# Handoff — for the next Claude session
*Written: 2026-06-30 (late evening). Single rolling handoff — overwrites the prior one; reflects current state.*

## Overall goal (anchor)
Build **Cadence** — a Windows 11 system-tray time tracker whose differentiator is tracking multiple
tasks **in parallel**; ClickUp read-only, local-first, pixel-faithful to the `3a` flyout. Hands-off
**dogfood** build. (Charter: `CLAUDE.md`. Plan: `IMPLEMENTATION_PLAN.md`. Spine: `VERIFICATION_SPINE.md`.)

## ✅ Stage 1 is DONE, verified, committed, and pushed. Next stop: **Stage 2 — the state engine.**
The G:-drive blocker from the previous handoff is **resolved**: this session ran on the laptop's
**local NTFS path** `C:\Projects\AiConsultancy\time_tracker`, where `npm install` + build + smoke all
work. (Never run installs from the `G:\Other computers\…` Drive sync view — it can't complete npm's
cleanup.) No action needed on that anymore.

## What this session accomplished
Took the hand-written Stage-1 scaffold from "written, unproven" to **verified green + hardened + pushed**.

- **`npm install`** completed (592 pkgs, 0 vulns; postinstall `electron-builder install-app-deps` is a
  clean no-op — no native deps). **`package-lock.json` generated and committed** → the toolchain pin is
  now real in git.
- **All verification gates pass:**
  - `npm run typecheck` — clean. **Fix:** added the missing `@shared/*` path mapping to
    `tsconfig.node.json` (it was only in `tsconfig.web.json`, so main/preload couldn't resolve
    `@shared/ipc`).
  - `npm run lint` — clean. **Fix:** added `TimeTracker-handoff/**` to the ignore lists in
    `eslint.config.mjs` **and** `.prettierignore` (the vendored design prototype was generating 114
    errors / ~967 warnings of noise; our own `src/` had only 8 auto-fixable formatting nits, now
    formatted).
  - `npm run build` — `out/` produced; **zero CDN refs** in `out/renderer` (fonts fully self-hosted).
  - `npm run smoke` — **5/5 PASS** (no renderer errors · renderer can't reach node · all 3 fonts
    loaded · ping→pong · exit 0). Eyeballed `%TEMP%/cadence-smoke/smoke.png`: rounded corners, **no
    black corners**, ambient shadow, Space Grotesk + Work Sans + Material Symbols all render, blue
    accent (no green). Typed IPC populated the version rows.
  - **Smoke fix:** `src/renderer/src/App.tsx` now `document.fonts.load(\`16px "<family>"\`)`s each
    family **before** `document.fonts.check`. The shell never renders Space Grotesk at weight 400, so
    that lazy face was never fetched → the old check falsely reported it unloaded.
- **Ran the mandatory review panel** (two lenses, per the spine's Stage-1 profile):
  - **Security lens:** verdict *sound* — all four hard requirements pass (contextIsolation/
    nodeIntegration:false/sandbox:true; minimal typed contextBridge; strict CSP no external origins;
    secret hygiene). Only Low/Nit hardening findings.
  - **Spec-conformance lens:** verdict *sound* — pinned matrix (not latest majors), self-hosted fonts,
    **no green** (success in blue), no ClickUp-write code, correct window flags, all scripts present;
    all 4 deliberate Phase-1 interim deviations confirmed intentional (not drift).
  - **Applied the substantive hardening fixes** (skipped pure nits per soft gate + "stop on nits"):
    - `src/main/index.ts`: `shell.openExternal` now gated to **http(s) only** via `isSafeExternalUrl`;
      added a **`will-navigate`** guard that blocks any cross-origin top-frame navigation.
    - `src/renderer/index.html` CSP: added `base-uri 'self'; object-src 'none'; form-action 'self'`.
      (Tried `frame-ancestors 'none'` too — the smoke caught that it's **ignored via `<meta>`** and
      logs a console error, so it was removed. Good catch by the gate.)
    - `electron-builder.yml`: removed the template's placeholder `publish:` block (generic provider →
      `example.com`) so no attacker-pointable auto-update channel can ship; left an explanatory comment.
  - Re-ran all gates after the fixes → still **green** (typecheck/lint/build/smoke 5/5).
- **Committed + pushed:** commit `6969ee1` "Stage 1: install, verify, and harden the app shell" →
  `origin/main` (`8272b3e..6969ee1`). Working tree clean, in sync with remote.

## Current state
- **Stage 1 complete.** Repo `LucaChech/time_tracker` (PUBLIC, `main`, `origin`) is at `6969ee1`,
  clean. `node_modules/` + `out/` present locally (gitignored). `package-lock.json` tracked.
  `.env.local` present, gitignored, untracked — secret hygiene intact (no real `pk_` token in any
  tracked file; the only `pk_` hits are doc prose).
- **Verification is real**, not assumed: typecheck + lint + build + smoke + visual + 2-lens review all
  passed this session.
- Phase 0 remains GREEN. No human gate (T1/T2/T3) is due.

## Next actions (priority order) — Stage 2: the state engine (Phase 2)
**This is the riskiest stage** (`VERIFICATION_SPINE.md` Stage 2): the whole app is a projection of this
logic, so a silent bug makes every later "it works" untrustworthy. It's pure, injected-dependency logic.
1. Read `IMPLEMENTATION_PLAN.md` Phase 2 + `VERIFICATION_SPINE.md` Stage 2 first. Build the append-only
   **event log** (`start`/`stop`/`heartbeat` = ts + taskId + source) as source of truth; derive current
   state + elapsed by replay. Elapsed = `Σ(stop−start)` closed intervals `+ (now−start)` open; clamp
   deltas `≥ 0`; **session total / tray tooltip = wall-clock UNION** of run-intervals (parallel overlaps
   don't double-count — 3×1h parallel = 1h).
2. **Write Vitest fixtures = the gate (hard, automated).** Cover the plan's acceptance set **plus the
   spine's `missing_checks`** that the plan omits: exactly-touching intervals (`stopA==startB`) merge to
   one (no double-count, no phantom gap); zero-length interval contributes 0; corrupt log line
   (start w/o stop / stop w/o start) never `NaN`; open interval whose `start < sessionStartTs` counts
   session elapsed only from `sessionStartTs`; 5-key PAUSED sort deterministic+stable at ~250 tasks with
   name final tiebreak; idempotent start/stop; new-session reset; catalogue-absent task still renders.
3. After it's green: run the **review panel** (lens=edge-cases interval/union math, lens=spec-conformance),
   fix, re-verify. Then **commit + push**, auto-`/future-claude`, end with a short non-technical summary.
4. Add `tasks-store.json` metadata snapshotting only if Phase 2 scope calls for it (check the plan) —
   otherwise it's later.

## Open threads / blockers / waiting-on-user
- **No blockers.** Build on the **laptop's local C: path** (never the G: Drive sync view).
- **Do NOT re-litigate** (settled): the pinned version matrix; Fontsource self-hosted fonts; `sandbox:true`;
  tracking `build/` (it holds source icons; outputs `out/`+`dist/`+`release/` are ignored); the
  smoke-harness design; window shown in dev/smoke but hidden in prod until the Phase-4 tray; local event
  log as source of truth + **no ClickUp push in v0**.
- **Known deliberate Phase-1 interim deviations** (not bugs, addressed in later phases): fixed placeholder
  window height (380×600 — content-fit is Phase 4); window controls are visual-only (wired Phase 4); prod
  launches hidden with no tray (tray is Phase 4); Material Symbols ships the full font (not subset).
- **Deferred nits from the review** (fine to leave; revisit when relevant): cross-platform mac/Linux build
  config + `build:mac`/`build:linux` scripts are template cruft on a Windows-only project (trim at Phase 6
  packaging); `.gitignore` has `!.env.example` but no `.env.example` exists (add one documenting
  `CLICKUP_TOKEN=` at Phase 5); CSP keeps `style-src 'unsafe-inline'` (needed for React inline styles).
- **Human touchpoints still ahead** (unchanged): Stage 3a pixel sign-off (T3); Stage 6 clean-install +
  reboot (T2). None due now.

## Pointers
- **Build root must be local** (laptop C:), not `G:\Other computers\…`. Commands: `npm run dev` (live),
  `npm run build`, `npm run typecheck`, `npm run lint`, `npm run smoke` (built app + asserts + writes
  `%TEMP%/cadence-smoke/smoke.png` + `smoke-result.json`).
- Plan: `IMPLEMENTATION_PLAN.md` (Phase 2 next) · Spine: `VERIFICATION_SPINE.md` (Stage 2, hard gate) ·
  Charter: `CLAUDE.md`. Doctrine: no human review of routine diffs; mandatory review panel after every
  non-trivial phase; human gates only at T1/T2/T3; one phase = one bounded session; auto-`/future-claude`
  before every handoff.
- IPC contract lives in `src/shared/ipc.ts` (single source of truth) — Stage 2 will extend it as the
  renderer needs state/elapsed.
- Design (build the **`3a`** panel in Phase 3, not in Stage 2):
  `TimeTracker-handoff/timetracker/project/design_handoff_cadence_tracker/README.md` +
  `Cadence Tracker.dc.html`; tokens already ported to `src/renderer/src/assets/tokens.css`.
  **No green anywhere — success is blue.**
- GitHub: `https://github.com/LucaChech/time_tracker` (PUBLIC, `main`, `origin`, at `6969ee1`). gh authed
  as `LucaChech`.
- ClickUp (Phase 5, later): base `https://api.clickup.com/api/v2`; header `Authorization: <pk_token>`
  (**no `Bearer`**); token in `.env.local` (untracked); workspace id `90121836206`; Free plan →
  `custom_id` null, lists have no API color. When ClickUp READ lands: keep all network in the **main**
  process (so CSP `connect-src` only needs `api.clickup.com` added there), and treat every ClickUp string
  as untrusted before rendering.
