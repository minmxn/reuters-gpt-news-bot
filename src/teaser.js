const { getStories } = require('./webserver');

const BANNER = 'https://placehold.co/1024x576/1a1a2e/FFD700.png?text=NOMO+NEWS';

function escHtml(text) {
  return String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Sends a "Today's Top Stories" teaser card: the real top-story photo +
// headline + a button that opens the reader.
//   opts.url     — the Mini App URL
//   opts.webApp  — true for private chats (native Mini App button); false
//                  for groups/channels (plain link button, since web_app
//                  inline buttons only work in private chats)
async function sendTopStoriesTeaser(bot, chatId, opts = {}) {
  let top = null, count = 0;
  try {
    const stories = await getStories();
    if (stories && stories.length) { top = stories[0]; count = stories.length; }
  } catch (err) {
    console.error('Teaser fetch failed:', err.message);
  }

  const caption = top
    ? `📰 <b>Today's Top Stories</b>\n\n<b>${escHtml(top.title)}</b>\n\n…and ${count - 1} more inside 👇`
    : "📰 <b>Today's Top Stories</b>\n\nTap below to read today's news 👇";
  const photo = (top && top.image) ? top.image : BANNER;

  const button = opts.url
    ? (opts.webApp
        ? { text: '📰 Read the news', web_app: { url: opts.url } }
        : { text: '📰 Read the news', url: opts.url })
    : null;
  const sendOpts = {
    caption,
    parse_mode: 'HTML',
    reply_markup: button ? { inline_keyboard: [[button]] } : undefined
  };

  try {
    await bot.sendPhoto(chatId, photo, sendOpts);
  } catch (_) {
    await bot.sendPhoto(chatId, BANNER, sendOpts).catch(err => console.error('Teaser send failed:', err.message));
  }
}

module.exports = { sendTopStoriesTeaser };
