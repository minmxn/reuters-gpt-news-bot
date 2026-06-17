require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const cron = require('node-cron');

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });
const CHAT_ID = process.env.CHAT_ID;
const NEWS_API_KEY = process.env.NEWS_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

// Fetch news from NewsAPI
async function fetchNews(category) {
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
function formatNews(articles, category) {
  const emojis = { markets: '📈', world: '🌍', technology: '💻' };
  if (!articles || articles.length === 0) return 'No news found right now. Try again later!';
  const header = `${emojis[category] || '📰'} *${category.toUpperCase()} News*\n\n`;
  const body = articles.map((a, i) =>
    `*${i + 1}. ${a.title}*\n${a.description || ''}\n[Read more](${a.url})`
  ).join('\n\n');
  return header + body;
}

// Start command with keyboard buttons
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id,
    `👋 Hey welcome to *Reuters GPT Bot!*\n\n` +
    `Built by the almighty Min 🙏⚡\n\n` +
    `Your personal AI news analyst — tap a button or just type any question! 📰🤖`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        keyboard: [
          [{ text: '📈 Markets' }, { text: '🌍 World' }],
          [{ text: '💻 Tech' }, { text: '☀️ Briefing' }],
        ],
        resize_keyboard: true,
        persistent: true
      }
    }
  );
});

// Markets button and command
bot.onText(/\/markets|📈 Markets/, async (msg) => {
  bot.sendMessage(msg.chat.id, '📈 Pulling the latest market news...');
  try {
    const articles = await fetchNews('markets');
    bot.sendMessage(msg.chat.id, formatNews(articles, 'markets'), { parse_mode: 'Markdown' });
  } catch (err) {
    console.error('Markets error:', err.message);
    bot.sendMessage(msg.chat.id, `😬 Could not fetch markets news. Error: ${err.message}`);
  }
});

// World button and command
bot.onText(/\/world|🌍 World/, async (msg) => {
  bot.sendMessage(msg.chat.id, '🌍 Fetching the latest world and geopolitics news...');
  try {
    const articles = await fetchNews('world');
    bot.sendMessage(msg.chat.id, formatNews(articles, 'world'), { parse_mode: 'Markdown' });
  } catch (err) {
    console.error('World error:', err.message);
    bot.sendMessage(msg.chat.id, `😬 Could not fetch world news. Error: ${err.message}`);
  }
});

// Tech button and command
bot.onText(/\/tech|💻 Tech/, async (msg) => {
  bot.sendMessage(msg.chat.id, '💻 Getting the latest tech news...');
  try {
    const articles = await fetchNews('technology');
    bot.sendMessage(msg.chat.id, formatNews(articles, 'technology'), { parse_mode: 'Markdown' });
  } catch (err) {
    console.error('Tech error:', err.message);
    bot.sendMessage(msg.chat.id, `😬 Could not fetch tech news. Error: ${err.message}`);
  }
});

// Briefing button and command
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
    const answer = await askGroq(question, newsContext);
    bot.sendMessage(chatId, `🤖 *Here is what I found:*\n\n${answer}`, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error('Ask error:', err.message);
    bot.sendMessage(chatId, `😬 Could not answer that. Error: ${err.message}`);
  }
});

// Plain text questions
bot.on('message', async (msg) => {
  const text = msg.text;
  if (!text) return;
  if (text.startsWith('/')) return;
  if (['📈 Markets', '🌍 World', '💻 Tech', '☀️ Briefing'].includes(text)) return;

  const chatId = msg.chat.id;
  bot.sendMessage(chatId, '🤔 On it — checking the latest news for you...');
  try {
    const articles = await fetchNews('markets');
    const newsContext = articles.map(a => a.title).join('\n');
    const answer = await askGroq(text, newsContext);
    bot.sendMessage(chatId, `🤖 *Here is what I found:*\n\n${answer}`, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error('Message error:', err.message);
    bot.sendMessage(chatId, `😬 Could not answer that. Error: ${err.message}`);
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

console.log('✅ Reuters GPT Bot is running — built by the almighty Min 🙏');
