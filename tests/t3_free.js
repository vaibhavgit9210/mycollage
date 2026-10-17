const L = require('./lib');
const items = page => page.evaluate(() => __studio.doc.free.items.map(i => ({...i})));
const sel = page => page.evaluate(() => { const b = document.querySelector('.selbox'); return !!b; });
// world position of an item's local point (lx, ly in -0.5..0.5 of w/h)
const world = (it, lx, ly) => { const a = it.rot * Math.PI / 180, x = lx * it.w, y = ly * it.h; return {x: it.cx + x * Math.cos(a) - y * Math.sin(a), y: it.cy + x * Math.sin(a) + y * Math.cos(a)}; };
const near = (a, b, tol = 1.5) => Math.abs(a - b) <= tol;
(async () => {
  const browser = await L.launch('smoke');
  const page = await browser.newPage();
  L.wire(page, 'studio');
  await page.goto(L.STUDIO);
  await page.waitForFunction(() => window.__studio && Object.keys(__studio.doc.images).length === 5, {timeout: 15000});
  await L.sleep(300);
  const gridFilled = await page.evaluate(() => __studio.layoutGrid().cells.filter(c => c.n.photo).length);
  await page.click('#modeSeg button[data-mode="free"]');
  await L.sleep(200);
  let its = await items(page);
  L.check('freeform seeded from grid cells', its.length === gridFilled && its.every(i => i.frame === 'none' && i.rot === 0), its.length);
  await page.screenshot({path: L.SHOTS + '/06-free-seeded.png'});

  await page.evaluate(() => [...document.querySelectorAll('.sec .btn')].find(b => /Scatter/.test(b.textContent)).click());
  await L.sleep(200);
  its = await items(page);
  L.check('scatter rotates items within ±13°', its.some(i => i.rot !== 0) && its.every(i => Math.abs(i.rot) <= 13), its.map(i => i.rot));
  L.check('scatter keeps centers on the artboard', its.every(i => i.cx >= 0 && i.cx <= 1000 && i.cy >= 0 && i.cy <= 1000));
  await page.screenshot({path: L.SHOTS + '/07-free-scatter.png'});

  // give everything a polaroid-ish style via the panel on the top item, then "Style all"
  let top = its[its.length - 1];
  let pt = await L.scr(page, top.cx, top.cy);
  await page.mouse.click(pt.x, pt.y);
  L.check('click selects the top item', await sel(page));
  await page.evaluate(() => [...document.querySelectorAll('.sec .seg button')].find(b => b.textContent === 'Polaroid').click());
  await page.evaluate(() => [...document.querySelectorAll('.sec .btn')].find(b => b.textContent.includes('Style all')).click());
  its = await items(page);
  L.check('style all copies the polaroid frame', its.every(i => i.frame === 'polaroid'));

  // move
  top = its[its.length - 1];
  const k = await page.evaluate(() => __studio.view.k);
  pt = await L.scr(page, top.cx, top.cy);
  await L.drag(page, pt, {x: pt.x + 61, y: pt.y + 37});
  let m = (await items(page)).find(i => i.id === top.id);
  const snapped = near(m.cx, 500, .01) || near(m.cy, 500, .01);
  L.check('drag moves by delta/k (or snapped to center)', snapped || (near(m.cx - top.cx, 61 / k) && near(m.cy - top.cy, 37 / k)), {dx: m.cx - top.cx, dy: m.cy - top.cy, want: [61 / k, 37 / k]});

  // corner resize: se handle outward, nw corner stays put, aspect kept
  const s0 = m, nw0 = world(s0, -.5, -.5);
  let hb = await (await page.$('[data-h="se"]')).boundingBox();
  await L.drag(page, {x: hb.x + hb.width / 2, y: hb.y + hb.height / 2}, {x: hb.x + hb.width / 2 + 40, y: hb.y + hb.height / 2 + 30});
  let s1 = (await items(page)).find(i => i.id === top.id), nw1 = world(s1, -.5, -.5);
  L.check('corner drag scales up', s1.w > s0.w * 1.05, {w0: s0.w, w1: s1.w});
  L.check('corner drag keeps aspect', near(s1.w / s1.h, s0.w / s0.h, .002), [s0.w / s0.h, s1.w / s1.h]);
  L.check('corner drag anchors the opposite corner', near(nw0.x, nw1.x) && near(nw0.y, nw1.y), {nw0, nw1});

  // edge resize: e handle, w edge midpoint fixed, height unchanged
  const w0 = world(s1, -.5, 0);
  hb = await (await page.$('[data-h="e"]')).boundingBox();
  await L.drag(page, {x: hb.x + hb.width / 2, y: hb.y + hb.height / 2}, {x: hb.x + hb.width / 2 - 35, y: hb.y + hb.height / 2 + 4});
  let s2 = (await items(page)).find(i => i.id === top.id), w1 = world(s2, -.5, 0);
  L.check('edge drag changes width only', s2.w < s1.w - 10 && near(s2.h, s1.h, .01), {w: [s1.w, s2.w], h: [s1.h, s2.h]});
  L.check('edge drag anchors the opposite edge', near(w0.x, w1.x) && near(w0.y, w1.y), {w0, w1});

  // rotate with shift: multiple of 15
  hb = await (await page.$('[data-h="rot"]')).boundingBox();
  const c = await L.scr(page, s2.cx, s2.cy);
  const r0 = {x: hb.x + hb.width / 2, y: hb.y + hb.height / 2};
  const ang = 50 * Math.PI / 180, dx = r0.x - c.x, dy = r0.y - c.y;
  const r1 = {x: c.x + dx * Math.cos(ang) - dy * Math.sin(ang), y: c.y + dx * Math.sin(ang) + dy * Math.cos(ang)};
  await page.keyboard.down('Shift');
  await L.drag(page, r0, r1, 20);
  await page.keyboard.up('Shift');
  let s3 = (await items(page)).find(i => i.id === top.id);
  L.check('shift-rotate snaps to 15°', Math.abs(s3.rot % 15) < 1e-9 && Math.abs(s3.rot - s2.rot) > 30, {from: s2.rot, to: s3.rot});
  await page.screenshot({path: L.SHOTS + '/08-free-rotated.png'});

  // z-order
  await page.click('button[aria-label="Send to back (Shift+[)"]');
  L.check('send to back', (await items(page))[0].id === top.id);
  await page.keyboard.press('BracketRight');
  L.check('] brings forward one', (await items(page))[1].id === top.id);
  await page.keyboard.down('Shift'); await page.keyboard.press('BracketRight'); await page.keyboard.up('Shift');
  its = await items(page);
  L.check('Shift+] brings to front', its[its.length - 1].id === top.id);

  // duplicate + delete
  const n0 = its.length;
  await page.keyboard.down('Meta'); await page.keyboard.press('d'); await page.keyboard.up('Meta');
  its = await items(page);
  L.check('⌘D duplicates', its.length === n0 + 1);
  await page.keyboard.press('Backspace');
  L.check('Backspace deletes the selected item', (await items(page)).length === n0);

  // adjust crop inside a rotated polaroid frame
  its = await items(page);
  top = its[its.length - 1];
  pt = await L.scr(page, top.cx, top.cy);
  await page.mouse.click(pt.x, pt.y, {count: 2});
  await L.sleep(100);
  L.check('double-click enters adjust', await page.$eval('#zoombar', z => !z.hidden));
  await page.mouse.move(pt.x, pt.y);
  await page.mouse.wheel({deltaY: -400});
  await L.sleep(450);
  const z1 = (await items(page)).find(i => i.id === top.id);
  await L.drag(page, pt, {x: pt.x + 50, y: pt.y + 50});
  const z2 = (await items(page)).find(i => i.id === top.id);
  L.check('wheel zoom + pan in rotated frame', z1.z > 1.5 && (z2.fx !== z1.fx || z2.fy !== z1.fy) && near(z2.cx, top.cx, .001), {z: z1.z, f1: [z1.fx, z1.fy], f2: [z2.fx, z2.fy]});
  await page.screenshot({path: L.SHOTS + '/09-free-adjust.png'});
  await page.keyboard.press('Escape');
  L.check('Esc leaves adjust', await page.$eval('#zoombar', z => z.hidden));

  // snapping: drag so the center lands 3px from the artboard center
  const it = (await items(page)).find(i => i.id === top.id);
  pt = await L.scr(page, it.cx, it.cy);
  const target = await L.scr(page, 500, 500);
  await page.mouse.move(pt.x, pt.y); await page.mouse.down();
  for (let i = 1; i <= 15; i++) await page.mouse.move(pt.x + (target.x + 3 - pt.x) * i / 15, pt.y + (target.y - 2 - pt.y) * i / 15);
  const guidesShown = await page.$$eval('.guide', g => g.length);
  await page.mouse.up();
  const sn = (await items(page)).find(i => i.id === top.id);
  L.check('center snaps with guides', sn.cx === 500 && sn.cy === 500 && guidesShown === 2, {cx: sn.cx, cy: sn.cy, guidesShown});

  // arrows nudge, then undo restores
  await page.keyboard.down('Shift'); await page.keyboard.press('ArrowLeft'); await page.keyboard.up('Shift');
  await L.sleep(450);
  L.check('Shift+Arrow nudges 10 units', (await items(page)).find(i => i.id === top.id).cx === 490);
  await page.keyboard.down('Meta'); await page.keyboard.press('z'); await page.keyboard.up('Meta');
  L.check('undo restores the nudge', (await items(page)).find(i => i.id === top.id).cx === 500);

  // back to grid: the grid layout is untouched
  await page.click('#modeSeg button[data-mode="grid"]');
  L.check('grid layout preserved across modes', await page.evaluate(() => __studio.layoutGrid().cells.filter(c => c.n.photo).length) === gridFilled);
  await page.click('#modeSeg button[data-mode="free"]');
  await browser.close();
  console.log('\nfails:', L.fails);
})().catch(e => { console.error(e); process.exit(1); });
