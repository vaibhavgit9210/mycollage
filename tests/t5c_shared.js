const L = require('./lib');
// Drafts live on the server: a device that never deployed anything opens what B deploys next.
async function open(profile, tag, hash = '') {
  const browser = await L.launch(profile);
  const page = await browser.newPage();
  L.wire(page, tag);
  await page.goto(L.STUDIO + hash);
  return {browser, page};
}
async function deploy(page) {
  await page.click('#deployBtn');
  await page.waitForSelector('.prev img', {timeout: 20000});
  await page.evaluate(() => [...document.querySelectorAll('.actions .btn.primary')].find(b => b.textContent.includes('Deploy')).click());
  await page.waitForFunction(() => document.querySelector('.status').textContent.includes('Live.'), {timeout: 30000});
}
(async () => {
  const liveBg = (await (await fetch(L.API + '/project', {headers: {Authorization: 'Bearer dev-local-key'}})).json()).doc.bg;
  const nextBg = liveBg === '#d9e0d3' ? '#f2d7d0' : '#d9e0d3';
  // C: brand-new device opens the live draft
  let {browser, page} = await open('devC', 'devC', '#k=dev-local-key');
  await page.waitForFunction(bg => window.__studio && __studio.doc.bg === bg && !document.querySelector('#deployBtn').classList.contains('dirty'), {timeout: 20000}, liveBg);
  await L.sleep(800);   // let the IndexedDB writes land before closing
  L.check('device C opens the live draft', true);
  await browser.close();
  // B changes that same draft and deploys
  ({browser, page} = await open('devB', 'devB'));
  await page.waitForFunction(() => window.__studio && Object.keys(__studio.doc.images).length === 5, {timeout: 15000});
  await page.evaluate(bg => { __studio.doc.bg = bg; __studio.commit(); __studio.render(); }, nextBg);
  await deploy(page);
  await browser.close();
  // C reopens: B's version is simply there, and it is the live one
  ({browser, page} = await open('devC', 'devC'));
  await page.waitForFunction(bg => window.__studio && __studio.doc.bg === bg && !document.querySelector('#deployBtn').classList.contains('dirty'), {timeout: 20000}, nextBg);
  await page.screenshot({path: L.SHOTS + '/18-shared.png'});
  L.check("device C shows B's deployed change, not dirty", true);
  await page.evaluate(() => localStorage.setItem('mycollage.key', 'stale'));
  await page.reload();
  await page.waitForSelector('#lock:not([hidden])', {timeout: 10000});
  L.check('a rejected stored key shows the lock again', (await page.$eval('#lockMsg', m => m.textContent)).includes('rejected'));
  await page.type('#keyIn', 'dev-local-key'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('#lock').hidden, {timeout: 5000});
  L.check('re-entering the key unlocks', true);
  await browser.close();
  console.log('\nfails:', L.fails);
})().catch(e => { console.error(e); process.exit(1); });
