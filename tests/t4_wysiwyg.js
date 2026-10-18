const L = require('./lib');
// Compare the editor's DOM (screenshot of #board) with renderCollage() at the same pixel size.
async function compare(page, name) {
  await page.evaluate(() => { __studio.select(null); });
  await L.sleep(400);
  const b = await page.$eval('#board', el => { const r = el.getBoundingClientRect(); return {x: r.left, y: r.top, w: r.width, h: r.height}; });
  const shot = await page.screenshot({clip: {x: b.x, y: b.y, width: b.w, height: b.h}, encoding: 'base64'});
  const res = await page.evaluate(async (png, w, h) => {
    const im = new Image(); im.src = 'data:image/png;base64,' + png; await im.decode();
    const a = document.createElement('canvas'); a.width = w; a.height = h;
    const ac = a.getContext('2d'); ac.drawImage(im, 0, 0, w, h);
    const exp = await __studio.renderCollage(Math.max(w, h));
    const bc = document.createElement('canvas'); bc.width = w; bc.height = h;
    bc.getContext('2d').drawImage(exp, 0, 0, w, h);
    const A = ac.getImageData(0, 0, w, h).data, B = bc.getContext('2d').getImageData(0, 0, w, h).data;
    const out = document.createElement('canvas'); out.width = w * 3; out.height = h;
    const oc = out.getContext('2d'); oc.drawImage(a, 0, 0); oc.drawImage(bc, w, 0);
    const dd = oc.createImageData(w, h);
    let sum = 0, big = 0, max = 0;
    for (let i = 0; i < A.length; i += 4) {
      const d = (Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2])) / 3;
      sum += d; if (d > 40) big++; if (d > max) max = d;
      dd.data[i] = dd.data[i + 1] = dd.data[i + 2] = Math.min(255, d * 4); dd.data[i + 3] = 255;
    }
    oc.putImageData(dd, w * 2, 0);
    return {mean: sum / (w * h), bigPct: big / (w * h) * 100, max, exp: [exp.width, exp.height], img: out.toDataURL('image/png')};
  }, shot, Math.round(b.w), Math.round(b.h));
  L.fs.writeFileSync(L.SHOTS + `/wys-${name}.png`, Buffer.from(res.img.split(',')[1], 'base64'));
  console.log(`  ${name}: board ${b.w}x${b.h} at (${b.x},${b.y}), export ${res.exp}, mean diff ${res.mean.toFixed(2)}, >40: ${res.bigPct.toFixed(3)}%, max ${res.max.toFixed(0)}`);
  return res;
}
(async () => {
  L.fs.rmSync(L.SP + '/prof-wys', {recursive: true, force: true});
  const browser = await L.launch('wys');
  const page = await browser.newPage();
  L.wire(page, 'studio');
  await page.goto(L.STUDIO + '#k=dev-local-key');
  await page.waitForFunction(() => window.__studio && __studio.draft && document.querySelector('#lock').hidden, {timeout: 15000});
  await page.evaluate(() => __studio.newDraft());           // a device opens the latest draft: start a clean one
  await page.waitForFunction(() => !Object.keys(__studio.doc.images).length, {timeout: 15000});
  await page.evaluate(() => __studio.setAspect('1:1'));
  await (await page.$('#fileIn')).uploadFile(...['a-sunset-4x3.jpg', 'b-forest-3x4.jpg', 'c-sea-1x1.jpg', 'f-rose-3x2.jpg', 'g-star-alpha.png'].map(f => L.FIX + '/' + f));
  await page.waitForFunction(() => Object.keys(__studio.doc.images).length === 5, {timeout: 30000});
  L.check('alpha PNG kept as PNG', await page.evaluate(() => Object.values(__studio.doc.images).some(i => i.type === 'image/png')));
  // grid: 2 + 3 template, gap/margin/radius, one zoomed + panned, one flipped
  await page.evaluate(() => {
    const s = __studio, d = s.doc;
    s.applyTemplate(s.TEMPLATES[10]);
    Object.assign(d.grid, {gap: 20, margin: 30, radius: 24});
    d.bg = '#f3eee6';
    const cs = s.layoutGrid().cells;
    Object.assign(cs[0].n.photo, {z: 1.8, fx: .2, fy: .8});
    cs[1].n.photo.flip = true;
    s.commit(); s.render();
  });
  let r = await compare(page, 'grid');
  L.check('grid: editor matches export (mean < 1.2, >40 under 0.4%)', r.mean < 1.2 && r.bigPct < .4, r);

  // freeform: frames, radius, shadow, opacity, flip, rotation, alpha sticker
  await page.evaluate(() => {
    const s = __studio, d = s.doc;
    s.setMode('free');
    const its = d.free.items;
    const base = {rot: 0, z: 1, fx: .5, fy: .5};
    Object.assign(its[0], base, {cx: 270, cy: 280, w: 420, h: 360, rot: -8, frame: 'polaroid', bw: .05, bc: '#ffffff', shadow: .6, rad: 0});
    Object.assign(its[1], base, {cx: 700, cy: 300, w: 380, h: 470, rot: 11, frame: 'border', bw: .04, bc: '#111111', rad: .12, shadow: .9});
    Object.assign(its[2], base, {cx: 330, cy: 700, w: 400, h: 400, rot: 23, frame: 'none', rad: .5, shadow: .3, op: .6, flip: true});
    Object.assign(its[3], base, {cx: 690, cy: 720, w: 460, h: 300, rot: -15, frame: 'border', bw: .06, bc: '#d6c3a5', shadow: 0, z: 1.6, fx: .9, fy: .1});
    const star = its.find(i => d.images[i.img].type === 'image/png');
    Object.assign(star, base, {cx: 520, cy: 520, w: 300, h: 300, rot: 30, frame: 'none', shadow: 1});
    s.commit(); s.render();
  });
  r = await compare(page, 'free');
  L.check('free: editor matches export (mean < 1.2, >40 under 0.4%)', r.mean < 1.2 && r.bigPct < .4, r);
  await browser.close();
  console.log('\nfails:', L.fails);
})().catch(e => { console.error(e); process.exit(1); });
