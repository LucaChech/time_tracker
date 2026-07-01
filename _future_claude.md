# Handoff — for the next Claude session
*Written: 2026-07-01 15:05. Single rolling handoff — overwrites the prior one; reflects current state.*

## Overall goal (anchor)
Build **Cadence** — a Windows 11 system-tray time tracker whose differentiator is tracking multiple
tasks **in parallel**; ClickUp read-only, local-first, pixel-faithful to the `3a` flyout. Hands-off
**dogfood** build. (Charter: `CLAUDE.md`. Plan: `IMPLEMENTATION_PLAN.md`. Spine: `VERIFICATION_SPINE.md`.)

## ✅ Stage 5b (refresh / resilience / rate-limit / filters / connect-state) is DONE, reviewed (3-lens panel), all findings fixed, every gate green. Next stop: **Stage 6 — persistence hardening, packaging & ship (the final phase; T2 human gate).**
Stage 5b turned the raw 5a launch fetch into a resilient, cache-first, user-connectable integration:
offline-safe cache, metadata-only refresh (tray + footer), 100-req/min throttle + 429 backoff +
per-list failure skipping, the PAUSED filter wired to the real user id + workspace statuses, and an
in-app **safeStorage-encrypted** "Connect ClickUp" flow. Ended on the **automated review-panel gate**
(no human review) per the spine. Committed + pushed with this handoff.

## What this session accomplished
- **`src/main/engine/store.ts`** — added `clickup-cache.json` persistence (`ClickUpCache =
  { currentUserId, fetchedAt, tasks }`): `readClickUpCache` (shape-guarded, drops malformed rows,
  null on corrupt) + `writeClickUpCache` (atomic tmp+rename). Exported via `engine/index.ts`.
- **`src/main/clickup.ts`** — resilience INSIDE the client, all injected/testable:
  - **Sliding-window throttle** to the 100/min floor (`RATE_LIMIT_PER_MINUTE`); cap clamped `≥1`
    (no busy-loop) and drops future-dated entries (backward-clock defense).
  - **429 backoff** — `computeBackoffMs(headers, now, attempt)` honors `X-RateLimit-Reset` (epoch
    **seconds**) then `Retry-After`, clamped `[0, 60s]` (the 60s cap makes the sec-vs-ms ambiguity
    safe); bounded retries (`DEFAULT_MAX_429_RETRIES=3`), then a typed `ClickUpApiError(429)`.
  - **Per-space / per-list skip** → `Catalogue.partial: boolean`; `/user`+`/team` stay FATAL (throw).
    Map/dedupe now runs INSIDE the per-list try (one bad row skips its list, never the traversal).
  - New injected deps: `sleep`, `now`, `maxRequestsPerMinute`, `maxRetriesPer429`.
- **`src/main/token-store.ts` (new)** — the build's **secret-at-rest boundary**. `safeStorage` (DPAPI)
  encrypt/decrypt of the `pk_` token → `clickup-token.enc` in userData. `readStoredToken` /
  `writeStoredToken` (atomic; refuses blank + refuses plaintext when encryption unavailable) /
  `clearStoredToken` / `hasStoredToken` / `isEncryptionAvailable`. RAW token never on disk (ciphertext
  only) or logged. ONLY module importing `safeStorage`.
- **`src/shared/types.ts` + `src/shared/ipc.ts` + `src/preload/index.ts`** — `ConnectionStatus`
  (`no-token|connecting|connected|partial|offline|invalid-token`) + `CatalogueMeta`
  (`{status, currentUserId, refreshedAt, hasToken, encryptionAvailable}`). New channels/API:
  `getCatalogueMeta`, `refreshCatalogue`, `setClickUpToken`, `catalogueMetaUpdate` (push),
  `openConnect` (push, tray → reveal token field) + preload wiring.
- **`src/main/index.ts`** — the connection state machine:
  - `resolveActiveToken(envDir?)` = `.env.local`/env (dev) → `readStoredToken()` (shipped) precedence.
  - `loadCachedCatalogue` (cache-first launch, seeds `lastFullTasks` merge base) → `refreshCatalogue`.
  - `refreshCatalogue(engine, {fetchFn?, envDir?})` — full success writes cache + `lastFullTasks`;
    **PARTIAL merges over `lastFullTasks` and does NOT clobber the cache** (review fix); auth 401/403 →
    `invalid-token`, other error → `offline` (cache kept). `refreshInFlight` guard + **`refreshQueued`
    trailing-refresh** so a token pasted mid-fetch isn't dropped (review fix). `setCatalogueMeta`
    push moved inside the try/finally (no stuck 'connecting').
  - `setClickUpToken`, `registerCatalogueIpc`, tray items **"Refresh tasks"** + **"Connect ClickUp…"**
    (`openConnectPanel`).
- **Renderer** — `App.tsx` holds `meta` (subscribes `onCatalogueMeta` + `onOpenConnect`, 30s `now`
  tick for the footer label), threads `currentUserId` + `now` + `connectOpen` + `onRefresh`/`onConnect`
  into `Flyout`. `Flyout.tsx` threads `currentUserId` into `applyPausedFilter`, derives real
  `statusOptions` from loaded rows, renders the footer refresh label + the connect prompt.
  New `ConnectPrompt.tsx` (masked `type=password` token field), `flyout/connect.ts`
  (`DEFAULT_META`, `shouldShowConnectPrompt`, `footerRefreshLabel`), `format.ts` `fmtRefreshedAgo`.
  `FilterControl.tsx` takes `statusOptions`.
- **Verify** — new `scripts/token-verify.mjs` + `npm run verify:token` + `CADENCE_TOKENTEST` branch
  (`runTokenVerify`, window-less, injected fetch, isolated dir): **22 checks** incl. safeStorage
  round-trip, raw token in NO userData file + never in logs, and the full state machine
  (connected / **partial merge + cache preserved** / invalid-token / offline / no-token).
- **Review panel (3 adversarial lenses):** integration/resilience, security/secrets (**CLEAN**),
  spec-conformance. **Fixes applied:** (HIGH/MED, flagged by two lenses) partial refresh no longer
  clobbers the good cache / empties the catalogue — it merges; (MED) mid-flight token paste queues a
  trailing refresh; (MED) map/dedupe moved inside the per-list try; (LOW) throttle cap clamp + stuck-
  connecting fix + backward-clock drop; (security LOW) fake test-token sentinel no longer starts with
  `pk_`, and `.gitignore` now ignores `*.enc`.

## Current state
- **Stage 5b complete, reviewed, all findings fixed, all gates green, committed + pushed.** Working tree
  clean after commit.
- **All gates:** `npm run typecheck` clean · `npm run lint` clean · `npm test` **123 passed**
  (57 engine [13 engine + 31 derive + 19 store — store now +5 cache] + 12 filter + 20 window + **21
  clickup** + **7 connect**) · `npm run build` clean · `npm run smoke` 5/5 · `npm run verify:ipc` 12/12 ·
  `npm run verify:tray` 13/13 · `npm run verify:clickup` **10/10 (LIVE real workspace)** ·
  **`npm run verify:token` 22/22**.
- **Docs-check PASS** (spine Stage-5 precondition): ClickUp v2 Free-plan rate limit = 100 req/min,
  429 on exceed, `X-RateLimit-Reset` = Unix timestamp — matches the client; `Retry-After` is not
  documented by ClickUp (we prefer reset, fall back to it). Source: developer.clickup.com/docs/rate-limits.
- Launch the app now: it renders the cached catalogue instantly, then refreshes live from ClickUp; no
  token → "Connect ClickUp" prompt; tray has Refresh + Connect. Filter narrows PAUSED by
  assignee/status.
- Secret hygiene verified: `.env.local` gitignored (`*.local`) & untracked; every `pk_` in tracked
  files is a test fixture; the token blob is `*.enc` (ignored) and only ever in userData; GET-only.

## Next actions (priority order) — Stage 6: persistence hardening, packaging & ship (FINAL phase)
Read `IMPLEMENTATION_PLAN.md` **Phase 6** + `VERIFICATION_SPINE.md` **Stage 6** `missing_checks` first.
This is a **hard gate ending in a T2 human ask** (only Luca can clean-install + reboot).
1. **New-session launch hardening:** confirm each launch refetches over cache, clears the removed-set,
   resets session timers/total to 0, all paused; history log intact; prior-crash open intervals closed
   (no phantom time) without affecting the fresh session. (Most of this already holds in the engine —
   verify + add any missing checks.)
2. **Heartbeat writer (~30s)** — `engine.heartbeat()` exists but isn't wired to a timer; add it in
   `index.ts` (bounds crash-tail loss). Clear it on quit like `tickTimer`.
3. **Package with electron-builder:** Windows **NSIS installer + portable exe**; app icon; autostart
   wired into the installed build; single-instance confirmed; **self-hosted fonts confirmed offline**
   (no CDN leak in the PACKAGED build, per the Stage-6 missing_check — test with the network blocked).
4. **Short root `README.md`:** install, where data lives (userData), how to set the token (in-app
   Connect ClickUp — no file editing needed in the shipped app).
5. **End-of-build secret sweep** (spine): working tree **AND git history** contain no `pk_` token,
   `.env.local`, or `safeStorage`/`.enc` blob; `.gitignore` covers them; grep logs for `pk_`.
6. **Stage 6 verification** = automated (new-session reset + log-history integrity + NSIS/portable
   build produced + packaged-fonts-offline) + review panel (spec-conformance reset/crash-close +
   security/release) → then the **T2 human gate**: ASK Luca to clean-install on a fresh Windows session
   (starts on login, lives in tray, reads ClickUp, tracks parallel timers) and reboot (0 totals,
   autostart, no phantom time). Auto-`/future-claude` before handing back.

## Open threads / do-not-relitigate (settled)
- **Stage-5b settled decisions (accepted, some flagged by the review panel):**
  1. **Partial refresh = merge, not replace; cache untouched on partial.** A partial fetch keeps the
     last-good-FULL cache as the offline snapshot and merges fetched rows over `lastFullTasks` so
     skipped-list tasks don't vanish. `refreshedAt` is NOT advanced on partial (honest staleness with
     the `partial` status). Don't "simplify" this back to an unconditional setCatalogue+writeCache.
  2. **Status filter chips come from the LOADED tasks' distinct statuses, not the full workspace status
     catalog.** Deliberate — fetching per-list status definitions is scope creep for v0. (LOW review nit,
     accepted.) Real ClickUp statuses render lowercase (e.g. "to do") — cosmetic, self-consistent.
  3. **Encryption-unavailable → refuse to persist the token** (no plaintext fallback) + warn in the
     connect UI. DPAPI is effectively always available for a logged-in Windows user; acceptable for v0.
  4. **The trailing-refresh (`refreshQueued`) always uses DEFAULT deps** (real transport + token source),
     never a harness's injected fetch — the token-verify harness awaits sequentially so it never fires.
  5. **`refreshCatalogue`/`setClickUpToken` IPC handlers return the IMMEDIATE meta** (usually
     'connecting'); the async fetch pushes transitions via `catalogueMetaUpdate` — the renderer never
     blocks on a multi-second round-trip.
- **Carry-forwards (still holding, grep-verified none re-introduced):** local event log = source of
  truth; **NO ClickUp push in v0** (client is GET-only); per-task elapsed = union; tray tooltip = union
  (never a per-task sum); `pausedCount` never shrinks under the filter (filter narrows what RENDERS,
  not the count); `sessionWorkedMs` in ms; **refresh = metadata-only, never touches intervals / never
  interrupts a running card** (engine.setCatalogue rewrites only the catalogue map + tasksStore; a
  running manual/ClickUp task survives via tasksStore+runningIds); self-hosted fonts; `sandbox:true`;
  `*.md` in `.prettierignore`; do NOT re-litigate the `3a` look (Luca signed it off, T3); `glyph`
  carried but not rendered; renderer is a pure projection (never re-sums/re-sorts).
- **Multi-monitor positioning** stays deferred (primary display only). Deferred-not-in-v0 list holds
  (no summaries, no permanent delete/rename, no full idle detection, no presence layer).

## Pointers
- **Build root must be local** (laptop C:), not `G:\Other computers\…`. Commands: `npm run dev` ·
  `npm test` (123) · `npm run typecheck` · `npm run lint` · `npm run build` · `npm run smoke` ·
  `npm run verify:ipc` · `npm run verify:tray` · `npm run verify:clickup` (5a live real-data) ·
  **`npm run verify:token`** (5b safeStorage + connect state machine).
- **Stage-5b code:** `src/main/clickup.ts` (throttle/429/skip/partial) · `src/main/token-store.ts`
  (safeStorage) · `src/main/index.ts` (`refreshCatalogue` state machine, `loadCachedCatalogue`,
  `setClickUpToken`, `registerCatalogueIpc`, tray items, `runTokenVerify`, `CADENCE_TOKENTEST`) ·
  `src/main/engine/store.ts` (`clickup-cache.json`) · `src/shared/{types,ipc}.ts` · `src/preload/index.ts`
  · renderer: `App.tsx`, `flyout/{Flyout,ConnectPrompt,FilterControl}.tsx`, `flyout/{connect,format}.ts` ·
  `scripts/token-verify.mjs`.
- **Phase-5 engine entry point:** `engine.setCatalogue(tasks)` (metadata-only; one atomic store write;
  never touches the worklog). `engine.heartbeat()` exists — Stage 6 wires the ~30s timer.
- **Persistence** (`src/main/engine/store.ts`): `worklog.jsonl` (source of truth) + `tasks-store.json`
  (metadata snapshot) + **`clickup-cache.json`** (last-good-full catalogue, offline). Token blob:
  `clickup-token.enc` (userData, `safeStorage`-encrypted, `*.enc`-ignored).
- **Verify harnesses** all mirror one pattern: a `CADENCE_*` env branch in `src/main/index.ts` + a
  `scripts/*.mjs` spawner on an isolated userData dir (`smoke`/`ipc`/`tray`/`clickup`/**`token`**). The
  clickup + token harnesses are window-less; token strips `CLICKUP_TOKEN` from the child env and greps
  the child's logs for the fake sentinel.
- Plan: `IMPLEMENTATION_PLAN.md` (**Phase 6** next — packaging & ship) · Spine: `VERIFICATION_SPINE.md`
  (**Stage 6**, HARD gate, `missing_checks` = packaged-fonts-offline, autostart-after-reboot,
  new-session reset on packaged build, secret sweep) · Charter: `CLAUDE.md`. Doctrine: no human review
  of routine diffs; mandatory autonomous review panel after every non-trivial phase; human gates only at
  T1/T2/T3 (**Stage 6 is the T2 gate** — clean-install + reboot); one phase = one bounded session;
  auto-`/future-claude` before every handoff.
- GitHub: `https://github.com/LucaChech/time_tracker` (PUBLIC, `main`, `origin`). gh authed as `LucaChech`.
  Real `pk_` token only in untracked `.env.local`; in the shipped app it lives `safeStorage`-encrypted.
- ClickUp: base `https://api.clickup.com/api/v2`; header `Authorization: <pk_token>` (**no `Bearer`**);
  workspace id `90121836206`; user id `302553911`; Free plan → `custom_id` null, lists no API color,
  **100 req/min** floor, 429 + `X-RateLimit-Reset` (epoch seconds). Use Node `fetch`, not curl.
