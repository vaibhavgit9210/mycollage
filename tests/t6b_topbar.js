const L = require('./lib');
(async () => {
  const browser = await L.launch('phone2', {width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true});
  const page = await browser.newPage();
  await page.setViewport({width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true});
  L.wire(page, 'studio');
  await page.goto(L.STUDIO + '#k=dev-local-key');
  await page.waitForFunction(() => window.__studio && Object.keys(__studio.doc.images).length === 5, {timeout: 25000});
  await L.sleep(500);
  const rows = await page.evaluate(() => [...document.querySelectorAll('.top > *')].filter(e => e.offsetParent).map(e => ({id: e.id || e.className, top: Math.round(e.getBoundingClientRect().top), right: Math.round(e.getBoundingClientRect().right)})));
  console.log(rows);
  const tops = rows.filter(r => !/spacer/.test(r.id)).map(r => r.top).sort((a, b) => a - b);
  const bands = tops.filter((t, i) => i === 0 || t - tops[i - 1] > 12).length;
  L.check('top bar fits in 2 rows within 390px', bands === 2 && rows.every(r => r.right <= 390), {bands});
  await page.screenshot({path: L.SHOTS + '/23-phone-topbar.png', clip: {x: 0, y: 0, width: 390, height: 130}});
  await browser.close();
  console.log('\nfails:', L.fails);
})().catch(e => { console.error(e); process.exit(1); });
