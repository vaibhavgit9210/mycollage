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
- Local state: IndexedDB `mycollage` (`blobs`, `thumbs`, `state`). Unused blobs are only deleted at boot,
  because Undo can bring a removed photo back within a session.
- "Dirty" (yellow dot on Deploy) = `JSON.stringify(doc) !== deployed.json`.
- `loadLive()` swaps the doc in only after its photos are in IndexedDB, then records `deployed`.

## Worker gotchas

- Durable Object SQLite caps a value at 2 MB: blobs are chunked into 1 MiB rows.
- Always read or drain a request body before answering (see `drain()`): answering early leaves the upload
  half-read and `wrangler dev` then breaks the next request.
- `/publish` refuses (409) unless every render and every photo in `doc.images` is stored; afterwards it
  deletes renders older than the previous deploy and photos no longer in `doc.images`.
- Cloudflare's edge answers `Python-urllib` user agents with error 1010: scripts must send a browser UA.
- `tests/api_test.py` publishes throwaway collages, so it asserts a localhost base. Never point it at production.

## Testing

`tests/run.sh` (see README). Headless traps: puppeteer 25 needs `mouse.click(x, y, {count: 2})` for a real
double-click, and relaunching a Chrome profile that once had two tabs open can hang at startup, so the
runner wipes profiles and every suite uses its own. t5 deploys; t5c and t3b rely on something being live.
