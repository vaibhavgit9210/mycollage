const L = require('./lib');
const DL = L.SP + '/downloads';
async function publicPage(browser, tag) {
  const page = await browser.newPage();
  L.wire(page, tag);
  return page;
}
(async () => {
  L.fs.rmSync(DL, {recursive: true, force: true}); L.fs.mkdirSync(DL, {recursive: true});
  // 0. public page before anything is live, and with the server down
  let browser = await L.launch('pub');
  let pub = await publicPage(browser, 'public');
  await pub.goto(L.PUBLIC);
  await pub.waitForFunction(() => !document.querySelector('#empty').hidden, {timeout: 10000});
  L.check('public: empty state before first deploy', true);
  await pub.screenshot({path: L.SHOTS + '/10-public-empty.png'});
  await pub.goto('http://127.0.0.1:8765/?api=http://localhost:9');
  await pub.waitForFunction(() => !document.querySelector('#failed').hidden, {timeout: 10000});
  L.check('public: failed state when the server is unreachable', true);
  await browser.close();

  // 1. lock screen on a fresh device
  L.fs.rmSync(L.SP + '/prof-devB', {recursive: true, force: true});
  browser = await L.launch('devB');
  let page = await browser.newPage();
  L.wire(page, 'devB');
  await page.goto(L.STUDIO);
  await page.waitForSelector('#lock:not([hidden])', {timeout: 10000});
  await page.screenshot({path: L.SHOTS + '/11-lock.png'});
  await page.type('#keyIn', 'wrong-key'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('#lockMsg').textContent.includes('did not work'), {timeout: 5000});
  L.check('lock: wrong key refused', true);
  await page.$eval('#keyIn', i => { i.value = ''; }); await page.type('#keyIn', 'dev-local-key'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('#lock').hidden && window.__studio, {timeout: 5000});
  L.check('lock: right key unlocks', true);
  await browser.close();

  // 2. deploy from device A (profile "smoke": freeform, titled, black bg)
  browser = await L.launch('smoke');
  page = await browser.newPage();
  L.wire(page, 'devA');
  await page.goto(L.STUDIO);
  await page.waitForFunction(() => window.__studio && Object.keys(__studio.doc.images).length === 5, {timeout: 15000});
  L.check('deploy button flags undeployed work', await page.$eval('#deployBtn', b => b.classList.contains('dirty')));
  await page.click('#deployBtn');
  await page.waitForSelector('.prev img', {timeout: 20000});
  const info = await page.$eval('.info', e => e.textContent);
  L.check('deploy modal shows the render size', info.includes('3200 × 3200'), info);
  await page.screenshot({path: L.SHOTS + '/12-deploy-modal.png'});
  await page.evaluate(() => [...document.querySelectorAll('.actions .btn.primary')].find(b => b.textContent.includes('Deploy')).click());
  await page.waitForFunction(() => document.querySelector('.status').textContent.includes('Live.'), {timeout: 30000});
  await page.screenshot({path: L.SHOTS + '/13-deploy-done.png'});
  L.check('deploy finished', true);
  L.check('dirty flag cleared after deploy', !(await page.$eval('#deployBtn', b => b.classList.contains('dirty'))));
  const live = await (await fetch(L.API + '/live')).json();
  const docA = await page.evaluate(() => JSON.stringify(__studio.doc));
  const proj = await (await fetch(L.API + '/project', {headers: {Authorization: 'Bearer dev-local-key'}})).json();
  L.check('live meta has title and size', live.title === 'Summer 2026' && live.W === 1000 && live.H === 1000 && live.full.w === 3200, live);
  L.check('project on the server equals the studio doc', JSON.stringify(proj.doc) === docA);
  const og = await fetch(L.API + '/og.jpg');
  L.check('og.jpg is a jpeg under 300 KB', og.ok && og.headers.get('content-type') === 'image/jpeg' && live.og.bytes < 300000, live.og.bytes);
  await page.click('.actions .btn.primary');   // Done

  // 3. public page: render, auto-hide, download, full screen
  pub = await publicPage(browser, 'public');
  const cdp = await pub.target().createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', {behavior: 'allow', downloadPath: DL});
  await pub.goto(L.PUBLIC);
  await pub.waitForFunction(() => document.body.classList.contains('ready') && document.querySelector('#pic').classList.contains('on'), {timeout: 15000});
  const pv = await pub.evaluate(() => ({title: document.title, ttl: document.querySelector('#ttl').textContent, w: document.querySelector('#pic').naturalWidth,
    ui: document.body.classList.contains('ui'), when: document.querySelector('#when').textContent}));
  L.check('public shows the deployed collage', pv.title === 'Summer 2026' && pv.ttl === 'Summer 2026' && pv.w >= 1600, pv);
  L.check('controls visible right after load', pv.ui);
  await L.sleep(700);
  await pub.screenshot({path: L.SHOTS + '/14-public-ui.png'});
  await L.sleep(3300);
  L.check('controls auto-hide when idle', !(await pub.evaluate(() => document.body.classList.contains('ui'))));
  L.check('cursor hidden when idle (fine pointer)', await pub.evaluate(() => document.body.classList.contains('idle')));
  await pub.screenshot({path: L.SHOTS + '/15-public-clean.png'});
  await pub.mouse.move(700, 400); await pub.mouse.move(720, 420);
  L.check('mouse movement wakes the controls', await pub.evaluate(() => document.body.classList.contains('ui')));
  const dl = await pub.$('#dl');
  const db = await dl.boundingBox();
  await pub.mouse.move(db.x + db.width / 2, db.y + db.height / 2);
  await L.sleep(3200);
  L.check('controls stay while hovered', await pub.evaluate(() => document.body.classList.contains('ui')));
  await pub.screenshot({path: L.SHOTS + '/16-public-hover.png'});
  await pub.mouse.click(db.x + db.width / 2, db.y + db.height / 2);
  let file = null;
  for (let i = 0; i < 50 && !file; i++) { await L.sleep(200); file = L.fs.readdirSync(DL).find(f => f.endsWith('.jpg')); }
  const size = file ? L.fs.statSync(DL + '/' + file).size : 0;
  L.check('download saves the full-size jpeg', file === 'summer-2026.jpg' && size === live.full.bytes, {file, size, want: live.full.bytes});
  await pub.keyboard.press('f');
  await L.sleep(500);
  const fs1 = await pub.evaluate(() => ({fs: !!document.fullscreenElement, cls: document.body.classList.contains('fs'), pic: document.querySelector('#pic').naturalWidth}));
  L.check('F enters full screen', fs1.fs && fs1.cls, fs1);
  await pub.screenshot({path: L.SHOTS + '/17-public-fullscreen.png'});
  await pub.keyboard.press('f');
  await L.sleep(400);
  L.check('F again exits full screen', !(await pub.evaluate(() => !!document.fullscreenElement)));
  await browser.close();

  // 4. a fresh device B opens the live draft (wiped: in step 1 it opened whatever was newest then)
  L.fs.rmSync(L.SP + '/prof-devB', {recursive: true, force: true});
  browser = await L.launch('devB');
  page = await browser.newPage();
  L.wire(page, 'devB');
  await page.goto(L.STUDIO + '#k=dev-local-key');
  await page.waitForFunction(() => window.__studio && Object.keys(__studio.doc.images).length === 5, {timeout: 20000});
  await L.sleep(500);
  const docB = await page.evaluate(() => JSON.stringify(__studio.doc));
  L.check('fresh device starts from the live project', docB === docA);
  L.check('its photos were downloaded (no missing thumbs)', await page.$$eval('.thumb.missing', t => t.length) === 0);
  L.check('fresh device is not dirty', !(await page.$eval('#deployBtn', b => b.classList.contains('dirty'))));
  // change the background and deploy from B
  await page.evaluate(() => { __studio.doc.bg = '#f2d7d0'; __studio.commit(); __studio.render(); });
  await page.click('#deployBtn');
  await page.waitForSelector('.prev img', {timeout: 20000});
  await page.evaluate(() => [...document.querySelectorAll('.actions .btn.primary')].find(b => b.textContent.includes('Deploy')).click());
  await page.waitForFunction(() => document.querySelector('.status').textContent.includes('Live.'), {timeout: 30000});
  L.check('device B deployed', true);
  await browser.close();

  console.log('\nfails:', L.fails);
})().catch(e => { console.error(e); process.exit(1); });
