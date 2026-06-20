const PDFDocument = require('pdfkit');
const fs = require('fs');
const os = require('os');
const path = require('path');
const axios = require('axios');
const { TZ } = require('../config');
const { generateSummaries } = require('./groq');

// ─── PALETTE ──────────────────────────────────────────────────────
const NAVY = '#1a1a2e';
const GOLD = '#FFD700';
const RED = '#E12828';
const INK = '#1b1b2a';
const GRAY = '#555a66';
const MUTE = '#cfcfe0';
const LINE = '#e3e3e8';

const M = 40; // page margin
const STORY_COUNT = 10; // full-page stories (plus a cover)

// ─── HELPERS ──────────────────────────────────────────────────────

function truncate(text, max) {
  if (!text) return '';
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max).trim() + '…' : t;
}

function sourceName(article) {
  return (article.source && article.source.name ? article.source.name : 'Nomo Wire').toUpperCase();
}

function firstSentence(text) {
  if (!text) return '';
  const m = text.match(/^.*?[.!?](\s|$)/);
  return (m ? m[0] : text).trim();
}

// Downloads an article image as a Buffer. PDFKit only supports JPEG/PNG,
// so anything else (WebP/GIF/SVG) or a failed request returns null.
async function fetchImage(url) {
  if (!url) return null;
  try {
    const res = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 8000,
      maxContentLength: 6 * 1024 * 1024
    });
    const type = (res.headers['content-type'] || '').toLowerCase();
    if (!type.includes('jpeg') && !type.includes('jpg') && !type.includes('png')) return null;
    return Buffer.from(res.data);
  } catch (_) {
    return null;
  }
}

// Draws an image cropped to fill the box, or a navy/gold placeholder.
function drawImageBox(doc, img, x, y, w, h, frame = true) {
  let drawn = false;
  if (img) {
    doc.save();
    doc.rect(x, y, w, h).clip();
    try {
      doc.image(img, x, y, { cover: [w, h], align: 'center', valign: 'center' });
      drawn = true;
    } catch (_) { /* corrupt image — fall through to placeholder */ }
    doc.restore();
  }
  if (!drawn) {
    doc.save();
    doc.rect(x, y, w, h).fill(NAVY);
    doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(Math.min(22, w / 9))
      .text('NOMO NEWS', x, y + h / 2 - 11, { width: w, align: 'center', characterSpacing: 1 });
    doc.restore();
  }
  if (frame) doc.rect(x, y, w, h).lineWidth(0.5).strokeColor(LINE).stroke();
}

// translucent overlay rectangle
function overlay(doc, x, y, w, h, opacity) {
  doc.save();
  doc.rect(x, y, w, h).fillOpacity(opacity).fill(NAVY);
  doc.restore();
}

// ─── COVER PAGE ───────────────────────────────────────────────────

function drawCover(doc, items, images, summaries, dateStr, edition) {
  const W = doc.page.width;
  const H = doc.page.height;
  const lead = items[0];

  drawImageBox(doc, images[0], 0, 0, W, H, false);

  // top masthead overlay
  overlay(doc, 0, 0, W, 128, 0.55);
  doc.rect(0, 128, W, 4).fill(GOLD);
  doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(42)
    .text('NOMO NEWS', M, 34, { characterSpacing: 1 });
  doc.fillColor('#ffffff').font('Helvetica').fontSize(10)
    .text('YOUR DAILY MARKETS & WORLD BRIEFING', M + 2, 86, { characterSpacing: 2.5 });
  doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(12)
    .text(edition.toUpperCase(), M, 42, { width: W - M * 2, align: 'right' });
  doc.fillColor(MUTE).font('Helvetica').fontSize(10)
    .text(dateStr, M, 60, { width: W - M * 2, align: 'right' });

  // bottom story + contents overlay
  const bandTop = H - 336;
  overlay(doc, 0, bandTop, W, 336, 0.72);

  let y = bandTop + 26;
  doc.rect(M, y, 96, 22).fill(RED);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(10)
    .text('TOP STORY', M, y + 7, { width: 96, align: 'center', characterSpacing: 1 });
  doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(9)
    .text(sourceName(lead), M + 110, y + 7, { characterSpacing: 1.5 });
  y += 34;

  const title = truncate(lead.title, 120);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(26)
    .text(title, M, y, { width: W - M * 2, lineGap: 2 });
  y += doc.heightOfString(title, { width: W - M * 2, lineGap: 2 }) + 8;

  const teaser = truncate(firstSentence(summaries[0]) || lead.description, 180);
  if (teaser) {
    doc.fillColor(GOLD).font('Times-Italic').fontSize(12.5)
      .text(teaser, M, y, { width: W - M * 2, lineGap: 2 });
    y += doc.heightOfString(teaser, { width: W - M * 2, lineGap: 2 }) + 12;
  }

  doc.moveTo(M, y).lineTo(W - M, y).lineWidth(1).strokeColor(GOLD).stroke();
  y += 12;
  doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(9)
    .text('INSIDE THIS ISSUE', M, y, { characterSpacing: 2 });
  y += 16;

  items.slice(1, 4).forEach((a) => {
    const line = truncate(a.title, 74);
    doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(10).text('‣', M, y, { continued: false });
    doc.fillColor('#ffffff').font('Helvetica').fontSize(10)
      .text(line, M + 14, y, { width: W - M * 2 - 14 });
    y += doc.heightOfString(line, { width: W - M * 2 - 14 }) + 6;
  });

  // gold frame
  doc.rect(16, 16, W - 32, H - 32).lineWidth(1.5).strokeColor(GOLD).stroke();
}

// ─── STORY PAGE ───────────────────────────────────────────────────

function drawStoryMasthead(doc, edition, dateStr, idx, total) {
  const W = doc.page.width;
  doc.rect(0, 0, W, 56).fill(NAVY);
  doc.rect(0, 56, W, 3).fill(GOLD);
  doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(17)
    .text('NOMO NEWS', M, 16, { characterSpacing: 1 });
  doc.fillColor(MUTE).font('Helvetica').fontSize(9)
    .text(`${edition.toUpperCase()}  ·  ${dateStr}`, M, 20, { width: W - M * 2, align: 'right' });
  doc.fillColor('#ffffff').font('Helvetica').fontSize(8)
    .text(`STORY ${String(idx).padStart(2, '0')} / ${total}`, M, 38, { width: W - M * 2, align: 'right' });
  return 56 + 3 + 18;
}

function drawStory(doc, article, img, summary, dateStr, edition, idx, total) {
  const W = doc.page.width - M * 2;
  let y = drawStoryMasthead(doc, edition, dateStr, idx, total);

  // hero image
  const heroH = 296;
  drawImageBox(doc, img, M, y, W, heroH);
  doc.rect(M + 14, y + 14, 86, 20).fill(idx === 1 ? RED : NAVY);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9)
    .text(idx === 1 ? 'TOP STORY' : 'BRIEFING', M + 14, y + 20, { width: 86, align: 'center', characterSpacing: 1 });
  overlay(doc, M, y + heroH - 30, W, 30, 0.62);
  doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(9)
    .text(sourceName(article), M + 14, y + heroH - 20, { characterSpacing: 1.5 });
  y += heroH + 18;

  // headline
  const title = truncate(article.title, 150);
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(22)
    .text(title, M, y, { width: W, lineGap: 1 });
  y += doc.heightOfString(title, { width: W, lineGap: 1 }) + 8;

  // meta line + gold rule
  doc.fillColor(GRAY).font('Helvetica').fontSize(9.5)
    .text(`${(article.source && article.source.name) || 'Nomo Wire'}   ·   ${dateStr}`, M, y);
  y += 14;
  doc.moveTo(M, y).lineTo(M + 70, y).lineWidth(2).strokeColor(GOLD).stroke();
  y += 16;

  // AI summary as the editorial body (serif)
  const text = summary || truncate(article.description, 320);
  if (text) {
    doc.fillColor(INK).font('Times-Roman').fontSize(13)
      .text(text, M, y, { width: W, lineGap: 3.5, align: 'left' });
  }

  // clickable read-more pinned near the bottom
  const ry = doc.page.height - 64;
  const label = 'Read the full story  ›';
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(10.5)
    .text(label, M, ry, { link: article.url || null, underline: false });
  const lw = doc.widthOfString(label);
  doc.moveTo(M, ry + 14).lineTo(M + lw, ry + 14).lineWidth(1.5).strokeColor(GOLD).stroke();
}

// ─── MAIN ─────────────────────────────────────────────────────────

async function generateNewsPDF(articles, edition) {
  const items = articles.slice(0, STORY_COUNT);

  // Fetch images and AI summaries in parallel; both fall back gracefully.
  const [images, summaries] = await Promise.all([
    Promise.all(items.map(a => fetchImage(a.urlToImage))),
    generateSummaries(items).catch(err => {
      console.error('PDF summary generation failed, using descriptions:', err.message);
      return [];
    })
  ]);

  return new Promise((resolve, reject) => {
    const safe = edition.toLowerCase().replace(/\s+/g, '-');
    const filename = path.join(os.tmpdir(), `nomo-news-${safe}-${Date.now()}.pdf`);
    const doc = new PDFDocument({ margin: M, size: 'A4', bufferPages: true });
    const stream = fs.createWriteStream(filename);
    doc.pipe(stream);

    const dateStr = new Date().toLocaleDateString('en-SG', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: TZ
    });

    if (items.length === 0) {
      doc.fillColor(NAVY).fontSize(16).text('No news available right now.', M, 120);
      doc.end();
      stream.on('finish', () => resolve(filename));
      stream.on('error', reject);
      return;
    }

    drawCover(doc, items, images, summaries, dateStr, edition);

    items.forEach((article, i) => {
      doc.addPage();
      drawStory(doc, article, images[i], summaries[i], dateStr, edition, i + 1, items.length);
    });

    // Footer band + page numbers on every page except the cover.
    const range = doc.bufferedPageRange();
    for (let p = 1; p < range.count; p++) {
      doc.switchToPage(range.start + p);
      const PW = doc.page.width;
      const PH = doc.page.height;
      doc.rect(0, PH - 30, PW, 30).fill(NAVY);
      doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(8)
        .text('BUILT BY MIN', M, PH - 20, { characterSpacing: 1 });
      doc.fillColor(MUTE).font('Helvetica').fontSize(8)
        .text(`Page ${p} of ${range.count - 1}`, M, PH - 20, { width: PW - M * 2, align: 'right' });
    }

    doc.end();
    stream.on('finish', () => resolve(filename));
    stream.on('error', reject);
  });
}

module.exports = { generateNewsPDF };
