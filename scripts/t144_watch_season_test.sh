#!/bin/bash
# t144 — local verification of Watch Now season generation on info pages.
set -u
BASE="http://127.0.0.1:8899"
agent-browser close > /dev/null 2>&1
agent-browser set viewport 1440 900 > /dev/null 2>&1

CHECK='(() => {
  const btn = document.getElementById("watchNowBtn");
  const cur = document.querySelector(".season-current .season-number");
  return JSON.stringify({
    url: location.pathname,
    title: (document.getElementById("showTitle")||{}).textContent || "",
    watch: btn ? btn.getAttribute("href") : null,
    nowViewing: cur ? cur.textContent.trim() : null
  });
})()'

run() {  # run <path> <expect-regex> <label>
  agent-browser open "$BASE$1" > /dev/null 2>&1
  for i in $(seq 1 30); do
    T=$(agent-browser eval 'document.getElementById("showTitle") ? document.getElementById("showTitle").textContent.trim() : ""' 2>/dev/null | tr -d '"')
    if [ -n "$T" ] && [ "$T" != "Loading show title..." ]; then break; fi
    sleep 1
  done
  sleep 1
  R=$(agent-browser eval "$CHECK" 2>/dev/null)
  echo "--- $3"
  echo "    $R"
  if echo "$R" | grep -qE "$2"; then echo "    PASS ✓"; else echo "    FAIL ✗ (expected /$2/)"; fi
}

run "/info/tv/tmdb-tv-2316/the-office/season/2"      'watch[^,]*the-office/season/2/episode/1' "path-suffix season 2 -> watch season/2"
run "/info/tv/tmdb-tv-2316/the-office-season-2"      'watch[^,]*the-office/season/2/episode/1' "slug-tail season 2 -> watch season/2 + Now Viewing S2"
run "/info/tv/tmdb-tv-2316/the-office/season/3"      'watch[^,]*the-office/season/3/episode/1' "path-suffix season 3 -> watch season/3"
run "/info/tv/tmdb-tv-2316/the-office"               'watch[^,]*the-office/season/1/episode/1' "no season -> watch season/1 (default)"
run "/info/tv/tmdb-tv-2316/the-office/season/99"     'watch[^,]*the-office/season/1/episode/1' "bogus season 99 -> guard falls back to 1"
run "/info/tv/tmdb-tv-1100/how-i-met-your-mother-season-1" 'watch[^,]*how-i-met-your-mother/season/1/episode/1' "HIMYM slug season 1 -> season/1 (unchanged)"
run "/info/movie/tmdb-movie-155/the-dark-knight"     'watch[^,]*the-dark-knight/season/1/episode/1' "movie -> season/1 unchanged"
run "/info/anime/jikan-1/cowboy-bebop"               'watch[^,]*jikan-1/cowboy-bebop/episode/01' "anime -> episode/01 format unchanged"
