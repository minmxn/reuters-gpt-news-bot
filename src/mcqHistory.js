const fs = require('fs');
const path = require('path');

// Rolling memory of recently-asked MCQ questions so the AI can be told NOT
// to repeat them. Without this, the ~24h NewsAPI delay feeds near-identical
// headlines day to day and Groq writes essentially the same quiz.

// Keep this many recent questions (≈ the last ~10 days × 3 questions).
const MAX = 30;

// Set MCQ_HISTORY_STORE to a Railway volume path to survive redeploys.
const STORE_PATH = process.env.MCQ_HISTORY_STORE || path.join(__dirname, '..', 'mcq-history.json');

let questions = []; // most-recent-last

function save() {
  try {
    fs.writeFileSync(STORE_PATH, JSON.stringify(questions));
  } catch (e) {
    console.error('MCQ history save failed:', e.message);
  }
}

function load() {
  try {
    if (!fs.existsSync(STORE_PATH)) return;
    const arr = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    if (Array.isArray(arr)) questions = arr.filter(q => typeof q === 'string').slice(-MAX);
  } catch (e) {
    console.error('MCQ history load failed:', e.message);
  }
}

// Returns recent question texts (most recent last) for the avoid-list.
function recent() {
  return [...questions];
}

// Appends the texts of a freshly-posted MCQ set and trims to MAX.
function record(mcqs) {
  if (!Array.isArray(mcqs)) return;
  for (const q of mcqs) {
    if (q && typeof q.question === 'string') questions.push(q.question);
  }
  if (questions.length > MAX) questions = questions.slice(-MAX);
  save();
}

load();

module.exports = { recent, record };
