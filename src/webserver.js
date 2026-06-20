const express = require('express');
const path = require('path');
const { fetchCombinedNews } = require('./news');
const { generateSummaries, AI_CREDIT } = require('./groq');

const STORY_COUNT = 10;
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

// Cache the story list so opening the Mini App repeatedly doesn't spend a
// NewsAPI + Groq call every time.
let cache = { at: 0, stories: [] };

async function getStories() {
  if (cache.stories.length && Date.now() - cache.at < CACHE_TTL) return cache.stories;
  const articles = (await fetchCombinedNews(STORY_COUNT)).slice(0, STORY_COUNT);
  const summaries = await generateSummaries(articles).catch(err => {
    console.error('Web app summary generation failed, using descriptions:', err.message);
    return [];
  });
  const stories = articles.map((a, i) => ({
    title: a.title || 'Untitled',
    source: (a.source && a.source.name) || 'Nomo Wire',
    summary: summaries[i] || a.description || '',
    ai: Boolean(summaries[i] && summaries[i].trim()),
    image: a.urlToImage || '',
    url: a.url || ''
  }));
  cache = { at: Date.now(), stories };
  return stories;
}

function startWebServer() {
  const app = express();
  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.get('/api/stories', async (req, res) => {
    try {
      res.json({ stories: await getStories(), credit: AI_CREDIT });
    } catch (err) {
      console.error('Web app /api/stories error:', err.message);
      res.status(500).json({ error: 'Could not load stories' });
    }
  });

  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`Nomo News web app listening on :${port}`));
}

module.exports = { startWebServer, getStories };
