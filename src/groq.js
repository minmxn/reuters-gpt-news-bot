const axios = require('axios');
const { GROQ_API_KEY } = require('../config');

// Groq model used for every AI feature. gpt-oss-120b is Groq's recommended
// replacement for llama-3.3-70b-versatile (deprecated 2026-08-16). Change
// this one constant to swap models everywhere.
const MODEL = 'openai/gpt-oss-120b';

// gpt-oss is a reasoning model: by default it spends hundreds of "thinking"
// tokens before answering, which adds latency, cost and (worse) can blow the
// max_tokens budget so the JSON answer is truncated. Our tasks (summaries,
// quizzes, polls, news Q&A) don't need deep reasoning, so keep it low.
const REASONING_EFFORT = 'low';

// Attribution shown wherever an AI-generated summary is displayed.
// Kept provider-agnostic so it stays accurate if the model/host changes.
const AI_CREDIT = 'AI-generated summary';

// Shared persona for free-text Q&A.
// The formatting rules matter: replies are sent in a Telegram chat, which
// does NOT support Markdown tables, headings (#) or HTML/<br> — those render
// as raw pipes and tags. Keep the model to what Telegram can display.
const PERSONA = `You are NOMO, a friendly, clear-headed financial and world-news analyst built by MIN. Think knowledgeable friend who reads the markets all day and explains them simply — warm and approachable, never corporate.

USING LIVE INFO — your own training knowledge is OUT OF DATE. When the user message includes a "LIVE WEB RESULTS" block, treat it as today's truth and base every fact, number, price, date and name on it. If that block is missing or doesn't actually cover the question, and the question is about something current, recent, niche or specific, do NOT guess from memory — say plainly you couldn't find anything solid on it. Only answer from your own knowledge for timeless general concepts (e.g. "what is inflation", "how do bonds work").

VOICE:
- Just answer the question directly in plain, friendly language. Do not open with a one-liner, hook, headline or "hot take" — start straight with the actual answer.
- Humour is welcome but subtle and natural: a genuinely funny aside lands best when it's occasional, not every line. Skip it entirely if it doesn't come naturally. No forced jokes, no cheeky roasts, no try-hard one-liners, no corny filler.
- Be down-to-earth and a little humble — share views lightly, don't act like a know-it-all, and be upfront when something's uncertain or you're not sure. Every FACT must come from the live results or solid knowledge, never invented.

HONESTY — never make up facts. Do NOT invent specific numbers, prices, dates, statistics, product details or events. If the live results don't cover it, or it's too recent/niche to confirm, just say so plainly — a quick honest "couldn't find anything solid on that" beats a confident wrong answer.

LENGTH — short and snappy. Default to 2-4 sentences. If you must list, a quick intro line plus at most 3 tight bullets — never a long multi-section breakdown with labelled categories. Only go long if the user explicitly asks for a deep dive or full comparison.

FORMATTING — your reply is shown in a Telegram message. Use ONLY short plain-text paragraphs and "• " bullets when a list genuinely helps. Do NOT bold the opening line or whole sentences, and don't use bold as a headline; use *bold* (single asterisks) only sparingly for a key word or number. NEVER use Markdown tables, pipes (|), headings (#, ##), HTML tags, or <br>.`;

async function askGroq(question, newsContext = '') {
  const prompt = `${PERSONA}
${newsContext ? `\nLatest news context:\n${newsContext}\n` : ''}
Question: ${question}`;

  const response = await axios.post(
    'https://api.groq.com/openai/v1/chat/completions',
    { model: MODEL, messages: [{ role: 'user', content: prompt }], max_tokens: 1000, reasoning_effort: REASONING_EFFORT },
    { headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' } }
  );
  return response.data.choices[0].message.content;
}

// Multi-turn chat completion for the free-text Q&A. `webContext` is a short
// Tavily snippet block (see search.js) injected so the model answers from
// live info instead of stale training memory. We do the search ourselves and
// cap its size, which keeps the request small and well under Groq's limits.
async function chatGroq(history, question, webContext = '') {
  // Only keep the last couple of exchanges so the request stays lean.
  const recentHistory = Array.isArray(history) ? history.slice(-4) : [];
  const userContent = webContext
    ? `LIVE WEB RESULTS (today's info — base facts on these):\n${webContext}\n\nQuestion: ${question}`
    : question;
  const messages = [
    { role: 'system', content: PERSONA },
    ...recentHistory,
    { role: 'user', content: userContent }
  ];
  const response = await axios.post(
    'https://api.groq.com/openai/v1/chat/completions',
    // Lower ceiling keeps total tokens down; brevity is enforced by the persona.
    { model: MODEL, messages, max_tokens: 600, reasoning_effort: REASONING_EFFORT },
    { headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' } }
  );
  return response.data.choices[0].message.content;
}

// Rejects if the wrapped promise doesn't settle within `ms` so a slow
// Groq call falls back to hardcoded content instead of hanging the cron job.
function withTimeout(promise, ms = 12000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Groq timeout')), ms))
  ]);
}

// Asks Groq for a JSON response and parses it. A higher temperature yields
// more varied wording/angles (used by the MCQ generator to avoid repeats).
async function groqJSON(prompt, maxTokens = 1000, temperature = 1) {
  const response = await withTimeout(axios.post(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      model: MODEL,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokens,
      temperature,
      reasoning_effort: REASONING_EFFORT,
      response_format: { type: 'json_object' }
    },
    { headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' } }
  ), 20000);
  return JSON.parse(response.data.choices[0].message.content);
}

// Validates one MCQ object has the expected shape.
function isValidMCQ(q) {
  return q && q.question && q.explanation &&
    Array.isArray(q.options) && q.options.length === 4 &&
    ['A', 'B', 'C', 'D'].includes(q.answer);
}

// Generates a set of three fresh MCQs (Easy, Medium, Hard) based on
// recent headlines. `recentQuestions` is an avoid-list of recently-asked
// question texts (see mcqHistory.js) so Groq doesn't reuse the same topics.
// Throws if Groq is down/slow or returns malformed questions — the caller
// is expected to fall back to hardcoded ones.
async function generateMCQSet(headlines, recentQuestions = []) {
  const avoidBlock = recentQuestions.length
    ? `\n────────────────────────────────────────
🚫 BANNED SUBJECTS — these questions were already asked on recent days:
${recentQuestions.map(q => `- ${q}`).join('\n')}

HARD RULE: every one of your three questions must be about a DIFFERENT subject from every banned question above. A subject is banned even if you reword it, change the difficulty, flip the angle, or focus on a different detail of the same company / event / asset / metric. If a headline below relates to any banned subject (e.g. the same company, the same conflict, the same IPO, the same commodity), SKIP that headline and choose a different one. There are many headlines — use the less obvious ones.
────────────────────────────────────────\n`
    : '';

  const prompt = `You are a financial educator creating a daily quiz for a markets/news Telegram channel.
Based on these recent headlines, create THREE multiple-choice questions connected to the news, at three clearly different difficulty levels:
- 🟢 Easy: beginner-friendly, tests one basic concept.
- 🟡 Medium: intermediate, needs real understanding of how something works.
- 🔴 Hard: genuinely difficult, expert/CFA-professional level — test deep conceptual understanding, mechanisms, or second-order / knock-on effects, with subtle distractors. PREFER reasoning over arithmetic: do NOT pose multi-step numerical problems (e.g. forward pricing, discounting, bond math) — they tend to come out internally inconsistent. If a number is unavoidable, keep the calculation trivial and make sure the stated correct answer is unambiguously and verifiably right. This question should challenge even finance professionals.

IMPORTANT — vary the topics: tie ALL THREE questions (the Easy one included) to a specific company, asset, market, region or event mentioned in TODAY'S headlines below. Do NOT fall back on generic evergreen textbook questions (e.g. "what does the S&P 500 track", "what does GDP stand for") — pick fresh angles that would differ from day to day.
Each question must be self-contained (do not assume the reader saw a specific article).

Recent headlines:
${headlines}
${avoidBlock}
Respond ONLY with valid JSON in exactly this shape:
{
  "questions": [
    { "level": "🟢 Easy",   "question": "...", "options": ["A — ...","B — ...","C — ...","D — ..."], "answer": "A", "explanation": "1-2 sentence explanation" },
    { "level": "🟡 Medium", "question": "...", "options": ["A — ...","B — ...","C — ...","D — ..."], "answer": "B", "explanation": "1-2 sentence explanation" },
    { "level": "🔴 Hard",   "question": "...", "options": ["A — ...","B — ...","C — ...","D — ..."], "answer": "C", "explanation": "1-2 sentence explanation" }
  ]
}
Make every option plausible and tempting — NO joke, silly, or filler answers. Aim for genuinely challenging questions that test real understanding and application, not just definitions; the wrong options should be common misconceptions. Keep each option under 90 characters.`;

  // Higher temperature → more varied wording and angles day to day.
  // Extra token headroom so three detailed questions never truncate.
  const data = await groqJSON(prompt, 1500, 1.1);
  const qs = data && data.questions;
  const valid = Array.isArray(qs) && qs.length === 3 && qs.every(isValidMCQ);
  if (!valid) throw new Error('Malformed MCQ set from Groq');
  // Force canonical level labels by position so a slightly off label from
  // the model doesn't matter (and the 3 tiers are always Easy/Medium/Hard).
  const levels = ['🟢 Easy', '🟡 Medium', '🔴 Hard'];
  qs.forEach((q, i) => { q.level = levels[i]; });
  return qs;
}

// Generates a fresh poll based on recent headlines.
// Throws on failure so the caller can fall back to a hardcoded poll.
async function generatePoll(headlines) {
  const prompt = `You run a finance/markets Telegram community. Based on these recent headlines, create ONE fun, engaging poll to spark discussion about markets, the economy or current financial events.

Recent headlines:
${headlines}

Respond ONLY with valid JSON in exactly this shape:
{
  "question": "🗳️ <catchy title>\\n\\n<the poll question>",
  "options": ["<option with emoji>", "...", "4 to 5 options total"]
}
Keep each option under 90 characters. Make the last option a lighthearted or neutral choice.`;

  const p = await groqJSON(prompt);
  const valid = p && p.question && Array.isArray(p.options) &&
    p.options.length >= 2 && p.options.length <= 10 &&
    p.options.every(o => typeof o === 'string' && o.length <= 100);
  if (!valid) throw new Error('Malformed poll from Groq');
  return p;
}

// Writes a clear 2-3 sentence editorial summary for each article, in one
// batched call. Returns an array of strings in the same order as `articles`.
// Throws on failure so the PDF builder can fall back to the description.
async function generateSummaries(articles) {
  const list = articles.map((a, i) =>
    `${i + 1}. ${a.title || 'Untitled'} — ${(a.description || '').slice(0, 240)}`
  ).join('\n');

  const prompt = `You are the editor of a daily news magazine for everyday readers who are NOT finance or politics experts. For each numbered article below, write a clear 2-3 sentence summary that anyone can understand.

Rules for each summary:
- Use clear, everyday language — write like you are explaining it to a smart friend.
- You may use common financial, markets and political terms (jargon) naturally — no need to over-explain basics. Only add a quick plain-English note for genuinely obscure terms.
- Explain WHY it matters or how it affects ordinary people, not just what happened.
- Be factual and neutral. Do not invent details beyond the title and description.
- No hype, no clickbait, no emojis.

Articles:
${list}

Respond ONLY with valid JSON in exactly this shape:
{ "summaries": ["summary for article 1", "summary for article 2", "... one entry per article, same order"] }
Provide exactly ${articles.length} summaries.`;

  const data = await groqJSON(prompt, 2200);
  const s = data && data.summaries;
  const valid = Array.isArray(s) && s.length === articles.length &&
    s.every(x => typeof x === 'string' && x.trim().length > 0);
  if (!valid) throw new Error('Malformed summaries from Groq');
  return s.map(x => x.trim());
}

module.exports = { askGroq, chatGroq, generateMCQSet, generatePoll, generateSummaries, AI_CREDIT };
