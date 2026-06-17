require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const cron = require('node-cron');

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });
const CHAT_ID = process.env.CHAT_ID;
const NEWS_API_KEY = process.env.NEWS_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const BOT_USERNAME = process.env.BOT_USERNAME;

// Fetch news from NewsAPI
async function fetchNews(category, pageSize = 10) {
  const queries = {
    markets: 'stock market OR financial markets OR wall street',
    world: 'geopolitics OR world news OR international',
    technology: 'technology OR AI OR tech news',
  };

  const response = await axios.get('https://newsapi.org/v2/everything', {
    params: {
      q: queries[category],
      language: 'en',
      sortBy: 'publishedAt',
      pageSize,
      apiKey: NEWS_API_KEY,
    }
  });

  return response.data.articles;
}

// Fetch news by custom keyword
async function fetchNewsByKeyword(keyword, pageSize = 5) {
  const response = await axios.get('https://newsapi.org/v2/everything', {
    params: {
      q: keyword,
      language: 'en',
      sortBy: 'publishedAt',
      pageSize,
      apiKey: NEWS_API_KEY,
    }
  });
  return response.data.articles;
}

// Fetch news by country
async function fetchNewsByCountry(country) {
  const response = await axios.get('https://newsapi.org/v2/top-headlines', {
    params: {
      country,
      pageSize: 5,
      apiKey: NEWS_API_KEY,
    }
  });
  return response.data.articles;
}

// Ask Groq AI
async function askGroq(question, newsContext = '') {
  const prompt = `You are a witty, friendly financial and geopolitical news analyst built by the almighty Min.
You explain complex news in plain simple English that anyone can understand.
Keep answers concise, clear and occasionally add a light humorous remark.

${newsContext ? `Latest news context:\n${newsContext}\n\n` : ''}

Question: ${question}`;

  const response = await axios.post(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1000,
    },
    {
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      }
    }
  );

  return response.data.choices[0].message.content;
}

// Format news articles
function formatNews(articles, label) {
  if (!articles || articles.length === 0) return 'No news found right now. Try again later!';
  const body = articles.map((a, i) =>
    `*${i + 1}. ${a.title}*\n${a.description || ''}\n[Read more](${a.url})`
  ).join('\n\n');
  return `📰 *${label}*\n\n${body}`;
}

// Check if bot should respond
function shouldRespond(msg) {
  const isPrivate = msg.chat.type === 'private';
  const isMentioned = msg.text && msg.text.includes(`@${BOT_USERNAME}`);
  const isReply = msg.reply_to_message && msg.reply_to_message.from.username === BOT_USERNAME;
  return isPrivate || isMentioned || isReply;
}

// Clean bot mention from message
function cleanMessage(text) {
  return text.replace(`@${BOT_USERNAME}`, '').trim();
}

// Start command with keyboard buttons
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id,
    `👋 Hey welcome to *The Almighty News Bot!*\n\n` +
    `Built by the almighty Min 🙏⚡\n\n` +
    `Your personal AI news analyst — tap a button or ask me anything! 📰🤖\n\n` +
    `*Commands:*\n` +
    `📈 /markets — Market and stocks news\n` +
    `🌍 /world — World and geopolitics news\n` +
    `💻 /tech — Technology news\n` +
    `☀️ /briefing — Daily AI news summary\n` +
    `🔍 /search [keyword] — Search any topic\n` +
    `📊 /stock [ticker] — News about a stock\n` +
    `😎 /mood — Market sentiment today\n` +
    `🌏 /sg — Singapore news\n` +
    `🇺🇸 /us — US news\n` +
    `🇨🇳 /cn — China news\n\n` +
    `In a group mention me with @${BOT_USERNAME} to get my attention! 😎`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        keyboard: [
          [{ text: '📈 Markets' }, { text: '🌍 World' }],
          [{ text: '💻 Tech' }, { text: '☀️ Briefing' }],
          [{ text: '😎 Mood' }, { text: '🔍 Search' }],
        ],
        resize_keyboard: true,
        persistent: true
      }
    }
  );
});

// Markets
bot.onText(/\/markets|📈 Markets/, async (msg) => {
  bot.sendMessage(msg.chat.id, '📈 Pulling the latest market news...');
  try {
    const articles = await fetchNews('markets');
    bot.sendMessage(msg.chat.id, formatNews(articles, 'MARKETS News'), { parse_mode: 'Markdown' });
  } catch (err) {
    bot.sendMessage(msg.chat.id, `😬 Could not fetch markets news. Error: ${err.message}`);
  }
});

// World
bot.onText(/\/world|🌍 World/, async (msg) => {
  bot.sendMessage(msg.chat.id, '🌍 Fetching the latest world and geopolitics news...');
  try {
    const articles = await fetchNews('world');
    bot.sendMessage(msg.chat.id, formatNews(articles, 'WORLD News'), { parse_mode: 'Markdown' });
  } catch (err) {
    bot.sendMessage(msg.chat.id, `😬 Could not fetch world news. Error: ${err.message}`);
  }
});

// Tech
bot.onText(/\/tech|💻 Tech/, async (msg) => {
  bot.sendMessage(msg.chat.id, '💻 Getting the latest tech news...');
  try {
    const articles = await fetchNews('technology');
    bot.sendMessage(msg.chat.id, formatNews(articles, 'TECH News'), { parse_mode: 'Markdown' });
  } catch (err) {
    bot.sendMessage(msg.chat.id, `😬 Could not fetch tech news. Error: ${err.message}`);
  }
});

// Briefing
bot.onText(/\/briefing|☀️ Briefing/, async (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, '☀️ Hang tight — putting together your briefing...');
  try {
    const markets = await fetchNews('markets');
    const world = await fetchNews('world');
    const allNews = [...markets, ...world].map(a => a.title).join('\n');
    const summary = await askGroq(
      'Give me a short news briefing based on these headlines. Keep it friendly, simple and easy to understand.',
      allNews
    );
    bot.sendMessage(chatId,
      `☀️ *Your Daily Briefing*\n\n${summary}\n\n_Brought to you by the almighty Min_ 🙏`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    bot.sendMessage(chatId, `😬 Briefing failed. Error: ${err.message}`);
  }
});

// Search command
bot.onText(/\/search (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const keyword = match[1];
  bot.sendMessage(chatId, `🔍 Searching for *${keyword}*...`, { parse_mode: 'Markdown' });
  try {
    const articles = await fetchNewsByKeyword(keyword);
    bot.sendMessage(chatId, formatNews(articles, `Search: ${keyword.toUpperCase()}`), { parse_mode: 'Markdown' });
  } catch (err) {
    bot.sendMessage(chatId, `😬 Search failed. Error: ${err.message}`);
  }
});

// Search button prompt
bot.onText(/🔍 Search/, async (msg) => {
  bot.sendMessage(msg.chat.id, '🔍 Type /search followed by any topic!\n\nExamples:\n/search Bitcoin\n/search Nvidia earnings\n/search Singapore economy');
});

// Stock news command
bot.onText(/\/stock (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const ticker = match[1].toUpperCase();
  bot.sendMessage(chatId, `📊 Fetching latest news for *${ticker}*...`, { parse_mode: 'Markdown' });
  try {
    const articles = await fetchNewsByKeyword(ticker);
    bot.sendMessage(chatId, formatNews(articles, `${ticker} News`), { parse_mode: 'Markdown' });
  } catch (err) {
    bot.sendMessage(chatId, `😬 Could not fetch stock news. Error: ${err.message}`);
  }
});

// Market mood / sentiment
bot.onText(/\/mood|😎 Mood/, async (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, '😎 Checking the market mood today...');
  try {
    const articles = await fetchNews('markets');
    const headlines = articles.map(a => a.title).join('\n');
    const mood = await askGroq(
      'Based on these headlines, what is the overall market sentiment today? Is it bullish, bearish or neutral? Give a fun one paragraph summary with an emoji mood rating out of 5.',
      headlines
    );
    bot.sendMessage(chatId, `😎 *Market Mood Today*\n\n${mood}\n\n_Brought to you by the almighty Min_ 🙏`, { parse_mode: 'Markdown' });
  } catch (err) {
    bot.sendMessage(chatId, `😬 Could not check market mood. Error: ${err.message}`);
  }
});

// Singapore news
bot.onText(/\/sg/, async (msg) => {
  bot.sendMessage(msg.chat.id, '🌏 Fetching Singapore news...');
  try {
    const articles = await fetchNewsByCountry('sg');
    bot.sendMessage(msg.chat.id, formatNews(articles, '🌏 SINGAPORE News'), { parse_mode: 'Markdown' });
  } catch (err) {
    bot.sendMessage(msg.chat.id, `😬 Could not fetch Singapore news. Error: ${err.message}`);
  }
});

// US news
bot.onText(/\/us/, async (msg) => {
  bot.sendMessage(msg.chat.id, '🇺🇸 Fetching US news...');
  try {
    const articles = await fetchNewsByCountry('us');
    bot.sendMessage(msg.chat.id, formatNews(articles, '🇺🇸 US News'), { parse_mode: 'Markdown' });
  } catch (err) {
    bot.sendMessage(msg.chat.id, `😬 Could not fetch US news. Error: ${err.message}`);
  }
});

// China news
bot.onText(/\/cn/, async (msg) => {
  bot.sendMessage(msg.chat.id, '🇨🇳 Fetching China news...');
  try {
    const articles = await fetchNewsByCountry('cn');
    bot.sendMessage(msg.chat.id, formatNews(articles, '🇨🇳 CHINA News'), { parse_mode: 'Markdown' });
  } catch (err) {
    bot.sendMessage(msg.chat.id, `😬 Could not fetch China news. Error: ${err.message}`);
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
    const answer = await askGroq(question, newsContext);
    bot.sendMessage(chatId, `🤖 *Here is what I found:*\n\n${answer}`, { parse_mode: 'Markdown' });
  } catch (err) {
    bot.sendMessage(chatId, `😬 Could not answer that. Error: ${err.message}`);
  }
});

// Plain text and group mention handler
bot.on('message', async (msg) => {
  const text = msg.text;
  if (!text) return;
  if (text.startsWith('/')) return;
  if (['📈 Markets', '🌍 World', '💻 Tech', '☀️ Briefing', '😎 Mood', '🔍 Search'].includes(text)) return;
  if (!shouldRespond(msg)) return;

  const chatId = msg.chat.id;
  const question = cleanMessage(text);
  if (!question) return;

  bot.sendMessage(chatId, '🤔 On it — checking the latest news for you...');
  try {
    const articles = await fetchNews('markets');
    const newsContext = articles.map(a => a.title).join('\n');
    const answer = await askGroq(question, newsContext);
    bot.sendMessage(chatId, `🤖 *Here is what I found:*\n\n${answer}`, { parse_mode: 'Markdown' });
  } catch (err) {
    bot.sendMessage(chatId, `😬 Could not answer that. Error: ${err.message}`);
  }
});

// Auto update every 1 hour with top 15 news
cron.schedule('0 * * * *', async () => {
  try {
    const markets = await fetchNews('markets', 10);
    const world = await fetchNews('world', 10);
    const tech = await fetchNews('technology', 10);
    const topNews = [...markets, ...world, ...tech].slice(0, 15);
    const newsText = topNews.map((a, i) =>
      `*${i + 1}. ${a.title}*\n${a.description || ''}\n[Read more](${a.url})`
    ).join('\n\n');
    bot.sendMessage(CHAT_ID,
      `🔔 *Hourly News Update*\n\n${newsText}\n\n_Brought to you by the almighty Min_ 🙏⚡`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    console.error('Auto update error:', err.message);
  }
});

// Morning briefing at 8am daily
cron.schedule('0 8 * * *', async () => {
  try {
    const markets = await fetchNews('markets');
    const world = await fetchNews('world');
    const allNews = [...markets, ...world].map(a => a.title).join('\n');
    const summary = await askGroq(
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

console.log('✅ The Almighty News Bot is running — built by the almighty Min 🙏');
