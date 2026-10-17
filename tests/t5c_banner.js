const L = require('./lib');
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
  // C: brand-new device, auto-loads what is live
  let {browser, page} = await open('devC', 'devC', '#k=dev-local-key');
  await page.waitForFunction(bg => window.__studio && __studio.doc.bg === bg && !document.querySelector('#deployBtn').classList.contains('dirty'), {timeout: 20000}, liveBg);
  await L.sleep(800);   // let the IndexedDB writes land before closing
  L.check('device C auto-loads the live project', true);
  await browser.close();
  // B deploys a change
  ({browser, page} = await open('devB', 'devB'));
  await page.waitForFunction(() => window.__studio && Object.keys(__studio.doc.images).length === 5, {timeout: 15000});
  await page.evaluate(bg => { __studio.doc.bg = bg; __studio.commit(); __studio.render(); }, nextBg);
  await deploy(page);
  await browser.close();
  // C reopens: banner, Load it
  ({browser, page} = await open('devC', 'devC'));
  await page.waitForSelector('#banner:not([hidden])', {timeout: 10000});
  await page.screenshot({path: L.SHOTS + '/18-banner.png'});
  L.check('device C sees the newer-version banner', (await page.$eval('#banner', b => b.textContent)).includes('another device'));
  L.check('C still shows its own draft until asked', await page.evaluate(bg => __studio.doc.bg === bg, liveBg));
  await page.evaluate(() => [...document.querySelectorAll('#banner button')].find(b => b.textContent === 'Load it').click());
  await page.waitForFunction(bg => __studio.doc.bg === bg, {timeout: 10000}, nextBg);
  L.check('Load it brings in the newer version', true);
  L.check('banner gone, not dirty', await page.$eval('#banner', b => b.hidden) && !(await page.$eval('#deployBtn', b => b.classList.contains('dirty'))));
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
