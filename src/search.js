const axios = require('axios');
const { TAVILY_API_KEY, GROQ_API_KEY } = require('../config');

// Lightweight web search via Tavily (https://tavily.com). Returns a SHORT,
// token-bounded context string to ground the AI Q&A, or '' if search is
// unavailable or finds nothing. Keeping this small is the whole point: it's
// what lets the free-text Q&A use live info without blowing Groq's token
// limits (the reason we don't let the model search the web itself).

const MAX_RESULTS = 10;
const SNIPPET_CHARS = 600;
const TIMEOUT_MS = 12000; // advanced search can be slow; give it room

// One Tavily call at the given depth. Returns a context string ('' if empty).
async function runSearch(query, searchDepth, timeRange, topic) {
  const resp = await axios.post(
    'https://api.tavily.com/search',
    {
      query,
      max_results: MAX_RESULTS,
      search_depth: searchDepth,
      time_range: timeRange,
      include_answer: 'basic',
      topic,
    },
    { headers: { Authorization: `Bearer ${TAVILY_API_KEY}` }, timeout: TIMEOUT_MS }
  );

  const data = resp.data || {};
  const lines = [];
  if (data.answer) lines.push(`Summary: ${data.answer}`);
  for (const r of data.results || []) {
    const snippet = String(r.content || '').replace(/\s+/g, ' ').trim().slice(0, SNIPPET_CHARS);
    if (snippet) lines.push(`• ${r.title} — ${snippet}`);
  }
  return lines.join('\n');
}

// Ask Groq to infer both the time window and topic in one call.
// Returns { timeRange: 'day'|'week'|'month'|'year', topic: 'news'|'general' }.
// Falls back to { timeRange: 'week', topic: 'news' } on any error.
async function inferSearchParams(query) {
  const defaults = { timeRange: 'week', topic: 'news' };
  if (!GROQ_API_KEY) return defaults;
  try {
    const resp = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: 'openai/gpt-oss-120b',
        messages: [{
          role: 'user',
          content: `You are a search assistant. Given this question, decide:
1. time_range — how recent the info needs to be: day, week, month, or year
2. topic — "news" for news/events/announcements, "general" for prices, data, stats, or factual lookups

Question: "${query}"

Reply with exactly two words on one line, space-separated: <time_range> <topic>
Example: day general`,
        }],
        max_tokens: 10,
        reasoning_effort: 'low',
      },
      { headers: { Authorization: `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' }, timeout: 5000 }
    );
    const parts = resp.data.choices[0].message.content.trim().toLowerCase().split(/\s+/);
    const timeRange = ['day', 'week', 'month', 'year'].includes(parts[0]) ? parts[0] : defaults.timeRange;
    const topic = ['news', 'general'].includes(parts[1]) ? parts[1] : defaults.topic;
    return { timeRange, topic };
  } catch (e) {
    console.error('inferSearchParams failed:', e.message);
  }
  return defaults;
}

async function webSearchContext(query) {
  if (!TAVILY_API_KEY) return '';
  const { timeRange, topic } = await inferSearchParams(query);
  const attempts = [['advanced', timeRange, topic], ['basic', timeRange, topic]];
  for (const [depth, tr, tp] of attempts) {
    try {
      const ctx = await runSearch(query, depth, tr, tp);
      if (ctx) return ctx;
      console.error(`Tavily ${depth}/${tr}/${tp} returned no results for: ${query}`);
    } catch (e) {
      console.error(`Tavily ${depth}/${tr}/${tp} failed:`, e.response ? e.response.status : e.message);
    }
  }
  return '';
}

module.exports = { webSearchContext };
