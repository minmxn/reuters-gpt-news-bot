require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const Parser = require('rss-parser');
const cron = require('node-cron');

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });
const parser = new Parser();
const CHAT_ID = process.env.CHAT_ID;

const FEEDS = {
  markets: 'https://feeds.reuters.com/reuters/businessNews',
  world: 'https://feeds.reuters.com/Reuters/worldNews',
  technology: 'https://feeds.reuters.com/reuters/technologyNews',
};

async function fetchReutersNews(category = 'markets') {
  const feed = await parser.parseURL(FEEDS[category]);
  return feed.items.slice(0, 5);
}

async function askGemini(question, newsContext = '') {
  const prompt = `You are a witty, friendly financial and geopolitical news analyst built by the almighty Min.
You explain complex news in plain simple English that anyone can understand.
Keep answers concise, clear and occasionally add a light humorous remark.

${newsContext ? `Latest Reuters news:\n${newsContext}\n\n` : ''}

Question: ${question}`;

  const response = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      contents: [{ parts: [{ text: prompt }] }]
    },
    {
      headers: { 'Content-Type': 'application/json' }
    }
  );

  return response.data.candidates[0].content.parts[0].text;
}

function formatNews(articles, category) {
  const emojis = { markets: '📈', world: '🌍', technology: '💻' };
  const header = `${emojis[category] || '📰'} *Reuters ${category.toUpperCase()} News*\n\n`;
  const body = articles.map((a, i) =>
    `*${i + 1}. ${a.title}*\n${a.contentSnippet || ''}\n[Read more](${a.link})`
  ).join('\n\n');
  return header + body;
}

// Start command
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id,
    `👋 Hey welcome to *Reuters GPT Bot!*\n\n` +
    `Built by the almighty Min 🙏⚡\n\n` +
    `Your personal AI news analyst — straight from Reuters, explained like a friend 📰🤖\n\n` +
    `Here is what I can do:\n\n` +
    `📈 /markets — Latest market and stocks news\n` +
    `🌍 /world — World and geopolitics news\n` +
    `💻 /tech — Technology news\n` +
    `☀️ /briefing — Your daily AI news summary\n` +
    `🤖 /ask [question] — Ask me anything\n\n` +
    `Or just type any question naturally and I will handle the rest! 😎`,
    { parse_mode: 'Markdown' }
  );
});

// Markets
bot.onText(/\/markets/, async (msg) => {
  bot.sendMessage(msg.chat.id, '📈 Pulling the latest market news from Reuters...');
  try {
    const articles = await fetchReutersNews('markets');
    bot.sendMessage(msg.chat.id, formatNews(articles, 'markets'), { parse_mode: 'Markdown' });
  } catch (err) {
    bot.sendMessage(msg.chat.id, '😬 Could not fetch markets news right now. Try again in a bit!');
  }
});

// World
bot.onText(/\/world/, async (msg) => {
  bot.sendMessage(msg.chat.id, '🌍 Fetching the latest world and geopolitics news...');
  try {
    const articles = await fetchReutersNews('world');
    bot.sendMessage(msg.chat.id, formatNews(articles, 'world'), { parse_mode: 'Markdown' });
  } catch (err) {
    bot.sendMessage(msg.chat.id, '😬 Could not fetch world news right now. Try again in a bit!');
  }
});

// Tech
bot.onText(/\/tech/, async (msg) => {
  bot.sendMessage(msg.chat.id, '💻 Getting the latest tech news...');
  try {
    const articles = await fetchReutersNews('technology');
    bot.sendMessage(msg.chat.id, formatNews(articles, 'technology'), { parse_mode: 'Markdown' });
  } catch (err) {
    bot.sendMessage(msg.chat.id, '😬 Could not fetch tech news right now. Try again in a bit!');
  }
});

// Briefing
bot.onText(/\/briefing/, async (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, '☀️ Hang tight — putting together your briefing...');
  try {
    const markets = await fetchReutersNews('markets');
    const world = await fetchReutersNews('world');
    const allNews = [...markets, ...world].map(a => a.title).join('\n');
    const summary = await askGemini(
      'Give me a short news briefing based on these headlines. Keep it friendly, simple and easy to understand.',
      allNews
    );
    bot.sendMessage(chatId,
      `☀️ *Your Daily Briefing — by Reuters GPT Bot*\n\n${summary}\n\n_Powered by the almighty Min_ 🙏`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    bot.sendMessage(chatId, '😬 Something went wrong with your briefing. Try again!');
  }
});

// Ask command
bot.onText(/\/ask (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const question = match[1];
  bot.sendMessage(chatId, '🤔 Good question — let me check the latest news and get back to you...');
  try {
    const articles = await fetchReutersNews('markets');
    const newsContext = articles.map(a => a.title).join('\n');
    const answer = await askGemini(question, newsContext);
    bot.sendMessage(chatId, `🤖 *Here is what I found:*\n\n${answer}`, { parse_mode: 'Markdown' });
  } catch (err) {
    bot.sendMessage(chatId, '😬 Something went wrong. Try asking again!');
  }
});

// Plain text questions
bot.on('message', async (msg) => {
  if (msg.text && !msg.text.startsWith('/')) {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, '🤔 On it — checking the latest news for you...');
    try {
      const articles = await fetchReutersNews('markets');
      const newsContext = articles.map(a => a.title).join('\n');
      const answer = await askGemini(msg.text, newsContext);
      bot.sendMessage(chatId, `🤖 *Here is what I found:*\n\n${answer}`, { parse_mode: 'Markdown' });
    } catch (err) {
      bot.sendMessage(chatId, '😬 Something went wrong. Try again!');
    }
  }
});

// Morning briefing at 8am daily
cron.schedule('0 8 * * *', async () => {
  try {
    const markets = await fetchReutersNews('markets');
    const world = await fetchReutersNews('world');
    const allNews = [...markets, ...world].map(a => a.title).join('\n');
    const summary = await askGemini(
      'Give me a short friendly morning briefing. Simple, clear and easy to understand.',
      allNews
    );
    bot.sendMessage(CHAT_ID,
      `☀️ *Good Morning! Your Daily Reuters Briefing is here*\n\n${summary}\n\n_Brought to you by the almighty Min_ 🙏⚡`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    console.error('Morning briefing failed:', err);
  }
});

console.log('✅ Reuters GPT Bot is running — built by the almighty Min 🙏');
