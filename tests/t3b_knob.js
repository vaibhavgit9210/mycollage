const L = require('./lib');
(async () => {
  const browser = await L.launch('knob');
  const page = await browser.newPage();
  L.wire(page, 'studio');
  await page.goto(L.STUDIO + '#k=dev-local-key');
  await page.waitForFunction(() => window.__studio && Object.keys(__studio.doc.images).length >= 3, {timeout: 20000});
  await L.sleep(800);
  for (const [label, cy] of [['top edge', 'h/2'], ['middle', 'H/2']]) {
    const it = await page.evaluate(where => {
      const s = __studio, d = s.doc;
      if (d.mode !== 'free') s.setMode('free');
      const it = d.free.items[d.free.items.length - 1];
      Object.assign(it, {rot: 0, cx: d.W / 2, cy: where === 'h/2' ? it.h / 2 : d.H / 2});
      s.commit(); s.select({kind: 'item', id: it.id}); s.render();
      return {...it};
    }, cy);
    const below = await page.$eval('.selbox', b => b.classList.contains('below'));
    L.check(`knob position at ${label}: ${label === 'top edge' ? 'below' : 'above'}`, below === (label === 'top edge'));
    const hb = await (await page.$('[data-h="rot"]')).boundingBox();
    const c = await L.scr(page, it.cx, it.cy);
    const r0 = {x: hb.x + hb.width / 2, y: hb.y + hb.height / 2}, ang = 30 * Math.PI / 180, dx = r0.x - c.x, dy = r0.y - c.y;
    await L.drag(page, r0, {x: c.x + dx * Math.cos(ang) - dy * Math.sin(ang), y: c.y + dx * Math.sin(ang) + dy * Math.cos(ang)}, 16);
    const rot = await page.evaluate(id => __studio.doc.free.items.find(i => i.id === id).rot, it.id);
    L.check(`rotating from the knob works at ${label}`, Math.abs(rot - 30) < 2, rot);
  }
  await page.screenshot({path: L.SHOTS + '/24-knob.png'});
  await browser.close();
  console.log('\nfails:', L.fails);
})().catch(e => { console.error(e); process.exit(1); });
