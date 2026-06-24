const axios = require('axios');
const { NEWS_API_KEY } = require('../config');
const { trackApiCall } = require('./quota');
const { isBlocked } = require('./blocklist');

// Removes blocked-domain articles from a NewsAPI response. The blocklist is
// managed at runtime via /block and /unblock (see blocklist.js).
function filterArticles(articles) {
  return (articles || []).filter(a => a && a.url && !isBlocked(a.url));
}

async function fetchNews(category, pageSize = 10) {
  const queries = {
    markets: 'stock market OR financial markets OR S&P500 OR nasdaq OR dow jones',
    world: 'geopolitics OR international relations OR war OR diplomacy OR sanctions',
    technology: 'artificial intelligence OR technology OR semiconductor OR cybersecurity',
  };
  trackApiCall();
  const response = await axios.get('https://newsapi.org/v2/everything', {
    params: { q: queries[category], language: 'en', sortBy: 'publishedAt', pageSize: pageSize + 6, apiKey: NEWS_API_KEY }
  });
  return filterArticles(response.data.articles).slice(0, pageSize);
}

async function fetchNewsByKeyword(keyword, pageSize = 5) {
  trackApiCall();
  const response = await axios.get('https://newsapi.org/v2/everything', {
    params: { q: keyword, language: 'en', sortBy: 'publishedAt', pageSize: pageSize + 6, apiKey: NEWS_API_KEY }
  });
  return filterArticles(response.data.articles).slice(0, pageSize);
}

async function fetchNewsByCountry(country, pageSize = 5) {
  trackApiCall();
  const response = await axios.get('https://newsapi.org/v2/top-headlines', {
    params: { country, pageSize: pageSize + 6, apiKey: NEWS_API_KEY }
  });
  return filterArticles(response.data.articles).slice(0, pageSize);
}

// Used by all scheduled posts to stay within the 100 calls/day free tier limit.
// Replaces the old pattern of fetchNews('markets') + fetchNews('world') + fetchNews('technology').
// Fetches extra so enough remain after blocked-domain filtering.
// sortBy: 'popularity' (default — lead with significant stories from major
// outlets) or 'publishedAt' (newest first, used by the timed news updates).
// fromDaysAgo constrains results to a recent window. This matters: without a
// date filter, sortBy=popularity ranks across NewsAPI's whole ~month window
// and returns the SAME most-popular articles every day (the feed never moves).
// A sliding recent window keeps the content fresh day to day.
async function fetchCombinedNews(pageSize = 15, sortBy = 'popularity', fromDaysAgo = 2) {
  trackApiCall();
  const from = new Date(Date.now() - fromDaysAgo * 86400000).toISOString().slice(0, 10);
  const response = await axios.get('https://newsapi.org/v2/everything', {
    params: {
      q: 'stock market OR geopolitics OR artificial intelligence OR economy',
      language: 'en',
      sortBy,
      from,
      pageSize: Math.min(pageSize + 10, 100),
      apiKey: NEWS_API_KEY
    }
  });
  return filterArticles(response.data.articles).slice(0, pageSize);
}

module.exports = { fetchNews, fetchNewsByKeyword, fetchNewsByCountry, fetchCombinedNews };
