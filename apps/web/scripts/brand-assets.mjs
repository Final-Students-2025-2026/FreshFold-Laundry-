/**
 * Renders the site's binary brand assets from the sources next to them.
 *
 *   node scripts/brand-assets.mjs
 *
 * Produces, into public/:
 *
 *   og.jpg               1200x630, from scripts/og-card.html — the card
 *                        WhatsApp, Facebook, X, Slack and iMessage draw when
 *                        somebody pastes a FreshFold link.
 *   icon-192.png         from public/favicon.svg, for the web manifest.
 *   icon-512.png         likewise, and the one Android uses for a splash.
 *   apple-touch-icon.png 180x180, for an iOS home screen. iOS ignores SVG
 *                        favicons, so this file is the only mark it will show.
 *
 * Headless Chrome rather than a drawing library: the sources are already HTML
 * and SVG, so the browser that renders the site renders the assets, with the
 * same webfonts and the same colour values. Nothing to keep in step by hand.
 *
 * Deliberately not wired into `npm run build`. These change when the brand or
 * the offer on the card changes — a few times a year — and a deploy should not
 * depend on Chrome being installed or on Google Fonts being reachable.
 */
import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(HERE, '..', 'public');

/** Where Chrome lives, in the order worth trying. */
const CHROMES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

const chrome = CHROMES.find((candidate) => existsSync(candidate));
if (!chrome) {
  console.error(
    `No Chrome found. Tried:\n  ${CHROMES.join('\n  ')}\n` +
      'Set CHROME_PATH to a Chrome or Chromium binary and run this again.'
  );
  process.exit(1);
}

const workspace = await mkdtemp(path.join(tmpdir(), 'freshfold-assets-'));

/**
 * Screenshots a local file at an exact size, and returns the PNG.
 *
 * `--screenshot` writes the file and then Chrome should exit, but on macOS it
 * hands off to GoogleUpdater on the way out and the process can sit there for
 * minutes with the image already written. So this watches for the file to
 * appear and stop growing, then kills the browser itself rather than waiting
 * on an exit that may not come.
 */
async function shot(fileUrl, width, height, name) {
  const out = path.join(workspace, name);
  const profile = path.join(workspace, `profile-${name}`);

  const child = spawn(
    chrome,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      '--default-background-color=00000000',
      `--window-size=${width},${height}`,
      `--user-data-dir=${profile}`,
      `--screenshot=${out}`,
      // Webfonts arrive over the network; without this the card screenshots in
      // Times before Cormorant has landed.
      '--virtual-time-budget=6000',
      fileUrl,
    ],
    { stdio: 'ignore' }
  );

  for (let waited = 0; waited < 60_000; waited += 250) {
    const size = await stat(out).then((s) => s.size, () => 0);
    if (size > 0) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      if ((await stat(out).then((s) => s.size, () => 0)) === size) break;
    }
    if (child.exitCode !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  child.kill('SIGKILL');
  if (!existsSync(out)) throw new Error(`Chrome exited without writing ${name}.`);
  return out;
}

/**
 * PNG to JPEG, because the share card is a photograph.
 *
 * The PNG Chrome writes is ~500 KB. WhatsApp — which is how most of these
 * links actually travel — gives up on a preview image well before that and
 * shows a bare link instead, which is the whole thing the card exists to
 * prevent. The same pixels as JPEG are ~100 KB.
 */
async function toJpeg(png) {
  const jpeg = path.join(workspace, 'og.jpg');
  if (existsSync('/usr/bin/sips')) {
    await run('/usr/bin/sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '80', png, '--out', jpeg]);
    return readFile(jpeg);
  }
  for (const tool of ['magick', 'convert']) {
    try {
      await run(tool, [png, '-quality', '80', jpeg]);
      return readFile(jpeg);
    } catch {
      // Try the next one.
    }
  }
  throw new Error(
    'No sips (macOS) and no ImageMagick, so the share card cannot be converted to JPEG. ' +
      `Install ImageMagick, or convert ${png} by hand and save it as public/og.jpg.`
  );
}

/** The favicon on a transparent ground, sized for one raster target. */
function iconPage(svg, size) {
  return `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;padding:0;background:transparent}
svg{display:block;width:${size}px;height:${size}px}</style>${svg}`;
}

async function emit(name, bytes) {
  await writeFile(path.join(PUBLIC, name), bytes);
  console.log(`  ${name.padEnd(22)} ${(bytes.length / 1024).toFixed(1)} KB`);
}

try {
  console.log('Rendering brand assets:');

  const card = await shot(`file://${path.join(HERE, 'og-card.html')}`, 1200, 630, 'og.png');
  await emit('og.jpg', await toJpeg(card));

  const svg = await readFile(path.join(PUBLIC, 'favicon.svg'), 'utf8');
  for (const [name, size] of [
    ['icon-192.png', 192],
    ['icon-512.png', 512],
    ['apple-touch-icon.png', 180],
  ]) {
    const page = path.join(workspace, `${name}.html`);
    await writeFile(page, iconPage(svg, size));
    await emit(name, await readFile(await shot(`file://${page}`, size, size, `${name}`)));
  }
} finally {
  await rm(workspace, { recursive: true, force: true });
}
