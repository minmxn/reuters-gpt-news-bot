const fs = require('fs');
const path = require('path');

// Always-blocked junk aggregators (can't be removed).
const DEFAULTS = ['biztoc.com', 'alltoc.com', 'medium.com'];

// Set BLOCKLIST_STORE to a Railway volume path to survive redeploys.
const STORE_PATH = process.env.BLOCKLIST_STORE || path.join(__dirname, '..', 'blocked-domains.json');

let domains = new Set(DEFAULTS);

function save() {
  try {
    // Persist only the user-added ones; defaults are always re-seeded.
    const extra = [...domains].filter(d => !DEFAULTS.includes(d));
    fs.writeFileSync(STORE_PATH, JSON.stringify(extra));
  } catch (e) {
    console.error('Blocklist save failed:', e.message);
  }
}

function load() {
  try {
    if (!fs.existsSync(STORE_PATH)) return;
    const arr = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    if (Array.isArray(arr)) domains = new Set([...DEFAULTS, ...arr.map(d => String(d).toLowerCase())]);
  } catch (e) {
    console.error('Blocklist load failed:', e.message);
  }
}

// Strips scheme / www / path so "https://www.foo.com/bar" → "foo.com".
function normalize(input) {
  return String(input || '').trim().toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '');
}

function isBlocked(url) {
  if (!url) return true;
  let host;
  try { host = new URL(url).hostname.replace(/^www\./, ''); }
  catch { return true; }
  for (const d of domains) {
    if (host === d || host.endsWith('.' + d)) return true;
  }
  return false;
}

function add(input) {
  const d = normalize(input);
  if (!d) return null;
  domains.add(d);
  save();
  return d;
}

function remove(input) {
  const d = normalize(input);
  if (DEFAULTS.includes(d)) return false; // defaults can't be removed
  const had = domains.delete(d);
  if (had) save();
  return had ? d : null;
}

function list() {
  return [...domains].sort();
}

load();

module.exports = { isBlocked, add, remove, list };
