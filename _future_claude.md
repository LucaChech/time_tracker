# Handoff — for the next Claude session
*Written: 2026-06-30 (evening), after writing the full Stage 1 scaffold but BEFORE install/verify.
Single rolling handoff — overwrites the prior one; reflects current state.*

## ⚠️ READ FIRST — run the next session ON THE LAPTOP, not this synced view
This session ran against `G:\Other computers\Laptop\Projects\AiConsultancy\time_tracker`, which is the
**Google Drive "Other computers" sync view** of the laptop's folder — **not a local disk**. `npm install`
**cannot complete here**: it fails every time with `EBADF` / `EPERM` during npm's cleanup phase because
Google Drive holds file locks over the thousands of `node_modules` files (and Drive can't host reparse
points, so a `node_modules` junction is impossible either). Proven by contrast: the identical install
ran cleanly in a **local** C:\ temp dir (70 pkgs, 23 s) but rolls back to nothing on G:.

**→ The next session must run on the actual laptop, where this folder is a LOCAL NTFS path** (e.g.
`C:\…\Projects\AiConsultancy\time_tracker`). There, `npm install` + build + the GUI smoke all work.
All the scaffold files written this session live on G: and **sync up to the laptop via Drive** — so
**before starting the laptop session, let Google Drive finish syncing** so every file below is present.
Do **not** attempt `npm install` from this "Other computers" view again.

## Overall goal (anchor)
Build **Cadence** — a Windows 11 system-tray time tracker whose differentiator is tracking multiple
tasks **in parallel**; ClickUp read-only, local-first, pixel-faithful to the `3a` flyout. Hands-off
**dogfood** build. (Charter: `CLAUDE.md`. Plan: `IMPLEMENTATION_PLAN.md`. Spine: `VERIFICATION_SPINE.md`.)
We are executing **Stage 1 — project scaffold & app shell**.

## What this session accomplished
**Wrote the entire Stage 1 scaffold by hand** (the official `npm create @quick-start/electron` CLI needs
a TTY and won't take piped input; so I extracted its `base` + `react-ts` template from the npm tarball and
reproduced it faithfully, then customized). **No `npm install` / build / verification has run yet** — that
is the next session's job (on the laptop). Files created/edited under the project root:

- **`package.json`** — name `cadence`; pinned to the scaffold's **tested** matrix (NOT absolute-latest
  majors): `electron ^39.2.6`, `electron-vite ^5.0.0`, `vite ^7.2.6`, `@vitejs/plugin-react ^5.1.1`,
  `typescript ^5.9.3`, `react ^19.2.1`, `electron-builder ^26.0.12`, eslint 9 + electron-toolkit configs,
  prettier 3. Added deps: `@fontsource/space-grotesk ^5.2.10`, `@fontsource/work-sans ^5.2.8`,
  `material-symbols ^0.45.4`, `@electron-toolkit/utils ^4.0.0`. Scripts: template's + a custom `smoke`.
  (Dropped `@electron-toolkit/preload` — we use a custom preload under `sandbox:true`.)
- **`electron.vite.config.ts`** — main/preload/renderer; `@renderer` + `@shared` aliases; react plugin.
- **`electron-builder.yml`** — `appId com.lucachech.cadence`, `productName Cadence`, win `executableName
  Cadence`; excludes docs/scripts/secrets from the package. (Packaging itself is Phase 6.)
- **`tsconfig.json` / `tsconfig.node.json` / `tsconfig.web.json`** — extend `@electron-toolkit/tsconfig`
  (strict). Added `src/shared/**` to both projects + `@shared/*` path.
- **`eslint.config.mjs`** — template's flat config; ignores `out/ dist/ release/ scripts/`.
- **`.editorconfig`, `.prettierrc.yaml`, `.prettierignore`, `.vscode/*`** — copied from the template base.
- **`build/`** (icon.ico/png/icns + entitlements) + **`resources/icon.png`** — **placeholder** icons from
  the template base (real icon later, per plan P0.2).
- **`src/shared/ipc.ts`** — single source of truth for IPC: `IpcChannels`, `AppInfo`, `SmokeReport`,
  `CadenceApi`. Stage-1 surface is tiny (ping, getAppInfo, smoke report).
- **`src/main/index.ts`** — the flyout window + security + IPC + smoke harness. Window: `width 380`,
  `height 600` (placeholder — content-fit + tray positioning are Phase 4), `frame:false`,
  `transparent:true`, `backgroundColor:'#00000000'`, `resizable:false`, `hasShadow:false`,
  `roundedCorners:false`, `skipTaskbar:true`, `alwaysOnTop:true`. `webPreferences`:
  `contextIsolation:true`, `nodeIntegration:false`, **`sandbox:true`**. Shows on `ready-to-show` only when
  `is.dev` or smoke (prod stays hidden until the Phase-4 tray reveals it). Captures renderer
  `console-message`(level `error`)/`preload-error`/`render-process-gone` for the smoke gate.
- **`src/preload/index.ts`** + **`index.d.ts`** — typed `contextBridge` exposing `window.cadence`
  (`ping`, `getAppInfo`, `reportSmoke`) using only `electron`'s `contextBridge`+`ipcRenderer` (sandbox-safe).
- **`src/renderer/index.html`** — strict CSP, **no external origins** (`default-src 'self'`; `font-src
  'self' data:`; etc.), title "Cadence".
- **`src/renderer/src/main.tsx`** — imports the **self-hosted** fonts (Fontsource `400/500/600(/700)` +
  `material-symbols/outlined.css`) + `tokens.css` + `main.css`, renders `<App/>` in StrictMode.
- **`src/renderer/src/App.tsx`** — Stage-1 shell (title bar with brand mark + window-control placeholders;
  body shows app/runtime versions via `getAppInfo`). Runs the smoke self-check (node-reach `typeof`s,
  `document.fonts.check` for all 3 families, `ping`) → `window.cadence.reportSmoke(...)`.
- **`src/renderer/src/assets/tokens.css`** — "Kinetic Logic" design tokens ported locally (no CDN link).
- **`src/renderer/src/assets/main.css`** — shell styles: transparent body, 16px-radius panel with the
  ambient CSS shadow (this is what proves **no black corners**), title bar, body, Material-Symbols base.
- **`src/renderer/src/env.d.ts`** — `vite/client` types.
- **`scripts/smoke.mjs`** — launch smoke orchestrator: spawns the built app under `CADENCE_SMOKE=1`,
  waits for the renderer self-report, asserts (no renderer errors · node-unreachable · fonts loaded ·
  ping→pong · exit 0), writes `smoke.png` + `smoke-result.json` to `%TEMP%/cadence-smoke`.
- **`.gitignore`** — EDITED: removed `build/` from the ignore list (in this stack `build/` holds **tracked**
  source icon resources; outputs are `out/` + `dist/` + `release/`, all still ignored) and added
  `.eslintcache`. Left a clarifying comment.

**Verified along the way (so the next session need not redo):**
- Toolchain versions confirmed against npm (Stage-1 precondition): the scaffold's pinned matrix above is
  the mutually-tested set; absolute-latest majors (electron 43 / TS 6 / vite 8 / plugin-react 6) were
  deliberately **not** chosen. Node 24.13.1 satisfies electron-vite's engine.
- **Electron's 210 MB binary downloads fine via npm** (proven in a local temp install) — the GitHub
  binary fetch is NOT blocked here; only `node_modules` churn on the synced drive is.
- Fonts: `@fontsource/space-grotesk/{400,500,600,700}.css` → family `'Space Grotesk'`;
  `@fontsource/work-sans/{400,500,600}.css` → `'Work Sans'`; `material-symbols/outlined.css` →
  `'Material Symbols Outlined'` + `.material-symbols-outlined`. All bundle local woff2 (offline, no CDN).
  Weights chosen to match the `3a` prototype.
- Electron 39 `console-message` event = single **details object** with `level` as a **string**
  (`'error'` etc.) — main uses `details.level === 'error'`.

## Current state
- **All Stage-1 source written and on G: (syncing to the laptop). Everything is UNTRACKED/uncommitted.**
  `node_modules` absent (cleaned up); no lockfile yet (couldn't generate — install never completed); no
  junction left behind (G: rejected it).
- **Nothing is verified**: no typecheck, no lint, no build, no smoke has run. Treat the code as
  "written, plausibly correct, unproven."
- Phase 0 remains GREEN (token + workspace + Node confirmed last session). Repo is the PUBLIC
  `LucaChech/time_tracker` (`main`, `origin`); `.env.local` gitignored & 404 on remote.

## Next actions (priority order) — run from a **laptop-local** session, rooted in time_tracker
1. **`npm install`** (will also run `electron-builder install-app-deps` via postinstall — a quick no-op,
   no native deps). Then **commit the generated `package-lock.json`** (plan: pin the toolchain).
2. **Run the Stage-1 acceptance + the spine's missing-checks**, fixing as needed:
   - `npm run typecheck` (tsc --noEmit, node + web) — **watch these likely-fragile spots** and adjust if
     tsc complains: the `console-message` handler typing (`details.level`); `import { … type JSX } from
     'react'` (React 19); the `@shared` alias resolution; `?asset` import in main.
   - `npm run lint` (eslint) — should be clean; fix any nits.
   - `npm run build` (electron-vite build → `out/`) — must succeed = the "runnable package" acceptance.
   - `npm run smoke` — launches the built app (a GUI window briefly appears on the laptop), asserts:
     **no renderer console errors · renderer can't reach node (all `typeof` undefined) · all 3 fonts
     loaded · ping→pong · exit 0**. Then **Read `%TEMP%/cadence-smoke/smoke.png`** to eyeball that the
     panel renders with **rounded corners, no black corners**, and the fonts/icon look right.
   - **Negative checks (spine Stage 1):** `git status`/`git check-ignore .env.local` shows it untracked
     (it is — but confirm after install); the smoke already proves node-unreachable + offline fonts.
     Optionally grep the built `out/renderer` for any `https://fonts.` / CDN URL → must be **zero**.
   - **Watch-outs to resolve if they bite:** if a **`preload-error`** shows at runtime, `sandbox:true`
     may not like the bundled preload → fall back to `sandbox:false` (still secure via
     contextIsolation+nodeIntegration:false) and re-verify. If **CSP blocks fonts** under `file://`
     (you'll see it in the smoke's captured console errors), relax `font-src` minimally.
3. **Run the review panel** (security + spec-conformance lenses per the spine; `/code-review high` inside
   it), fix findings, re-review until clean.
4. **Commit + push** the scaffold (+ lockfile) to `origin/main`. Then **auto-`/future-claude`** and end
   with a short non-technical summary + "start a new session" (Stage 2 = the state engine, the riskiest).

## Open threads / blockers / waiting-on-user
- **The G:-drive blocker is the headline** — see the top banner. Build on the laptop's local copy; never
  on the "Other computers" sync view. (If the laptop ever can't be used, the fallback is a local C: build
  mirror, but the laptop is the clean path.)
- **Do NOT re-litigate:** the pinned version matrix; Fontsource (over hand-downloaded woff2 — raw curl is
  network-blocked here anyway, npm is the only egress); `sandbox:true` as the starting posture; tracking
  `build/` (gitignore edit); the smoke-harness design; the window being shown in dev/smoke but hidden in
  prod until Phase 4.
- **Deliberate Phase-1 interim deviations to keep in mind (not bugs):** window height is a fixed
  placeholder (content-fit is Phase 4); window controls are visual-only (wired Phase 4); prod launches
  hidden with no tray yet (tray is Phase 4) — so a packaged Stage-1 build shows nothing until dev/smoke.
- **Secret hygiene still load-bearing** (public repo): `.env.local` stays gitignored; never `add -f`.
- **Human touchpoints still ahead** (unchanged): Stage 3a pixel sign-off (T3), Stage 6 clean-install +
  reboot (T2). None due now.

## Pointers
- **Build root must be local** (laptop), not `G:\Other computers\…`. All paths below are relative to the
  project root regardless of where it's mounted.
- Plan: `IMPLEMENTATION_PLAN.md` (Phase 1) · Spine: `VERIFICATION_SPINE.md` (Stage 1) · Charter: `CLAUDE.md`.
- Design (build the **`3a`** panel in Phase 3, not now):
  `TimeTracker-handoff/timetracker/project/design_handoff_cadence_tracker/README.md` +
  `Cadence Tracker.dc.html`; tokens already ported to `src/renderer/src/assets/tokens.css`.
  **No green anywhere — success is blue.**
- GitHub: `https://github.com/LucaChech/time_tracker` (PUBLIC, `main`, `origin`). gh authed as `LucaChech`.
- ClickUp (Phase 5, later): base `https://api.clickup.com/api/v2`; header `Authorization: <pk_token>`
  (**no `Bearer`**); token in `.env.local` (untracked); workspace id `90121836206`; 2 spaces / 5 lists /
  5 open tasks (all in *Automations*); Free plan → `custom_id` null, lists have no API color.
- Doctrine governing the build (settled): no human review of routine diffs; mandatory autonomous review
  panel after every non-trivial phase; human gates only at T1/T2/T3; one phase = one bounded session;
  auto-`/future-claude` before every handoff.
