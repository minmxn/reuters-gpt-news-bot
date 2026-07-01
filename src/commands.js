const fs = require('fs');
const { fetchNews, fetchNewsByKeyword, fetchNewsByCountry, fetchCombinedNews } = require('./news');
const { askGroq, chatGroq } = require('./groq');
const { webSearchContext } = require('./search');
const { generateNewsPDF } = require('./pdf');
const { formatNews, shouldRespond, cleanMessage, truncate, sanitizeForTelegram } = require('./helpers');
const { DAILY_LIMIT, getQuota } = require('./quota');
const { BOT_USERNAME, ADMIN_ID } = require('../config');
const { scheduleText, mainKeyboard } = require('./scheduler');
const memory = require('./memory');
const blocklist = require('./blocklist');

function registerCommands(bot) {
  bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id,
      `👋 Hey welcome to Nomo News Bot!\n\n` +
      `📰 Nomo — No More Information Overload. Know More in Minutes.\n\n` +
      `BUILT BY MIN ⚡\n\n` +
      `Your personal AI news analyst — tap a button or ask me anything! 📰🤖\n\n` +
      `In a group just mention me with @${BOT_USERNAME} and ask away! 😎`,
      { reply_markup: mainKeyboard }
    );
  });

  bot.onText(/^\/schedule(?:@\w+)?$|^📅 Schedule$/, (msg) => {
    bot.sendMessage(msg.chat.id, scheduleText, { parse_mode: 'Markdown' });
  });

  bot.onText(/^\/markets(?:@\w+)?$|^📈 Markets$/, async (msg) => {
    bot.sendMessage(msg.chat.id, '📈 Pulling the latest market news...');
    try {
      const articles = await fetchNews('markets');
      bot.sendMessage(msg.chat.id, formatNews(articles, 'MARKETS News'), { parse_mode: 'Markdown' });
    } catch (err) {
      bot.sendMessage(msg.chat.id, `😬 Could not fetch markets news. Error: ${err.message}`);
    }
  });

  bot.onText(/^\/world(?:@\w+)?$|^🌍 World$/, async (msg) => {
    bot.sendMessage(msg.chat.id, '🌍 Fetching the latest world and geopolitics news...');
    try {
      const articles = await fetchNews('world');
      bot.sendMessage(msg.chat.id, formatNews(articles, 'WORLD News'), { parse_mode: 'Markdown' });
    } catch (err) {
      bot.sendMessage(msg.chat.id, `😬 Could not fetch world news. Error: ${err.message}`);
    }
  });

  bot.onText(/^\/tech(?:@\w+)?$|^💻 Tech$/, async (msg) => {
    bot.sendMessage(msg.chat.id, '💻 Getting the latest tech news...');
    try {
      const articles = await fetchNews('technology');
      bot.sendMessage(msg.chat.id, formatNews(articles, 'TECH News'), { parse_mode: 'Markdown' });
    } catch (err) {
      bot.sendMessage(msg.chat.id, `😬 Could not fetch tech news. Error: ${err.message}`);
    }
  });

  bot.onText(/^\/briefing(?:@\w+)?$|^☀️ Briefing$/, async (msg) => {
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

  bot.onText(/^\/mood(?:@\w+)?$|^😎 Mood$/, async (msg) => {
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

  bot.onText(/^🔍 Search$/, (msg) => {
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

  bot.onText(/^📊 Stock$/, (msg) => {
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

  bot.onText(/^\/sg(?:@\w+)?$|^🌏 Singapore$/, async (msg) => {
    bot.sendMessage(msg.chat.id, '🌏 Fetching Singapore news...');
    try {
      const articles = await fetchNewsByCountry('sg');
      bot.sendMessage(msg.chat.id, formatNews(articles, '🌏 SINGAPORE News'), { parse_mode: 'Markdown' });
    } catch (err) {
      bot.sendMessage(msg.chat.id, `😬 Could not fetch Singapore news. Error: ${err.message}`);
    }
  });

  bot.onText(/^\/us(?:@\w+)?$|^🇺🇸 US$/, async (msg) => {
    bot.sendMessage(msg.chat.id, '🇺🇸 Fetching US news...');
    try {
      const articles = await fetchNewsByCountry('us');
      bot.sendMessage(msg.chat.id, formatNews(articles, '🇺🇸 US News'), { parse_mode: 'Markdown' });
    } catch (err) {
      bot.sendMessage(msg.chat.id, `😬 Could not fetch US news. Error: ${err.message}`);
    }
  });

  bot.onText(/^\/cn(?:@\w+)?$|^🇨🇳 China$/, async (msg) => {
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

  // Clears the asker's conversation memory.
  bot.onText(/\/reset/, (msg) => {
    memory.reset(msg.chat.id, msg.from && msg.from.id);
    bot.sendMessage(msg.chat.id, '🧹 Memory cleared — starting fresh.');
  });

  // ─── Blocklist management ───────────────────────────────────────
  // If ADMIN_ID is set, only that user can block/unblock; otherwise open.
  const canManage = (msg) => !ADMIN_ID || String(msg.from && msg.from.id) === String(ADMIN_ID);

  bot.onText(/^\/myid(?:@\w+)?$/, (msg) => {
    bot.sendMessage(msg.chat.id, `Your Telegram ID: \`${msg.from && msg.from.id}\``, { parse_mode: 'Markdown' });
  });

  bot.onText(/^\/blocked(?:@\w+)?$/, (msg) => {
    const list = blocklist.list();
    bot.sendMessage(msg.chat.id, `🚫 *Blocked domains* (${list.length})\n\n` + list.map(d => `• ${d}`).join('\n'), { parse_mode: 'Markdown' });
  });

  bot.onText(/^\/block(?:@\w+)?(?:\s+(.+))?$/, (msg, match) => {
    if (!canManage(msg)) return bot.sendMessage(msg.chat.id, '⛔ Only the admin can manage the blocklist.');
    const arg = match[1] && match[1].trim();
    if (!arg) return bot.sendMessage(msg.chat.id, 'Usage: `/block example.com`', { parse_mode: 'Markdown' });
    const d = blocklist.add(arg);
    const note = ADMIN_ID ? '' : '\n\n_Tip: set ADMIN_ID (see /myid) so only you can edit this._';
    bot.sendMessage(msg.chat.id, `🚫 Blocked *${d}* — it won't appear in future news.${note}`, { parse_mode: 'Markdown' });
  });

  bot.onText(/^\/unblock(?:@\w+)?(?:\s+(.+))?$/, (msg, match) => {
    if (!canManage(msg)) return bot.sendMessage(msg.chat.id, '⛔ Only the admin can manage the blocklist.');
    const arg = match[1] && match[1].trim();
    if (!arg) return bot.sendMessage(msg.chat.id, 'Usage: `/unblock example.com`', { parse_mode: 'Markdown' });
    const d = blocklist.remove(arg);
    if (d) bot.sendMessage(msg.chat.id, `✅ Unblocked *${d}*.`, { parse_mode: 'Markdown' });
    else bot.sendMessage(msg.chat.id, `Couldn't unblock that — it's either not on the list or a built-in default.`);
  });

  bot.on('message', async (msg) => {
    const text = msg.text;
    if (!text) return;
    if (text.startsWith('/')) return;
    const buttonTexts = ['📈 Markets', '🌍 World', '💻 Tech', '☀️ Briefing', '😎 Mood', '🔍 Search', '🌏 Singapore', '🇺🇸 US', '🇨🇳 China', '📊 Stock', '📖 Read', '📅 Schedule'];
    if (buttonTexts.includes(text)) return;
    if (!shouldRespond(msg)) return;

    const chatId = msg.chat.id;
    const userId = msg.from && msg.from.id;
    const question = cleanMessage(text);
    if (!question) return;

    // Reply-context: if the user replied to a message, anchor the answer to it.
    const repliedText = msg.reply_to_message && msg.reply_to_message.text;
    const prompt = repliedText
      ? `(Replying to: "${truncate(repliedText, 400)}")\n\n${question}`
      : question;

    bot.sendChatAction(chatId, 'typing').catch(() => {});
    try {
      const history = memory.getHistory(chatId, userId);
      // Fetch a few short live web snippets so the answer is grounded in
      // current info instead of the model's stale training (returns '' if
      // Tavily isn't configured or finds nothing — degrades gracefully).
      const webContext = await webSearchContext(question);
      const answer = await chatGroq(history, prompt, webContext);
      // Strip GFM (tables/headings/<br>) Telegram can't render, then try
      // Markdown — and fall back to plain text if it still won't parse, so
      // the send never fails silently.
      const clean = sanitizeForTelegram(answer);
      // disable_web_page_preview stops Telegram from rendering a big image
      // preview card under source links — we just want the inline link.
      try {
        await bot.sendMessage(chatId, `🤖 ${clean}`, { parse_mode: 'Markdown', disable_web_page_preview: true });
      } catch (sendErr) {
        await bot.sendMessage(chatId, `🤖 ${clean}`, { disable_web_page_preview: true });
      }
      memory.append(chatId, userId, question, answer);
    } catch (err) {
      // Map the noisy Groq/HTTP errors to friendly, in-character replies.
      const status = err.response && err.response.status;
      let reply;
      if (status === 429) {
        reply = '🥵 Whoa, too many questions at once — I\'ve hit my rate limit. Give me ~30 seconds and ask again.';
      } else if (status === 413) {
        reply = '📚 That dug up way too much to chew on. Try asking something a bit more specific.';
      } else {
        reply = '😬 Couldn\'t pull that one off just now — give it another shot in a moment.';
      }
      console.error('Free-text Q&A error:', status || '', err.message);
      bot.sendMessage(chatId, reply);
    }
  });
}

module.exports = { registerCommands };
