#!/bin/bash
# t143 — local live-vs-cache render comparison for info pages.
# Usage: t143_cache_compare.sh <path> <label>
#   1) fresh load (live fetch path)  -> capture key fields
#   2) reload (localStorage cache path) -> capture again
#   3) diff
set -u
PATHPART="$1"; LABEL="$2"
BASE="http://127.0.0.1:8899"
OUT="/tmp/t143"
mkdir -p "$OUT"

EXTRACT='(() => {
  const g = id => { const e = document.getElementById(id); return e ? e.textContent.trim() : null; };
  const watch = document.querySelector(".action-buttons a[href*=\"/watch/\"], a.btn-primary[href*=\"/watch/\"], a[href*=\"/watch/\"]");
  return JSON.stringify({
    url: location.pathname,
    docTitle: document.title,
    crumbType: g("typeName"),
    crumbTitle: g("breadcrumbTitle"),
    heroTitle: g("showTitle"),
    metaRow: (g("metadataRow") || "").replace(/\s+/g, " "),
    synopsisLen: (g("synopsisText") || "").length,
    detailRows: document.querySelectorAll("#detailsGrid .detail-item, #detailsGrid > *").length,
    watchHref: watch ? watch.getAttribute("href") : null,
    posterOk: (() => { const p = document.getElementById("posterImg"); return p ? (p.src.indexOf("data:image") === -1) : null; })()
  });
})()'

echo "=== [$LABEL] pass 1: FRESH (live fetch) ==="
agent-browser open "$BASE$PATHPART" > /dev/null 2>&1
agent-browser set viewport 1440 900 > /dev/null 2>&1
# wait until the hero title is no longer the loading placeholder (max ~25s)
for i in $(seq 1 25); do
  T=$(agent-browser eval 'document.getElementById("showTitle") ? document.getElementById("showTitle").textContent.trim() : ""' 2>/dev/null | tr -d '"')
  if [ -n "$T" ] && [ "$T" != "Loading show title..." ]; then break; fi
  sleep 1
done
sleep 3
agent-browser eval "$EXTRACT" > "$OUT/${LABEL}_live.json" 2>/dev/null
cat "$OUT/${LABEL}_live.json"

echo "=== [$LABEL] pass 2: RELOAD (cache-served) ==="
agent-browser reload > /dev/null 2>&1
for i in $(seq 1 25); do
  T=$(agent-browser eval 'document.getElementById("showTitle") ? document.getElementById("showTitle").textContent.trim() : ""' 2>/dev/null | tr -d '"')
  if [ -n "$T" ] && [ "$T" != "Loading show title..." ]; then break; fi
  sleep 1
done
sleep 3
agent-browser eval "$EXTRACT" > "$OUT/${LABEL}_cache.json" 2>/dev/null
cat "$OUT/${LABEL}_cache.json"

echo "=== [$LABEL] DIFF live vs cache ==="
if diff <(python3 -m json.tool "$OUT/${LABEL}_live.json" 2>/dev/null || cat "$OUT/${LABEL}_live.json") \
        <(python3 -m json.tool "$OUT/${LABEL}_cache.json" 2>/dev/null || cat "$OUT/${LABEL}_cache.json"); then
  echo "IDENTICAL ✓"
else
  echo "^^ differences above"
fi
