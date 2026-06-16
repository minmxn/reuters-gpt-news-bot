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
  const prompt = `You are a friendly financial and geopolitical news analyst.
Answer in plain simple English that anyone can understand.

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
  const header = `📰 *Reuters ${category.toUpperCase()} News*\n\n`;
  const body = articles.map((a, i) =>
    `*${i + 1}. ${a.title}*\n${a.contentSnippet || ''}\n[Read more](${a.link})`
  ).join('\n\n');
  return header + body;
}

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id,
    `👋 Wah lau eh welcome to *Wah Lau News Bot!* 🤣\n\n` +
    `Here is what I can do:\n\n` +
    `📈 /markets — Latest market news\n` +
    `🌍 /world — World and geopolitics news\n` +
    `💻 /tech — Technology news\n` +
    `☀️ /briefing — Your daily news summary\n` +
    `🤖 /ask [question] — Ask me anything\n\n` +
    `Or just type any question and I will answer lah!`,
    { parse_mode: 'Markdown' }
  );
});

bot.onText(/\/markets/, async (msg) => {
  bot.sendMessage(msg.chat.id, '⏳ Fetching latest Reuters markets news...');
  try {
    const articles = await fetchReutersNews('markets');
    bot.sendMessage(msg.chat.id, formatNews(articles, 'markets'), { parse_mode: 'Markdown' });
  } catch (err) {
    bot.sendMessage(msg.chat.id, '❌ Cannot fetch news. Try again later.');
  }
});

bot.onText(/\/world/, async (msg) => {
  bot.sendMessage(msg.chat.id, '⏳ Fetching latest Reuters world news...');
  try {
    const articles = await fetchReutersNews('world');
    bot.sendMessage(msg.chat.id, formatNews(articles, 'world'), { parse_mode: 'Markdown' });
  } catch (err) {
    bot.sendMessage(msg.chat.id, '❌ Cannot fetch news. Try again later.');
  }
});

bot.onText(/\/tech/, async (msg) => {
  bot.sendMessage(msg.chat.id, '⏳ Fetching latest Reuters tech news...');
  try {
    const articles = await fetchReutersNews('technology');
    bot.sendMessage(msg.chat.id, formatNews(articles, 'technology'), { parse_mode: 'Markdown' });
  } catch (err) {
    bot.sendMessage(msg.chat.id, '❌ Cannot fetch news. Try again later.');
  }
});

bot.onText(/\/briefing/, async (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, '☀️ Generating your news briefing...');
  try {
    const markets = await fetchReutersNews('markets');
    const world = await fetchReutersNews('world');
    const allNews = [...markets, ...world].map(a => a.title).join('\n');
    const summary = await askGemini(
      'Give me a short morning briefing based on these headlines. Keep it simple, friendly and easy to understand.',
      allNews
    );
    bot.sendMessage(chatId, `☀️ *Your Daily Briefing*\n\n${summary}`, { parse_mode: 'Markdown' });
  } catch (err) {
    bot.sendMessage(chatId, '❌ Something went wrong. Try again.');
  }
});

bot.onText(/\/ask (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const question = match[1];
  bot.sendMessage(chatId, '🤔 Let me check and answer that...');
  try {
    const articles = await fetchReutersNews('markets');
    const newsContext = articles.map(a => a.title).join('\n');
    const answer = await askGemini(question, newsContext);
    bot.sendMessage(chatId, `🤖 *Answer:*\n\n${answer}`, { parse_mode: 'Markdown' });
  } catch (err) {
    bot.sendMessage(chatId, '❌ Something went wrong. Try again.');
  }
});

bot.on('message', async (msg) => {
  if (msg.text && !msg.text.startsWith('/')) {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, '🤔 Checking latest news and thinking...');
    try {
      const articles = await fetchReutersNews('markets');
      const newsContext = articles.map(a => a.title).join('\n');
      const answer = await askGemini(msg.text, newsContext);
      bot.sendMessage(chatId, `🤖 *Answer:*\n\n${answer}`, { parse_mode: 'Markdown' });
    } catch (err) {
      bot.sendMessage(chatId, '❌ Something went wrong. Try again.');
    }
  }
});

cron.schedule('0 8 * * *', async () => {
  try {
    const markets = await fetchReutersNews('markets');
    const world = await fetchReutersNews('world');
    const allNews = [...markets, ...world].map(a => a.title).join('\n');
    const summary = await askGemini(
      'Give me a short morning briefing. Keep it simple, friendly and easy to understand.',
      allNews
    );
    bot.sendMessage(CHAT_ID,
      `☀️ *Good Morning! Wah Lau News Briefing*\n\n${summary}`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    console.error('Morning briefing failed:', err);
  }
});

console.log('✅ Wah Lau News Bot is running...');
