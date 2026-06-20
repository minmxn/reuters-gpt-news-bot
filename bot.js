require('./config');
const TelegramBot = require('node-telegram-bot-api');
const { registerCommands } = require('./src/commands');
const { registerScheduler } = require('./src/scheduler');
const { registerReader } = require('./src/reader');

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

registerCommands(bot);
registerScheduler(bot);
registerReader(bot);

console.log('Nomo News Bot is running - BUILT BY MIN - all times SGT');
