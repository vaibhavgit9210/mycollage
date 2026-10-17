#!/bin/bash
# Full local check: worker API suite, then the browser suites against `wrangler dev` (8787)
# and a static server (8765). Uses Chrome + puppeteer-core; screenshots land in $MC_WORK/shots.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(dirname "$HERE")"
export MC_WORK="${MC_WORK:-${TMPDIR:-/tmp}/mycollage-tests}"
mkdir -p "$MC_WORK"
[ -f "$ROOT/worker/.dev.vars" ] || printf 'ADMIN_KEY=dev-local-key\n' > "$ROOT/worker/.dev.vars"
python3 "$HERE/make_fixtures.py" "$MC_WORK/fixtures"
restart_worker() {
  pkill -f "wrangler dev --port 8787"; sleep 1
  rm -rf "$ROOT/worker/.wrangler/state"
  (cd "$ROOT/worker" && npx --yes wrangler dev --port 8787 --local > "$MC_WORK/wrangler.log" 2>&1 &)
  for i in $(seq 1 60); do curl -s -o /dev/null http://localhost:8787/live && return; sleep 1; done
  echo "wrangler dev did not start"; exit 1
}
pkill -f "http.server 8765"; (cd "$ROOT" && python3 -m http.server 8765 --bind 127.0.0.1 > "$MC_WORK/http.log" 2>&1 &)
restart_worker
echo "== api"; python3 "$HERE/api_test.py" | grep -E "^FAIL|failure"
restart_worker
rm -rf "$MC_WORK"/prof-*
# Order matters: t5 deploys, and t5c / t3b need something live to auto-load.
for t in t1_smoke t2_grid t3_free t4_wysiwyg t5_deploy t5c_banner t3b_knob t6_mobile t6b_topbar t7_firstrun; do
  echo "== $t"
  node "$HERE/$t.js" 2>&1 | grep -E "^(FAIL|fails)|Error|Timed out"
done
pkill -f "wrangler dev --port 8787"; pkill -f "http.server 8765"
