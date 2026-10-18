const L = require('./lib');
// Several drafts, one live: new, switch, deploy the open one, shared by every device with the key,
// a two-device edit keeps both versions, delete, and a device's old single draft joins the list.
const ready = () => window.__studio && __studio.draft && document.querySelector('#lock').hidden;
const settled = () => JSON.stringify(__studio.doc) === __studio.synced;
const dirty = page => page.$eval('#deployBtn', b => b.classList.contains('dirty'));
async function open(profile, tag, hash = '') {
  const browser = await L.launch(profile);
  const page = await browser.newPage();
  L.wire(page, tag);
  await page.goto(L.STUDIO + hash);
  await page.waitForFunction(ready, {timeout: 20000});
  return {browser, page};
}
async function sheet(page) {
  await page.click('#draftsBtn');
  await page.waitForFunction(() => document.querySelector('.dgrid .dcard'), {timeout: 15000});
  await L.sleep(200);
  return page.$$eval('.dcard', cs => cs.map(c => ({id: c.dataset.id, title: c.querySelector('.dinfo b').textContent,
    tags: [...c.querySelectorAll('.tag')].map(t => t.textContent), img: !!c.querySelector('.dprev img')})));
}
const close = page => page.evaluate(() => document.querySelector('#modal').click());
async function deploy(page) {
  await page.click('#deployBtn');
  await page.waitForSelector('.prev img', {timeout: 20000});
  const info = await page.$eval('.info', e => e.textContent);
  await page.evaluate(() => [...document.querySelectorAll('.actions .btn.primary')].find(b => b.textContent.includes('Deploy')).click());
  await page.waitForFunction(() => document.querySelector('.status').textContent.includes('Live.'), {timeout: 30000});
  await page.click('.actions .btn.primary');   // Done
  return info;
}
(async () => {
  // A: opens the live draft; start a second one from the Drafts sheet
  let {browser: bA, page: A} = await open('drafts-a', 'A', '#k=dev-local-key');
  const first = await A.evaluate(() => ({id: __studio.draft.id, title: __studio.doc.title, n: __studio.drafts.length}));
  L.check('a fresh device opens the live draft', await A.evaluate(() => __studio.live.draft === __studio.draft.id) && !(await dirty(A)), first);
  let cards = await sheet(A);
  L.check('Drafts sheet lists the live draft, tagged Live and Open', cards.some(c => c.id === first.id && c.tags.includes('Live') && c.tags.includes('Open')), cards);
  await A.evaluate(() => [...document.querySelectorAll('.dhead .btn')].find(b => b.textContent.includes('New draft')).click());
  await A.waitForFunction(id => __studio.draft.id !== id && !Object.keys(__studio.doc.images).length, {timeout: 15000}, first.id);
  const input = await A.$('#fileIn');
  await input.uploadFile(L.FIX + '/c-sea-1x1.jpg', L.FIX + '/f-rose-3x2.jpg');
  await A.waitForFunction(() => Object.keys(__studio.doc.images).length === 2, {timeout: 30000});
  await A.click('#title', {count: 3}); await A.keyboard.type('Second'); await A.keyboard.press('Enter');
  await A.waitForFunction(settled, {timeout: 30000});
  const second = await A.evaluate(() => __studio.draft.id);
  L.check('new draft saved to the server with its photos', (await A.evaluate(() => __studio.doc.title)) === 'Second'
    && (await (await fetch(L.API + '/drafts/' + second, {headers: {Authorization: 'Bearer dev-local-key'}})).json()).doc.title === 'Second');
  L.check('Deploy flags a draft that is not the live one', await dirty(A)
    && (await A.$eval('#deployBtn', b => b.title)).includes('Another draft is live'));
  L.check('top bar counts the drafts', (await A.$eval('#draftsCount', b => b.textContent)) === String(first.n + 1));
  cards = await sheet(A);
  await A.screenshot({path: L.SHOTS + '/25-drafts.png'});
  const mine = cards.filter(c => c.id === first.id || c.id === second);
  L.check('both drafts listed with previews, Live stays on the first', cards.length === first.n + 1 && mine.length === 2 && mine.every(c => c.img)
    && cards.find(c => c.id === first.id).tags.includes('Live') && cards.find(c => c.id === second).tags.includes('Open'), cards);
  await close(A);

  // deploy the open draft: it becomes the live one
  const info = await deploy(A);
  L.check('deploy says which collage it replaces', info.includes('replaces'), info);
  const live = await (await fetch(L.API + '/live')).json();
  L.check('the public page now shows the selected draft', live.title === 'Second', live.title);
  L.check('not dirty after deploying it', !(await dirty(A)));
  cards = await sheet(A);
  L.check('Live tag moved to the deployed draft', cards.find(c => c.id === second).tags.includes('Live') && !cards.find(c => c.id === first.id).tags.includes('Live'), cards);
  // switch back to the first draft from its card
  await A.evaluate(id => document.querySelector(`.dcard[data-id="${id}"] .dprev`).click(), first.id);
  await A.waitForFunction(id => __studio.draft.id === id, {timeout: 20000}, first.id);
  L.check('opening a card switches drafts', (await A.evaluate(() => __studio.doc.title)) === first.title && await dirty(A));

  // B: another device sees the same drafts and starts on the live one
  let {browser: bB, page: B} = await open('drafts-b', 'B', '#k=dev-local-key');
  const bState = await B.evaluate(() => ({id: __studio.draft.id, n: __studio.drafts.length, imgs: Object.keys(__studio.doc.images).length}));
  L.check('device B sees every draft and opens the live one, photos included', bState.id === second && bState.n === first.n + 1 && bState.imgs === 2, bState);

  // both edit "Second": B saves first, A's later save keeps A's version as a separate draft
  await A.evaluate(id => __studio.openDraft(id), second);
  await A.waitForFunction(id => __studio.draft.id === id, {timeout: 20000}, second);
  await B.evaluate(() => { __studio.doc.bg = '#2b2b2e'; __studio.commit(); __studio.render(); });
  await B.waitForFunction(settled, {timeout: 20000});
  await A.evaluate(() => { __studio.doc.bg = '#f3eee6'; __studio.commit(); __studio.render(); });
  await A.waitForFunction(() => __studio.drafts.some(d => d.title === 'Second (this device)') && __studio.doc.bg === '#2b2b2e', {timeout: 30000});
  L.check("A shows B's version and keeps its own as a copy", true);
  const copy = await A.evaluate(() => __studio.drafts.find(d => d.title === 'Second (this device)').id);
  const copyDoc = (await (await fetch(L.API + '/drafts/' + copy, {headers: {Authorization: 'Bearer dev-local-key'}})).json()).doc;
  L.check("the copy holds A's edit", copyDoc.bg === '#f3eee6', copyDoc.bg);

  // delete the copy from A's sheet; B no longer lists it after a refresh
  await sheet(A);
  await A.evaluate(id => document.querySelector(`.dcard[data-id="${id}"] [aria-label="Delete"]`).click(), copy);
  await A.waitForFunction(() => [...document.querySelectorAll('#sheet .btn.primary')].some(b => b.textContent === 'Delete'), {timeout: 5000});
  await A.evaluate(() => [...document.querySelectorAll('#sheet .btn.primary')].find(b => b.textContent === 'Delete').click());
  await A.waitForFunction(id => !__studio.drafts.some(d => d.id === id), {timeout: 15000}, copy);
  await B.evaluate(() => __studio.refreshDrafts());
  L.check('deleted draft is gone everywhere', !(await B.evaluate(id => __studio.drafts.some(d => d.id === id), copy)));
  // put the first draft back live: the suites after this one expect it
  await A.evaluate(id => __studio.openDraft(id), first.id);
  await A.waitForFunction(id => __studio.draft.id === id, {timeout: 20000}, first.id);
  await deploy(A);
  L.check('redeploying an older draft makes it live again', (await A.evaluate(() => __studio.live.draft)) === first.id && !(await dirty(A)));
  await bA.close(); await bB.close();

  // a device from before drafts: its one draft (state/doc) joins the list on first open
  const bytes = L.fs.readFileSync(L.FIX + '/b-forest-3x4.jpg').toString('base64');
  const {browser: bC} = await (async () => {
    const browser = await L.launch('drafts-legacy');
    const page = await browser.newPage();
    L.wire(page, 'legacy');
    await page.goto(L.PUBLIC);      // same origin as the studio, so the same IndexedDB
    await page.evaluate(async b64 => {
      const blob = new Blob([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], {type: 'image/jpeg'});
      const id = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map(x => x.toString(16).padStart(2, '0')).join('');
      const db = await new Promise((res, rej) => { const r = indexedDB.open('mycollage', 1); r.onupgradeneeded = () => ['blobs', 'thumbs', 'state'].forEach(s => r.result.createObjectStore(s)); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      const doc = {v: 1, title: 'Forest', aspect: '4:5', W: 800, H: 1000, bg: '#ffffff', mode: 'grid',
        grid: {gap: 12, margin: 12, radius: 0, root: {t: 'cell', id: 'c1', photo: {img: id, z: 1, fx: .5, fy: .5, flip: false}}}, free: {items: []},
        images: {[id]: {w: 1500, h: 2000, type: 'image/jpeg', name: 'forest.jpg'}}};
      await new Promise((res, rej) => { const t = db.transaction(['blobs', 'state'], 'readwrite'); t.objectStore('blobs').put(blob, id); t.objectStore('state').put(JSON.stringify(doc), 'doc'); t.objectStore('state').put({json: '{}', id: 'old', at: 1}, 'deployed'); t.oncomplete = res; t.onerror = () => rej(t.error); });
      localStorage.setItem('mycollage.key', 'dev-local-key');
    }, bytes);
    await page.goto(L.STUDIO);
    await page.waitForFunction(ready, {timeout: 30000});
    await page.waitForFunction(() => __studio.doc.title === 'Forest (from this device)', {timeout: 20000});
    const st = await page.evaluate(async () => {
      const db = await new Promise(res => { const r = indexedDB.open('mycollage', 1); r.onsuccess = () => res(r.result); });
      const old = await new Promise(res => { const q = db.transaction('state').objectStore('state').get('doc'); q.onsuccess = () => res(q.result); });
      return {open: __studio.doc.title, photos: Object.keys(__studio.doc.images).length, listed: __studio.drafts.some(d => d.id === __studio.draft.id), old: old === undefined};
    });
    L.check("this device's old draft became a server draft and is open", st.open === 'Forest (from this device)' && st.photos === 1 && st.listed && st.old, st);
    return {browser};
  })();
  await bC.close();
  console.log('\nfails:', L.fails);
})().catch(e => { console.error(e); process.exit(1); });
