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

// ─── HELPERS ──────────────────────────────────────────────────────

// Collapses whitespace and truncates with an ellipsis.
function truncate(text, max) {
  if (!text) return '';
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max).trim() + '…' : t;
}

function sourceName(article) {
  return (article.source && article.source.name ? article.source.name : 'Nomo Wire').toUpperCase();
}

// Downloads an article image as a Buffer. PDFKit only supports JPEG/PNG,
// so anything else (WebP/GIF/SVG) or a failed request returns null and the
// caller falls back to a branded placeholder.
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
function drawImageBox(doc, img, x, y, w, h) {
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
    doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(Math.min(18, w / 9))
      .text('NOMO NEWS', x, y + h / 2 - 9, { width: w, align: 'center', characterSpacing: 1 });
    doc.restore();
  }
  // subtle frame
  doc.rect(x, y, w, h).lineWidth(0.5).strokeColor(LINE).stroke();
}

// ─── HEADERS / FOOTERS ────────────────────────────────────────────

function drawMasthead(doc, edition, dateStr) {
  const W = doc.page.width;
  doc.rect(0, 0, W, 96).fill(NAVY);
  doc.rect(0, 96, W, 4).fill(GOLD);
  doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(34)
    .text('NOMO NEWS', M, 26, { characterSpacing: 1 });
  doc.fillColor('#ffffff').font('Helvetica').fontSize(9)
    .text('YOUR DAILY MARKETS & WORLD BRIEFING', M + 2, 66, { characterSpacing: 2 });
  doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(11)
    .text(edition.toUpperCase(), M, 30, { width: W - M * 2, align: 'right' });
  doc.fillColor(MUTE).font('Helvetica').fontSize(9)
    .text(dateStr, M, 46, { width: W - M * 2, align: 'right' });
  return 96 + 4 + 20;
}

function drawMiniHeader(doc, edition) {
  const W = doc.page.width;
  doc.rect(0, 0, W, 46).fill(NAVY);
  doc.rect(0, 46, W, 3).fill(GOLD);
  doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(16)
    .text('NOMO NEWS', M, 14, { characterSpacing: 1 });
  doc.fillColor(MUTE).font('Helvetica').fontSize(9)
    .text(edition.toUpperCase(), M, 18, { width: W - M * 2, align: 'right' });
  return 46 + 3 + 18;
}

// ─── HERO STORY ───────────────────────────────────────────────────

function drawHero(doc, article, img, y) {
  const W = doc.page.width - M * 2;
  const imgH = 220;
  drawImageBox(doc, img, M, y, W, imgH);

  // bottom gradient bar for label legibility
  doc.save();
  doc.rect(M, y + imgH - 34, W, 34).fillOpacity(0.62).fill(NAVY);
  doc.restore();

  // TOP STORY badge
  doc.rect(M + 14, y + 14, 88, 20).fill(RED);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9)
    .text('TOP STORY', M + 14, y + 20, { width: 88, align: 'center', characterSpacing: 1 });

  // source over the gradient
  doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(9)
    .text(sourceName(article), M + 14, y + imgH - 23, { characterSpacing: 1 });

  let ty = y + imgH + 14;
  const title = truncate(article.title, 130);
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(19)
    .text(title, M, ty, { width: W, lineGap: 1 });
  ty += doc.heightOfString(title, { width: W, lineGap: 1 }) + 6;

  const desc = truncate(article.description, 260);
  if (desc) {
    doc.fillColor(GRAY).font('Helvetica').fontSize(10.5)
      .text(desc, M, ty, { width: W, lineGap: 1.5 });
    ty += doc.heightOfString(desc, { width: W, lineGap: 1.5 }) + 8;
  }

  doc.moveTo(M, ty).lineTo(M + W, ty).lineWidth(1).strokeColor(GOLD).stroke();
  return ty + 18;
}

// ─── GRID CARDS ───────────────────────────────────────────────────

const CARD_IMG_H = 116;

function measureCard(doc, article, colW) {
  let h = CARD_IMG_H + 8 + 11; // image + gap + source line
  const title = truncate(article.title, 95);
  doc.font('Helvetica-Bold').fontSize(11.5);
  h += doc.heightOfString(title, { width: colW, lineGap: 0.5 }) + 4;
  const desc = truncate(article.description, 130);
  if (desc) {
    doc.font('Helvetica').fontSize(9);
    h += doc.heightOfString(desc, { width: colW, lineGap: 1 }) + 4;
  }
  return h;
}

function drawCard(doc, article, img, x, y, colW) {
  drawImageBox(doc, img, x, y, colW, CARD_IMG_H);
  let ty = y + CARD_IMG_H + 8;

  doc.fillColor(RED).font('Helvetica-Bold').fontSize(8)
    .text(sourceName(article), x, ty, { width: colW, characterSpacing: 0.5 });
  ty += 11;

  const title = truncate(article.title, 95);
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(11.5)
    .text(title, x, ty, { width: colW, lineGap: 0.5 });
  ty += doc.heightOfString(title, { width: colW, lineGap: 0.5 }) + 4;

  const desc = truncate(article.description, 130);
  if (desc) {
    doc.fillColor(GRAY).font('Helvetica').fontSize(9)
      .text(desc, x, ty, { width: colW, lineGap: 1 });
  }
}

// ─── MAIN ─────────────────────────────────────────────────────────

async function generateNewsPDF(articles, edition) {
  const items = articles.slice(0, 15);
  // Pre-download all images in parallel so the layout pass stays synchronous.
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

    const W = doc.page.width - M * 2;
    const gutter = 18;
    const colW = (W - gutter) / 2;
    const bottom = doc.page.height - 54;

    let y = drawMasthead(doc, edition, dateStr);

    if (items.length > 0) {
      y = drawHero(doc, items[0], images[0], y);
    }

    // Remaining stories as a two-column grid, row by row.
    for (let i = 1; i < items.length; i += 2) {
      const lh = measureCard(doc, items[i], colW);
      const rh = items[i + 1] ? measureCard(doc, items[i + 1], colW) : 0;
      const rowH = Math.max(lh, rh);

      if (y + rowH > bottom) {
        doc.addPage();
        y = drawMiniHeader(doc, edition);
      }

      drawCard(doc, items[i], images[i], M, y, colW);
      if (items[i + 1]) {
        drawCard(doc, items[i + 1], images[i + 1], M + colW + gutter, y, colW);
      }
      y += rowH + 22;
    }

    // Footer band + page numbers on every page.
    const range = doc.bufferedPageRange();
    for (let p = 0; p < range.count; p++) {
      doc.switchToPage(range.start + p);
      const PW = doc.page.width;
      const PH = doc.page.height;
      doc.rect(0, PH - 32, PW, 32).fill(NAVY);
      doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(8)
        .text('BUILT BY MIN', M, PH - 21, { characterSpacing: 1 });
      doc.fillColor(MUTE).font('Helvetica').fontSize(8)
        .text(`Page ${p + 1} of ${range.count}`, M, PH - 21, { width: PW - M * 2, align: 'right' });
    }

    doc.end();
    stream.on('finish', () => resolve(filename));
    stream.on('error', reject);
  });
}

module.exports = { generateNewsPDF };
