# Handoff — for the next Claude session
*Written: 2026-06-30 (late night). Single rolling handoff — overwrites the prior one; reflects current state.*

## Overall goal (anchor)
Build **Cadence** — a Windows 11 system-tray time tracker whose differentiator is tracking multiple
tasks **in parallel**; ClickUp read-only, local-first, pixel-faithful to the `3a` flyout. Hands-off
**dogfood** build. (Charter: `CLAUDE.md`. Plan: `IMPLEMENTATION_PLAN.md`. Spine: `VERIFICATION_SPINE.md`.)

## ✅ Stage 2 (the state engine) is DONE, reviewed, hardened, and verified green. Next stop: **Stage 3a — the static pixel-faithful `3a` UI.**
Stage 2 was the **riskiest stage** (the whole app projects from this logic). It is now complete:
pure, dependency-injected engine + a 57-test Vitest gate, both review-panel lenses run, substantive
findings fixed, re-verified clean. **NOT yet committed when this was written — the commit+push covering
both the engine and this handoff is the immediate next mechanical step (see Next actions #0).**

## What this session accomplished
Built the entire Phase-2 state engine from scratch (UI-independent, no Electron import, `now()` + storage
dir injected) plus its hard automated test gate, then ran the mandatory review panel and fixed what it found.

- **Tooling:** added `vitest@^3` (devDep), `vitest.config.ts` (node env, `@shared` alias, `include
  src/**/*.test.ts`), `test`/`test:watch` scripts, and `vitest.config.*` to `tsconfig.node.json` include.
- **Data model** — `src/shared/types.ts`: `Task`, `WorklogEvent` (ts/taskId/action/**source**), `EventSource`,
  `Interval`, `TaskRow`, `StateSnapshot`. The `source` field is a deliberate, documented reconciliation of
  the plan's 3-field event line with the charter's "ts + task id + **source**" — derivation never branches
  on it (both review lenses confirmed this is sanctioned, not drift).
- **Engine** — four files under `src/main/engine/`:
  - `derive.ts` — pure: `replay` (log-order, idempotent, clamps), per-task session/all-time elapsed,
    `mergeIntervals`, `sessionUnionMs`, `comparePaused`/ACTIVE sort, `deriveState` entry.
  - `store.ts` — persistence (injected dir, `node:fs` only): `worklog.jsonl` append/read (skips corrupt
    lines), `tasks-store.json` atomic write + shape-validated read. (`clickup-cache.json` deferred to Ph5.)
  - `engine.ts` — `CadenceEngine` orchestrator: `create()` (load + crash-close dangling opens at `max(ts)`
    + fresh session), `start/stop/toggle` (idempotent via `runningIds`), `addManualTask` (palette cycle),
    `removeFromList` (session set), `stopAllRunning`/`quit`, `heartbeat`, `setCatalogue`, `getState`.
  - `index.ts` — barrel.
- **Vitest gate (57 tests)** — `derive.test.ts` / `store.test.ts` / `engine.test.ts`. Covers the plan's full
  Phase-2 acceptance set **and** every one of the spine's Stage-2 `missing_checks` (touching/zero-length/gap
  intervals, corrupt lines never NaN, pre-session open interval, 250-task deterministic+stable sort, perf guard).
- **Review panel (2 lenses, autonomous):**
  - **Spec-conformance lens → SOUND.** Every acceptance criterion + missing_check has a real test; zero
    ClickUp-push seam; injected clock+dir; no Electron leak; log-as-truth projection. Only Low/Nit findings.
  - **Edge-case math lens** confirmed the headline `sessionWorkedMs` union is robust, but found real defects
    in the **per-task** numbers and **sort determinism**. **Fixed all substantive ones:**
    - **#1 (per-task double-count):** per-task elapsed is now a **UNION of that task's own intervals**, not a
      naive Σ — a same-task clock-step self-overlap can't make a per-card timer exceed the session total.
      (Union == Σ under a sane clock.) Unified via one `normInterval` helper in `derive.ts`.
    - **#3 (closed interval past `now`):** `normInterval` caps every interval end at `now` (no-op under a
      forward clock) so elapsed can never exceed wall-clock-since-session-start.
    - **#2 (sort not total):** added `id` as the ultimate `comparePaused` tiebreaker (mirrors ACTIVE) so
      duplicate name/space/list/elapsed rows are deterministic across ClickUp refreshes. `name` stays the
      last *meaningful* key — spec ordering unchanged.
    - **Hardening:** `parseEventLine` rejects non-positive `ts`; heartbeat lines default `source:'heartbeat'`;
      `readTasksStore` shape-validates + drops malformed rows; `setCatalogue` rewrites the store **once**
      (not per-task — was O(n²) writes, the spec lens's LOW-3 / Phase-5 latency landmine).
    - Added 10 regression/coverage tests pinning all of the above. Re-ran the panel's concerns → addressed.
- **Repo hygiene:** added `*.md` to `.prettierignore` — `npm run format` was reflowing the hand-formatted
  planning docs (CLAUDE.md / plan / spine / handoff). Reverted that accidental reformatting; only engine
  source is formatted now.
- **All gates green after fixes:** `npm run typecheck` clean · `npm run lint` clean (0/0) · `npm test`
  **57/57 pass** · `npm run build` clean (`out/` unchanged — engine isn't wired into entry points yet, by design).

## Current state
- **Stage 2 complete and verified**, but **uncommitted** at time of writing. Working tree has: new
  `src/shared/types.ts`, new `src/main/engine/` (4 src + 3 test files), new `vitest.config.ts`, and modified
  `package.json` / `package-lock.json` / `tsconfig.node.json` / `.prettierignore`. Repo otherwise at `6969ee1`.
- Stage 1 (app shell) remains green and is **not touched** by Stage 2 (engine is pure, not imported by
  main/preload/renderer yet — that wiring is Stage 3b).
- Phase 0 GREEN. No human gate (T1/T2/T3) due *for Stage 2*. Stage 3a **will** end on a human gate (T3).

## Next actions (priority order)
0. **FIRST: commit + push Stage 2.** One commit covering the engine + tests + tooling + this handoff
   (e.g. "Stage 2: state engine + Vitest gate, reviewed & hardened"). Push to `origin/main`. Working tree
   should be clean after. *(If already done in this session, skip.)*
1. **Stage 3a — static pixel-faithful `3a` UI (its own bounded session).** Read `IMPLEMENTATION_PLAN.md`
   Phase 3 + `VERIFICATION_SPINE.md` **Stage 3a** first. Build the `3a` flyout **pixel-faithfully, BEFORE
   wiring to state** (wiring is Stage 3b). Two sections only (ACTIVE / PAUSED); title bar (minimize+close
   only, no maximize); current-session line + live·idle pill; active cards (gradient, ping dot, HH:MM:SS,
   code chip only when non-null, Pause pill, **no ×**); paused rows (attention bar, `Space · List`, short
   elapsed hidden when 0, Play, **×**); filter control; manual-task composer; footer ("Tasks refreshed Xm
   ago"). Exact tokens/colors/radii/animations from the prototype. **No green — success is blue.** Times
   `tabular-nums`.
2. Stage 3a verification = automated style + screenshot-diff vs a render of the `3a` prototype across
   **populated / empty / long-list (scroll)** states, asserting the intended v0 deviations (filter, per-row
   ×, maximize removed, code hidden) are present and NOT flagged as regressions.
3. **Stage 3a ENDS ON A HUMAN GATE (T3): ask Luca for visual pixel sign-off.** Do not self-certify the look.
4. Then auto-`/future-claude` + short non-technical summary + "start a new session."

## Open threads / blockers / waiting-on-user
- **No blockers.** Build on the **laptop's local C: path** (never the `G:\Other computers\…` Drive sync view —
  it can't complete npm's cleanup).
- **Do NOT re-litigate** (settled): the pinned version matrix; Fontsource self-hosted fonts; `sandbox:true`;
  local event log as source of truth + **no ClickUp push in v0**; the `source` 4th event field (sanctioned);
  per-task elapsed = union (not Σ) and interval-end clamp-to-`now` (review-panel decisions, documented in
  `derive.ts`); `id` as the final PAUSED-sort tiebreaker; `sessionWorkedMs` in **ms** (plan's "Seconds" was
  loose; ms is consistent everywhere and the renderer formats to `Xh YYm`); `*.md` in `.prettierignore`.
- **Deferred to later phases (engine seams already in place):** Stage 3b wires the renderer to `getState()`
  + operations over IPC (`src/shared/ipc.ts` is the contract to extend); Phase 4 wires tray + `powerMonitor`
  suspend/lock → `engine.stopAllRunning('suspend'|'lock')` + the 1s display tick + autostart; Phase 5 ClickUp
  READ calls `engine.setCatalogue(...)` + adds `clickup-cache.json` + `safeStorage` token; Phase 6 adds the
  ~30s `engine.heartbeat()` writer + packaging.
- **Known low-pri carry-forwards (not bugs):** starting an *unknown* taskId would append an event + mark it
  running with no rendered row (latent only — UI never starts unknown tasks; documented, left as-is). The
  Stage-1 deferred nits still stand (mac/Linux build cruft to trim at Ph6; add `.env.example` at Ph5).
- **Human touchpoints still ahead:** Stage 3a pixel sign-off (T3 — next!); Stage 6 clean-install + reboot (T2).

## Pointers
- **Build root must be local** (laptop C:), not `G:\Other computers\…`. Commands: `npm test` (the Stage-2
  gate, 57 tests) · `npm run typecheck` · `npm run lint` · `npm run build` · `npm run dev` (live) ·
  `npm run smoke` (Stage-1 shell harness, writes `%TEMP%/cadence-smoke/`).
- **The engine** lives entirely in `src/main/engine/` + types in `src/shared/types.ts`. It is pure +
  injected (`EngineDeps = { dir, now }`) — Stage 3b/Phase 4 will instantiate it in `src/main/index.ts` and
  expose `getState()` + ops over IPC. `getState()` returns a serializable `StateSnapshot` (active[], paused[],
  runningCount, pausedCount, sessionWorkedMs, sessionStartTs). The renderer must be a **pure render** of it —
  never recompute/re-sum (that's a Stage-3b spec point; re-summing per-task would double-count the union).
- Plan: `IMPLEMENTATION_PLAN.md` (Phase 3 next) · Spine: `VERIFICATION_SPINE.md` (**Stage 3a**, hard human gate)
  · Charter: `CLAUDE.md`. Doctrine: no human review of routine diffs; mandatory autonomous review panel after
  every non-trivial phase; human gates only at T1/T2/T3; one phase = one bounded session; auto-`/future-claude`
  before every handoff.
- Design (build the **`3a`** panel): `TimeTracker-handoff/timetracker/project/design_handoff_cadence_tracker/README.md`
  + `Cadence Tracker.dc.html` (pixel spec; recreate `3a`, ignore `2a`–`2d`). Tokens already ported to
  `src/renderer/src/assets/tokens.css`. **No green anywhere — success is blue.**
- GitHub: `https://github.com/LucaChech/time_tracker` (PUBLIC, `main`, `origin`). gh authed as `LucaChech`.
  Secret hygiene load-bearing (public repo): real `pk_` token only in untracked `.env.local`.
- ClickUp (Phase 5, later): base `https://api.clickup.com/api/v2`; header `Authorization: <pk_token>` (**no
  `Bearer`**); workspace id `90121836206`; Free plan → `custom_id` null, lists have no API color. Keep all
  network in the **main** process; treat every ClickUp string as untrusted before rendering.
