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

async function webSearchContext(query) {
  if (!TAVILY_API_KEY) return '';
  try {
    const resp = await axios.post(
      'https://api.tavily.com/search',
      {
        query,
        max_results: MAX_RESULTS,
        // 'advanced' returns more relevant snippets (worth the extra credit);
        // time_range biases toward recent pages so "latest X" doesn't surface
        // a year-old article and confuse the model.
        search_depth: 'advanced',
        time_range: 'year',
        include_answer: 'basic', // Tavily's own short synthesis of the results
        topic: 'general',
      },
      { headers: { Authorization: `Bearer ${TAVILY_API_KEY}` }, timeout: 8000 }
    );

    const data = resp.data || {};
    const lines = [];
    if (data.answer) lines.push(`Summary: ${data.answer}`);
    for (const r of data.results || []) {
      const snippet = String(r.content || '').replace(/\s+/g, ' ').trim().slice(0, SNIPPET_CHARS);
      if (snippet) lines.push(`• ${r.title} — ${snippet}`);
    }
    return lines.join('\n');
  } catch (e) {
    console.error('Tavily search failed:', e.response ? e.response.status : e.message);
    return '';
  }
}

module.exports = { webSearchContext };
