# mycollage

A photo collage with two faces: a view-only public page at
**https://vaibhavkumar.is-a.dev/mycollage/**, and a key-locked studio where the collage is
built and deployed.

## The public page

- Shows the deployed collage fitted to the screen, over a soft ambient glow made from its own colors.
- A glass control pill (title, date, Download, Full screen) appears on load, on mouse movement or a tap,
  and hides itself (and the cursor) after a few idle seconds. It stays put while hovered or focused.
- **Download** saves the full 3200 px JPEG. On phones it opens the share sheet, which is where "Save Image" lives.
- **Full screen** goes edge to edge. The button hides itself where the browser can't do it (iPhone Safari).
- Keys: `F` full screen, `D` download, `Esc` leaves full screen.
- Link previews (WhatsApp, iMessage, Slack) show the live collage through `og.jpg`.

## The studio

Lives at a random path, `studio-qaq7tavl/`. Opening `…/mycollage/studio-qaq7tavl/#k=<key>` stores the key
on that device (the `#k=` part is wiped from the address bar right away); without it the studio asks for
the key. The key lives in `.admin-key`, which is gitignored. The path is visible in this public repo, so the
key is the real protection: without it nobody can deploy or read the photos back.

**Grid** works like mypager's splits. Split a cell left/right or top/bottom: along its parent's direction
that adds an equal sibling, across it nests a new pair. Drag the lines between cells to resize, delete a
cell to collapse its split. Drag a photo onto another cell to swap them; double-click a photo to pan and
zoom its crop. 16 layout templates, **Smart layout** (rows or columns chosen so the photos are cropped as
little as possible), and gap / margin / corner sliders.

**Freeform**: drag to move (snaps to the center lines), corner handles scale, side handles crop, the round
knob rotates (Shift snaps to 15°), and two fingers pinch to scale and rotate on touch screens. Bring to
front / forward / backward / to back, frame (none, border, polaroid) with width and color, corners, shadow,
opacity, flip, duplicate, crop zoom, and **Style all**. **Scatter** throws every photo down at random,
tilted and overlapping.

Both modes: 8 canvas ratios, background color, undo/redo (`⌘Z` / `⇧⌘Z`), and photos can be dropped,
pasted or picked.

**Drafts**: work on as many collages as you like. Every draft (and the photos it uses) is saved on the
server a moment after each change, so any device with the studio key sees the same list and picks up where
the last one left off; a dot next to the title says Saved / Saving / Offline. The **Drafts** button (on
phones: ⋯ → All drafts) shows them as preview cards, tagged **Live** for the one on the public page and
**Open** for the one you're editing, with New draft, Duplicate and Delete. A device opens the draft it had
open last, or the live one the first time. If two devices change the same draft at once, nothing is
overwritten: the later save is kept as a separate "(this device)" draft. Each device also keeps a copy of
the open draft, so going offline or closing the tab mid-save loses nothing.

**Deploy** publishes the draft that's open: it renders the collage to a 3200 px JPEG (plus 1600 px and
1200 px copies and a tiny placeholder), shows the exact image first (and which live collage it replaces),
then uploads it. The Deploy button gets a dot when the open draft isn't the live one, or has changed since
it went live. *Open the live collage* in the ⋯ menu jumps to the live draft.

## How it's built

- `index.html`: the public page. Single file, no dependencies.
- `studio-qaq7tavl/index.html`: the studio. Single file, vanilla JS, no dependencies.
- `worker/`: Cloudflare Worker + SQLite Durable Object (vaibhavpro9210 account) at
  https://mycollage.vaibhavpro9210.workers.dev.
  - Public: `GET /live`, `GET /r/<sha256>` (renders), `GET /og.jpg`.
  - Studio, with `Authorization: Bearer <key>`: `GET /auth`, `POST /have`, `PUT /src/<sha256>`,
    `PUT /r/<sha256>`, `PUT /publish`, `GET /project`, and drafts: `GET /drafts`,
    `GET|PUT|DELETE /drafts/<id>` (saves carry the rev they started from; a stale one gets 409).
  - Images are stored by SHA-256 (checked on upload) in 1 MiB rows, since one SQLite value caps at 2 MB.
    Source photos are never public: the public page only ever gets the flattened render, so whatever a
    crop hides stays hidden.

Photos are re-encoded on import: long side at most 3200 px, EXIF (and its location) dropped, orientation
baked in, PNG kept only when the photo really has transparency.

## Deploying

- Pages: push both `main` and `main:gh-pages`.
- Worker: `cd worker && npx wrangler deploy`. Rotate the key with
  `npx wrangler secret put ADMIN_KEY < ../.admin-key` after writing a new one there; every device then asks for it again.

## Testing

`tests/run.sh` starts `wrangler dev` (key `dev-local-key` from `worker/.dev.vars`) and a static server,
generates fixture photos (needs Pillow), then runs the API suite and eleven puppeteer suites in real Chrome:
grid splits, gutters, swaps and crops; freeform transforms; a pixel diff of the editor against the exported
image in both modes; deploy; the public page (auto-hide, download, full screen); a second device opening the
shared draft; drafts (new, switch, deploy the selected one, two devices editing at once, delete, a device's
old single draft moving in); the phone layout and pinch. Screenshots land in `$MC_WORK/shots`.

Local pages take `?api=http://localhost:8787` (only localhost is accepted, so a crafted link can't send the
key anywhere else), and the studio exposes test hooks on `window.__studio`.
