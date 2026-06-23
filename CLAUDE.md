# Nomo News Bot

A Telegram news bot ("BUILT BY MIN") that fetches financial/world/tech news, summarizes it with AI, and posts it on a daily schedule — as a swipeable card reader, a magazine-style PDF, polls, and quizzes.

## Tech stack

- **Node.js** (CommonJS modules)
- **node-telegram-bot-api** — Telegram bot (long polling)
- **axios** — HTTP (NewsAPI, Groq, image downloads)
- **node-cron** — scheduled posts (all times Asia/Singapore)
- **pdfkit** — PDF magazine generation
- **NewsAPI** (newsapi.org) — news source (free tier: 100 calls/day, ~24h article delay)
- **Groq** (llama-3.3-70b) — AI summaries, briefings, polls, quizzes
- Deployed on **Railway** (auto-deploys from `main`)

## Run

```
npm install
npm start        # = node bot.js
```

Only one instance may poll Telegram at a time, or you get HTTP 409 conflicts. Since Railway runs the bot, don't also run it locally against the same token.

## Environment variables

Validated at startup in [config.js](config.js) — the process exits with a clear message if a required var is missing.

| Var | Required | Purpose |
|---|---|---|
| `TELEGRAM_TOKEN` | ✅ | Bot token from @BotFather |
| `NEWS_API_KEY` | ✅ | newsapi.org key |
| `GROQ_API_KEY` | recommended | AI features; degrade gracefully if absent |
| `CHAT_ID` | recommended | Target chat/channel for scheduled posts |
| `BOT_USERNAME` | optional | Defaults to `nomogh_bot` (used for group mention/reply detection) |
| `READER_STORE` | optional | Path for persisted reader sessions; point at a Railway volume (e.g. `/data/reader-sessions.json`) to survive redeploys |
| `WEBAPP_URL` | optional | Public HTTPS URL of the Mini App (the Railway domain). When set, enables the `/swipe` launch button + menu button |
| `PORT` | optional | Web server port (Railway sets this automatically; defaults to 3000 locally) |
| `MEMORY_STORE` | optional | Path for persisted per-user chat memory; point at a Railway volume to survive redeploys |
| `BLOCKLIST_STORE` | optional | Path for the persisted runtime domain blocklist; point at a Railway volume to survive redeploys |
| `ADMIN_ID` | optional | Telegram user id allowed to run `/block` and `/unblock`. If unset, anyone can manage the blocklist |

## Architecture

`bot.js` is a thin entry point: it creates the bot and calls three registrars.

```
bot.js
├── config.js              env vars + constants + startup validation
├── src/
│   ├── commands.js        registerCommands(bot) — all bot.onText handlers + the
│   │                      free-text AI fallback (bot.on('message'))
│   ├── scheduler.js       registerScheduler(bot) — all cron jobs, the reply
│   │                      keyboard, the /schedule text, MCQ fallback picker
│   ├── reader.js          registerReader(bot) + startReader() — the /read
│   │                      swipeable carousel (inline-button navigation)
│   ├── webserver.js       startWebServer() — Express server for the Mini App:
│   │                      serves public/ and GET /api/stories (cached 10 min);
│   │                      also exports getStories() for reuse
│   ├── teaser.js          sendTopStoriesTeaser() — posts a top-story photo +
│   │                      headline card with a button that opens the reader
│   │                      (web_app button in private chats, link button in groups)
│   ├── news.js            NewsAPI fetchers + blocked-domain filtering
│   ├── groq.js            askGroq + generateSummaries / generateMCQSet /
│   │                      generatePoll (JSON mode, with timeout)
│   ├── pdf.js             generateNewsPDF() — magazine PDF (cover + stories)
│   ├── quota.js           in-memory daily NewsAPI call counter
│   ├── memory.js          per-user chat memory (10 exchanges, 60-min idle,
│   │                      persisted to MEMORY_STORE) for the free-text Q&A
│   ├── blocklist.js       runtime domain blocklist (defaults + user-added via
│   │                      /block), persisted to BLOCKLIST_STORE; used by news.js
│   └── helpers.js         escapeMarkdown, truncate, buildNewsBody, formatNews,
│                          shouldRespond, cleanMessage
├── data/
│   ├── polls.js           dailyPolls (per weekday)
│   └── mcq.js             mcqQuestions (hardcoded fallback) + mcqState
└── public/
    └── index.html         Mini App — fullscreen swipeable card reader
                           (Telegram WebApp SDK, CSS scroll-snap, /api/stories)
```

### Data flow (scheduled post)

`cron fires → news.js fetchCombinedNews() (1 NewsAPI call, blocked domains filtered)
→ groq.js summarizes/builds content → bot sends to CHAT_ID`.

### Key registrars

- **commands.js** — `/start`, `/markets`, `/world`, `/tech`, `/briefing`, `/mood`, `/search`, `/stock`, `/sg`, `/us`, `/cn`, `/read`, `/quota`, `/reset`, `/testpdf`, `/schedule`, plus reply-keyboard buttons and an AI fallback for free-text questions. The free-text Q&A uses `chatGroq` with per-user memory ([memory.js](src/memory.js)) and reply-context (anchors to the message a user replied to). See [COMMANDS.md](COMMANDS.md).
- **scheduler.js** — cron jobs (see schedule below). `postNewsUpdate()` posts the carousel; `fallbackMCQSet()` rotates hardcoded questions when Groq is unavailable.
- **reader.js** — the carousel. Sessions (articles + summaries + cached Telegram `file_id`s) live in a `Map`, persisted to `READER_STORE` (24h TTL). Images are pre-downloaded so `Next`/`Prev` (via `editMessageMedia`) are fast; cached `file_id`s make repeat views instant. Image source order: cached file_id → buffer → URL → placeholder.

## Daily schedule (SGT)

| Time | Post | Source |
|---|---|---|
| 8:00am | Morning briefing (AI summary only) | scheduler.js |
| 9:00am | Daily poll — AI-generated, falls back to hardcoded | scheduler.js + data/polls.js |
| 10:00am | MCQ quiz (3 questions) — AI-generated, falls back to hardcoded | scheduler.js + data/mcq.js |
| 11:00am | MCQ answers | scheduler.js |
| 12:00pm | News reader (carousel) | scheduler.js → reader.js |
| 3:00pm | News reader (carousel) | scheduler.js → reader.js |
| 6:00pm | Evening Top News teaser card (opens the reader) | scheduler.js + teaser.js |
| 8:00pm | News reader (carousel) | scheduler.js → reader.js |
| 10:00pm | News reader (carousel) | scheduler.js → reader.js |

## Design notes / conventions

- **AI is best-effort.** Every Groq-backed feature (summaries, poll, MCQ) has a silent fallback (description / hardcoded poll / hardcoded MCQ) and logs failures via `console.error`. Users always get content.
- **API budget.** Scheduled posts use ~9 NewsAPI calls/day (1 each) to stay well under the 100/day free-tier cap. The combined query (`fetchCombinedNews`) replaced 3 separate category fetches. Quota is tracked in `quota.js` (in-memory, resets at SGT midnight).
- **Blocked domains.** `news.js` drops blocked domains from every result via `blocklist.js` (defaults: biztoc.com, alltoc.com, medium.com; more added at runtime with `/block`). Fetchers request extras and trim so enough clean stories remain. There is no source whitelist — the feed pulls from all of NewsAPI minus the blocklist.
- **PDFKit only supports JPEG/PNG.** Other image formats fall back to a navy "NOMO NEWS" placeholder. (Telegram itself handles WebP, so the carousel shows more real photos than the PDF.)
- **Times are always Asia/Singapore** via the `TZ` constant and `cron` `{ timezone: TZ }`.

## Known limitations

- NewsAPI free tier delays articles up to ~24h and caps at 100 calls/day.
- Reader sessions persist to a file; on Railway this only survives redeploys if `READER_STORE` points at a mounted volume.
- Single polling instance only (no horizontal scaling).
