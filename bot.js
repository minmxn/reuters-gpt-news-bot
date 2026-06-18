require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const cron = require('node-cron');
const PDFDocument = require('pdfkit');
const fs = require('fs');

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });
const CHAT_ID = process.env.CHAT_ID;
const NEWS_API_KEY = process.env.NEWS_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const BOT_USERNAME = process.env.BOT_USERNAME || 'nomogh_bot';

const TZ = 'Asia/Singapore';

// ─── NEWS FETCHING ────────────────────────────────────────────────

async function fetchNews(category, pageSize = 10) {
  const queries = {
    markets: 'stock market OR financial markets OR S&P500 OR nasdaq OR dow jones',
    world: 'geopolitics OR international relations OR war OR diplomacy OR sanctions',
    technology: 'artificial intelligence OR technology OR semiconductor OR cybersecurity',
  };
  const response = await axios.get('https://newsapi.org/v2/everything', {
    params: { q: queries[category], language: 'en', sortBy: 'publishedAt', pageSize, apiKey: NEWS_API_KEY }
  });
  return response.data.articles;
}

async function fetchNewsByKeyword(keyword, pageSize = 5) {
  const response = await axios.get('https://newsapi.org/v2/everything', {
    params: { q: keyword, language: 'en', sortBy: 'publishedAt', pageSize, apiKey: NEWS_API_KEY }
  });
  return response.data.articles;
}

async function fetchNewsByCountry(country, pageSize = 5) {
  const response = await axios.get('https://newsapi.org/v2/top-headlines', {
    params: { country, pageSize, apiKey: NEWS_API_KEY }
  });
  return response.data.articles;
}

// ─── COMBINED NEWS FETCH (1 API call instead of 3) ───────────────
// Used by all scheduled posts to stay within the 100 calls/day free tier limit.
// Replaces the old pattern of fetchNews('markets') + fetchNews('world') + fetchNews('technology').

async function fetchCombinedNews(pageSize = 15) {
  const response = await axios.get('https://newsapi.org/v2/everything', {
    params: {
      q: 'stock market OR geopolitics OR artificial intelligence OR economy',
      language: 'en',
      sortBy: 'publishedAt',
      pageSize,
      apiKey: NEWS_API_KEY
    }
  });
  return response.data.articles;
}

// ─── GROQ AI ──────────────────────────────────────────────────────

async function askGroq(question, newsContext = '') {
  const prompt = `You are a witty, friendly financial and geopolitical news analyst built by MIN.
You explain complex news in plain simple English that anyone can understand.
Keep answers concise, clear and occasionally add a light humorous remark.
${newsContext ? `\nLatest news context:\n${newsContext}\n` : ''}
Question: ${question}`;

  const response = await axios.post(
    'https://api.groq.com/openai/v1/chat/completions',
    { model: 'llama-3.3-70b-versatile', messages: [{ role: 'user', content: prompt }], max_tokens: 1000 },
    { headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' } }
  );
  return response.data.choices[0].message.content;
}

// ─── PDF GENERATOR ────────────────────────────────────────────────

function generateNewsPDF(articles, edition) {
  return new Promise((resolve, reject) => {
    const filename = `/tmp/nomo-news-${edition.toLowerCase().replace(' ', '-')}-${Date.now()}.pdf`;
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const stream = fs.createWriteStream(filename);
    doc.pipe(stream);

    const now = new Date().toLocaleDateString('en-SG', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: TZ
    });

    doc.rect(0, 0, doc.page.width, 120).fill('#1a1a2e');
    doc.fillColor('#FFD700').fontSize(32).font('Helvetica-Bold')
      .text('NOMO NEWS', 50, 25, { align: 'center' });
    doc.fillColor('#ffffff').fontSize(14).font('Helvetica')
      .text(`${edition}  |  ${now}`, 50, 68, { align: 'center' });
    doc.moveTo(50, 130).lineTo(doc.page.width - 50, 130).strokeColor('#FFD700').lineWidth(2).stroke();

    let y = 150;

    articles.slice(0, 15).forEach((article, i) => {
      if (y > 720) {
        doc.addPage();
        y = 50;
      }
      doc.rect(50, y, 24, 24).fill('#FFD700');
      doc.fillColor('#1a1a2e').fontSize(12).font('Helvetica-Bold')
        .text(`${i + 1}`, 50, y + 6, { width: 24, align: 'center' });

      const title = article.title || 'No title available';
      doc.fillColor('#1a1a2e').fontSize(13).font('Helvetica-Bold')
        .text(title, 85, y, { width: doc.page.width - 135 });
      y += doc.heightOfString(title, { width: doc.page.width - 135, font: 'Helvetica-Bold', fontSize: 13 }) + 4;

      if (article.description) {
        const desc = article.description.length > 150 ? article.description.substring(0, 150) + '...' : article.description;
        doc.fillColor('#555555').fontSize(10).font('Helvetica')
          .text(desc, 85, y, { width: doc.page.width - 135 });
        y += doc.heightOfString(desc, { width: doc.page.width - 135, fontSize: 10 }) + 4;
      }

      doc.fillColor('#999999').fontSize(9).font('Helvetica-Oblique')
        .text(`Source: ${article.source && article.source.name ? article.source.name : 'Unknown'}`, 85, y);
      y += 16;

      doc.moveTo(50, y).lineTo(doc.page.width - 50, y).strokeColor('#e0e0e0').lineWidth(0.5).stroke();
      y += 14;
    });

    doc.rect(0, doc.page.height - 50, doc.page.width, 50).fill('#1a1a2e');
    doc.fillColor('#FFD700').fontSize(10).font('Helvetica-Bold')
      .text('BUILT BY MIN', 50, doc.page.height - 32, { align: 'center' });

    doc.end();
    stream.on('finish', () => resolve(filename));
    stream.on('error', reject);
  });
}

// ─── HELPERS ──────────────────────────────────────────────────────

function formatNews(articles, label) {
  if (!articles || articles.length === 0) return 'No news found right now. Try again later!';
  const body = articles.map((a, i) =>
    `*${i + 1}. ${a.title}*\n${a.description || ''}\n[Read more](${a.url})`
  ).join('\n\n');
  return `📰 *${label}*\n\n${body}`;
}

function shouldRespond(msg) {
  const isPrivate = msg.chat.type === 'private';
  const isMentioned = msg.text && msg.text.includes(`@${BOT_USERNAME}`);
  const isReply = msg.reply_to_message && msg.reply_to_message.from && msg.reply_to_message.from.username === BOT_USERNAME;
  return isPrivate || isMentioned || isReply;
}

function cleanMessage(text) {
  return text.replace(`@${BOT_USERNAME}`, '').trim();
}

// ─── NEWS UPDATE HELPER (now uses fetchCombinedNews — 1 call only) ─

async function postNewsUpdate(label) {
  const topNews = await fetchCombinedNews(15);
  const newsText = topNews.map((a, i) =>
    `*${i + 1}. ${a.title}*\n${a.description || ''}\n[Read more](${a.url})`
  ).join('\n\n');
  await bot.sendMessage(CHAT_ID,
    `${label}\n\n${newsText}\n\n_BUILT BY MIN_ ⚡`,
    { parse_mode: 'Markdown' }
  );
}

// ─── KEYBOARD ─────────────────────────────────────────────────────

const mainKeyboard = {
  keyboard: [
    [{ text: '📈 Markets' }, { text: '🌍 World' }],
    [{ text: '💻 Tech' }, { text: '☀️ Briefing' }],
    [{ text: '😎 Mood' }, { text: '🔍 Search' }],
    [{ text: '🌏 Singapore' }, { text: '🇺🇸 US' }, { text: '🇨🇳 China' }],
    [{ text: '📊 Stock' }, { text: '📅 Schedule' }]
  ],
  resize_keyboard: true
};

// ─── DAILY POLLS ──────────────────────────────────────────────────

const dailyPolls = {
  1: { question: '🗳️ Monday Market Pulse\n\nHow are you feeling about markets this week?', options: ['📈 Bullish — expecting gains', '📉 Bearish — expecting drops', '😐 Neutral — nothing exciting', '🤷 Not sure yet', '👀 Here to observe and learn'] },
  2: { question: '🗳️ Sector Spotlight\n\nWhich sector do you think performs best this week?', options: ['💻 Technology', '🏦 Banking and Finance', '🛢️ Oil and Energy', '🏥 Healthcare', '🤷 Too hard to call'] },
  3: { question: '🗳️ Mid Week Check\n\nHow are markets performing vs your expectation?', options: ['🚀 Better than expected', '😅 Worse than expected', '😐 Pretty much as expected', '🤷 Will check on Friday'] },
  4: { question: '🗳️ Biggest Market Risk Right Now\n\nWhat do you think is the biggest threat to markets?', options: ['🇺🇸 US recession fears', '🇨🇳 China slowdown', '💸 Inflation returning', '⚔️ Geopolitical tensions', '🤷 Honestly all of the above'] },
  5: { question: '🗳️ Friday Verdict\n\nHow did markets perform vs your prediction this week?', options: ['🎯 Called it perfectly', '😅 Surprised me completely', '💀 Nobody saw that coming', '🤷 I only check on Fridays', '👀 Setting up for next week'] },
  6: { question: '🗳️ Weekend Read\n\nWhat topic do you want more coverage on?', options: ['📈 Stock market deep dives', '🌍 Geopolitics and market impact', '💰 Crypto and digital assets', '🏦 Central banks and interest rates', '🌏 Asia and Singapore markets'] },
  0: { question: '🗳️ Sunday Prediction Corner\n\nYour call for next week — S&P 500?', options: ['📈 Up more than 1%', '📈 Up less than 1%', '😐 Flat', '📉 Down less than 1%', '📉 Down more than 1%', '🤷 Markets are unpredictable'] }
};

// ─── WEEKLY BIG QUESTIONS ─────────────────────────────────────────

const weeklyQuestions = [
  '💬 *Weekly Big Question*\n\nIs the US dollar losing its dominance as the world reserve currency? Drop your thoughts below!',
  '💬 *Weekly Big Question*\n\nWill AI stocks keep outperforming the broader market in 2026? Agree or disagree?',
  '💬 *Weekly Big Question*\n\nIs a global recession coming in the next 12 months? What is your read?',
  '💬 *Weekly Big Question*\n\nAre interest rates going to stay higher for longer? How is it affecting you?',
  '💬 *Weekly Big Question*\n\nIs China a good investment opportunity right now? Bullish or bearish?',
  '💬 *Weekly Big Question*\n\nWill crypto become a mainstream asset class in the next 5 years?',
  '💬 *Weekly Big Question*\n\nIs Singapore economy resilient enough to weather a global slowdown?',
  '💬 *Weekly Big Question*\n\nWith AI disrupting industries — which sector do you think is most at risk?'
];

// ─── MCQ QUESTIONS ────────────────────────────────────────────────

const mcqQuestions = [
  { level: '🟢 Easy', question: 'What does the S&P 500 track?', options: ['A — Top 500 US companies by market cap', 'B — Top 500 global companies', 'C — Top 500 tech companies only', 'D — No idea, just here for the memes'], answer: 'A', explanation: 'The S&P 500 tracks the 500 largest publicly traded companies in the US by market capitalisation. It is the most widely followed benchmark for the US stock market.' },
  { level: '🟡 Medium', question: 'When the Fed raises interest rates, what typically happens to bond prices?', options: ['A — They go up', 'B — They go down', 'C — They stay the same', 'D — What is a bond?'], answer: 'B', explanation: 'When interest rates rise, existing bond prices fall. New bonds are issued at higher rates making older lower-rate bonds less attractive to investors.' },
  { level: '🔴 Hard', question: 'What does a yield curve inversion typically signal?', options: ['A — Strong economic growth ahead', 'B — Potential recession ahead', 'C — High inflation incoming', 'D — Time to Google this'], answer: 'B', explanation: 'A yield curve inversion happens when short-term bond yields exceed long-term yields. Historically this has been one of the most reliable indicators of a coming recession.' },
  { level: '🟢 Easy', question: 'What does GDP stand for?', options: ['A — Global Development Plan', 'B — Gross Domestic Product', 'C — General Dollar Price', 'D — I know this one... maybe'], answer: 'B', explanation: 'GDP stands for Gross Domestic Product. It measures the total value of all goods and services produced in a country and is the primary measure of economic health.' },
  { level: '🟡 Medium', question: 'What does CPI measure?', options: ['A — Corporate Price Index', 'B — Consumer Price Index that tracks inflation', 'C — Central Policy Interest rate', 'D — No clue'], answer: 'B', explanation: 'CPI stands for Consumer Price Index. It tracks the average change in prices paid by consumers for goods and services. Central banks use it to measure inflation.' },
  { level: '🔴 Hard', question: 'What is quantitative easing?', options: ['A — A central bank selling bonds to reduce money supply', 'B — A central bank buying bonds to inject money into the economy', 'C — A government raising taxes to control inflation', 'D — A way to make economics easier to understand'], answer: 'B', explanation: 'Quantitative easing is when a central bank purchases bonds to inject money into the economy. It is used to stimulate growth when interest rates are already near zero.' },
  { level: '🟢 Easy', question: 'What does a bear market mean?', options: ['A — Markets are rising strongly', 'B — Markets have fallen 20% or more from recent highs', 'C — A market dominated by animal stocks', 'D — When traders are in a bad mood'], answer: 'B', explanation: 'A bear market is defined as a decline of 20% or more from recent highs in a market index. It reflects widespread pessimism and negative investor sentiment.' },
  { level: '🟡 Medium', question: 'What is the main purpose of the Federal Reserve?', options: ['A — To print money for the US government', 'B — To manage monetary policy and maintain economic stability', 'C — To regulate Wall Street banks only', 'D — To decide stock prices'], answer: 'B', explanation: 'The Federal Reserve is the US central bank. Its main goals are to promote maximum employment, stable prices and moderate long-term interest rates through monetary policy.' }
];

let currentMCQIndex = 0;
let currentMCQ = null;

// ─── SCHEDULE TEXT ────────────────────────────────────────────────

const scheduleText =
`📅 *NOMO NEWS BOT*
*Daily Schedule* 🇸🇬 Singapore Time

━━━━━━━━━━━━━━━━━━━━━
🌅 *MORNING*
━━━━━━━━━━━━━━━━━━━━━
☀️  8:00am — Morning Briefing + PDF Magazine
🗳️  9:00am — Daily Poll
🧠 10:00am — Daily MCQ Quiz
✅ 11:00am — MCQ Answer Revealed

━━━━━━━━━━━━━━━━━━━━━
🌆 *AFTERNOON & EVENING*
━━━━━━━━━━━━━━━━━━━━━
📰 12:00pm — News Update
📰  2:00pm — News Update
📰  4:00pm — News Update
🌆  6:00pm — Evening News + PDF Magazine
📰  8:00pm — News Update
📰 10:00pm — News Update

━━━━━━━━━━━━━━━━━━━━━
🌙 *LATE NIGHT*
━━━━━━━━━━━━━━━━━━━━━
📰 12:00am — News Update
📰  2:00am — News Update

━━━━━━━━━━━━━━━━━━━━━
💬 *EVERY MONDAY*
━━━━━━━━━━━━━━━━━━━━━
💡  Weekly Big Question at 9:00am

━━━━━━━━━━━━━━━━━━━━━
_BUILT BY MIN_ ⚡`;

// ─── COMMANDS ─────────────────────────────────────────────────────

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id,
    `👋 Hey welcome to Nomo News Bot!\n\n` +
    `BUILT BY MIN ⚡\n\n` +
    `Your personal AI news analyst — tap a button or ask me anything! 📰🤖\n\n` +
    `In a group just mention me with @${BOT_USERNAME} and ask away! 😎`,
    { reply_markup: mainKeyboard }
  );
});

bot.onText(/\/schedule|📅 Schedule/, (msg) => {
  bot.sendMessage(msg.chat.id, scheduleText, { parse_mode: 'Markdown' });
});

bot.onText(/\/markets|📈 Markets/, async (msg) => {
  bot.sendMessage(msg.chat.id, '📈 Pulling the latest market news...');
  try {
    const articles = await fetchNews('markets');
    bot.sendMessage(msg.chat.id, formatNews(articles, 'MARKETS News'), { parse_mode: 'Markdown' });
  } catch (err) {
    bot.sendMessage(msg.chat.id, `😬 Could not fetch markets news. Error: ${err.message}`);
  }
});

bot.onText(/\/world|🌍 World/, async (msg) => {
  bot.sendMessage(msg.chat.id, '🌍 Fetching the latest world and geopolitics news...');
  try {
    const articles = await fetchNews('world');
    bot.sendMessage(msg.chat.id, formatNews(articles, 'WORLD News'), { parse_mode: 'Markdown' });
  } catch (err) {
    bot.sendMessage(msg.chat.id, `😬 Could not fetch world news. Error: ${err.message}`);
  }
});

bot.onText(/\/tech|💻 Tech/, async (msg) => {
  bot.sendMessage(msg.chat.id, '💻 Getting the latest tech news...');
  try {
    const articles = await fetchNews('technology');
    bot.sendMessage(msg.chat.id, formatNews(articles, 'TECH News'), { parse_mode: 'Markdown' });
  } catch (err) {
    bot.sendMessage(msg.chat.id, `😬 Could not fetch tech news. Error: ${err.message}`);
  }
});

bot.onText(/\/briefing|☀️ Briefing/, async (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, '☀️ Hang tight — putting together your briefing...');
  try {
    const articles = await fetchCombinedNews(15);
    const allNews = articles.map(a => a.title).join('\n');
    const summary = await askGroq('Give me a short news briefing based on these headlines. Keep it friendly, simple and easy to understand.', allNews);
    bot.sendMessage(chatId, `☀️ *Your Daily Briefing*\n\n${summary}\n\n_BUILT BY MIN_ ⚡`, { parse_mode: 'Markdown' });
  } catch (err) {
    bot.sendMessage(chatId, `😬 Briefing failed. Error: ${err.message}`);
  }
});

bot.onText(/\/mood|😎 Mood/, async (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, '😎 Checking the market mood today...');
  try {
    const articles = await fetchNews('markets');
    const headlines = articles.map(a => a.title).join('\n');
    const mood = await askGroq('Based on these headlines what is the overall market sentiment today? Is it bullish bearish or neutral? Give a fun one paragraph summary with an emoji mood rating out of 5.', headlines);
    bot.sendMessage(chatId, `😎 *Market Mood Today*\n\n${mood}\n\n_BUILT BY MIN_ ⚡`, { parse_mode: 'Markdown' });
  } catch (err) {
    bot.sendMessage(chatId, `😬 Could not check market mood. Error: ${err.message}`);
  }
});

bot.onText(/🔍 Search/, (msg) => {
  bot.sendMessage(msg.chat.id, '🔍 Type /search followed by any topic!\n\nExamples:\n/search Bitcoin\n/search Nvidia earnings\n/search Singapore economy\n/search Fed rate cut');
});

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

bot.onText(/📊 Stock/, (msg) => {
  bot.sendMessage(msg.chat.id, '📊 Type /stock followed by a ticker!\n\nExamples:\n/stock NVDA\n/stock AAPL\n/stock TSLA\n/stock META');
});

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

bot.onText(/\/sg|🌏 Singapore/, async (msg) => {
  bot.sendMessage(msg.chat.id, '🌏 Fetching Singapore news...');
  try {
    const articles = await fetchNewsByCountry('sg');
    bot.sendMessage(msg.chat.id, formatNews(articles, '🌏 SINGAPORE News'), { parse_mode: 'Markdown' });
  } catch (err) {
    bot.sendMessage(msg.chat.id, `😬 Could not fetch Singapore news. Error: ${err.message}`);
  }
});

bot.onText(/\/us|🇺🇸 US/, async (msg) => {
  bot.sendMessage(msg.chat.id, '🇺🇸 Fetching US news...');
  try {
    const articles = await fetchNewsByCountry('us');
    bot.sendMessage(msg.chat.id, formatNews(articles, '🇺🇸 US News'), { parse_mode: 'Markdown' });
  } catch (err) {
    bot.sendMessage(msg.chat.id, `😬 Could not fetch US news. Error: ${err.message}`);
  }
});

bot.onText(/\/cn|🇨🇳 China/, async (msg) => {
  bot.sendMessage(msg.chat.id, '🇨🇳 Fetching China news...');
  try {
    const articles = await fetchNewsByCountry('cn');
    bot.sendMessage(msg.chat.id, formatNews(articles, '🇨🇳 CHINA News'), { parse_mode: 'Markdown' });
  } catch (err) {
    bot.sendMessage(msg.chat.id, `😬 Could not fetch China news. Error: ${err.message}`);
  }
});

bot.onText(/\/testpdf/, async (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, '📰 Generating a test PDF magazine...');
  try {
    const allArticles = await fetchCombinedNews(15);
    const pdfPath = await generateNewsPDF(allArticles, 'Test Edition');
    await bot.sendDocument(chatId, pdfPath, { caption: `📰 *Nomo News — Test Edition*\n\n_BUILT BY MIN_ ⚡`, parse_mode: 'Markdown' });
    fs.unlinkSync(pdfPath);
  } catch (err) {
    bot.sendMessage(chatId, `😬 PDF test failed. Error: ${err.message}`);
  }
});

bot.on('message', async (msg) => {
  const text = msg.text;
  if (!text) return;
  if (text.startsWith('/')) return;
  const buttonTexts = ['📈 Markets', '🌍 World', '💻 Tech', '☀️ Briefing', '😎 Mood', '🔍 Search', '🌏 Singapore', '🇺🇸 US', '🇨🇳 China', '📊 Stock', '📅 Schedule'];
  if (buttonTexts.includes(text)) return;
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

// ─── SCHEDULED TASKS — ALL TIMES IN SINGAPORE TIME (SGT) ─────────
// API call budget per day (100 limit on free tier):
//   8am briefing:    1 (fetchCombinedNews)
//   6pm evening:     1 (fetchCombinedNews)
//   7x news updates: 1 each = 7 (fetchCombinedNews)
//   /testpdf:        1 (fetchCombinedNews)
//   Total scheduled: ~9/day — leaves ~90 calls for user commands
// ─────────────────────────────────────────────────────────────────

const cronOpts = { timezone: TZ };

// 8:00am SGT — Morning briefing + PDF
cron.schedule('0 8 * * *', async () => {
  try {
    const allArticles = await fetchCombinedNews(15);
    const allNews = allArticles.map(a => a.title).join('\n');
    const summary = await askGroq('Give me a short friendly morning briefing. Simple, clear and easy to understand.', allNews);
    await bot.sendMessage(CHAT_ID, `☀️ *Good Morning! Your Daily Briefing*\n\n${summary}\n\n_BUILT BY MIN_ ⚡`, { parse_mode: 'Markdown' });
    const pdfPath = await generateNewsPDF(allArticles, 'Morning Edition');
    await bot.sendDocument(CHAT_ID, pdfPath, { caption: `📰 *Nomo News — Morning Edition*\n\n_BUILT BY MIN_ ⚡`, parse_mode: 'Markdown' });
    fs.unlinkSync(pdfPath);
  } catch (err) {
    console.error('Morning briefing error:', err.message);
  }
}, cronOpts);

// 9:00am SGT — Daily poll (+ weekly question on Mondays)
cron.schedule('0 9 * * *', async () => {
  try {
    const day = new Date().toLocaleString('en-US', { weekday: 'short', timeZone: TZ });
    const dayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const d = dayMap[day];
    const poll = dailyPolls[d];
    await bot.sendPoll(CHAT_ID, poll.question, poll.options, { is_anonymous: false });
    if (d === 1) {
      const weekNum = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000)) % weeklyQuestions.length;
      bot.sendMessage(CHAT_ID, weeklyQuestions[weekNum] + '\n\n_Drop your thoughts below — all views welcome!_ 👇', { parse_mode: 'Markdown' });
    }
  } catch (err) {
    console.error('Daily poll error:', err.message);
  }
}, cronOpts);

// 10:00am SGT — MCQ quiz
cron.schedule('0 10 * * *', async () => {
  try {
    currentMCQ = mcqQuestions[currentMCQIndex % mcqQuestions.length];
    currentMCQIndex++;
    const text = `🧠 *Daily Market Quiz!* ${currentMCQ.level}\n\n*${currentMCQ.question}*\n\n` + currentMCQ.options.join('\n') + `\n\n_Reply with your answer! Correct answer revealed at 11am_ ⏰`;
    bot.sendMessage(CHAT_ID, text, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error('MCQ error:', err.message);
  }
}, cronOpts);

// 11:00am SGT — MCQ answer
cron.schedule('0 11 * * *', async () => {
  try {
    if (!currentMCQ) return;
    const text = `✅ *MCQ Answer Revealed!*\n\n*Question:* ${currentMCQ.question}\n\n*Correct Answer: ${currentMCQ.answer}*\n\n📖 *Explanation:*\n${currentMCQ.explanation}\n\n_BUILT BY MIN_ ⚡`;
    bot.sendMessage(CHAT_ID, text, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error('MCQ answer error:', err.message);
  }
}, cronOpts);

// 6:00pm SGT — Evening news + PDF
cron.schedule('0 18 * * *', async () => {
  try {
    const allArticles = await fetchCombinedNews(15);
    const newsText = allArticles.map((a, i) => `*${i + 1}. ${a.title}*\n${a.description || ''}\n[Read more](${a.url})`).join('\n\n');
    await bot.sendMessage(CHAT_ID, `🌆 *Evening News Update*\n\n${newsText}\n\n_BUILT BY MIN_ ⚡`, { parse_mode: 'Markdown' });
    const pdfPath = await generateNewsPDF(allArticles, 'Evening Edition');
    await bot.sendDocument(CHAT_ID, pdfPath, { caption: `📰 *Nomo News — Evening Edition*\n\n_BUILT BY MIN_ ⚡`, parse_mode: 'Markdown' });
    fs.unlinkSync(pdfPath);
  } catch (err) {
    console.error('Evening news error:', err.message);
  }
}, cronOpts);

// News updates at fixed SGT times: 12pm, 2pm, 4pm, 8pm, 10pm, 12am, 2am
cron.schedule('0 12 * * *', () => postNewsUpdate('🔔 *News Update — 12pm*').catch(e => console.error(e.message)), cronOpts);
cron.schedule('0 14 * * *', () => postNewsUpdate('🔔 *News Update — 2pm*').catch(e => console.error(e.message)), cronOpts);
cron.schedule('0 16 * * *', () => postNewsUpdate('🔔 *News Update — 4pm*').catch(e => console.error(e.message)), cronOpts);
cron.schedule('0 20 * * *', () => postNewsUpdate('🔔 *News Update — 8pm*').catch(e => console.error(e.message)), cronOpts);
cron.schedule('0 22 * * *', () => postNewsUpdate('🔔 *News Update — 10pm*').catch(e => console.error(e.message)), cronOpts);
cron.schedule('0 0 * * *', () => postNewsUpdate('🔔 *News Update — 12am*').catch(e => console.error(e.message)), cronOpts);
cron.schedule('0 2 * * *', () => postNewsUpdate('🔔 *News Update — 2am*').catch(e => console.error(e.message)), cronOpts);

console.log('Nomo News Bot is running - BUILT BY MIN - all times SGT');
