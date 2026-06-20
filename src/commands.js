const fs = require('fs');
const { fetchNews, fetchNewsByKeyword, fetchNewsByCountry, fetchCombinedNews } = require('./news');
const { askGroq } = require('./groq');
const { generateNewsPDF } = require('./pdf');
const { formatNews, shouldRespond, cleanMessage } = require('./helpers');
const { DAILY_LIMIT, getQuota } = require('./quota');
const { BOT_USERNAME } = require('../config');
const { scheduleText, mainKeyboard } = require('./scheduler');

function registerCommands(bot) {
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

  bot.onText(/\/quota/, (msg) => {
    const { quotaCount } = getQuota();
    const remaining = DAILY_LIMIT - quotaCount;
    const pct = Math.round((quotaCount / DAILY_LIMIT) * 100);
    const bar = '█'.repeat(Math.round(pct / 10)) + '░'.repeat(10 - Math.round(pct / 10));
    const status = remaining <= 10 ? '🔴' : remaining <= 30 ? '🟡' : '🟢';
    bot.sendMessage(msg.chat.id,
      `📊 *NewsAPI Quota — Today*\n\n` +
      `${status} \`${bar}\` ${pct}%\n\n` +
      `*Used:* ${quotaCount} / ${DAILY_LIMIT} calls\n` +
      `*Remaining:* ${remaining} calls\n` +
      `*Resets:* midnight SGT\n\n` +
      `_BUILT BY MIN_ ⚡`,
      { parse_mode: 'Markdown' }
    );
  });

  bot.on('message', async (msg) => {
    const text = msg.text;
    if (!text) return;
    if (text.startsWith('/')) return;
    const buttonTexts = ['📈 Markets', '🌍 World', '💻 Tech', '☀️ Briefing', '😎 Mood', '🔍 Search', '🌏 Singapore', '🇺🇸 US', '🇨🇳 China', '📊 Stock', '📖 Read', '📅 Schedule'];
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
}

module.exports = { registerCommands };
