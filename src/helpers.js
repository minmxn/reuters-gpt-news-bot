const { BOT_USERNAME } = require('../config');

// Escapes Telegram Markdown special characters so stray symbols in
// article titles/descriptions don't break message parsing.
function escapeMarkdown(text) {
  if (!text) return '';
  return text.replace(/([_*\[\]`])/g, '\\$1');
}

// Converts GitHub-flavoured Markdown that an LLM may emit into something
// Telegram's legacy Markdown can actually display. Telegram has no tables,
// headings or HTML, so those otherwise render as raw pipes / "###" / <br>.
function sanitizeForTelegram(text) {
  if (!text) return '';
  let t = text
    .replace(/\*\*(.+?)\*\*/g, '*$1*')    // **bold** (GFM) → *bold* (Telegram)
    .replace(/^#{1,6}\s*(.+?)\s*$/gm, '*$1*') // # Heading → *Heading*
    // Citation style: strip a connector word ("per"/"according to") when it
    // sits right before a source link, so "... per [Reuters](url)" becomes a
    // clean trailing "[Reuters](url)" tag (Claude-style) regardless of how
    // the model phrased it.
    .replace(/(^|[\s(])(?:per|according to)\s+(?=\[[^\]]+\]\([^)]+\))/gi, '$1');

  const out = [];
  for (const line of t.split('\n')) {
    const trimmed = line.trim();
    // Drop horizontal rules (---, ***, ___).
    if (/^([-*_])\1{2,}$/.test(trimmed)) continue;
    // Markdown table rows start with "|".
    if (trimmed.startsWith('|')) {
      // Skip the separator row (|---|:--:|).
      if (/^\|?[\s:|-]+\|?$/.test(trimmed)) continue;
      // <br> inside a cell becomes a space so the row stays one line.
      const cells = trimmed.split('|')
        .map(c => c.trim().replace(/<br\s*\/?>/gi, ' '))
        .filter(Boolean);
      if (cells.length) out.push('• ' + cells.join(' — '));
      continue;
    }
    // Outside a table, <br> is a real line break.
    out.push(line.replace(/<br\s*\/?>/gi, '\n'));
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// Truncates text to a max length and adds an ellipsis.
function truncate(text, max = 100) {
  if (!text) return '';
  return text.length > max ? text.substring(0, max).trim() + '...' : text;
}

const BLOCKED_DOMAINS = [
  'biztoc.com',   // scraper aggregator
  'alltoc.com',   // redirect aggregator
  'medium.com',   // blog platform, inconsistent quality
];

function isCleanUrl(url) {
  try { return !BLOCKED_DOMAINS.some(d => new URL(url).hostname.includes(d)); }
  catch { return false; }
}

// Builds the article list: limited count, truncated descriptions,
// and Markdown-safe text. Keeps messages under Telegram's 4096 char limit.
function buildNewsBody(articles, max = 10) {
  const clean = articles.filter(a => isCleanUrl(a.url));
  return clean.slice(0, max).map((a, i) =>
    `*${i + 1}. ${escapeMarkdown(a.title)}*\n${escapeMarkdown(truncate(a.description, 100))}\n[Read more](${a.url})`
  ).join('\n\n');
}

function formatNews(articles, label) {
  if (!articles || articles.length === 0) return 'No news found right now. Try again later!';
  return `📰 *${escapeMarkdown(label)}*\n\n${buildNewsBody(articles, 10)}`;
}

function shouldRespond(msg) {
  const isPrivate = msg.chat.type === 'private';
  const isMentioned = msg.text && msg.text.includes(`@${BOT_USERNAME}`);
  const isReply = msg.reply_to_message && msg.reply_to_message.from && msg.reply_to_message.from.username === BOT_USERNAME;
  return isPrivate || isMentioned || isReply;
}

function cleanMessage(text) {
  return text.replace(`@${BOT_USERNAME}`, '').trim();
}

module.exports = { escapeMarkdown, sanitizeForTelegram, truncate, buildNewsBody, formatNews, shouldRespond, cleanMessage };
