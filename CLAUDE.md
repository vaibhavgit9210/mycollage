# mycollage

Collage maker with a view-only public page (`index.html`, the home URL) and a key-locked studio
(`studio-qaq7tavl/index.html`, the "secret" admin path), backed by the `mycollage` Cloudflare Worker in
`worker/` (vaibhavpro9210 account). User-facing overview in `README.md`.

Repo `vaibhavgit9210/mycollage`, live at https://vaibhavkumar.is-a.dev/mycollage/ (Pages from `gh-pages`:
push BOTH `main` and `main:gh-pages`). The worker deploys separately: `cd worker && npx wrangler deploy`.

## Keys and secrets

- `ADMIN_KEY` is a wrangler secret; its value is in `.admin-key` (gitignored, never commit, never print).
  The studio stores it in localStorage `mycollage.key`; `#k=<key>` in the studio URL sets it and is
  stripped on load. A 401 anywhere brings the lock screen back.
- `worker/.dev.vars` (gitignored) holds `ADMIN_KEY=dev-local-key` for `wrangler dev`.
- `?api=` on either page is honoured only for `http://localhost|127.0.0.1`. Keep it that way: otherwise a
  crafted studio link would send the key to someone else's server.

## Studio architecture (all in one file)

- `doc` is plain JSON: `grid.root` is a mypager-style tree (`{t:'cell', photo}` or
  `{t:'row'|'col', kids, sizes}`, sizes = fractions of the room left after gaps); `free.items` is the
  freeform stack (array order = z-order). Layout units: artboard long side = 1000. Item border width and
  corner radius are fractions of the item's short side. Every placed photo has a crop
  (`z >= 1`, focus `fx/fy` in 0..1), cover-fit in its frame via `cropRect()`.
- Split rule is mypager's: same direction as the parent adds an equal sibling (re-equalizes), the other
  direction nests a pair. `deleteCell` collapses one-child splits and merges same-direction nesting.
- **Editor and export must stay in lockstep**: the DOM editor (`drawCellEl` / `drawItemEl`) and the canvas
  export (`renderCollage`) share `cropRect`, `inner`, `insets`, `shadowOf`. Two traps already hit:
  CSS `drop-shadow()` blur is the Gaussian's sigma but canvas `shadowBlur` is 2 sigma (export multiplies by 2);
  canvas shadows ignore the transform, so in the DOM the shadow lives on the unrotated `.fw` wrapper to fall
  straight down too. `tests/t4_wysiwyg.js` pixel-diffs editor vs export (mean diff < 1.2/255); run it after
  touching either side.
- Every gesture captures the pointer on `#stage`, never on overlay elements: the overlay (`#ov`) is rebuilt
  every frame during drags.
- History = JSON snapshots (`commit()` after each finished action). Slider `input` mutates + `frame()`,
  slider `change` commits. Never rebuild the props panel on `input` (it would kill the slider being dragged).
- **Drafts live on the server** (worker table `drafts`): `draft` = `{id, rev, at}` of the open one,
  `synced` = its JSON as the server has it, `live` = `{id, at, draft, draftRev}`. `save()` writes the
  device cache (IndexedDB `state/cur` = `{id, rev, doc, synced}`) and schedules `syncDraft()` 1.5 s later:
  upload missing photos (`/have` + `/src`), then `PUT /drafts/<id>` with `base: rev`. A 409 rev means
  another device saved it: `conflictCopy()` keeps this version as "<title> (this device)" and opens theirs.
  A 409 missing re-uploads; a 404 (deleted elsewhere while open) puts it back. Syncs wait while a pointer
  is down (`pointers.size`), unless forced.
- Saving the same doc again doesn't bump the rev (it may refresh the list preview), so "edited since
  deploy" stays exact: Deploy is dirty when `live.draft !== draft.id`, or the doc differs from `synced`, or
  `draft.rev !== live.draftRev`. Previews (360 px JPEG data URLs) ride along at most every 20 s, and always
  on `syncDraft(true)` (leaving a draft, opening the sheet, deploying).
- Boot order: cache → `GET /drafts` (offline: keep editing the cache) → move a pre-drafts device's
  `state/doc` across (`adoptLegacy`, skipped when it equals the live draft) → open the cached draft, else the
  last one opened here (`localStorage mycollage.draft`), else the live one, else the newest. Unsynced cached
  edits resume (`resumeCached`); if the server moved on meanwhile and the content differs, both are kept.
- Local state: IndexedDB `mycollage` (`blobs`, `thumbs`, `state`). Cached photos no draft uses are only
  deleted at boot, because Undo can bring a removed photo back within a session.
- `openDraft()` swaps the doc in only after its photos are in IndexedDB.

## Worker gotchas

- Durable Object SQLite caps a value at 2 MB: blobs are chunked into 1 MiB rows.
- Always read or drain a request body before answering (see `drain()`): answering early leaves the upload
  half-read and `wrangler dev` then breaks the next request.
- `/publish` refuses (409) unless every render and every photo in `doc.images` is stored; afterwards it
  deletes renders older than the previous deploy and photos that neither it nor any draft uses
  (`photosInUse`). Deleting a draft sweeps the same way. `/publish` also records `{draft, draftRev}` in the
  studio-only `project` (never in the public `/live`).
- The first `GET /drafts` turns a pre-drafts live project into draft #1 (`adoptProject`, once, flag
  `draftsInit` in kv).
- Cloudflare's edge answers `Python-urllib` user agents with error 1010: scripts must send a browser UA.
- `tests/api_test.py` publishes throwaway collages, so it asserts a localhost base. Never point it at production.

## Testing

`tests/run.sh` (see README). Headless traps: puppeteer 25 needs `mouse.click(x, y, {count: 2})` for a real
double-click, and a reused profile can come up on `chrome://profile-picker` (its Local State says
`picker_shown`), where puppeteer would wait forever for a first tab: `lib.launch()` passes
`waitForInitialPage: false` and suites open their own page. The runner still wipes profiles.
Drafts are shared server state, so suites see each other's work: a fresh profile opens the live (or newest)
draft, not a blank one. t4 starts its own draft, t5 wipes devB before its "fresh device" step, t8 deploys
the first draft again at the end because t3b and t6 expect it live, and t3 centres its item first (scatter
is random and used to leave handles under a panel). Order: t5 deploys; t5c, t8, t3b, t6 need something live.
