// Shared helpers for the headless checks. See README.md > Testing.
const fs = require('fs'), os = require('os'), path = require('path');
function findPuppeteer() {
  try { return require('puppeteer-core'); } catch {}
  const cache = path.join(os.homedir(), '.npm/_npx');
  for (const d of fs.existsSync(cache) ? fs.readdirSync(cache) : []) {
    const p = path.join(cache, d, 'node_modules/puppeteer-core');
    if (fs.existsSync(p)) return require(p);
  }
  throw new Error('puppeteer-core not found: run `npx --yes puppeteer-core@latest --version` once, or npm i puppeteer-core');
}
const puppeteer = findPuppeteer();
const SP = process.env.MC_WORK || path.join(os.tmpdir(), 'mycollage-tests');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SHOTS = SP + '/shots', FIX = SP + '/fixtures';
fs.mkdirSync(SHOTS, {recursive: true});
const API = 'http://localhost:8787';
const STUDIO = 'http://127.0.0.1:8765/studio-qaq7tavl/?api=' + API;
const PUBLIC = 'http://127.0.0.1:8765/?api=' + API;
let fails = 0;
function check(name, cond, extra) {
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond || extra === undefined ? '' : ' :: ' + JSON.stringify(extra)));
  if (!cond) fails++;
}
// Reusing a profile that once had two tabs open can hang Chrome's startup, so every
// suite uses its own fresh profile (run.sh wipes them).
async function launch(profile, viewport = {width: 1440, height: 900, deviceScaleFactor: 1}) {
  return puppeteer.launch({executablePath: CHROME, headless: true, defaultViewport: viewport,
    args: ['--window-size=' + viewport.width + ',' + viewport.height, '--hide-scrollbars'], userDataDir: SP + '/prof-' + profile});
}
function wire(page, tag = '') {
  page.on('console', m => { if (['error', 'warning'].includes(m.type())) console.log('  [console ' + tag + ']', m.type(), m.text()); });
  page.on('pageerror', e => console.log('  [pageerror ' + tag + ']', e.message));
}
// screen point of a layout-unit point
async function scr(page, x, y) {
  return page.evaluate((x, y) => {
    const r = document.querySelector('#stage').getBoundingClientRect(), v = __studio.view;
    return {x: r.left + v.bx + x * v.k, y: r.top + v.by + y * v.k};
  }, x, y);
}
async function drag(page, a, b, steps = 12) {
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) await page.mouse.move(a.x + (b.x - a.x) * i / steps, a.y + (b.y - a.y) * i / steps);
  await page.mouse.up();
  await new Promise(r => setTimeout(r, 60));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
module.exports = {puppeteer, fs, SP, CHROME, SHOTS, FIX, API, STUDIO, PUBLIC, check, launch, wire, scr, drag, sleep, get fails() { return fails; }};
