# Restoring ESPN support via browser capture

**Status:** design complete, verified, nothing implemented yet.
**Branch:** `espn-via-capture`
**Last verified:** 2026-09-15 (see [Re-verify before you start](#re-verify-before-you-start) — these findings decay)

ESPN/ESPN+ were removed in `e2343f4` ("[4.16.3] version bump, removed non-working providers").
This document explains why, why the old approach is unrecoverable, and the design that
restores the provider by keeping its schedule half and replacing its playback half.

---

## 1. Root cause

Two things changed on ESPN's side at roughly the same time, and only one of them is a bug you
could chase.

**a) DRM.** ESPN moved from AES-128 HLS to Widevine/FairPlay CENC. EPlusTV's model — proxy the
manifest, rewrite key and segment URLs, hand plain HLS to the client — depends on being able to
fetch the AES-128 key. That key endpoint now returns `410 Gone`. The same change broke the
yt-dlp ESPN extractor ([yt-dlp#13356](https://github.com/yt-dlp/yt-dlp/issues/13356)) and
Gotham Sports simultaneously. Upstream discussion: issues
[#219](https://github.com/tonywagner/EPlusTV/issues/219),
[#232](https://github.com/tonywagner/EPlusTV/issues/232),
[#241](https://github.com/tonywagner/EPlusTV/issues/241),
[#255](https://github.com/tonywagner/EPlusTV/issues/255).

**b) The catalog moved to DTC.** The new `espn_unlimited_events` network returns
`source.url: ""` — there is no stream URL to proxy even in principle. Confirmed live:

```
$ ./verify-espn-api.sh            # LIVE airings, no credentials
espn_unlimited_events   BAM             source.url = ""        authTypes=[DIRECT]
bam_dtc                 BAM             source.url = playback.svcs.plus.espn.com/.../scenarios/{scenario}
espn_dtc                BAM             source.url = playback.svcs.plus.espn.com/.../scenarios/{scenario}
espn1/2/u/sec/acc/...   START_SESSION   source.url = broadband.espn.com/espn3/auth/watchespn/startSession
```

So: no rework of the existing playback path gets ESPN working. Channels DVR custom channels
accept MPEG-TS or HLS only — no CDM, no license acquisition. And stripping Widevine is
circumvention, which is out of scope regardless of subscription status. **The manifest-proxy
approach is permanently dead for ESPN.**

## 2. What still works, and it's most of the provider

The airings GraphQL API is completely intact and **needs no ESPN credentials at all**:

```
UPCOMING, one day, unauthenticated → 303 airings
espn_dtc: 88   espnews: 28   espn_unlimited_events: 25   espn2: 20
sec: 17   espnu: 17   bam_dtc: 16   acc: 16   espn1: 14 ...
```

Full names, start times, durations, sport/league, artwork. The API key is public and fetched at
runtime from `a.espncdn.com` (see `getGraphQlApiKey`).

This matters a lot for scoping: the entire Disney/BAM token dance (device grant, license plate,
WebSocket pairing, token refresh) and the whole Adobe Pass MVPD flow exist **only** to serve
playback. Replacing playback lets ~900 of the old handler's 1574 lines be deleted rather than
maintained.

## 3. Design

Delegate playback to a browser-capture backend that plays the stream with a real CDM and
re-emits the captured output as HLS. This is the approach the Channels community settled on
after the DRM change. [PrismCast](https://github.com/hjdhjd/prismcast) is the current tool
(successor to [chrome-capture-for-channels](https://github.com/fancybits/chrome-capture-for-channels)).

```
ESPN graph API ──► EPlusTV builds virtual channels + XMLTV     (unchanged — works today)
                        │
Channels DVR tunes ─────┤
                        ▼
       getEventData(airingId) returns
       http://<prismcast>:5589/play?url=https://www.espn.com/watch/player/_/id/<airingId>
                        │
                        ▼
       PrismCast Chrome — logged into ESPN Unlimited once, session persisted in its volume
                        │  plays with a real CDM, captures output
                        ▼
       HLS ──► EPlusTV's existing playlist proxy ──► Channels DVR
```

### Why this fits EPlusTV cleanly

Three things make the seam narrow rather than invasive:

1. **PrismCast has an ad-hoc URL endpoint.** From its `src/routes/play.ts`:
   ```
   GET /play?url=<url>&profile=<name>   →  302  →  /hls/<key>/stream.m3u8
   ```
   No pre-registration needed, so EPlusTV can hand it a different URL per event — exactly what
   per-event virtual channels require. This is the hinge the whole design rests on; PrismCast's
   README documents the channel-registry workflow but not this endpoint.

2. **PrismCast already ships an ESPN profile.** `src/config/sites.ts`:
   ```ts
   "espn.com": { profile: "keyboardMultiVideo", service: "ESPN.com" },
   ```

3. **Per-airing deep links resolve.** `https://www.espn.com/watch/player/_/id/<airingId>`
   returns 200 for airing IDs straight out of the catalog. (`https://www.espn.com/watch/_/id/<id>`
   also works, redirecting to `?id=` form.)

And `getEventData()` already returns `[url, headers]` into a playlist handler that proxies
whatever HLS you give it — so this changes what one function returns, not how streaming works.

### Decisions already made

| Question | Decision |
|---|---|
| Capture backend | PrismCast, set up fresh as part of this work |
| ESPN credentials | ESPN Unlimited (DTC) |
| Scope | Event catalog as virtual channels — **not** linear ESPN networks |
| Delivery | Local branch off a personal fork |

Linear networks were deliberately left out: PrismCast handles fixed channels on its own with
Gracenote guide data, so EPlusTV adds little there. The per-event virtual channel is the thing
EPlusTV uniquely does.

### Ruled out

- **Alternate playback scenarios** (`tvos`, `chromecast`, `roku` instead of `browser~ssai`) —
  the DRM change is at the packager, not the scenario, and `espn_unlimited_events` has no
  `source.url` at all.
- **chrome-capture-for-channels** — outputs WebM via a `chrome://` M3U scheme that Channels DVR
  resolves itself. EPlusTV can't proxy that, and a static M3U entry can't carry a per-event URL.
  PrismCast's native HLS output is what makes the proxy path work.
- **ADBTuner + HDMI encoder** — works, but tunes a physical device by channel command rather
  than by URL, which doesn't map onto per-event channels.

---

## 4. Setup on the new machine

```bash
# 1. Point at your fork (this branch was created against tonywagner/EPlusTV)
git remote add fork git@github.com:<you>/EPlusTV.git
git push -u fork espn-via-capture

# 2. Re-verify the findings above still hold before writing code
./docs/espn-via-capture/verify-espn-api.sh

# 3. Stand up PrismCast
curl -O https://raw.githubusercontent.com/hjdhjd/prismcast/main/prismcast.yaml
docker compose -f prismcast.yaml up -d
```

PrismCast ports: `5589` web UI + HLS, `6080` noVNC, `5900` VNC, `5004` HDHomeRun emulation
(Plex only — not needed here). Its data volume `prismcast-data:/root/.prismcast` holds the
Chrome profile, so the ESPN login survives restarts. Uncomment `devices: /dev/dri:/dev/dri` if
the host has an Intel GPU with Quick Sync — capture is CPU-hungry without it.

Then: open `http://localhost:6080/vnc.html`, log into espn.com with the ESPN Unlimited account
once, and confirm ad-hoc capture works end to end before touching EPlusTV:

```bash
# Should 302 to /hls/<key>/stream.m3u8 and serve a live playlist
curl -iL "http://localhost:5589/play?url=https%3A%2F%2Fwww.espn.com%2Fwatch%2Fplayer%2F_%2Fid%2F<live-airing-id>"
```

Get a live airing ID from `verify-espn-api.sh`. **Do this before any EPlusTV work** — if
capture doesn't work by hand, nothing downstream will, and you'll have saved yourself debugging
the wrong layer.

---

## 5. Implementation plan

The removal was one clean commit, so restoration starts as a scoped revert.

### Step 1 — restore the files

```bash
git checkout e2343f4^ -- \
  services/espn-handler.ts \
  services/providers/espn/ \
  services/providers/espn-plus/
```

Skip `services/providers/gotham/`, `services/gotham-*.ts`, `services/wnba-handler.ts`, and
`services/providers/wnba/` — same commit, unrelated providers, still broken.

### Step 2 — rewire the call sites

All four were edited by `e2343f4`; `git show e2343f4 -- <file>` shows exactly what came out.

| File | Change |
|---|---|
| `index.tsx` | Re-add `espnHandler` import; re-add to `schedule()`, `initialize()` lists; re-add `<ESPN />` / `<ESPNPlus />` to the providers view. **Drop the `refreshTokens()` entries** — there are no tokens any more. |
| `services/providers/index.ts` | Re-add `espn` + `espnplus` imports and `providers.route('/', ...)` calls. |
| `services/launch-channel.ts` | Add an explicit **`case 'espn':`**. ESPN used to be the `default:` case, and that default was deleted — a restored provider with no case silently produces no stream. `parseAirings` writes `from: 'espn'`. |
| `services/misc-db-service.ts` | Remove `'espn'`/`'espnplus'` from `removedProviders` and `'espn'` from `removedSchedules` in `initMiscDb`, or the provider is force-disabled on every boot. |

That last one is the easy trap: everything else can look correct while the provider disables
itself at startup.

### Step 3 — replace `getEventData`

Old body: `services/espn-handler.ts:864` (in `e2343f4^`). It resolves a scenario URL, then
branches into either BAM auth (ESPN+) or Adobe Pass + `startSession` (MVPD). All of that goes.
Replacement is roughly:

```ts
public getEventData = async (eventId: string): Promise<TChannelPlaybackInfo> => {
  const captureUrl = await getCaptureUrl();          // new setting, see Step 5
  if (!captureUrl) {
    console.log('No capture backend configured for ESPN');
    return;
  }

  const watchUrl = `https://www.espn.com/watch/player/_/id/${eventId}`;
  const playUrl  = `${captureUrl}/play?url=${encodeURIComponent(watchUrl)}`;

  return [playUrl, {'User-Agent': userAgent}];
};
```

Two things to settle by testing, not by reading:

- **Redirect handling.** `/play` 302s to `/hls/<key>/stream.m3u8`. Check whether
  `PlaylistHandler` follows that or whether `getEventData` should resolve it first.
- **Proxy vs. redirect.** EPlusTV proxying PrismCast's HLS may add nothing but indirection —
  a 302 straight to PrismCast could be simpler. Proxying is the safer default because it keeps
  channel continuity when a virtual channel rolls from one event to the next, which is also
  the case most likely to misbehave. Test an event boundary specifically.

### Step 4 — triage the rest of the handler

**Keep** (schedule path, all credential-free):

- `parseCategories` (:355), `parseAirings` (:366), `isEnabled` (:439)
- `getSchedule` (:705), `getLiveEvents` (:1027), `getUpcomingEvents` (:1047)
- `getGraphQlApiKey` (:1385), `getNetworkInfo` (:254), `LINEAR_NETWORKS` (:177)
- `save` / `load` / `loadJSON` (:1509/:1518/:1549) — simplify, far less state to persist
- `initialize` (:487) — simplify heavily, no token bootstrap left
- `refreshInMarketTeams` (:1235) — keep. It looks like BAM auth but only does an anonymous
  device registration to read a zip code, then an NHL postal lookup. `parseAirings` uses its
  output to filter in-market `bam_dtc` duplicates. **`BAM_API_KEY` must stay for this**, even
  though the rest of the BAM machinery goes.

**Delete** (existed only to serve playback):

- Disney/BAM auth: `getApiKey` (:217), `fixHeaderKey` (:227), `makeApiCall` (:230),
  `createDeviceGrant` (:1399), `createAccountGrant` (:1417), `getDeviceTokenExchange` (:1438),
  `getDeviceRefreshToken` (:1462), `getBamAccessToken` (:1485), `getPlusAuthCode` (:1180),
  `authenticatePlusRegCode` (:1222), `getAppConfig` (:1375), `class WebSocketPlus` (:299) +
  `wsPlus`, and the `ANDROID_ID` / `DISNEY_ROOT_URL` / `*_URL` / `BAM_APP_CONFIG` constants
  plus the `IToken` / `IGrant` / `ITokens` / `IAppConfig` / `IEndpoint` interfaces.
- Adobe Pass: `ADOBE_KEY` (:129), `ADOBE_PUBLIC_KEY` (:131), `authorizeEvent` (:1067),
  `getLinearAuthCode` (:1097), `authenticateLinearRegCode` (:1129), `refreshProviderToken`
  (:1154), `authorizedResources`, `IAuthResources`.
- `refreshTokens` (:690), `refreshAuth` (:987) — nothing left to refresh.
- `ispAccess` (:1300) — ISP auth was an espn3 playback path.
- `espnPlusTokens` / `espnLinearTokens` file paths (:46/:47).

`parseAirings` stores `url: event.source?.url` on each entry. That's `""` for
`espn_unlimited_events` and unused by the new `getEventData` (which builds from the airing ID) —
harmless, but don't be misled into thinking it's load-bearing.

### Step 5 — catalog filter and settings

Filter to what an ESPN Unlimited subscription actually covers — `espn_dtc`, `bam_dtc`,
`espn_unlimited_events` — via `getNetworkInfo` (:254).

Use an allowlist, not a denylist. The catalog carries more networks than the old handler knew
about, and the tail varies day to day: a single day's UPCOMING query on 2026-09-15 also
returned `mlb_network`, `nfl_network_domestic`, `secplus`, `accextra`, `espn_free`, and
`cw_sports`. The first two are covered by other EPlusTV providers and would duplicate
channels; the rest need a subscription this scope doesn't assume. Run
`verify-espn-api.sh` and read section 4 to see the current mix before fixing the list.

New setting for the PrismCast base URL (env var + provider UI field), following an existing
provider's settings pattern. The restored provider UI card should lose its credential/login
flow entirely — there's nothing to log into on the EPlusTV side any more, which is worth
saying plainly in the card so it isn't mistaken for a broken setup.

---

## 6. Known costs — set expectations before building

These are inherent to capture, not fixable in code:

- **Tune latency.** Chrome launch + navigate + play is seconds to tens of seconds versus
  near-instant before. PrismCast's predictive pretuning reads the Channels DVR schedule and
  pre-warms upcoming recordings — helps DVR, not casual live tuning.
- **Quality is capture, not source.** Re-encoded, up to 1080p, Opus audio. Viewport size
  influences what ESPN serves but doesn't guarantee it.
- **Concurrency is CPU-bound.** PrismCast defaults to 10 streams, but each is a live Chrome +
  ffmpeg capture. Real ceiling depends on hardware and GPU passthrough. This bounds
  *simultaneous tuners*, not channel count — idle virtual channels cost nothing.
- **Event rollover is the likeliest rough edge.** Community reports mention ESPN streams
  hanging at event end. Test this deliberately.

## 7. Re-verify before you start

Everything in §1 and §2 is an empirical claim about a third party's API, verified 2026-09-02
and re-verified 2026-09-15. Run `./verify-espn-api.sh` first. If the network mix or
`source.url` shape has changed materially, re-read §1 before trusting §3.

Also worth re-checking, since both are pinned to a moving `main`:

```bash
curl -sSL https://raw.githubusercontent.com/hjdhjd/prismcast/main/src/routes/play.ts | grep -n 'app.get'
curl -sSL https://raw.githubusercontent.com/hjdhjd/prismcast/main/src/config/sites.ts | grep -n espn
```

## 8. Reference

- Removal commit: `e2343f4` — `git show e2343f4` for the full surface area
- Upstream issues: [#219](https://github.com/tonywagner/EPlusTV/issues/219),
  [#232](https://github.com/tonywagner/EPlusTV/issues/232),
  [#241](https://github.com/tonywagner/EPlusTV/issues/241),
  [#255](https://github.com/tonywagner/EPlusTV/issues/255)
- Channels community thread:
  [ESPN+ & FOX Sports with Custom Channels via EPlusTV](https://community.getchannels.com/t/espn-fox-sports-with-custom-channels-via-eplustv/31144)
- [PrismCast](https://github.com/hjdhjd/prismcast) ·
  [Channels DVR custom channels docs](https://getchannels.com/docs/channels-dvr-server/how-to/custom-channels/)
