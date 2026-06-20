require('dotenv').config();

const TZ = 'Asia/Singapore';
const BOT_USERNAME = process.env.BOT_USERNAME || 'nomogh_bot';
const CHAT_ID = process.env.CHAT_ID;
const NEWS_API_KEY = process.env.NEWS_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const WEBAPP_URL = process.env.WEBAPP_URL;

// Fail fast with a clear message if anything required is missing, instead of
// crashing later with a cryptic error mid-request.
//   required — the bot cannot start without these
//   recommended — the bot starts but some features are degraded
const REQUIRED = {
  TELEGRAM_TOKEN: 'Bot auth token from @BotFather — without it the bot cannot connect to Telegram.',
  NEWS_API_KEY: 'newsapi.org API key — without it no news can be fetched.',
};
const RECOMMENDED = {
  GROQ_API_KEY: 'Groq API key — without it AI briefings, summaries, polls and quizzes are skipped.',
  CHAT_ID: 'Target chat/channel id — without it scheduled posts have nowhere to go.',
};

const missingRequired = Object.keys(REQUIRED).filter(k => !process.env[k]);
const missingRecommended = Object.keys(RECOMMENDED).filter(k => !process.env[k]);

if (missingRecommended.length) {
  console.warn('⚠️  Missing recommended environment variables (some features will be degraded):');
  for (const k of missingRecommended) console.warn(`   - ${k}: ${RECOMMENDED[k]}`);
}

if (missingRequired.length) {
  console.error('❌ Cannot start — missing required environment variables:');
  for (const k of missingRequired) console.error(`   - ${k}: ${REQUIRED[k]}`);
  console.error('\nSet them in your .env file (local) or the service Variables (Railway), then restart.');
  process.exit(1);
}

module.exports = { TZ, BOT_USERNAME, CHAT_ID, NEWS_API_KEY, GROQ_API_KEY, TELEGRAM_TOKEN, WEBAPP_URL };
