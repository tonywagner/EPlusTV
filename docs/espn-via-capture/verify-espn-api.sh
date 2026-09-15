#!/usr/bin/env bash
#
# Re-verify the empirical claims behind docs/espn-via-capture/README.md.
#
# Everything in that document's "Root cause" and "What still works" sections is a claim about
# ESPN's live API, verified 2026-09-02 and re-verified 2026-09-15. Run this before writing code
# to confirm the ground hasn't shifted.
#
# No credentials needed — that is itself one of the findings.
#
# Usage:  ./verify-espn-api.sh [YYYY-MM-DD]     (day defaults to tomorrow)

set -euo pipefail

GRAPH_API='https://watch.graph.api.espn.com/api'
KEY_CONFIG='https://a.espncdn.com/connected-devices/app-configurations/espn-js-sdk-web-2.0.config.json'
DAY="${1:-$(date -u -v+1d +%Y-%m-%d 2>/dev/null || date -u -d 'tomorrow' +%Y-%m-%d)}"

echo "=== 1. Public GraphQL API key ==="
API_KEY=$(curl -fsS "$KEY_CONFIG" | python3 -c 'import sys,json; print(json.load(sys.stdin)["graphqlapi"]["apiKey"])')
echo "apiKey = $API_KEY"
echo "  (expected shape: a UUID; was 814f2f90-ba23-49d3-8b8c-74aa18e7cc6b)"
echo

query_airings() {
  # $1 = airing type (LIVE/UPCOMING), $2 = extra variables JSON fragment (may be empty)
  local type="$1" extra="${2:-}"
  local q='query Airings ( $countryCode: String!, $deviceType: DeviceType!, $tz: String!, $type: AiringType, $day: String, $limit: Int ) { airings( countryCode: $countryCode, deviceType: $deviceType, tz: $tz, type: $type, day: $day, limit: $limit ) { id name startDateTime duration authTypes feedName image { url } sport { name } league { name } network { id name } source { url authorizationType } packages { name } } }'
  curl -fsS -G "$GRAPH_API" \
    --data-urlencode "apiKey=$API_KEY" \
    --data-urlencode "query=$q" \
    --data-urlencode "variables={\"countryCode\":\"US\",\"deviceType\":\"DESKTOP\",\"tz\":\"UTC+0000\",\"type\":\"$type\"${extra},\"limit\":500}"
}

summarize() {
  python3 -c '
import sys, json, collections
airings = json.load(sys.stdin)["data"]["airings"]
print("airings returned: %d" % len(airings))
if not airings:
    sys.exit(0)
rows = collections.Counter(
    (a["network"]["id"], a["source"]["authorizationType"], bool(a["source"]["url"]))
    for a in airings
)
print("%-26s %-16s %s" % ("network", "authorizationType", "has source.url"))
for (net, auth, has_url), n in rows.most_common():
    print("%-26s %-16s %-14s  x%d" % (net, auth, has_url, n))
'
}

echo "=== 2. LIVE airings (unauthenticated) ==="
echo "Key things to confirm:"
echo "  - the call succeeds at all without credentials"
echo "  - any espn_unlimited_events row has NO source.url (the DTC catalog is unproxyable)"
echo "    — this network only appears when such an event is live, so an empty run proves nothing"
echo "  - espn1/espn2/espnu/sec/acc rows are START_SESSION (linear, out of scope)"
echo
LIVE=$(query_airings LIVE)
echo "$LIVE" | summarize
echo

echo "=== 3. A live airing ID + its watch URL ==="
echo "$LIVE" | python3 -c '
import sys, json
airings = json.load(sys.stdin)["data"]["airings"]
dtc = [a for a in airings if a["network"]["id"] in ("espn_dtc", "bam_dtc", "espn_unlimited_events")]
pick = (dtc or airings or [None])[0]
if not pick:
    print("no live airings right now — try again during US daytime")
    sys.exit(0)
print("id:      %s" % pick["id"])
print("name:    %s" % pick["name"])
print("network: %s" % pick["network"]["id"])
print("watch:   https://www.espn.com/watch/player/_/id/%s" % pick["id"])
print()
print("Feed that watch URL to PrismCast to test capture end to end:")
print("  curl -iL \"http://localhost:5589/play?url=https%3A%2F%2Fwww.espn.com%2Fwatch%2Fplayer%2F_%2Fid%2F" + pick["id"] + "\"")
'
echo

echo "=== 4. UPCOMING catalog for $DAY (the EPG source) ==="
echo "Confirms the schedule half of the provider still has data to work with."
echo "Note: 'has source.url = False' is normal here — upcoming airings have no stream yet."
echo "What matters is the airing count and the network mix, not the URLs."
echo
query_airings UPCOMING ",\"day\":\"$DAY\"" | summarize
echo

echo "=== 5. Per-airing watch URL resolves ==="
AIRING_ID=$(echo "$LIVE" | python3 -c '
import sys, json
a = json.load(sys.stdin)["data"]["airings"]
print(a[0]["id"] if a else "")
')
if [ -n "$AIRING_ID" ]; then
  curl -fsS -o /dev/null -w "  HTTP %{http_code} -> %{url_effective}\n" -L \
    -A 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36' \
    "https://www.espn.com/watch/player/_/id/$AIRING_ID" || echo "  request failed"
  echo "  (expected: HTTP 200)"
else
  echo "  skipped — no live airing available to test with"
fi
echo

echo "=== 6. PrismCast integration points (pinned to a moving main) ==="
echo "--- ad-hoc URL endpoint: expect a GET /play route ---"
curl -fsSL https://raw.githubusercontent.com/hjdhjd/prismcast/main/src/routes/play.ts \
  | grep -nE 'app\.get|GET /play' || echo "  !! /play route not found — the design's core assumption is gone, re-read README section 3"
echo "--- builtin ESPN site profile ---"
curl -fsSL https://raw.githubusercontent.com/hjdhjd/prismcast/main/src/config/sites.ts \
  | grep -n 'espn' || echo "  !! no espn.com profile — capture may need a user-defined service profile"
echo
echo "Done."
