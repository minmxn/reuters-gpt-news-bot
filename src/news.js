const axios = require('axios');
const { NEWS_API_KEY } = require('../config');
const { trackApiCall } = require('./quota');

// Low-quality aggregators / redirectors to drop from every result. biztoc.com
// in particular redirects to alltoc.com instead of the real source article.
const BLOCKED_DOMAINS = [
  'biztoc.com',   // scraper aggregator, redirects to alltoc.com
  'alltoc.com',   // redirect aggregator
  'medium.com',   // blog platform, inconsistent quality
];

function isCleanArticle(article) {
  if (!article || !article.url) return false;
  try {
    const host = new URL(article.url).hostname;
    return !BLOCKED_DOMAINS.some(d => host.includes(d));
  } catch {
    return false;
  }
}

// Removes blocked-domain articles from a NewsAPI response.
function filterArticles(articles) {
  return (articles || []).filter(isCleanArticle);
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
async function fetchCombinedNews(pageSize = 15) {
  trackApiCall();
  const response = await axios.get('https://newsapi.org/v2/everything', {
    params: {
      q: 'stock market OR geopolitics OR artificial intelligence OR economy',
      language: 'en',
      sortBy: 'publishedAt',
      pageSize: Math.min(pageSize + 10, 100),
      apiKey: NEWS_API_KEY
    }
  });
  return filterArticles(response.data.articles).slice(0, pageSize);
}

module.exports = { fetchNews, fetchNewsByKeyword, fetchNewsByCountry, fetchCombinedNews };
