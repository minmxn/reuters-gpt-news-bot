const { fetchCombinedNews } = require('./news');
const { generateSummaries } = require('./groq');
const { escapeMarkdown, truncate } = require('./helpers');

// Fallback image Telegram can fetch when an article has no usable photo.
const PLACEHOLDER = 'https://placehold.co/1024x576/1a1a2e/FFD700.png?text=NOMO+NEWS';
const STORY_COUNT = 10;
const SESSION_TTL = 6 * 60 * 60 * 1000; // 6 hours

// In-memory carousel sessions: sid -> { articles, summaries, index, createdAt }
const sessions = new Map();
let sidCounter = 0;

function pruneSessions() {
  const now = Date.now();
  for (const [sid, s] of sessions) {
    if (now - s.createdAt > SESSION_TTL) sessions.delete(sid);
  }
}

function photoUrl(article) {
  return article.urlToImage || PLACEHOLDER;
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

async function startReader(bot, chatId) {
  pruneSessions();
  const loading = await bot.sendMessage(chatId, '📖 Loading your news reader...');
  try {
    const articles = (await fetchCombinedNews(STORY_COUNT)).slice(0, STORY_COUNT);
    if (articles.length === 0) {
      await bot.editMessageText('😬 No news available right now. Try again later!', { chat_id: chatId, message_id: loading.message_id });
      return;
    }
    const summaries = await generateSummaries(articles).catch(err => {
      console.error('Reader summary generation failed, using descriptions:', err.message);
      return [];
    });

    const sid = String(++sidCounter);
    sessions.set(sid, { articles, summaries, index: 0, createdAt: Date.now() });

    const a = articles[0];
    const opts = { caption: buildCaption(a, summaries[0], 0, articles.length), parse_mode: 'Markdown', reply_markup: buildKeyboard(sid, a) };
    try {
      await bot.sendPhoto(chatId, photoUrl(a), opts);
    } catch (_) {
      await bot.sendPhoto(chatId, PLACEHOLDER, opts);
    }
    await bot.deleteMessage(chatId, loading.message_id).catch(() => {});
  } catch (err) {
    await bot.editMessageText(`😬 Could not load the reader. Error: ${err.message}`, { chat_id: chatId, message_id: loading.message_id }).catch(() => {});
  }
}

function registerReader(bot) {
  bot.onText(/\/read|📖 Read/, (msg) => startReader(bot, msg.chat.id));

  bot.on('callback_query', async (q) => {
    const data = q.data || '';
    if (!data.startsWith('rd:')) return;

    const [, action, sid] = data.split(':');
    const s = sessions.get(sid);
    if (!s) {
      bot.answerCallbackQuery(q.id, { text: 'This reader expired — send /read again.', show_alert: false });
      return;
    }

    const total = s.articles.length;
    s.index = (s.index + (action === 'n' ? 1 : -1) + total) % total;
    const a = s.articles[s.index];

    const media = { type: 'photo', media: photoUrl(a), caption: buildCaption(a, s.summaries[s.index], s.index, total), parse_mode: 'Markdown' };
    const editOpts = { chat_id: q.message.chat.id, message_id: q.message.message_id, reply_markup: buildKeyboard(sid, a) };
    try {
      await bot.editMessageMedia(media, editOpts);
    } catch (_) {
      media.media = PLACEHOLDER;
      try { await bot.editMessageMedia(media, editOpts); } catch (e) { console.error('Reader edit failed:', e.message); }
    }
    bot.answerCallbackQuery(q.id);
  });
}

module.exports = { registerReader };
