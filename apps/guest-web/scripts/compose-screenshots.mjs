#!/usr/bin/env node
// PV13 screenshot post-processing: contact sheet + device-frame compositions + website
// comparison. Built via Playwright rendering a local HTML/CSS layout (no ImageMagick/ffmpeg
// available in this environment) — every radius/shadow value here is copied verbatim from
// docs/design/vinkin-design-system.md (itself sourced from vinkin.org's own compiled CSS),
// not approximated. No glossy 3D tilts, no reflections — matches the site's own restraint.

import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
const RAW = path.join(REPO_ROOT, 'artifacts/product-screenshots/raw');
const COMPOSITIONS = path.join(REPO_ROOT, 'artifacts/product-screenshots/compositions');
mkdirSync(COMPOSITIONS, { recursive: true });

function dataUri(name) {
  const bytes = readFileSync(path.join(RAW, name));
  return `data:image/png;base64,${bytes.toString('base64')}`;
}

const CARD_SHADOW = '0 40px 100px -20px rgba(10,10,11,0.55)';
const BASE_CSS = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #EDE7D9; font-family: -apple-system, sans-serif; }
  .frame {
    border-radius: 2rem;
    overflow: hidden;
    box-shadow: ${CARD_SHADOW};
    background: #F7F3EB;
  }
  .frame img { display: block; width: 100%; height: auto; }
  .label {
    font-size: 15px; color: #6E6A61; text-align: center; margin-top: 14px;
    font-family: -apple-system, sans-serif;
  }
`;

async function renderHtml(html, outPath, viewport) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport });
  await page.setContent(html, { waitUntil: 'networkidle' });
  const body = await page.$('body');
  await body.screenshot({ path: outPath });
  await browser.close();
}

// --- Contact sheet: all 13 raw screenshots in a labeled grid ----------------------
async function buildContactSheet() {
  const files = [
    '01-organizer-home.png',
    '02-add-people.png',
    '03-equal-split.png',
    '04-review-vink.png',
    '05-live-lobby-progress.png',
    '06-organizer-contribution.png',
    '07-everyone-in.png',
    '08-ready-to-pay.png',
    '09-vink-completed.png',
    '10-guest-join.png',
    '11-guest-contribution.png',
    '12-guest-live-progress.png',
    '13-guest-funded.png',
  ];
  const cells = files
    .map(
      (f) => `
      <div>
        <div class="frame" style="box-shadow:0 8px 24px -8px rgba(10,10,11,0.25)"><img src="${dataUri(f)}" /></div>
        <div class="label">${f}</div>
      </div>`,
    )
    .join('\n');
  const html = `<html><head><style>${BASE_CSS}
    .grid { display: grid; grid-template-columns: repeat(5, 220px); gap: 40px; padding: 48px; }
  </style></head><body><div class="grid">${cells}</div></body></html>`;
  await renderHtml(
    html,
    path.join(REPO_ROOT, 'artifacts/product-screenshots/vinkin-screenshot-contact-sheet.png'),
    {
      width: 1400,
      height: 1900,
    },
  );
}

// --- Device-frame compositions -----------------------------------------------------
async function buildComposition(name, innerHtml, viewport) {
  const html = `<html><head><style>${BASE_CSS}</style></head><body>${innerHtml}</body></html>`;
  await renderHtml(html, path.join(COMPOSITIONS, name), viewport);
}

async function buildCompositions() {
  // hero-live-lobby.png — primary phone (Live Lobby) + secondary phone (Equal Split)
  // offset behind/beside it, echoing the site's own layered-chip composition.
  await buildComposition(
    'hero-live-lobby.png',
    `<div style="position:relative; width:900px; height:820px; padding:40px;">
      <div class="frame" style="position:absolute; left:360px; top:40px; width:340px; transform:rotate(1deg);">
        <img src="${dataUri('03-equal-split.png')}" />
      </div>
      <div class="frame" style="position:absolute; left:60px; top:120px; width:440px; transform:rotate(-1deg);">
        <img src="${dataUri('05-live-lobby-progress.png')}" />
      </div>
    </div>`,
    { width: 900, height: 820 },
  );

  // feature-equal-split.png — single card, the "know exactly who pays what" feature.
  await buildComposition(
    'feature-equal-split.png',
    `<div style="padding:40px; width:480px;"><div class="frame"><img src="${dataUri('03-equal-split.png')}" /></div></div>`,
    { width: 480, height: 1100 },
  );

  // feature-guest-flow.png — organizer add-people card + guest-join card side by side.
  await buildComposition(
    'feature-guest-flow.png',
    `<div style="display:flex; gap:32px; padding:40px; align-items:flex-start;">
      <div class="frame" style="width:360px;"><img src="${dataUri('02-add-people.png')}" /></div>
      <div class="frame" style="width:320px; margin-top:48px;"><img src="${dataUri('10-guest-join.png')}" /></div>
    </div>`,
    { width: 800, height: 1000 },
  );

  // feature-everyone-in.png — the funded payoff moment, standalone.
  await buildComposition(
    'feature-everyone-in.png',
    `<div style="padding:40px; width:480px;"><div class="frame"><img src="${dataUri('07-everyone-in.png')}" /></div></div>`,
    { width: 480, height: 1100 },
  );
}

// --- Website comparison: live vinkin.org hero + five selected product screenshots -
async function buildWebsiteComparison() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  let siteShot = null;
  try {
    await page.goto('https://www.vinkin.org/', { waitUntil: 'networkidle', timeout: 20_000 });
    siteShot = await page.screenshot();
  } catch {
    siteShot = null;
  }
  await browser.close();

  const siteCell = siteShot
    ? `<div class="frame" style="width:100%;"><img src="data:image/png;base64,${siteShot.toString('base64')}" /></div>`
    : `<div style="color:#6E6A61;">vinkin.org unreachable at composition time</div>`;

  const productFiles = [
    '01-organizer-home.png',
    '03-equal-split.png',
    '05-live-lobby-progress.png',
    '10-guest-join.png',
    '09-vink-completed.png',
  ];
  const productCells = productFiles
    .map(
      (f) =>
        `<div class="frame" style="width:220px;"><img src="${dataUri(f)}" /></div><div class="label">${f}</div>`,
    )
    .join('\n');

  const html = `<html><head><style>${BASE_CSS}
    .row { display: flex; gap: 24px; padding: 48px; align-items: flex-start; flex-wrap: wrap; }
    .site-col { width: 640px; }
    h2 { font-family: -apple-system, sans-serif; color: #0A0A0B; margin: 0 0 16px; }
  </style></head><body>
    <div style="padding: 48px 48px 0;"><h2>vinkin.org (live) vs. captured product screenshots</h2></div>
    <div class="row">
      <div class="site-col">${siteCell}</div>
      <div style="display:flex; gap:20px; flex-wrap:wrap; max-width: 620px;">${productCells}</div>
    </div>
  </body></html>`;
  await renderHtml(
    html,
    path.join(REPO_ROOT, 'artifacts/product-screenshots/vinkin-website-product-comparison.png'),
    {
      width: 1400,
      height: 1100,
    },
  );
}

// --- AVIF exports for the recommended homepage set (sips supports AVIF, not WebP here) ---
async function exportAvif() {
  const { execFileSync } = await import('node:child_process');
  const webDir = path.join(REPO_ROOT, 'artifacts/product-screenshots/web');
  mkdirSync(webDir, { recursive: true });
  const homepageSet = [
    '01-organizer-home.png',
    '03-equal-split.png',
    '05-live-lobby-progress.png',
    '07-everyone-in.png',
    '09-vink-completed.png',
    '10-guest-join.png',
  ];
  for (const file of homepageSet) {
    const src = path.join(RAW, file);
    const pngOut = path.join(webDir, file);
    const avifOut = path.join(webDir, file.replace('.png', '.avif'));
    writeFileSync(pngOut, readFileSync(src));
    try {
      execFileSync('sips', ['-s', 'format', 'avif', src, '--out', avifOut], { stdio: 'ignore' });
    } catch {
      console.warn(`AVIF export failed for ${file} (sips)`);
    }
  }
}

await buildContactSheet();
await buildCompositions();
await buildWebsiteComparison();
await exportAvif();
console.log('Done.');
