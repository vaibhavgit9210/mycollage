const L = require('./lib');
const cells = page => page.evaluate(() => __studio.layoutGrid().cells.map(c => ({id: c.n.id, img: c.n.photo && c.n.photo.img, p: c.n.photo, x: c.x, y: c.y, w: c.w, h: c.h})));
const center = async (page, c) => L.scr(page, c.x + c.w / 2, c.y + c.h / 2);
(async () => {
  const browser = await L.launch('smoke');       // reuse the profile from t1 (5 photos, smart layout)
  const page = await browser.newPage();
  L.wire(page, 'studio');
  await page.goto(L.STUDIO);
  await page.waitForFunction(() => window.__studio && Object.keys(__studio.doc.images).length === 5, {timeout: 15000});
  await L.sleep(300);
  let cs = await cells(page);
  L.check('persisted across reload: 5 filled cells', cs.length === 5 && cs.every(c => c.img), cs.length);

  // 1. select cell A (first) -> mini toolbar + cell panel
  const A = cs[0];
  let pt = await center(page, A);
  await page.mouse.click(pt.x, pt.y);
  await L.sleep(100);
  L.check('cell selected shows mini toolbar', await page.$('.mini') !== null);
  L.check('cell panel shown', (await page.$$eval('.sec h3', hs => hs.map(h => h.textContent))).includes('Cell'));

  // 2. split left/right via mini toolbar -> 6 cells, new empty cell right of A
  await page.click('.mini button[title="Split left / right"]');
  await L.sleep(100);
  cs = await cells(page);
  const nA = cs.find(c => c.id === A.id), fresh = cs.find(c => !c.img);
  L.check('split L/R adds an empty cell', cs.length === 6 && !!fresh, cs.length);
  L.check('new cell sits right of A, same row', fresh && Math.abs(fresh.y - nA.y) < .01 && fresh.x > nA.x && Math.abs(fresh.h - nA.h) < .01, {fresh, nA});
  L.check('A and new cell split evenly', fresh && Math.abs(fresh.w - nA.w) < .01);

  // 3. same-direction split on the fresh cell: adds a sibling and equalizes (mypager rule)
  pt = await center(page, fresh);
  await page.mouse.click(pt.x, pt.y);
  await page.click('.mini button[title="Split left / right"]');
  await L.sleep(100);
  cs = await cells(page);
  const rowCells = cs.filter(c => Math.abs(c.y - nA.y) < .01 && Math.abs(c.h - nA.h) < .01);
  L.check('same-direction split gives 3 equal siblings', rowCells.length === 3 && rowCells.every(c => Math.abs(c.w - rowCells[0].w) < .01), rowCells.map(c => c.w));
  const bad = await page.evaluate(() => { let n = 0; (function w(x) { if (!x.kids) return; for (const k of x.kids) { if (k.t === x.t) n++; w(k); } })(__studio.doc.grid.root); return n; });
  L.check('no split nested directly in a same-direction split', bad === 0, bad);

  // 4. delete the two empties -> collapses back to 5 cells, A full width of its column again
  for (let i = 0; i < 2; i++) {
    cs = await cells(page);
    const e = cs.find(c => !c.img);
    pt = await center(page, e);
    await page.mouse.click(pt.x, pt.y);
    await page.click('.mini button[title="Delete cell"]');
    await L.sleep(80);
  }
  cs = await cells(page);
  const A2 = cs.find(c => c.id === A.id);
  L.check('deleting collapses back to 5 cells', cs.length === 5, cs.length);
  L.check('A regains its width', A2 && Math.abs(A2.w - A.w) < .01, {was: A.w, now: A2 && A2.w});

  // 5. gutter drag between the two columns: +80 screen px
  const before = await page.evaluate(() => __studio.layoutGrid().guts.map(g => ({row: g.row, at: g.at, i: g.i})));
  const gi = before.findIndex(g => g.row);
  const gEl = (await page.$$('.gut'))[gi];
  const gb = await gEl.boundingBox();
  const k = await page.evaluate(() => __studio.view.k);
  await L.drag(page, {x: gb.x + gb.width / 2, y: gb.y + gb.height / 2}, {x: gb.x + gb.width / 2 + 80, y: gb.y + gb.height / 2});
  const after = await page.evaluate(() => __studio.layoutGrid().guts.map(g => ({row: g.row, at: g.at})));
  L.check('gutter drag moves the boundary by 80px/k units', Math.abs(after[gi].at - before[gi].at - 80 / k) < 1.5, {before: before[gi].at, after: after[gi].at, expect: 80 / k});
  await page.screenshot({path: L.SHOTS + '/03-grid-gutter.png'});

  // 6. swap by dragging photo C onto photo E
  cs = await cells(page);
  const imgs = await page.evaluate(() => Object.keys(__studio.doc.images));
  const byImg = i => cs.find(c => c.img === imgs[i]);
  const C = byImg(2), E = byImg(4);
  await L.drag(page, await center(page, C), await center(page, E), 16);
  cs = await cells(page);
  L.check('drag swaps photos C and E', cs.find(c => c.id === C.id).img === imgs[4] && cs.find(c => c.id === E.id).img === imgs[2]);
  L.check('swap target becomes selected', await page.evaluate(id => document.querySelector('.selbox') !== null, E.id));

  // 7. double-click B -> adjust; drag pans; wheel zooms; Done exits
  const B = cs.find(c => c.img === imgs[1]);
  pt = await center(page, B);
  await page.mouse.click(pt.x, pt.y, {count: 2});
  await L.sleep(100);
  L.check('double-click enters adjust (zoombar visible)', await page.$eval('#zoombar', z => !z.hidden));
  const p0 = (await cells(page)).find(c => c.id === B.id).p;
  await L.drag(page, pt, {x: pt.x, y: pt.y + 60});
  const p1 = (await cells(page)).find(c => c.id === B.id).p;
  L.check('drag in adjust pans the crop', p1.fy !== p0.fy || p1.fx !== p0.fx, {p0, p1});
  await page.mouse.move(pt.x, pt.y);
  await page.mouse.wheel({deltaY: -300});
  await L.sleep(500);
  const p2 = (await cells(page)).find(c => c.id === B.id).p;
  L.check('wheel zooms in adjust', p2.z > 1.5, p2.z);
  await page.screenshot({path: L.SHOTS + '/04-grid-adjust.png'});
  await page.click('#zoomDone');
  L.check('Done exits adjust', await page.$eval('#zoombar', z => z.hidden));

  // 8. keyboard: Backspace clears photo, again deletes cell; undo x2 restores; redo
  pt = await center(page, (await cells(page)).find(c => c.id === B.id));
  await page.mouse.click(pt.x, pt.y);
  await page.keyboard.press('Backspace');
  L.check('Backspace clears the photo', !(await cells(page)).find(c => c.id === B.id).img);
  await page.keyboard.press('Backspace');
  L.check('Backspace on empty cell deletes it', !(await cells(page)).find(c => c.id === B.id) && (await cells(page)).length === 4);
  await page.keyboard.down('Meta'); await page.keyboard.press('z'); await page.keyboard.press('z'); await page.keyboard.up('Meta');
  cs = await cells(page);
  L.check('undo x2 restores cell and photo', cs.length === 5 && cs.find(c => c.id === B.id)?.img === imgs[1]);
  await page.keyboard.down('Meta'); await page.keyboard.down('Shift'); await page.keyboard.press('z'); await page.keyboard.up('Shift'); await page.keyboard.up('Meta');
  L.check('redo re-clears the photo', !(await cells(page)).find(c => c.id === B.id).img);
  await page.keyboard.down('Meta'); await page.keyboard.press('z'); await page.keyboard.up('Meta');

  // 9. template 2x2 keeps first 4 photos in order, toasts about the 5th
  const tps = await page.$$('.tp');
  await tps[7].click();
  await L.sleep(150);
  cs = await cells(page);
  L.check('2x2 template -> 4 filled cells', cs.length === 4 && cs.every(c => c.img), cs.length);
  L.check('toast says one photo did not fit', (await page.$$eval('.toast', t => t.map(x => x.textContent).join('|'))).includes("didn't fit"));

  // 10. split a cell, click library thumb -> fills the selected empty cell
  pt = await center(page, cs[3]);
  await page.mouse.click(pt.x, pt.y);
  await page.click('.mini button[title="Split top / bottom"]');
  await L.sleep(80);
  cs = await cells(page);
  const empty = cs.find(c => !c.img);
  pt = await center(page, empty);
  await page.mouse.click(pt.x, pt.y);
  const thumbs = await page.$$('.thumb');
  await thumbs[4].click();
  await L.sleep(100);
  L.check('clicking a thumb fills the selected empty cell', (await cells(page)).find(c => c.id === empty.id).img === imgs[4]);

  // 11. drag a thumb from the library onto a cell -> replaces it
  cs = await cells(page);
  const tgt = cs[0];
  const tb = await (await page.$$('.thumb'))[2].boundingBox();
  await L.drag(page, {x: tb.x + tb.width / 2, y: tb.y + tb.height / 2}, await center(page, tgt), 20);
  L.check('library drag onto a cell sets that photo', (await cells(page)).find(c => c.id === tgt.id).img === imgs[2]);

  // 12. spacing + canvas
  const gapRange = await page.evaluateHandle(() => [...document.querySelectorAll('.ctl')].find(c => c.querySelector('.lab span').textContent === 'Gap').querySelector('input'));
  const gb2 = await gapRange.boundingBox();
  await page.mouse.click(gb2.x + gb2.width * .8, gb2.y + gb2.height / 2);
  L.check('gap slider changes gap', await page.evaluate(() => __studio.doc.grid.gap) > 30);
  await page.click('.chip:nth-child(1)');
  L.check('1:1 aspect', await page.evaluate(() => __studio.doc.W === __studio.doc.H && __studio.doc.aspect === '1:1'));
  await page.click('.sw .swc[title="#111111"]');
  L.check('black background', await page.evaluate(() => __studio.doc.bg === '#111111'));
  await page.click('#title');
  await page.keyboard.type('Summer 2026');
  await page.keyboard.press('Enter');
  L.check('title set', await page.evaluate(() => __studio.doc.title === 'Summer 2026'));
  await page.mouse.click(5, 450);  // somewhere on the lib panel, deselect nothing
  await page.screenshot({path: L.SHOTS + '/05-grid-styled.png'});

  // 13. persistence after reload
  const json = await page.evaluate(() => JSON.stringify(__studio.doc));
  await L.sleep(500);
  await page.reload();
  await page.waitForFunction(() => window.__studio && __studio.doc.title === 'Summer 2026', {timeout: 10000}).catch(() => {});
  L.check('doc identical after reload', json === await page.evaluate(() => JSON.stringify(__studio.doc)));
  await browser.close();
  console.log('\nfails:', L.fails);
})().catch(e => { console.error(e); process.exit(1); });
