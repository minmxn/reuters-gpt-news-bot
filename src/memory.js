const fs = require('fs');
const path = require('path');

const MAX_MESSAGES = 20;             // 10 exchanges (user + assistant each)
const IDLE_TTL = 60 * 60 * 1000;     // forget a thread after 60 min idle

// Set MEMORY_STORE to a Railway volume path to survive redeploys.
const STORE_PATH = process.env.MEMORY_STORE || path.join(__dirname, '..', 'chat-memory.json');

// Per-user conversation threads, keyed by "<chatId>:<userId>" so each person
// has their own thread (works the same in private chats and groups).
//   key -> { messages: [{role, content}], updatedAt }
const store = new Map();

function keyOf(chatId, userId) { return `${chatId}:${userId || 'anon'}`; }

function save() {
  try {
    const obj = {};
    for (const [k, v] of store) obj[k] = v;
    fs.writeFileSync(STORE_PATH, JSON.stringify(obj));
  } catch (e) {
    console.error('Memory save failed:', e.message);
  }
}

function load() {
  try {
    if (!fs.existsSync(STORE_PATH)) return;
    const obj = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    const now = Date.now();
    for (const [k, v] of Object.entries(obj)) {
      if (v && Array.isArray(v.messages) && now - v.updatedAt < IDLE_TTL) store.set(k, v);
    }
  } catch (e) {
    console.error('Memory load failed:', e.message);
  }
}

// Returns the recent message history for a user (empty if none or expired).
function getHistory(chatId, userId) {
  const k = keyOf(chatId, userId);
  const entry = store.get(k);
  if (!entry) return [];
  if (Date.now() - entry.updatedAt > IDLE_TTL) { store.delete(k); save(); return []; }
  return entry.messages;
}

// Records a question/answer pair, trimming to the most recent MAX_MESSAGES.
function append(chatId, userId, userMsg, assistantMsg) {
  const k = keyOf(chatId, userId);
  const entry = store.get(k) || { messages: [], updatedAt: Date.now() };
  entry.messages.push({ role: 'user', content: userMsg }, { role: 'assistant', content: assistantMsg });
  if (entry.messages.length > MAX_MESSAGES) entry.messages = entry.messages.slice(-MAX_MESSAGES);
  entry.updatedAt = Date.now();
  store.set(k, entry);
  save();
}

function reset(chatId, userId) {
  store.delete(keyOf(chatId, userId));
  save();
}

load();

module.exports = { getHistory, append, reset };
