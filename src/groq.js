const axios = require('axios');
const { GROQ_API_KEY } = require('../config');

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

// Rejects if the wrapped promise doesn't settle within `ms` so a slow
// Groq call falls back to hardcoded content instead of hanging the cron job.
function withTimeout(promise, ms = 12000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Groq timeout')), ms))
  ]);
}

// Asks Groq for a JSON response and parses it.
async function groqJSON(prompt, maxTokens = 1000) {
  const response = await withTimeout(axios.post(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokens,
      response_format: { type: 'json_object' }
    },
    { headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' } }
  ), 20000);
  return JSON.parse(response.data.choices[0].message.content);
}

// Validates one MCQ object has the expected shape.
function isValidMCQ(q, expectedLevel) {
  return q && q.question && q.explanation &&
    Array.isArray(q.options) && q.options.length === 4 &&
    ['A', 'B', 'C', 'D'].includes(q.answer) &&
    q.level === expectedLevel;
}

// Generates a set of three fresh MCQs (Easy, Medium, Hard) based on
// recent headlines. Throws if Groq is down/slow or returns malformed
// questions — the caller is expected to fall back to hardcoded ones.
async function generateMCQSet(headlines) {
  const prompt = `You are a financial educator creating a daily quiz for a markets/news Telegram channel.
Based on these recent headlines, create THREE multiple-choice questions — one 🟢 Easy, one 🟡 Medium, one 🔴 Hard — that each teach a useful finance, economics, markets or geopolitics concept connected to the news. Each question must be self-contained (do not assume the reader saw a specific article).

Recent headlines:
${headlines}

Respond ONLY with valid JSON in exactly this shape:
{
  "questions": [
    { "level": "🟢 Easy",   "question": "...", "options": ["A — ...","B — ...","C — ...","D — ..."], "answer": "A", "explanation": "1-2 sentence explanation" },
    { "level": "🟡 Medium", "question": "...", "options": ["A — ...","B — ...","C — ...","D — ..."], "answer": "B", "explanation": "1-2 sentence explanation" },
    { "level": "🔴 Hard",   "question": "...", "options": ["A — ...","B — ...","C — ...","D — ..."], "answer": "C", "explanation": "1-2 sentence explanation" }
  ]
}
In each question make one option a light humorous wrong answer. Keep each option under 90 characters.`;

  const data = await groqJSON(prompt);
  const qs = data && data.questions;
  const levels = ['🟢 Easy', '🟡 Medium', '🔴 Hard'];
  const valid = Array.isArray(qs) && qs.length === 3 &&
    qs.every((q, i) => isValidMCQ(q, levels[i]));
  if (!valid) throw new Error('Malformed MCQ set from Groq');
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

module.exports = { askGroq, generateMCQSet, generatePoll, generateSummaries };
