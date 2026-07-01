# Handoff — for the next Claude session
*Written: 2026-07-01 20:45. Single rolling handoff — overwrites the prior one; reflects current state.*

## Overall goal (anchor)
Build **Cadence** — a Windows 11 system-tray time tracker whose differentiator is tracking multiple
tasks **in parallel**; ClickUp read-only, local-first, pixel-faithful to the `3a` flyout. Hands-off
**dogfood** build. (Charter: `CLAUDE.md`. Plan: `IMPLEMENTATION_PLAN.md`. Spine: `VERIFICATION_SPINE.md`.)

## ✅✅ v0 SHIPPED — Stage 6 complete AND the T2 human gate PASSED (2026-07-01). Luca installed the **portable** build and confirmed everything works end-to-end (tray flyout, Connect ClickUp, parallel timers, union total). The whole 6-phase build is DONE; there is no open v0 work. A post-ship filter question was raised and resolved with NO code change (see settled decisions). Stage 6 itself: code complete, reviewed (3-lens panel + re-review), all findings fixed, every automated gate green, artifacts built, committed + pushed (`af8f4fb`).
Stage 6 turned the verified engine + integration into a shippable Windows app: a running-gated
heartbeat writer that bounds crash-tail loss, a launch-hardening verify harness that proves the
new-session/crash-close/no-phantom-time semantics on the built artifact, electron-builder packaging
(NSIS installer + portable exe) with the secret/CDN/`.claude` leak paths closed, a root README, and a
clean end-of-build secret sweep. Ended on the **automated review-panel gate + a T2 human ask** per the
spine (the plan's only T2: clean-install on a fresh Windows session + a real reboot).

## What this session accomplished
- **Fresh checkout bootstrap:** `node_modules` was absent → ran `npm ci` (624 pkgs). NOTE: this machine
  has `core.autocrlf=true` + no `.gitattributes`, so the working tree is CRLF and `npm run lint` shows
  ~5.1k `prettier/prettier` "Delete ␍" WARNINGS (0 errors). This is a checkout artifact only — git
  normalizes to LF on commit (verified: `git diff --stat` shows content-only changes, no EOL churn).
  The lint GATE passes (exit 0, 0 errors). Don't "fix" the whole tree's EOLs (huge spurious diff).
- **`src/main/index.ts` — heartbeat writer (Stage-6 core):** `HEARTBEAT_INTERVAL_MS = 30_000`,
  `heartbeatIntervalMs()` (override via `CADENCE_HEARTBEAT_MS` scoped to `NEWSESSIONTEST` only),
  `startHeartbeat(engine)` — **gated on `engine.hasRunning()`** (a heartbeat only bounds an OPEN
  interval, so idle ticks are skipped — no unbounded `worklog.jsonl` growth on a resident tray app),
  re-entrancy-guarded, and wired inside the `if (!SMOKE && !IPCTEST)` lifecycle block (SMOKE runs on
  REAL userData → must stay read-only). `heartbeatTimer` cleared in `will-quit` alongside `tickTimer`.
- **`src/main/index.ts` — new-session verify harness:** `runNewSessionVerify()` + `writeNewSessionResult`
  + `NEWSESSIONTEST*` constants + `whenReady` early-return dispatch (window-less, like clickup/token).
  Engine import now also pulls `readWorklog, replay`. Drives the REAL launch helpers (`CadenceEngine.create`
  crash-close, `loadCachedCatalogue` offline render, `startHeartbeat`) over a pre-seeded crashed-prior-run
  dir and asserts **16 checks**: crash-close at max(ts)/no-phantom-time, fresh-session reset (0 totals,
  all paused), history retained-but-scoped-out, log integrity, removed-set is session-only (remove a row
  → hidden this session → reappears on relaunch), heartbeat-appends-while-running, idempotent relaunch.
- **`scripts/newsession-verify.mjs` (new)** — spawner that SEEDS the isolated userData dir (a 2-days-ago
  `worklog.jsonl` with a completed interval + a dangling OPEN interval + trailing heartbeat, a
  `tasks-store.json`, a `clickup-cache.json`), runs the harness under `CADENCE_HEARTBEAT_MS=100`, reads
  `newsession-result.json`, exits 0/1. Mirrors the tray/token harness pattern.
- **`package.json`** — added `"verify:newsession": "node scripts/newsession-verify.mjs"`.
- **`electron-builder.yml`** — `win.target: [nsis, portable]` + a `portable` block with a DISTINCT
  `artifactName` (both are `.exe` → would collide otherwise). Hardened `files` excludes: added
  **`!.claude/**`** (electron-builder does NOT honor `.gitignore`, so a gitignored `.claude/settings.local.json`
  would otherwise ride into the PUBLIC installer), `!vitest.config.*`, `!**/*.enc`, `!**/*.map`, and made
  `src`/`scripts`/`TimeTracker-handoff`/`.vscode` globs recursive (`/**`). Added top-level **`publish: null`**
  to suppress the auto-inferred GitHub `app-update.yml`/`latest.yml` (no electron-updater dep → inert, but
  keeps the artifact honest; no attacker-pointable channel).
- **`README.md` (new, repo root)** — what Cadence is, install (NSIS vs portable), usage, **Connect ClickUp**
  (in-app token, safeStorage-encrypted, no file editing), where data lives (`%APPDATA%\Cadence\` + the 4
  files), dev + verify-harness commands.
- **Review panel (3 adversarial lenses: spec-conformance, security/release, correctness/edge-cases) + a
  re-review pass.** Findings, all FIXED & re-verified:
  - (MED, correctness) idle heartbeat = unbounded log growth → gated on `hasRunning()`.
  - (MED, security) `.claude/**` (+ maps/enc/vitest) could ship into the PUBLIC installer → excluded;
    rebuilt + asar-scanned to confirm gone.
  - (MED, spec) the "removed-set cleared" harness assertion was vacuous → now actually removes a row and
    proves it reappears on relaunch; heartbeat assertion now starts a task first (required by the gate).
  - (LOWs) `CADENCE_HEARTBEAT_MS` scoped to NEWSESSIONTEST; re-entrancy guard; precondition counts stops
    not events; `crashCloses.every` guarded against empty; `app-update.yml` suppressed.
  - Re-review verdict: **fixes correct and regression-free, no new/remaining findings.**

## Current state
- **Stage 6 code complete, reviewed, all findings fixed, all automated gates green, committed + pushed.**
  Working tree clean apart from this handoff.
- **All gates:** `npm run typecheck` clean · `npm run lint` **0 errors** (CRLF warnings = checkout artifact) ·
  `npm test` **123 passed** · `npm run build` clean · `npm run smoke` PASS · `npm run verify:ipc` PASS ·
  `npm run verify:tray` PASS · `npm run verify:token` 22/22 · **`npm run verify:newsession` 16/16** ·
  `npm run build:win` → **`dist/cadence-0.0.0-setup.exe` (NSIS) + `dist/cadence-0.0.0-portable.exe`** (~112 MB each).
  NOT re-run this session: `npm run verify:clickup` (live — needs a `pk_` token in `.env.local` + network;
  `.env.local` is ABSENT on this fresh checkout; it's a Stage-5 gate, not a Stage-6 requirement).
- **Packaged-artifact scans (automated half of the Stage-6 missing_checks):** `app.asar` has **0**
  `fonts.googleapis`/`fonts.gstatic` refs and 184 bundled local font files (no CDN leak); `.claude`/`src`/
  `scripts`/`vitest.config` NOT in the asar; `app-update.yml`/`latest.yml` suppressed; NO `pk_` token
  anywhere in `dist/`.
- **Secret sweep (spine end-of-build) — CLEAN:** working tree + FULL git history contain no real `pk_`
  token, no `.env*`/`.enc` file ever committed, no real-token-shaped string in history. Every tracked `pk_`
  is a doc placeholder (`pk_xxx`) or a short fake test fixture (`pk_abc`, `pk_x`…); the token-verify
  sentinel deliberately avoids the `pk_` prefix. `.gitignore` covers `.env.*`/`*.local`/`*.enc`/`dist`/`out`.
  `dist/` (the 112 MB exes) is gitignored (uncommittable).

## Next actions (priority order) — v0 is SHIPPED; no open build work
The 6-phase v0 build is complete and accepted. Nothing is required to finish v0. If a NEW session opens,
do **not** re-present the T2 gate (already passed) and do **not** re-run the build unless something changed.
Only pick up if Luca asks for one of:
- **A deferred feature** (explicitly OUT of v0 — see the deferred list below): ClickUp time-entry PUSH
  (the architecture is push-ready — a future `add_time_entry` sync of finished blocks; client is currently
  GET-only), daily/weekly summaries, permanent delete/rename, full idle detection, presence layer, output
  metric, multi-monitor positioning, or a code-signing cert (v0 ships unsigned → SmartScreen warns).
- **A bug found in daily dogfooding.** Repro, then check: autostart → `applyAutostart` (runs `if (app.isPackaged)`);
  phantom time → `CadenceEngine.create` crash-close (engine.ts:72-96) + heartbeat cadence; offline blank →
  `loadCachedCatalogue`/`clickup-cache.json`; fonts/glyphs → the Fontsource/material-symbols imports in
  `src/renderer/src/main.tsx` (keep self-hosted).
- The only not-run automated check remains `verify:clickup` (live; needs a `pk_` in `.env.local` + network)
  and the spine's optional "packaged app renders fonts with network BLOCKED" visual check — neither is a v0 blocker.

## Open threads / do-not-relitigate (settled)
- **Stage-6 settled decisions (accepted, reviewed):**
  1. **Heartbeat is gated on `hasRunning()`** and only wired for the real runtime (+ TRAYTEST), never
     SMOKE/IPCTEST. Don't "simplify" it to fire unconditionally — that reintroduces unbounded idle log growth.
  2. **`electron-builder.yml` excludes are load-bearing, not cosmetic** — `!.claude/**` in particular
     prevents a gitignored local file leaking into a PUBLIC installer (electron-builder ignores `.gitignore`).
     Keep the excludes recursive. `publish: null` is deliberate (suppress the inferred update channel).
  3. **The new-session harness proves LAUNCH WIRING, not engine internals** (those are Stage-2 unit tests).
     Its "new-session refetch over cache" is the OFFLINE cache render; the network refetch is covered by
     `verify:clickup`, not here (the harness has no network — by design).
  4. **NSIS + portable both ship**, each with a distinct `artifactName` (avoid the `.exe` overwrite).
  5. **Status filter stays MULTI-SELECT with OR (union) semantics** — ticking "to do" + "in progress"
     shows tasks in EITHER status (AND'd against "Assigned to me"). Luca queried whether ticking multiple
     "makes sense", then accepted the union reasoning — **decided: NO change** (`applyPausedFilter` in
     `src/renderer/src/flyout/filter.ts`). Don't switch it to single-select.
- **Carry-forwards (still holding, grep-verified none re-introduced):** local event log = source of truth;
  **NO ClickUp push in v0** (client is GET-only); per-task elapsed = union; tray tooltip = union (never a
  per-task sum); refresh = metadata-only, never touches intervals / never interrupts a running card;
  `pausedCount` drops on REMOVE but NOT under the view-only filter; `sessionWorkedMs` in ms; token only
  ever `safeStorage`-encrypted at rest (`clickup-token.enc`, `*.enc`-ignored); self-hosted fonts;
  `sandbox:true`; `*.md` in `.prettierignore`; renderer is a pure projection; do NOT re-litigate the `3a`
  look (Luca signed it off, T3); multi-monitor positioning stays deferred (primary display only).
- **Deferred-not-in-v0 (unchanged):** ClickUp time-entry push, separate task-management/session-confirm
  screen, permanent delete/rename, full idle detection, daily/weekly summaries, presence layer, output metric.

## Pointers
- **Build root must be local** (laptop C:), not `G:\Other computers\…`. On a fresh checkout run `npm ci`
  first (node_modules is gitignored). Commands: `npm run dev` · `npm test` (123) · `npm run typecheck` ·
  `npm run lint` (0 errors; CRLF warnings are a local checkout artifact) · `npm run build` · `npm run smoke` ·
  `npm run verify:ipc` · `npm run verify:tray` · `npm run verify:token` · **`npm run verify:newsession`** (Stage 6) ·
  `npm run verify:clickup` (live, needs `.env.local`) · **`npm run build:win`** (→ NSIS + portable in `dist/`).
- **Stage-6 code:** `src/main/index.ts` (heartbeat writer §~505-538; `runNewSessionVerify` §~1420-1560;
  `NEWSESSIONTEST` dispatch in `whenReady`; `startHeartbeat` call in the lifecycle block; `will-quit` cleanup) ·
  `scripts/newsession-verify.mjs` · `electron-builder.yml` (win target + `files` excludes + `publish: null`) ·
  `README.md` · `package.json` (`verify:newsession`).
- **Engine (unchanged this stage):** `CadenceEngine.create` does crash-close + fresh session (engine.ts:72-96);
  `engine.heartbeat()` appends a global heartbeat; `engine.setCatalogue` is metadata-only; `derive.ts` filters
  `removed` out of `paused` + sets `pausedCount = paused.length`.
- **Persistence** (`src/main/engine/store.ts`): `worklog.jsonl` (truth) + `tasks-store.json` (metadata snapshot)
  + `clickup-cache.json` (offline catalogue). Token blob: `clickup-token.enc` (userData, safeStorage, `*.enc`-ignored).
- GitHub: `https://github.com/LucaChech/time_tracker` (PUBLIC, `main`, `origin`). gh authed as `LucaChech`.
  Real `pk_` token only in untracked `.env.local` (ABSENT on this checkout); in the shipped app it lives
  `safeStorage`-encrypted, entered via the in-app **Connect ClickUp** flow.
- ClickUp: base `https://api.clickup.com/api/v2`; header `Authorization: <pk_token>` (**no `Bearer`**);
  workspace `90121836206`; user `302553911`; Free plan → `custom_id` null, lists no API color, 100 req/min.
- Doctrine (spine): no human review of routine diffs; mandatory autonomous review panel after every non-trivial
  phase (done for Stage 6 + a re-review); human gates only at T1/T2/T3 — **Stage 6 IS the T2 gate**
  (clean-install + reboot); one phase = one bounded session; auto-`/future-claude` before every handoff.
