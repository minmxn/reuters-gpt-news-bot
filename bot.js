require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const Parser = require('rss-parser');
const cron = require('node-cron');

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });
const parser = new Parser();
const CHAT_ID = process.env.CHAT_ID;

const FEEDS = {
  markets: 'https://feeds.content.dowjones.io/public/rss/mw_realtimeheadlines',
  world: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml',
  technology: 'https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml',
};

async function fetchNews(category = 'markets') {
  const feed = await parser.parseURL(FEEDS[category]);
  return feed.items.slice(0, 5);
}

async function askGemini(question, newsContext = '') {
  const prompt = `You are a witty, friendly financial and geopolitical news analyst built by the almighty Min.
You explain complex news in plain simple English that anyone can understand.
Keep answers concise, clear and occasionally add a light humorous remark.

${newsContext ? `Latest news context:\n${newsContext}\n\n` : ''}

Question: ${question}`;

  const response = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      contents: [{ parts: [{ text: prompt }] }]
    },
    {
      headers: { 'Content-Type': 'application/json' }
    }
  );

  if (response.data.error) {
    throw new Error(`Gemini error: ${response.data.error.message}`);
  }

  return response.data.candidates[0].content.parts[0].text;
}

function formatNews(articles, category) {
  const emojis = { markets: '📈', world: '🌍', technology: '💻' };
  const header = `${emojis[category] || '📰'} *${category.toUpperCase()} News*\n\n`;
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
    `Your personal AI news analyst — straight from the headlines, explained like a friend 📰🤖\n\n` +
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
  bot.sendMessage(msg.chat.id, '📈 Pulling the latest market news...');
  try {
    const articles = await fetchNews('markets');
    bot.sendMessage(msg.chat.id, formatNews(articles, 'markets'), { parse_mode: 'Markdown' });
  } catch (err) {
    console.error('Markets error:', err.message);
    bot.sendMessage(msg.chat.id, `😬 Could not fetch markets news. Error: ${err.message}`);
  }
});

// World
bot.onText(/\/world/, async (msg) => {
  bot.sendMessage(msg.chat.id, '🌍 Fetching the latest world and geopolitics news...');
  try {
    const articles = await fetchNews('world');
    bot.sendMessage(msg.chat.id, formatNews(articles, 'world'), { parse_mode: 'Markdown' });
  } catch (err) {
    console.error('World error:', err.message);
    bot.sendMessage(msg.chat.id, `😬 Could not fetch world news. Error: ${err.message}`);
  }
});

// Tech
bot.onText(/\/tech/, async (msg) => {
  bot.sendMessage(msg.chat.id, '💻 Getting the latest tech news...');
  try {
    const articles = await fetchNews('technology');
    bot.sendMessage(msg.chat.id, formatNews(articles, 'technology'), { parse_mode: 'Markdown' });
  } catch (err) {
    console.error('Tech error:', err.message);
    bot.sendMessage(msg.chat.id, `😬 Could not fetch tech news. Error: ${err.message}`);
  }
});

// Briefing
bot.onText(/\/briefing/, async (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, '☀️ Hang tight — putting together your briefing...');
  try {
    const markets = await fetchNews('markets');
    const world = await fetchNews('world');
    const allNews = [...markets, ...world].map(a => a.title).join('\n');
    const summary = await askGemini(
      'Give me a short news briefing based on these headlines. Keep it friendly, simple and easy to understand.',
      allNews
    );
    bot.sendMessage(chatId,
      `☀️ *Your Daily Briefing*\n\n${summary}\n\n_Brought to you by the almighty Min_ 🙏`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    console.error('Briefing error:', err.message);
    bot.sendMessage(chatId, `😬 Briefing failed. Error: ${err.message}`);
  }
});

// Ask command
bot.onText(/\/ask (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const question = match[1];
  bot.sendMessage(chatId, '🤔 Good question — let me check the latest news and get back to you...');
  try {
    const articles = await fetchNews('markets');
    const newsContext = articles.map(a => a.title).join('\n');
    const answer = await askGemini(question, newsContext);
    bot.sendMessage(chatId, `🤖 *Here is what I found:*\n\n${answer}`, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error('Ask error:', err.message);
    bot.sendMessage(chatId, `😬 Could not answer that. Error: ${err.message}`);
  }
});

// Plain text questions
bot.on('message', async (msg) => {
  if (msg.text && !msg.text.startsWith('/')) {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, '🤔 On it — checking the latest news for you...');
    try {
      const articles = await fetchNews('markets');
      const newsContext = articles.map(a => a.title).join('\n');
      const answer = await askGemini(msg.text, newsContext);
      bot.sendMessage(chatId, `🤖 *Here is what I found:*\n\n${answer}`, { parse_mode: 'Markdown' });
    } catch (err) {
      console.error('Message error:', err.message);
      bot.sendMessage(chatId, `😬 Could not answer that. Error: ${err.message}`);
    }
  }
});

// Morning briefing at 8am daily
cron.schedule('0 8 * * *', async () => {
  try {
    const markets = await fetchNews('markets');
    const world = await fetchNews('world');
    const allNews = [...markets, ...world].map(a => a.title).join('\n');
    const summary = await askGemini(
      'Give me a short friendly morning briefing. Simple, clear and easy to understand.',
      allNews
    );
    bot.sendMessage(CHAT_ID,
      `☀️ *Good Morning! Your Daily Briefing is here*\n\n${summary}\n\n_Brought to you by the almighty Min_ 🙏⚡`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    console.error('Morning briefing error:', err.message);
  }
});

console.log('✅ Reuters GPT Bot is running — built by the almighty Min 🙏');
