const axios = require('axios');
const { TAVILY_API_KEY } = require('../config');

// Lightweight web search via Tavily (https://tavily.com). Returns a SHORT,
// token-bounded context string to ground the AI Q&A, or '' if search is
// unavailable or finds nothing. Keeping this small is the whole point: it's
// what lets the free-text Q&A use live info without blowing Groq's token
// limits (the reason we don't let the model search the web itself).

// Trim each snippet so the combined context stays tiny (~a few hundred tokens).
const MAX_RESULTS = 5;
const SNIPPET_CHARS = 250;
const TIMEOUT_MS = 12000; // advanced search can be slow; give it room

// One Tavily call at the given depth. Returns a context string ('' if empty).
async function runSearch(query, searchDepth) {
  const resp = await axios.post(
    'https://api.tavily.com/search',
    {
      query,
      max_results: MAX_RESULTS,
      search_depth: searchDepth,
      time_range: 'year', // bias toward recent pages so "latest X" isn't stale
      include_answer: 'basic', // Tavily's own short synthesis of the results
      topic: 'general',
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

async function webSearchContext(query) {
  if (!TAVILY_API_KEY) return '';
  // Try 'advanced' first (best relevance). If it errors, times out, or comes
  // back empty, retry once with the faster 'basic' depth so a single slow or
  // flaky call doesn't make the bot wrongly claim it found nothing.
  for (const depth of ['advanced', 'basic']) {
    try {
      const ctx = await runSearch(query, depth);
      if (ctx) return ctx;
      console.error(`Tavily ${depth} search returned no results for: ${query}`);
    } catch (e) {
      console.error(`Tavily ${depth} search failed:`, e.response ? e.response.status : e.message);
    }
  }
  return '';
}

module.exports = { webSearchContext };
