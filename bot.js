require('./config');
const TelegramBot = require('node-telegram-bot-api');
const { registerCommands } = require('./src/commands');
const { registerScheduler } = require('./src/scheduler');
const { registerReader } = require('./src/reader');
const { startWebServer, getStories } = require('./src/webserver');

function escHtml(text) {
  return String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

registerCommands(bot);
registerScheduler(bot);
registerReader(bot);

// Mini App (swipeable web reader). Always serve the page; only expose the
// launch button + menu button once WEBAPP_URL points at the public domain.
startWebServer();

const WEBAPP_URL = process.env.WEBAPP_URL;
const READER_BANNER = 'https://placehold.co/1024x576/1a1a2e/FFD700.png?text=NOMO+NEWS';
if (WEBAPP_URL) {
  bot.setChatMenuButton({ menu_button: { type: 'web_app', text: '📰 News', web_app: { url: WEBAPP_URL } } })
    .catch(err => console.error('setChatMenuButton failed:', err.message));

  bot.onText(/\/news|\/swipe/, async (msg) => {
    if (msg.chat.type !== 'private') {
      bot.sendMessage(msg.chat.id, "📰 Open today's news reader from a *private* chat with me — tap the ☰ button next to the message box.", { parse_mode: 'Markdown' });
      return;
    }

    // Use the real top story as a teaser: its photo + headline, like a link preview.
    let top = null, count = 0;
    try {
      const stories = await getStories();
      if (stories && stories.length) { top = stories[0]; count = stories.length; }
    } catch (err) {
      console.error('/news teaser fetch failed:', err.message);
    }

    const caption = top
      ? `📰 <b>Today's Top Stories</b>\n\n<b>${escHtml(top.title)}</b>\n\n…and ${count - 1} more inside 👇`
      : "📰 <b>Today's Top Stories</b>\n\nTap below to read today's news 👇";
    const photo = (top && top.image) ? top.image : READER_BANNER;
    const opts = {
      caption,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: '📰 Read the news', web_app: { url: WEBAPP_URL } }]] }
    };

    try {
      await bot.sendPhoto(msg.chat.id, photo, opts);
    } catch (_) {
      await bot.sendPhoto(msg.chat.id, READER_BANNER, opts).catch(err => console.error('/news send failed:', err.message));
    }
  });
} else {
  console.warn('⚠️  WEBAPP_URL not set — Mini App launch button disabled (set it to your public Railway domain to enable /news).');
}

console.log('Nomo News Bot is running - BUILT BY MIN - all times SGT');
