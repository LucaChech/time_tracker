# Handoff — for the next Claude session
*Written: 2026-07-01 10:13. Single rolling handoff — overwrites the prior one; reflects current state.*

## Overall goal (anchor)
Build **Cadence** — a Windows 11 system-tray time tracker whose differentiator is tracking multiple
tasks **in parallel**; ClickUp read-only, local-first, pixel-faithful to the `3a` flyout. Hands-off
**dogfood** build. (Charter: `CLAUDE.md`. Plan: `IMPLEMENTATION_PLAN.md`. Spine: `VERIFICATION_SPINE.md`.)

## ✅ Stage 3b (wire UI ↔ engine over IPC) is DONE, reviewed (both panel lenses SOUND), all gates green, review fixes applied. Next stop: **Stage 4 — Tray & window behavior (the "flyout" feel).**
Stage 3b wired the signed-off static `3a` flyout to the Stage-2 engine over typed IPC. The renderer is
now a **live pure projection** of the engine's `StateSnapshot`; all timing/union/sort math stays in
main/engine. Ended on the **automated review-panel gate** (no human review) per the spine — both
adversarial lenses (spec-conformance/pure-projection + edge-cases/transitions) returned **SOUND**;
their minor findings were fixed. Committed + pushed with this handoff.

## What this session accomplished
- **IPC contract** (`src/shared/ipc.ts`): added domain channels (`getState`/`start`/`stop`/
  `addManualTask`/`removeFromList` + a `stateUpdate` push channel) and extended `CadenceApi` with
  those methods + `onStateUpdate(cb) => unsubscribe`. Imports `StateSnapshot`/`ManualTaskInput` from
  `@shared/types`.
- **`ManualTaskInput` moved** to `src/shared/types.ts` (single source); `src/main/engine/engine.ts`
  imports + re-exports it, so `engine/index.ts`'s re-export chain is unchanged. This lets the IPC
  layer + renderer reference the shape **without importing from `src/main`** (renderer keeps its own
  `ManualDraft`, which is structurally assignable to `ManualTaskInput`).
- **Preload bridge** (`src/preload/index.ts`): thin `invoke` wrappers for the domain ops;
  `onStateUpdate` registers a unique `ipcRenderer.on` listener and returns an unsubscribe that removes
  that exact listener (no leak; StrictMode-safe).
- **Main** (`src/main/index.ts`): instantiates `CadenceEngine.create({ dir: app.getPath('userData'),
  now: Date.now })` after `whenReady`; `registerDomainIpc` (each op runs on the engine then returns
  the fresh `getState()`); a **1s tick** (`startTick`) that pushes a fresh snapshot **only while a
  timer runs** (`engine.hasRunning()` O(1) gate — skips the re-derive when idle); `broadcastState`
  guards `isDestroyed()`; `tickTimer` cleared on `will-quit`. Handlers guard ids with
  `engine.hasTask()` and sanitize the manual-task payload at the trust boundary.
- **Engine** (`src/main/engine/engine.ts`): added `hasRunning()` and `hasTask(id)` accessors (both
  O(1)); no change to the tested derivation logic.
- **Snapshot** (`src/shared/types.ts` + `src/main/engine/derive.ts`): added **`derivedAt: number`**
  (= the `now` a snapshot was derived at). Fixtures updated to carry it.
- **Renderer** (`src/renderer/src/App.tsx`): replaced the fixture with a live `getState()` +
  `onStateUpdate` subscription; wired `onPlay→start`, `onPause→stop`, `onRemove→removeFromList`,
  `onAddManual→addManualTask`. `onMinimize`/`onClose` intentionally **left unwired** (Phase 4 stubs).
  A `bridge()` accessor returns the IPC surface or `undefined`, so a **plain browser tab** (no
  preload, e.g. the dev server at `http://localhost:5173`) **falls back to the `?scenario=` fixture**
  and never white-screens. `applySnapshot` **drops any snapshot older than the last applied**
  (`derivedAt` monotonic) — kills the invoke-reply-vs-tick-push backward-jump race. `.catch(onOpError)`
  on every IPC promise.
- **Filter wiring** (`src/renderer/src/flyout/filter.ts` + `Flyout.tsx`): new pure
  `applyPausedFilter(rows, filter, currentUserId?)` narrows **only which PAUSED rows render**. ⚠️ The
  pill's "M idle" keeps `snapshot.pausedCount` (the FULL total), never the filtered length. ACTIVE is
  **never** filtered. A filtered-to-empty view shows "No paused tasks match the filter" (vs "No paused
  tasks" when genuinely empty). Predicate narrows on optional `status`/`assigneeIds` fields that land
  on the catalogue row in **Phase 5** (renderer-local `FilterableRow` type for now).
- **New tests + verify harness:**
  - `src/renderer/src/flyout/filter.test.ts` — **12 Vitest tests** for `applyPausedFilter` (strict
    status/assignee narrowing, AND across groups, purity/non-mutation, view-only subset). Runs under
    the existing node vitest config.
  - `scripts/ipc-verify.mjs` + a `CADENCE_IPCTEST` branch in `src/main/index.ts` +
    `npm run verify:ipc` — a **real end-to-end IPC drive**: boots the built app on an **isolated**
    userData dir, drives `window.cadence` via `executeJavaScript`, asserts membership/ordering/
    transitions/idempotency/union-no-double-count (**12/12 PASS**). Fails fast if the isolation dir is
    missing (protects the real worklog).
- **Review-panel fixes applied** (both lenses SOUND; 6 minor findings fixed): `derivedAt` stale-drop;
  `hasTask` id guard (phantom-interval); `.catch` on IPC promises; manual-input sanitize; honest tick
  gate; IPCTEST fail-fast + non-empty-results guard. Two findings **deferred with rationale** (see
  Open threads).

## Current state
- **Stage 3b complete, reviewed, all gates green, committed + pushed.** Working tree clean after commit.
- **All gates:** `npm run typecheck` clean · `npm run lint` clean · `npm test` **69 passed**
  (57 engine + 12 filter) · `npm run build` clean · `npm run smoke` 5/5 (now a live end-to-end empty
  render) · `npm run verify:ipc` **12/12**.
- The engine is fully wired into main/preload/renderer. The live app renders the real session state;
  the browser-only route still renders fixtures for capture.
- Phase 0 GREEN. Next human gate is **Stage 6** (T2, clean-install + reboot). Stage 4 ends on the
  **automated** review-panel gate (no human review). *(Stage 4's `missing_checks` include a
  positioning edge and single-instance show+reposition — see spine.)*

## Next actions (priority order) — Stage 4: Tray & window behavior (Phase 4)
Read `IMPLEMENTATION_PLAN.md` **Phase 4** + `VERIFICATION_SPINE.md` **Stage 4** first.
1. **Tray icon + tooltip = the session total** (`sessionWorkedMs`, "worked this session"), updated each
   second; tray menu: Show/Hide, **Quit**. Tooltip must tolerate **3-digit hours** (no truncation).
2. **Click tray → toggle the flyout**, positioned bottom-right above the taskbar near the tray
   (`screen.getPrimaryDisplay().workArea` + tray `getBounds()`; **clamp to the work area for
   top/left/right taskbars**, not just bottom).
3. **Window sizing (the deferred Phase-4 item):** the transparent window is still the Stage-1
   placeholder (**380 wide × 600 tall**, `src/main/index.ts` `FLYOUT_WIDTH`/`FLYOUT_HEIGHT`). Size it to
   **panel(380) + shadow gutter**, height **content-driven** with internal PAUSED scroll — the panel's
   shadow gutter currently clips. (The `.flyout` is pinned at exactly 380px via `flex: none`; 3a's
   captures show the intended result.)
4. **Wire the window controls + lifecycle** (App.tsx already threads `onMinimize`/`onClose` as
   unwired stubs): minimize → hide to tray; close (`×`) → **hide to tray (session stays alive)**;
   **Quit only via tray** → ends the session. On Quit/suspend/lock, call the engine's **auto-pause**
   (`engine.quit()` / `engine.stopAllRunning('suspend'|'lock'|'quit')` — these already exist) so
   running timers stop. **This closes the two Stage-3b-deferred items (see Open threads).**
5. **Hide-on-blur** — except **disabled in dev / when DevTools is focused** (else dev is unusable).
6. **Autostart on login** via `app.setLoginItemSettings` (default on; persisted). Programmatic write
   only — the **real reboot proof is deferred to the Stage 6 human gate**.
7. **Single-instance lock** — the flyout is hidden by default, so a 2nd launch must **show +
   reposition** the existing window, not merely `focus()` an invisible one.
8. **Stage 4 verification** = `/verify` (tray click shows in work area, blur hides with the dev
   exception, 2nd instance shows+repositions) + review panel (edge-cases: positioning/single-instance;
   integration-reality). Ends on the **automated** gate → summary + "start a new session";
   auto-`/future-claude` first.

## Open threads / do-not-relitigate (settled)
- **`pausedCount` must not shrink under the filter** — locked in and verified this stage (pill uses
  `snapshot.pausedCount`, never the filtered length). Documented in `src/shared/types.ts`.
- **DEFERRED to Stage 4 (both flagged by the 3b review panel, intentionally):**
  1. **`will-quit` does NOT stop running timers.** The engine has `quit()`/`stopAllRunning()`; 3b left
     them unwired (Phase 4 owns Quit/suspend/lock semantics). Next-launch **crash-close** already
     prevents phantom time, so this is not data loss — BUT note: until **Phase 6 heartbeats** land,
     crash-close closes a dangling interval at `max(ts)` = the last `start` ts, so a *graceful* quit
     currently records the final start→quit span as ~0 duration. Wire `engine.quit()` in Phase 4 to
     make graceful-quit history accurate. (CLAUDE.md lists "auto-pause on Quit" as v0 scope.)
  2. **`onMinimize`/`onClose` are unwired stubs** in `App.tsx` (Phase 4 wires them to hide-to-tray).
- **Filter empties the live PAUSED list on real 3b data (intentional, not a bug).** Live `TaskRow`s
  carry no `status`/`assigneeIds` yet (Phase 5), so the **strict** predicate drops every paused row
  when any status/assignee is toggled → "No paused tasks match the filter." The pill still shows the
  true `pausedCount`, and the predicate is unit-tested correct with synthetic status/assignee rows.
  **Phase 5** attaches the real fields (+ the current-user id via `GET /user`) and threads
  `currentUserId` into `applyPausedFilter`; then the filter goes live. **Do not** hide/disable the
  Filter button (would change signed-off UI + couple to Phase 5). If Luca finds the interim
  empties-on-toggle jarring, the smallest change is to disable the toggle chips until rows carry
  metadata — but the agreed default is to leave it.
- **Do NOT re-litigate the `3a` look** — Luca signed it off (T3) at Stage 3a. The empty-state text and
  the new "…match the filter" message are consistent with the approved muted empty-state pattern.
- Settled earlier and still holding: local event log as source of truth + **no ClickUp push in v0**
  (grep-verified none this stage); per-task elapsed = union; `sessionWorkedMs` in ms; `id` as final
  PAUSED-sort tiebreaker; self-hosted fonts; `sandbox:true`; `*.md` in `.prettierignore`.
- **Carry-forwards (not bugs):** `glyph` carried but intentionally not rendered (3a uses colored bars +
  gradient cards). `initialPanel` is launch-time-only (not reactive) — fine. The renderer receives a
  full snapshot each push and re-renders — it never re-sums/re-sorts (verified SOUND).

## Pointers
- **Build root must be local** (laptop C:), not `G:\Other computers\…`. Commands: `npm run dev`
  (electron-vite dev; renderer also at `http://localhost:5173/` in a browser → **fixture fallback**,
  no live engine) · `npm test` (69 tests) · `npm run typecheck` · `npm run lint` · `npm run build` ·
  `npm run smoke` (Stage-1 shell + live empty render) · **`npm run verify:ipc`** (Stage-3b end-to-end
  IPC drive).
- **IPC contract** is `src/shared/ipc.ts` (channels + `CadenceApi`). **Data model** is
  `src/shared/types.ts` (`StateSnapshot` now carries `derivedAt`; `ManualTaskInput` lives here).
- **The engine** (`src/main/engine/`) is pure + injected (`EngineDeps = { dir, now }`); `getState()`
  returns the serializable `StateSnapshot`. Ops: `start`/`stop`/`toggle`/`addManualTask`/
  `removeFromList`/`setCatalogue` (Phase 5)/`quit`/`stopAllRunning`/`heartbeat` (Phase 6). New:
  `hasRunning()`, `hasTask(id)`.
- **The 3a UI** lives in `src/renderer/src/flyout/`. `Flyout` is a **pure render** of a
  `StateSnapshot` + optional op handlers. `App.tsx` owns the live subscription + the `bridge()`
  fallback + `applySnapshot` (monotonic `derivedAt` drop). Filter view-state (`FilterState`) is
  renderer-only; `applyPausedFilter` is pure and unit-tested.
- **Verify harnesses**: `scripts/smoke.mjs` (CADENCE_SMOKE branch in main) and `scripts/ipc-verify.mjs`
  (CADENCE_IPCTEST branch in main — isolated userData, `executeJavaScript` drive). Both mirror the
  same spawn→result-JSON→exit-code pattern.
- Plan: `IMPLEMENTATION_PLAN.md` (Phase 4 next) · Spine: `VERIFICATION_SPINE.md` (**Stage 4**, soft
  automated gate) · Charter: `CLAUDE.md`. Doctrine: no human review of routine diffs; mandatory
  autonomous review panel after every non-trivial phase; human gates only at T1/T2/T3; one phase = one
  bounded session; auto-`/future-claude` before every handoff.
- GitHub: `https://github.com/LucaChech/time_tracker` (PUBLIC, `main`, `origin`). gh authed as
  `LucaChech`. Secret hygiene load-bearing (public repo): real `pk_` token only in untracked
  `.env.local`.
- ClickUp (Phase 5, later): base `https://api.clickup.com/api/v2`; header `Authorization: <pk_token>`
  (**no `Bearer`**); workspace id `90121836206`; Free plan → `custom_id` null, lists have no API color.
  Phase 5 also attaches `status` + `assigneeIds` to each `Task` and the current-user id → activates
  the filter.
