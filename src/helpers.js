const { BOT_USERNAME } = require('../config');

// Escapes Telegram Markdown special characters so stray symbols in
// article titles/descriptions don't break message parsing.
function escapeMarkdown(text) {
  if (!text) return '';
  return text.replace(/([_*\[\]`])/g, '\\$1');
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

module.exports = { escapeMarkdown, truncate, buildNewsBody, formatNews, shouldRespond, cleanMessage };
