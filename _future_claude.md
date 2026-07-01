# Handoff — for the next Claude session
*Written: 2026-07-01. Single rolling handoff — overwrites the prior one; reflects current state.*

## Overall goal (anchor)
Build **Cadence** — a Windows 11 system-tray time tracker whose differentiator is tracking multiple
tasks **in parallel**; ClickUp read-only, local-first, pixel-faithful to the `3a` flyout. Hands-off
**dogfood** build. (Charter: `CLAUDE.md`. Plan: `IMPLEMENTATION_PLAN.md`. Spine: `VERIFICATION_SPINE.md`.)

## ✅ Stage 3a (static pixel-faithful `3a` UI) is DONE, reviewed, verified, and **T3-signed-off by Luca**. Next stop: **Stage 3b — wire the UI to the state engine over IPC.**
Stage 3a recreated the `3a` tray flyout **pixel-faithfully as a pure static render**, BEFORE any
engine wiring. Built renderer-only; both review-panel lenses ran SOUND; fidelity verified against the
actual `3a` prototype (rendered via its own DC runtime as ground truth); **Luca gave the pixel
sign-off (T3) and approved proceeding to 3b.** Committed + pushed with this handoff.

## What this session accomplished
Built the entire `3a` flyout as pure React components under `src/renderer/src/flyout/`, driven by a
fixture `StateSnapshot` (the exact shape the engine's `getState()` returns) — NOT wired to the engine.

- **Components** (`src/renderer/src/flyout/`): `Flyout.tsx` (panel: title bar, session line, ACTIVE/
  PAUSED sections, footer, inset panels), `ActiveCard.tsx`, `PausedRow.tsx`, `Composer.tsx` (3-field,
  now a `<form>` → Enter submits / Esc cancels), `FilterControl.tsx` + `filter.ts` (Assignee +
  Task-status, view-only), `Icon.tsx` (Material Symbols; `aria-hidden` + `translate="no"`).
- **Helpers**: `format.ts` (`fmtHMS`/`fmtShort`/`fmtHM` + `cardGradient`/`shade`/`rgba`/`softTint`/
  `ringTint` — mirror the prototype's `renderVals` math exactly; input is **ms** → `Math.floor(ms/1000)`).
  `fixtures.ts` (three scenarios: `populated` = the prototype's 5 tasks; `empty`; `long` = 2 active +
  32 paused for scroll, incl. a null-code active card + manual "Untracked" rows + 0-elapsed rows).
- **CSS**: `flyout.css` — every value transcribed from the prototype's inline styles + `<style>` block
  (klpulse/klping keyframes, `.ms-fill`, `.ci`); `@media (prefers-reduced-motion)` freezes the loops
  for deterministic capture. `main.css` trimmed to the base reset (Stage-1 shell rules removed — they
  collided with the flyout's `.titlebar`/`.brand`/`.window-controls`). `main.tsx` imports `flyout.css`.
- **App.tsx**: renders `<Flyout snapshot={getScenario(?scenario=)} initialPanel={?panel=}>`. The
  Stage-1 **smoke self-check effect is preserved** (fonts + node-reach + ping/reportSmoke) so
  `npm run smoke` still passes. `?scenario=populated|empty|long` + `?panel=composer|filter` drive
  deterministic verification captures.
- **Deviations implemented (all pre-agreed, present + correct):** maximize removed (min+close only);
  per-row **×** on PAUSED only (never on active cards); **filter** control; `code` chip hidden when
  null; union session-total (`sessionWorkedMs`, not a per-task sum); "Tasks refreshed Xm ago"; PAUSED
  in the Phase-2 session-desc sort; short elapsed hidden when 0.
- **Two judgment-call additions Luca approved at T3:** (a) muted empty-state text ("No timers running"
  / "No paused tasks"); (b) footer **pinned** below a scrollable `.content` + a transparent shadow
  **gutter** (needed for the long-list scroll + the Phase-4 transparent window).
- **Review panel (2 lenses, autonomous) → both SOUND:** spec-conformance/fidelity confirmed
  value-by-value transcription, no green, all deviations correct, pure `StateSnapshot` render (no
  re-sum/re-sort/interval math in the renderer). Code-quality confirmed formatter math correct under
  adversarial inputs, fixtures consistent, handler signatures already match the real engine. Fixed:
  Icon a11y (systemic), Composer `<form>` + aria-labels, footer `aria-expanded` (was `aria-pressed`),
  1px footer bottom-padding drift, a redundant cast, and a **forward-looking `pausedCount` doc note**
  in `types.ts` (see next section).
- **All gates green:** `npm run typecheck` clean · `npm run lint` clean · `npm run build` clean ·
  `npm run smoke` 5/5.

## Current state
- **Stage 3a complete, verified, T3-signed-off, committed + pushed.** Working tree clean after commit.
- The engine (`src/main/engine/`, Stage 2) is still **not imported** by main/preload/renderer — that
  wiring IS Stage 3b. The 3a UI renders fixtures only.
- Phase 0 GREEN. The next human gate is **Stage 6** (T2, clean-install + reboot). Stage 3b ends on the
  **automated** review-panel gate (no human review).

## Next actions (priority order) — Stage 3b: wire UI ↔ engine over IPC
Read `IMPLEMENTATION_PLAN.md` Phase 3 (Wiring) + `VERIFICATION_SPINE.md` **Stage 3b** first.
1. **Instantiate the engine in `src/main/index.ts`** (`CadenceEngine.create({ dir: app.getPath('userData'), now: Date.now })`) and expose `getState()` + operations over **typed IPC**. Extend the IPC contract in `src/shared/ipc.ts` (start/stop/toggle, addManualTask, removeFromList, getState, subscribe/push-updates). Keep all logic in main; the renderer stays a **pure projection**.
2. **Replace the fixture snapshot** in `App.tsx` with a live `getState()` subscription; wire the
   optional handlers already threaded through `Flyout` (`onPause`→stop, `onPlay`→start, `onRemove`→
   removeFromList, `onAddManual`→addManualTask, `onMinimize`/`onClose`→Phase-4 stubs for now). The
   component prop signatures already match the engine (verified in review).
3. **Add the 1-second display tick** (renderer) that recomputes shown elapsed from the snapshot's
   interval math — display only; do NOT recompute totals/sort in the renderer.
4. **Apply the view-only filter** to the PAUSED list in the renderer. ⚠️ **CRITICAL (locked down in
   `types.ts` `pausedCount` doc):** the filter narrows which rows RENDER, but the pill's "M idle" =
   `snapshot.pausedCount` must stay the **full** paused total (never a filtered `paused.length`).
   Filter must NOT touch the fetch, persistence, or the ACTIVE list (running tasks always shown).
5. **Stage 3b verification** = `/verify` drives start/pause/add/remove/filter over IPC and asserts
   state + ordering; review panel lenses = spec-conformance (pure projection) + edge-cases
   (transitions). Negative assertions: remove only on paused rows; filter view-only; per-task shown ==
   selector value; session total == union selector (no renderer double-count). Ends on the automated
   gate → summary + "start a new session"; auto-`/future-claude` first.

## Open threads / do-not-relitigate (settled)
- **Do NOT re-litigate** the `3a` look — **Luca signed it off (T3)**. The five deviations + the two
  approved additions (empty-state text; pinned footer + gutter) are accepted.
- **`pausedCount` must not shrink under the filter** (see action #4 — the single most important 3b
  correctness point; documented in `src/shared/types.ts`).
- **Phase-4 window sizing:** the transparent window is still 380px (Stage-1 placeholder), so the panel
  shadow gutter clips in the packaged app. Phase 4 sizes the window to **panel(380) + shadow gutter**
  and makes height content-driven with internal PAUSED scroll. (3a's browser captures show the intended
  result; the `.flyout` is pinned at exactly 380px via `flex: none`.)
- Settled earlier and still holding: local event log as source of truth + **no ClickUp push in v0**;
  per-task elapsed = union; `sessionWorkedMs` in ms; `id` as final PAUSED-sort tiebreaker; self-hosted
  fonts; `sandbox:true`; `*.md` in `.prettierignore`.
- **Carry-forwards (not bugs):** `glyph` is carried on every row but intentionally not rendered (the
  `3a` design uses colored attention bars + gradient cards, not glyph squares — it's for tray/future
  use). Composer's `ManualDraft` duplicates the engine's `ManualTaskInput` shape by design (renderer
  must not import from `src/main`). `initialPanel` is a launch-time-only prop (not reactive) — fine.

## Pointers
- **Build root must be local** (laptop C:), not `G:\Other computers\…`. Commands: `npm run dev`
  (electron-vite dev; renderer also reachable in a browser at `http://localhost:5173/` — used for the
  3a captures) · `npm test` (Stage-2 engine gate, 57 tests) · `npm run typecheck` · `npm run lint` ·
  `npm run build` · `npm run smoke` (Stage-1 shell harness).
- **3a UI** lives entirely in `src/renderer/src/flyout/`. It is a **pure render** of a `StateSnapshot`
  — `Flyout` takes `snapshot` + optional operation handlers (all no-ops in 3a; wire them in 3b).
  Verify captures: `?scenario=populated|empty|long` and `?panel=composer|filter`.
- **The engine** (`src/main/engine/`) is pure + injected (`EngineDeps = { dir, now }`); `getState()`
  returns the serializable `StateSnapshot` (active[], paused[], runningCount, pausedCount,
  sessionWorkedMs, sessionStartTs). `src/shared/types.ts` is the shared contract; `src/shared/ipc.ts`
  is the IPC contract to extend in 3b.
- Plan: `IMPLEMENTATION_PLAN.md` (Phase 3 wiring next) · Spine: `VERIFICATION_SPINE.md` (**Stage 3b**,
  soft automated gate) · Charter: `CLAUDE.md`. Doctrine: no human review of routine diffs; mandatory
  autonomous review panel after every non-trivial phase; human gates only at T1/T2/T3; one phase = one
  bounded session; auto-`/future-claude` before every handoff.
- Design source (reference only now — 3a is signed off): `TimeTracker-handoff/.../Cadence Tracker.dc.html`
  section `#3a` + `design_handoff_cadence_tracker/README.md`. Tokens in `src/renderer/src/assets/tokens.css`.
  **No green anywhere — success is blue.**
- GitHub: `https://github.com/LucaChech/time_tracker` (PUBLIC, `main`, `origin`). gh authed as `LucaChech`.
  Secret hygiene load-bearing (public repo): real `pk_` token only in untracked `.env.local`.
- ClickUp (Phase 5, later): base `https://api.clickup.com/api/v2`; header `Authorization: <pk_token>`
  (**no `Bearer`**); workspace id `90121836206`; Free plan → `custom_id` null, lists have no API color.
