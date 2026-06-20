const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { fetchCombinedNews } = require('./news');
const { generateSummaries } = require('./groq');
const { escapeMarkdown, truncate } = require('./helpers');

// Fallback image Telegram can fetch when an article has no usable photo.
const PLACEHOLDER = 'https://placehold.co/1024x576/1a1a2e/FFD700.png?text=NOMO+NEWS';
const STORY_COUNT = 10;
const SESSION_TTL = 24 * 60 * 60 * 1000; // 24 hours

// Where sessions are persisted. Set READER_STORE to a Railway volume path
// (e.g. /data/reader-sessions.json) so sessions also survive redeploys.
const STORE_PATH = process.env.READER_STORE || path.join(__dirname, '..', 'reader-sessions.json');

// Carousel sessions:
//   sid -> { articles, summaries, buffers, fileIds, index, createdAt }
// buffers[i]  = pre-downloaded image Buffer (or null) — NOT persisted
// fileIds[i]  = Telegram file_id cached after the photo is first shown
const sessions = new Map();
let sidCounter = 0;

// Persists sessions to disk (without the large image buffers — cached
// Telegram file_ids stay valid across restarts and do the same job).
function saveSessions() {
  try {
    const obj = {};
    for (const [sid, s] of sessions) {
      obj[sid] = { articles: s.articles, summaries: s.summaries, fileIds: s.fileIds, index: s.index, createdAt: s.createdAt };
    }
    fs.writeFileSync(STORE_PATH, JSON.stringify(obj));
  } catch (e) {
    console.error('Reader session save failed:', e.message);
  }
}

function loadSessions() {
  try {
    if (!fs.existsSync(STORE_PATH)) return;
    const obj = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    const now = Date.now();
    let maxSid = 0;
    for (const [sid, s] of Object.entries(obj)) {
      if (!s || now - s.createdAt > SESSION_TTL) continue;
      sessions.set(sid, { articles: s.articles, summaries: s.summaries || [], fileIds: s.fileIds || {}, index: s.index || 0, buffers: [], createdAt: s.createdAt });
      const n = parseInt(sid, 10);
      if (!Number.isNaN(n) && n > maxSid) maxSid = n;
    }
    sidCounter = maxSid; // keep new ids from colliding with restored ones
  } catch (e) {
    console.error('Reader session load failed:', e.message);
  }
}

function pruneSessions() {
  const now = Date.now();
  let removed = false;
  for (const [sid, s] of sessions) {
    if (now - s.createdAt > SESSION_TTL) { sessions.delete(sid); removed = true; }
  }
  if (removed) saveSessions();
}

// Pre-downloads an image so we can upload the bytes to Telegram directly
// instead of making Telegram fetch a slow source URL on every tap.
async function fetchBuffer(url) {
  if (!url) return null;
  try {
    const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 8000, maxContentLength: 6 * 1024 * 1024 });
    const type = (res.headers['content-type'] || '').toLowerCase();
    if (!type.includes('jpeg') && !type.includes('jpg') && !type.includes('png')) return null;
    return Buffer.from(res.data);
  } catch (_) {
    return null;
  }
}

function buildCaption(article, summary, idx, total) {
  const src = escapeMarkdown((article.source && article.source.name) || 'Nomo Wire');
  const badge = idx === 0 ? '🔴 TOP STORY · ' : '📰 ';
  const title = escapeMarkdown(truncate(article.title, 180));
  const body = escapeMarkdown(truncate(summary || article.description || 'No summary available.', 600));
  return `${badge}*${src}*\n*${title}*\n\n${body}\n\n📖 Story ${idx + 1} / ${total}`;
}

function buildKeyboard(sid, article) {
  return {
    inline_keyboard: [
      [
        { text: '◀ Prev', callback_data: `rd:p:${sid}` },
        { text: 'Next ▶', callback_data: `rd:n:${sid}` }
      ],
      [{ text: '📖 Read full story', url: article.url || 'https://t.me' }]
    ]
  };
}

// Ordered list of image sources to try for a story: cached file_id (instant),
// pre-downloaded buffer, raw URL, then the placeholder.
function imageSources(s, i) {
  const out = [];
  if (s.fileIds[i]) out.push(s.fileIds[i]);
  if (s.buffers[i]) out.push(s.buffers[i]);
  if (s.articles[i].urlToImage) out.push(s.articles[i].urlToImage);
  out.push(PLACEHOLDER);
  return out;
}

function extractFileId(msg) {
  if (msg && Array.isArray(msg.photo) && msg.photo.length) {
    return msg.photo[msg.photo.length - 1].file_id;
  }
  return null;
}

// opts.articles — pre-fetched articles to reuse (skips a NewsAPI call)
// opts.silent   — skip the "Loading…" message (used for scheduled posts)
async function startReader(bot, chatId, opts = {}) {
  pruneSessions();
  const loading = opts.silent ? null : await bot.sendMessage(chatId, '📖 Loading your news reader...');
  const fail = async (text) => {
    if (loading) await bot.editMessageText(text, { chat_id: chatId, message_id: loading.message_id }).catch(() => {});
    else await bot.sendMessage(chatId, text).catch(() => {});
  };
  try {
    const articles = (opts.articles || await fetchCombinedNews(STORY_COUNT)).slice(0, STORY_COUNT);
    if (articles.length === 0) {
      await fail('😬 No news available right now. Try again later!');
      return;
    }

    // Pre-fetch summaries and all images up front so navigation is fast.
    const [summaries, buffers] = await Promise.all([
      generateSummaries(articles).catch(err => {
        console.error('Reader summary generation failed, using descriptions:', err.message);
        return [];
      }),
      Promise.all(articles.map(a => fetchBuffer(a.urlToImage)))
    ]);

    const sid = String(++sidCounter);
    const s = { articles, summaries, buffers, fileIds: {}, index: 0, createdAt: Date.now() };
    sessions.set(sid, s);

    const a = articles[0];
    const sendOpts = { caption: buildCaption(a, summaries[0], 0, articles.length), parse_mode: 'Markdown', reply_markup: buildKeyboard(sid, a) };
    for (const src of imageSources(s, 0)) {
      try {
        const sent = await bot.sendPhoto(chatId, src, sendOpts);
        const fid = extractFileId(sent);
        if (fid) s.fileIds[0] = fid;
        break;
      } catch (_) { /* try next source */ }
    }
    saveSessions();
    if (loading) await bot.deleteMessage(chatId, loading.message_id).catch(() => {});
  } catch (err) {
    await fail(`😬 Could not load the reader. Error: ${err.message}`);
  }
}

function registerReader(bot) {
  loadSessions();
  bot.onText(/\/read|📖 Read/, (msg) => startReader(bot, msg.chat.id));

  bot.on('callback_query', async (q) => {
    const data = q.data || '';
    if (!data.startsWith('rd:')) return;

    const [, action, sid] = data.split(':');
    const s = sessions.get(sid);
    if (!s) {
      bot.answerCallbackQuery(q.id, { text: 'This reader expired — send /read again.' });
      return;
    }

    // Acknowledge immediately so the button stops spinning.
    bot.answerCallbackQuery(q.id).catch(() => {});

    const total = s.articles.length;
    s.index = (s.index + (action === 'n' ? 1 : -1) + total) % total;
    const i = s.index;
    const a = s.articles[i];

    const caption = buildCaption(a, s.summaries[i], i, total);
    const editOpts = { chat_id: q.message.chat.id, message_id: q.message.message_id, reply_markup: buildKeyboard(sid, a) };
    for (const src of imageSources(s, i)) {
      try {
        const res = await bot.editMessageMedia({ type: 'photo', media: src, caption, parse_mode: 'Markdown' }, editOpts);
        const fid = extractFileId(res);
        if (fid) s.fileIds[i] = fid;
        break;
      } catch (_) { /* try next source */ }
    }
    saveSessions();
  });
}

module.exports = { registerReader, startReader };
