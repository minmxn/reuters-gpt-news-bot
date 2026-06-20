require('./config');
const TelegramBot = require('node-telegram-bot-api');
const { registerCommands } = require('./src/commands');
const { registerScheduler } = require('./src/scheduler');
const { registerReader } = require('./src/reader');
const { startWebServer } = require('./src/webserver');
const { sendTopStoriesTeaser } = require('./src/teaser');

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

registerCommands(bot);
registerScheduler(bot);
registerReader(bot);

// Mini App (swipeable web reader). Always serve the page; only expose the
// launch button + menu button once WEBAPP_URL points at the public domain.
startWebServer();

const WEBAPP_URL = process.env.WEBAPP_URL;
if (WEBAPP_URL) {
  bot.setChatMenuButton({ menu_button: { type: 'web_app', text: '📰 News', web_app: { url: WEBAPP_URL } } })
    .catch(err => console.error('setChatMenuButton failed:', err.message));

  bot.onText(/\/news|\/swipe/, (msg) => {
    if (msg.chat.type !== 'private') {
      bot.sendMessage(msg.chat.id, "📰 Open today's news reader from a *private* chat with me — tap the ☰ button next to the message box.", { parse_mode: 'Markdown' });
      return;
    }
    sendTopStoriesTeaser(bot, msg.chat.id, { url: WEBAPP_URL, webApp: true });
  });
} else {
  console.warn('⚠️  WEBAPP_URL not set — Mini App launch button disabled (set it to your public Railway domain to enable /news).');
}

console.log('Nomo News Bot is running - BUILT BY MIN - all times SGT');
