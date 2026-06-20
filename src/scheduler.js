const fs = require('fs');
const cron = require('node-cron');
const { TZ, CHAT_ID } = require('../config');
const { fetchCombinedNews } = require('./news');
const { askGroq, generateMCQSet, generatePoll } = require('./groq');
const { generateNewsPDF } = require('./pdf');
const { buildNewsBody } = require('./helpers');
const { dailyPolls, weeklyQuestions } = require('../data/polls');
const { mcqQuestions, mcqState } = require('../data/mcq');

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
💬 *EVERY MONDAY*
━━━━━━━━━━━━━━━━━━━━━
💡  Weekly Big Question at 9:00am

━━━━━━━━━━━━━━━━━━━━━
_BUILT BY MIN_ ⚡`;

// ─── MCQ FALLBACK ─────────────────────────────────────────────────
// Picks one Easy, one Medium and one Hard question from the hardcoded
// set, rotating through them so the same trio isn't repeated daily.

function fallbackMCQSet() {
  const pick = (level, offset) => {
    const pool = mcqQuestions.filter(q => q.level === level);
    return pool[offset % pool.length];
  };
  const i = mcqState.currentMCQIndex++;
  return [
    pick('🟢 Easy', i),
    pick('🟡 Medium', i),
    pick('🔴 Hard', i)
  ];
}

// ─── NEWS UPDATE HELPER (uses fetchCombinedNews — 1 call only) ────

async function postNewsUpdate(bot, label) {
  const topNews = await fetchCombinedNews(15);
  const newsText = buildNewsBody(topNews, 10);
  await bot.sendMessage(CHAT_ID,
    `${label}\n\n${newsText}\n\n_BUILT BY MIN_ ⚡`,
    { parse_mode: 'Markdown' }
  );
}

// ─── SCHEDULER ────────────────────────────────────────────────────

function registerScheduler(bot) {
  const cronOpts = { timezone: TZ };

  // API call budget per day (100 limit on free tier):
  //   8am briefing:    1 (fetchCombinedNews)
  //   9am poll:        1 (fetchCombinedNews — for AI poll context)
  //   10am MCQ:        1 (fetchCombinedNews — for AI quiz context)
  //   6pm evening:     1 (fetchCombinedNews)
  //   5x news updates: 1 each = 5 (fetchCombinedNews)
  //   /testpdf:        1 (fetchCombinedNews)
  //   Total scheduled: ~9/day — leaves ~90 calls for user commands

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
  // Tries to generate a fresh poll from today's headlines via Groq;
  // falls back silently to the hardcoded daily poll if Groq is down/slow.
  cron.schedule('0 9 * * *', async () => {
    try {
      const day = new Date().toLocaleString('en-US', { weekday: 'short', timeZone: TZ });
      const dayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
      const d = dayMap[day];

      let poll;
      try {
        const articles = await fetchCombinedNews(15);
        const headlines = articles.map(a => a.title).join('\n');
        poll = await generatePoll(headlines);
      } catch (genErr) {
        console.error('AI poll generation failed, using fallback:', genErr.message);
        poll = dailyPolls[d];
      }

      await bot.sendPoll(CHAT_ID, poll.question, poll.options, { is_anonymous: false });
      if (d === 1) {
        const weekNum = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000)) % weeklyQuestions.length;
        bot.sendMessage(CHAT_ID, weeklyQuestions[weekNum] + '\n\n_Drop your thoughts below — all views welcome!_ 👇', { parse_mode: 'Markdown' });
      }
    } catch (err) {
      console.error('Daily poll error:', err.message);
    }
  }, cronOpts);

  // 10:00am SGT — MCQ quiz (3 questions: Easy, Medium, Hard)
  // Tries to generate a fresh set from today's headlines via Groq;
  // falls back silently to hardcoded questions if Groq is down/slow.
  cron.schedule('0 10 * * *', async () => {
    try {
      try {
        const articles = await fetchCombinedNews(15);
        const headlines = articles.map(a => a.title).join('\n');
        mcqState.currentMCQs = await generateMCQSet(headlines);
      } catch (genErr) {
        console.error('AI MCQ generation failed, using fallback:', genErr.message);
        mcqState.currentMCQs = fallbackMCQSet();
      }

      const body = mcqState.currentMCQs.map((q, i) =>
        `${q.level}\n*Q${i + 1}: ${q.question}*\n${q.options.join('\n')}`
      ).join('\n\n');
      const text = `🧠 *Daily Market Quiz!* — 3 Questions\n\n${body}\n\n_Reply with your answers! Revealed at 11am_ ⏰`;
      bot.sendMessage(CHAT_ID, text, { parse_mode: 'Markdown' });
    } catch (err) {
      console.error('MCQ error:', err.message);
    }
  }, cronOpts);

  // 11:00am SGT — MCQ answers
  cron.schedule('0 11 * * *', async () => {
    try {
      if (!mcqState.currentMCQs || mcqState.currentMCQs.length === 0) return;
      const body = mcqState.currentMCQs.map((q, i) =>
        `${q.level}\n*Q${i + 1}: ${q.question}*\n*Correct Answer: ${q.answer}*\n📖 ${q.explanation}`
      ).join('\n\n');
      const text = `✅ *MCQ Answers Revealed!*\n\n${body}\n\n_BUILT BY MIN_ ⚡`;
      bot.sendMessage(CHAT_ID, text, { parse_mode: 'Markdown' });
    } catch (err) {
      console.error('MCQ answer error:', err.message);
    }
  }, cronOpts);

  // 6:00pm SGT — Evening news + PDF
  cron.schedule('0 18 * * *', async () => {
    try {
      const allArticles = await fetchCombinedNews(15);
      const newsText = buildNewsBody(allArticles, 10);
      await bot.sendMessage(CHAT_ID, `🌆 *Evening News Update*\n\n${newsText}\n\n_BUILT BY MIN_ ⚡`, { parse_mode: 'Markdown' });
      const pdfPath = await generateNewsPDF(allArticles, 'Evening Edition');
      await bot.sendDocument(CHAT_ID, pdfPath, { caption: `📰 *Nomo News — Evening Edition*\n\n_BUILT BY MIN_ ⚡`, parse_mode: 'Markdown' });
      fs.unlinkSync(pdfPath);
    } catch (err) {
      console.error('Evening news error:', err.message);
    }
  }, cronOpts);

  // News updates at fixed SGT times: 12pm, 2pm, 4pm, 8pm, 10pm
  cron.schedule('0 12 * * *', () => postNewsUpdate(bot, '🔔 *News Update — 12pm*').catch(e => console.error(e.message)), cronOpts);
  cron.schedule('0 14 * * *', () => postNewsUpdate(bot, '🔔 *News Update — 2pm*').catch(e => console.error(e.message)), cronOpts);
  cron.schedule('0 16 * * *', () => postNewsUpdate(bot, '🔔 *News Update — 4pm*').catch(e => console.error(e.message)), cronOpts);
  cron.schedule('0 20 * * *', () => postNewsUpdate(bot, '🔔 *News Update — 8pm*').catch(e => console.error(e.message)), cronOpts);
  cron.schedule('0 22 * * *', () => postNewsUpdate(bot, '🔔 *News Update — 10pm*').catch(e => console.error(e.message)), cronOpts);
}

module.exports = { registerScheduler, mainKeyboard, scheduleText };
