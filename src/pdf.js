const PDFDocument = require('pdfkit');
const fs = require('fs');
const os = require('os');
const path = require('path');
const axios = require('axios');
const { TZ } = require('../config');

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

// NewsAPI free-tier `content` ends with a "[+1234 chars]" marker — strip it.
function cleanContent(article) {
  const body = (article.content || '').replace(/\s*\[\+\d+\s*chars\]\s*$/i, '').trim();
  if (!body) return '';
  const desc = (article.description || '').trim();
  if (desc && body.slice(0, 30) === desc.slice(0, 30)) return ''; // avoid duplicating standfirst
  return body;
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
// frame=false skips the border (used for full-bleed cover image).
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

// ─── COVER PAGE ───────────────────────────────────────────────────

function drawCover(doc, article, img, dateStr, edition) {
  const W = doc.page.width;
  const H = doc.page.height;

  // full-bleed lead photo
  drawImageBox(doc, img, 0, 0, W, H, false);

  // top masthead overlay
  doc.save();
  doc.rect(0, 0, W, 124).fillOpacity(0.58).fill(NAVY);
  doc.restore();
  doc.rect(0, 124, W, 4).fill(GOLD);
  doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(40)
    .text('NOMO NEWS', M, 34, { characterSpacing: 1 });
  doc.fillColor('#ffffff').font('Helvetica').fontSize(10)
    .text('YOUR DAILY MARKETS & WORLD BRIEFING', M + 2, 84, { characterSpacing: 2.5 });
  doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(12)
    .text(edition.toUpperCase(), M, 40, { width: W - M * 2, align: 'right' });
  doc.fillColor(MUTE).font('Helvetica').fontSize(10)
    .text(dateStr, M, 58, { width: W - M * 2, align: 'right' });

  // bottom teaser overlay
  const bandTop = H - 232;
  doc.save();
  doc.rect(0, bandTop, W, 232).fillOpacity(0.72).fill(NAVY);
  doc.restore();

  doc.rect(M, bandTop + 30, 96, 22).fill(RED);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(10)
    .text('TOP STORY', M, bandTop + 37, { width: 96, align: 'center', characterSpacing: 1 });

  doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(10)
    .text(sourceName(article), M, bandTop + 64, { characterSpacing: 1.5 });

  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(27)
    .text(truncate(article.title, 150), M, bandTop + 82, { width: W - M * 2, lineGap: 2 });
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

function drawStory(doc, article, img, dateStr, edition, idx, total) {
  const W = doc.page.width - M * 2;
  let y = drawStoryMasthead(doc, edition, dateStr, idx, total);

  // hero image
  const heroH = 300;
  drawImageBox(doc, img, M, y, W, heroH);

  // category badge + source overlay
  doc.rect(M + 14, y + 14, 86, 20).fill(idx === 1 ? RED : NAVY);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9)
    .text(idx === 1 ? 'TOP STORY' : 'BRIEFING', M + 14, y + 20, { width: 86, align: 'center', characterSpacing: 1 });
  doc.save();
  doc.rect(M, y + heroH - 30, W, 30).fillOpacity(0.62).fill(NAVY);
  doc.restore();
  doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(9)
    .text(sourceName(article), M + 14, y + heroH - 20, { characterSpacing: 1.5 });

  y += heroH + 18;

  // headline
  const title = truncate(article.title, 150);
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(22)
    .text(title, M, y, { width: W, lineGap: 1 });
  y += doc.heightOfString(title, { width: W, lineGap: 1 }) + 8;

  // meta line
  doc.fillColor(GRAY).font('Helvetica').fontSize(9.5)
    .text(`${(article.source && article.source.name) || 'Nomo Wire'}   ·   ${dateStr}`, M, y);
  y += 14;
  doc.moveTo(M, y).lineTo(M + 70, y).lineWidth(2).strokeColor(GOLD).stroke();
  y += 14;

  // standfirst (serif)
  const standfirst = truncate(article.description, 320);
  if (standfirst) {
    doc.fillColor(INK).font('Times-Roman').fontSize(13)
      .text(standfirst, M, y, { width: W, lineGap: 3 });
    y += doc.heightOfString(standfirst, { width: W, lineGap: 3 }) + 12;
  }

  // body paragraph (if content adds anything beyond the standfirst)
  const body = truncate(cleanContent(article), 360);
  if (body) {
    doc.fillColor(GRAY).font('Helvetica').fontSize(10.5)
      .text(body, M, y, { width: W, lineGap: 2 });
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
  const images = await Promise.all(items.map(a => fetchImage(a.urlToImage)));

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

    // Cover
    drawCover(doc, items[0], images[0], dateStr, edition);

    // One full page per story
    items.forEach((article, i) => {
      doc.addPage();
      drawStory(doc, article, images[i], dateStr, edition, i + 1, items.length);
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
