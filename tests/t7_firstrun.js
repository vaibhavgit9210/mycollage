const L = require('./lib');
(async () => {
  L.fs.rmSync(L.SP + '/prof-first', {recursive: true, force: true});
  const browser = await L.launch('first');
  const page = await browser.newPage();
  L.wire(page, 'studio');
  // a key that the server accepts, but this device has nothing and nothing is live for it yet is not
  // possible to fake here, so point at the local worker and clear what loadLive would bring in.
  await page.goto(L.STUDIO + '#k=dev-local-key');
  await page.waitForFunction(() => window.__studio && document.querySelector('#lock').hidden, {timeout: 15000});
  await L.sleep(1500);   // let a possible auto-load of the live project finish
  await page.evaluate(() => { const d = __studio.doc; for (const k of Object.keys(d.images)) delete d.images[k]; d.mode = 'grid'; d.grid.root = {t: 'cell', id: 'x1', photo: null}; d.free.items = []; __studio.commit(); __studio.render(); });
  const c = await page.evaluate(() => { const c = __studio.layoutGrid().cells[0]; return {x: c.x + c.w / 2, y: c.y + c.h / 2}; });
  const pt = await L.scr(page, c.x, c.y);
  const [chooser] = await Promise.all([page.waitForFileChooser({timeout: 5000}), page.mouse.click(pt.x, pt.y)]);
  L.check('clicking the empty cell on a fresh studio opens the photo picker', !!chooser && chooser.isMultiple());
  await chooser.accept(['b-forest-3x4.jpg', 'c-sea-1x1.jpg', 'f-rose-3x2.jpg'].map(f => L.FIX + '/' + f));
  await page.waitForFunction(() => Object.keys(__studio.doc.images).length === 3, {timeout: 20000});
  await L.sleep(300);
  const filled = await page.evaluate(() => __studio.layoutGrid().cells.filter(c => c.n.photo).length);
  L.check('picked photos are laid out', filled === 3, filled);
  // with photos in the library, a click on an empty cell only selects it
  await page.evaluate(() => { __studio.splitCell(__studio.layoutGrid().cells[0].n.id, 'row'); });
  const e = await page.evaluate(() => { const c = __studio.layoutGrid().cells.find(c => !c.n.photo); return {x: c.x + c.w / 2, y: c.y + c.h / 2}; });
  const ept = await L.scr(page, e.x, e.y);
  let opened = false;
  page.waitForFileChooser({timeout: 1500}).then(() => { opened = true; }).catch(() => {});
  await page.mouse.click(ept.x, ept.y);
  await L.sleep(1700);
  L.check('with a library, clicking an empty cell just selects it', !opened && await page.$('.mini') !== null);
  await browser.close();
  console.log('\nfails:', L.fails);
})().catch(e => { console.error(e); process.exit(1); });
