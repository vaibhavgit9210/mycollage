const L = require('./lib');
const phone = {width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true};
(async () => {
  const browser = await L.launch('phone', phone);
  // public page on a phone
  const pub = await browser.newPage();
  L.wire(pub, 'public');
  await pub.setViewport(phone);
  await pub.goto(L.PUBLIC);
  await pub.waitForFunction(() => document.querySelector('#pic').classList.contains('on'), {timeout: 15000});
  const w = await pub.evaluate(() => document.querySelector('#pic').naturalWidth);
  L.check('phone at 3x picks the 1600 preview (frame ~355pt x3 < 1600)', w === 1600, w);
  await L.sleep(800);
  await pub.screenshot({path: L.SHOTS + '/19-phone-public.png'});
  await L.sleep(3800);
  L.check('phone: controls hide when idle', !(await pub.evaluate(() => document.body.classList.contains('ui'))));
  L.check('phone: cursor rule not applied on touch', !(await pub.evaluate(() => document.body.classList.contains('idle'))));
  await pub.touchscreen.tap(195, 400);
  await L.sleep(100);
  L.check('phone: tap shows controls', await pub.evaluate(() => document.body.classList.contains('ui')));
  await pub.touchscreen.tap(195, 400);
  await L.sleep(100);
  L.check('phone: tap again hides them', !(await pub.evaluate(() => document.body.classList.contains('ui'))));

  // studio on a phone
  const page = await browser.newPage();
  L.wire(page, 'studio');
  await page.setViewport(phone);
  await page.goto(L.STUDIO + '#k=dev-local-key');
  await page.waitForFunction(() => window.__studio && Object.keys(__studio.doc.images).length === 5, {timeout: 25000});
  await L.sleep(600);
  await page.screenshot({path: L.SHOTS + '/20-phone-studio.png'});
  await page.screenshot({path: L.SHOTS + '/21-phone-studio-full.png', fullPage: true});
  const its = await page.evaluate(() => __studio.doc.free.items.map(i => ({...i})));
  L.check('phone studio loaded the live freeform doc', its.length > 0 && await page.evaluate(() => __studio.doc.mode === 'free'));
  // tap the top item to select it
  const top = its[its.length - 1];
  const c = await L.scr(page, top.cx, top.cy);
  await page.touchscreen.tap(c.x, c.y);
  await L.sleep(150);
  L.check('phone: tap selects an item', await page.evaluate(() => !!document.querySelector('.selbox')));
  // two-finger pinch: spread fingers 1.5x and twist 20°
  const cdp = await page.target().createCDPSession();
  const pts = (r, a) => [{x: c.x - r * Math.cos(a), y: c.y - r * Math.sin(a), id: 1}, {x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a), id: 2}];
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: pts(40, 0)});
  for (let i = 1; i <= 12; i++) {
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: pts(40 + 20 * i / 12, (20 * Math.PI / 180) * i / 12)});
    await L.sleep(16);
  }
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
  await L.sleep(200);
  const after = await page.evaluate(id => __studio.doc.free.items.find(i => i.id === id), top.id);
  L.check('pinch scales the item 1.5x', Math.abs(after.w / top.w - 1.5) < .08, after.w / top.w);
  L.check('pinch rotates the item by ~20°', Math.abs(after.rot - top.rot - 20) < 2.5 || Math.abs(after.rot - top.rot + 340) < 2.5, [top.rot, after.rot]);
  L.check('pinch keeps the aspect', Math.abs(after.w / after.h - top.w / top.h) < .001);
  await page.screenshot({path: L.SHOTS + '/22-phone-pinched.png'});
  await browser.close();
  console.log('\nfails:', L.fails);
})().catch(e => { console.error(e); process.exit(1); });
