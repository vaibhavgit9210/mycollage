const L = require('./lib');
(async () => {
  const browser = await L.launch('smoke');
  const page = await browser.newPage();
  L.wire(page, 'studio');
  await page.goto(L.STUDIO + '#k=dev-local-key');
  await page.waitForFunction(() => window.__studio && document.querySelector('#lock').hidden, {timeout: 15000});
  L.check('hash key stripped from URL', !(await page.evaluate(() => location.hash)));
  L.check('key stored', (await page.evaluate(() => localStorage.getItem('mycollage.key'))) === 'dev-local-key');
  await page.screenshot({path: L.SHOTS + '/01-empty.png'});
  const input = await page.$('#fileIn');
  await input.uploadFile(...['a-sunset-4x3.jpg', 'b-forest-3x4.jpg', 'c-sea-1x1.jpg', 'd-pano-16x9.jpg', 'e-tall-9x16.jpg'].map(f => L.FIX + '/' + f));
  await page.waitForFunction(() => Object.keys(__studio.doc.images).length === 5, {timeout: 30000});
  await L.sleep(400);
  const st = await page.evaluate(() => {
    const cells = __studio.layoutGrid().cells;
    return {n: cells.length, filled: cells.filter(c => c.n.photo).length, thumbs: document.querySelectorAll('.thumb').length,
      dims: Object.values(__studio.doc.images).map(i => i.w + 'x' + i.h)};
  });
  L.check('5 photos imported', st.thumbs === 5, st);
  L.check('smart layout made 5 filled cells', st.n === 5 && st.filled === 5, st);
  L.check('pano downscaled to 3200 long side', st.dims.includes('3200x1800'), st.dims);
  await page.screenshot({path: L.SHOTS + '/02-grid-smart.png'});
  await browser.close();
  console.log('\nfails:', L.fails);
})().catch(e => { console.error(e); process.exit(1); });
