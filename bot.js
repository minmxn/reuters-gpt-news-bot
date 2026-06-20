require('./config');
const TelegramBot = require('node-telegram-bot-api');
const { registerCommands } = require('./src/commands');
const { registerScheduler } = require('./src/scheduler');
const { registerReader } = require('./src/reader');
const { startWebServer } = require('./src/webserver');

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

registerCommands(bot);
registerScheduler(bot);
registerReader(bot);

// Mini App (swipeable web reader). Always serve the page; only expose the
// launch button + menu button once WEBAPP_URL points at the public domain.
startWebServer();

const WEBAPP_URL = process.env.WEBAPP_URL;
if (WEBAPP_URL) {
  bot.setChatMenuButton({ menu_button: { type: 'web_app', text: '📲 Reader', web_app: { url: WEBAPP_URL } } })
    .catch(err => console.error('setChatMenuButton failed:', err.message));

  bot.onText(/\/swipe|📲 Swipe/, (msg) => {
    if (msg.chat.type !== 'private') {
      bot.sendMessage(msg.chat.id, '📲 Open the swipe reader from a private chat with me — tap the ☰ menu button.');
      return;
    }
    bot.sendMessage(msg.chat.id, '📲 Tap below to open the swipe reader:', {
      reply_markup: { inline_keyboard: [[{ text: '📲 Open Swipe Reader', web_app: { url: WEBAPP_URL } }]] }
    });
  });
} else {
  console.warn('⚠️  WEBAPP_URL not set — Mini App launch button disabled (set it to your public Railway domain to enable /swipe).');
}

console.log('Nomo News Bot is running - BUILT BY MIN - all times SGT');
