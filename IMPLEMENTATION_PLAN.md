# Cadence — Implementation Plan (v0)

*Drafted 2026-06-30. Target: the `3a` "Final" tray-flyout design, local-first, ClickUp read-only.*
*Hardened via two review passes (technical correctness + functional/behaviour); all product
decisions below are settled with Luca. This plan is written to be chunked into verified phases by
`/verify-plan` and then executed hands-off. **Every human-only input is front-loaded into Phase 0**
so that, once Phase 0 is satisfied, the build runs to completion with no further back-and-forth.*

## Verified ClickUp facts that shape this plan (target = Luca's Free-plan workspace, 2026-06-30)
- **Lists do NOT return a `color` via the API** (only statuses carry colors) → per-task card color is
  a **deterministic local palette** hashed by list-id, not from ClickUp.
- **Custom Task IDs (`CU-482`) require Business+** and are **null on this workspace** → the `code`
  chip shows `custom_id` only when present, otherwise hidden. ("CU-482" is mock data.)
- **Auth:** personal `pk_` token in the `Authorization` header, **no `Bearer` prefix**.
- **Get Tasks excludes subtasks + closed/archived by default** (`subtasks`, `include_closed`,
  `archived` params). Pagination 100/page.
- **Rate limit is tier-based**; 100 req/min is the Free floor — build to it.
- **"Tasks in Multiple Lists"** → one task id can appear under several lists → must dedupe.

---

## Scope recap

**In:** Windows 11 system-tray flyout; ClickUp read (ALL open tasks + subtasks across all
spaces/lists → task list + breadcrumbs); unlimited parallel local timers; manual/ad-hoc tasks;
in-panel filter + per-row remove; local append-only persistence; pixel-faithful `3a` UI.

**Out (v0):** ClickUp push/write-back (single-live-timer constraint — `CLAUDE.md`); a separate
task-management screen / session-confirm onboarding; full idle detection; daily/weekly summaries;
presence layer; output metric; permanent delete / rename of tasks. Architecture stays push-ready but
ships no push.

**Stack:** Electron + React + TypeScript + Vite (electron-vite), packaged with electron-builder.

**Conflict rule:** where the handoff README text and the `3a` prototype disagree, **the `3a`
prototype wins** — except the deliberate v0 deviations listed in Phase 3.

**Session model (central — read first):** a **"session" = one app run** (launch → Quit).
Minimise-to-tray keeps the session alive; only Quit ends it. On each launch a **new session** starts:
per-task session timers and the session total reset to 0, the catalogue is refetched, and
session-removed rows reappear. The append-only event log persists **across** sessions purely as
**history** — there is **no UI restore of totals after reboot**.

---

## Phase 0 — Prerequisites (HUMAN-ONLY; gather before any build starts)

> The build cannot self-serve these. Everything else has a sensible default. Goal: Luca provides the
> items below **once**, then walks away.

**P0.1 — ClickUp personal API token (the one true blocker).**
- ClickUp → avatar → **Settings → Apps → API Token → Generate**. Token begins with `pk_`.
- Paste into an **untracked** root file `.env.local`: `CLICKUP_TOKEN=pk_xxx` (gitignored in Phase 1).
- Used by (a) the builder to self-verify Phase 5 against real data and (b) the running app. The
  shipped app reads from local config; an in-app token field (encrypted) is built in Phase 5.

**P0.2 — Confirmations with defaults (builder proceeds on the default unless Luca overrides via
`.env.local` / `cadence.config.json`):**
| Item | Default the builder will use |
|---|---|
| ClickUp scope | **All authorized workspaces, all spaces, all lists; open tasks + subtasks** (exclude closed/archived) |
| "Current session" | **One app run** — resets each launch (see session model) |
| Start on Windows login | **On** (always-resident tray app) |
| Close (`×`) behavior | **Minimize to tray** (not quit); Quit only from the tray menu |
| `maximize` window control | **Removed** (meaningless on a fixed-width flyout) |
| Worklog + config location | Electron `app.getPath('userData')` |
| App icon | Placeholder (blue rounded square + `timer` glyph); real icon later |
| Token storage in shipped app | OS-encrypted via Electron `safeStorage` (DPAPI) |

**P0.3 — Build environment:** Node.js LTS + npm; Windows build host (electron-builder → NSIS +
portable). Verify present, else document the install step.

**Phase 0 acceptance (machine-checkable):** a scripted `GET /api/v2/user` with the `.env.local` token
returns 200; Node LTS available. → green-light autonomous execution of 1–6.

---

## Phase 1 — Project scaffold & app shell

**Deliverables**
- Scaffold via the official electron-vite starter (`npm create @quick-start/electron`), React + TS +
  strict mode, ESLint + Prettier. **Pin the toolchain: commit the lockfile and do not bump
  Electron / Vite / electron-vite / electron-builder majors during the build.**
- A single **frameless, transparent, always-on-top** `BrowserWindow`, 380px wide, height fits
  content (with internal scroll for a long PAUSED list), `skipTaskbar: true`, hidden on launch
  (tray-driven). For correct rounded-corner + shadow rendering on Windows: `transparent: true`,
  `backgroundColor: '#00000000'`, `resizable: false`, `hasShadow: false`; verify no black corners.
- Security: `contextIsolation: true`, `nodeIntegration: false`; typed IPC via a `contextBridge`
  preload (`window.cadence.*`).
- `.gitignore` (node_modules, dist, `.env.local`, packaged output, userData artifacts).
- Self-hosted **Space Grotesk**, **Work Sans**, **Material Symbols Outlined** (bundled, no runtime CDN).

**Acceptance (machine-checkable):** `npm run build` produces a runnable package; lint + `tsc
--noEmit` clean; an automated launch test opens the window without console errors.

---

## Phase 2 — State engine (core; UI-independent, unit-tested with Vitest)

Built and tested **before** the UI. The engine is a **pure module with injected dependencies** —
`now()` and the storage directory are parameters — so interval math and persistence are
deterministically testable.

**Data model** (`src/shared/types.ts`)
- `Task = { id, name, space, list, code: string | null, color, glyph, source: 'clickup' | 'manual' }`
  (`code` null unless ClickUp returns `custom_id`).
- Event line (JSONL): `{ ts: epoch-ms, taskId: string | null, action: 'start' | 'stop' | 'heartbeat' }`
  (`heartbeat` is global → `taskId: null`).
- A **session** is bounded by a `sessionStartTs` captured at launch (used to scope UI selectors).

**Persistence** (`app.getPath('userData')`)
- `worklog.jsonl` — append-only `start`/`stop`/`heartbeat` events for **all** task ids, kept
  **across sessions** as history.
- `tasks-store.json` — metadata snapshot for **every task that is manual OR has ever received a
  `start`** (upserted on manual-add, on each `start`, **and on each catalogue refresh**). Lets a
  tracked ClickUp task that later leaves the catalogue still render with its name/space/list/color.
- `clickup-cache.json` — last good full ClickUp catalogue (fast launch + offline display).
- Session-only state (in memory, reset each launch): `sessionStartTs`, the **removed-set** (ids
  hidden this session), filter state, composer state.

**Derivation logic** (pure functions, unit-tested)
- Replay `worklog.jsonl` → per task: ordered intervals; `running` iff the last `start`/`stop` event
  is `start`. `heartbeat` events ignored for running-state.
- **Per-task session elapsed** = `Σ(stop − start)` over the task's intervals **with `ts ≥
  sessionStartTs`** `+ (now − start)` for an open one. **Per-task all-time elapsed** = same over the
  whole log (used only as a ranking tiebreaker). **Clamp every interval delta to `≥ 0`** (defends
  against NTP/manual clock steps).
- **Session total = wall-clock UNION** of all tasks' run-intervals this session — i.e. the total
  time during which `runningCount ≥ 1` (merge overlapping intervals across tasks, sum the union).
  Parallel overlaps do **not** double-count: 3 tasks × 1h in parallel ⇒ **1h**. Meaning: "how long I
  worked this session." The tray tooltip shows this **same** number.
- Selectors: `running`, `paused`, `runningCount`, `pausedCount`, `sessionWorkedSeconds`, plus the two
  per-task elapsed values.

**Ordering selectors** (the agreed single sort — no separate zones)
- **ACTIVE:** most-recently-started first.
- **PAUSED:** sort key, descending priority — (1) session elapsed **desc**, (2) all-time elapsed
  **desc**, (3) Space **asc**, (4) List **asc**, (5) name **asc**. Effect: tasks worked this session
  float to the top, then tasks worked in earlier sessions, then the untouched catalogue naturally
  grouped by Space → List. PAUSED **excludes** running tasks and **excludes** session-removed ids.

**Operations** (each appends an event, then re-derives; metadata upserted to `tasks-store.json`)
- `start(taskId)` / `stop(taskId)` — **idempotent** (`start` is a no-op if already running; `stop` a
  no-op if already stopped). `toggle(taskId)` is the UI affordance. **No concurrency limit.**
- `addManualTask({name, space?, list?})` — id = `crypto.randomUUID()`; color/glyph cycled through
  `['#c64f00','#4b3fb0','#0091b3','#fe9400']` / `['edit_note','draw','task_alt','bolt']`; created
  **paused**, `source:'manual'`, `code:null`; defaults per the `3a` prototype: `space:'Untracked'`,
  `list:'Untracked'`.
- `removeFromList(taskId)` — adds the id to the **session removed-set** (hidden until next launch).
  **Exposed in the UI only on PAUSED rows** (pause a running task before removing); applies equally
  to manual + ClickUp tasks. No permanent delete in v0 (a mistyped manual task reappears next session
  — accepted). A removed task is hidden from PAUSED, so it can never be re-started → it never
  re-enters ACTIVE; no ACTIVE/removed-set interaction is needed.

**Restart / sleep / lock / crash semantics**
- **Graceful Quit:** append `stop` for every running task.
- **System sleep (`powerMonitor` `suspend`) and screen lock (`lock-screen`):** append `stop` for all
  running tasks (auto-pause guard against forgotten/away timers — **included in v0**); on
  `resume`/`unlock` they stay paused.
- **Crash hygiene:** open intervals from a previous run are closed in the log at `max(ts)` across all
  events (incl. heartbeats) — keeps history clean, no phantom time. A heartbeat writer (~30s, Phase
  6) bounds the tail.
- **Every launch is a new session:** all tasks start **paused** with 0 session-elapsed — **timers
  never auto-resume** (confirmed). Awake-and-unlocked over-count is accepted for v0.

**Display tick:** a 1-second renderer tick recomputes shown elapsed from interval math (display only).

**Acceptance (Vitest, machine-checkable):** parallel start/stop → correct independent per-task
session elapsed; **session union total = 1h for the 3×1h-parallel fixture**; toggle moves a task
ACTIVE↔PAUSED; idempotent start/stop; PAUSED sort matches the 5-key fixture; removed id disappears
from selectors and reappears after a simulated relaunch (removed-set cleared); manual add persists
across relaunch; new-session reset zeroes session elapsed while the log retains history; clock-step
never yields negative elapsed; a catalogue-absent task still renders from `tasks-store.json`.

---

## Phase 3 — UI: recreate the `3a` flyout (pixel-faithful), wired to state

Two sections only — **ACTIVE** and **PAUSED** — exactly as the handoff. Everything fetched and
untouched lives in PAUSED; start → moves to ACTIVE; stop → back to PAUSED (re-sorted).

**Components**
- **Title bar** (44px): app mark + "Cadence"; window controls — **minimize + close only**
  (`open_in_full`/maximize removed). Close hovers red `#c0504c`; minimize `rgba(0,0,0,.06)`; hairline.
- **Current-session line:** "Current session" + **session total** `Xh YYm` (no seconds, tabular,
  wall-clock union per Phase 2) left; **live·idle pill** (`● N live · M idle`; N = `runningCount`,
  M idle = `pausedCount` = **all** paused tasks — intentionally can be large, e.g. "247 idle") right.
- **ACTIVE → active task cards:** 16px-radius, `135°` gradient from palette color to its `×0.68`
  shade, soft shadow; breadcrumb pill (`folder_open` + Space) → chevron → List; task title; pinging
  white dot; big `HH:MM:SS` = **this task's session elapsed** + **`code` chip only when `code !=
  null`**; white **Pause** pill. **No remove (×) on active cards** — remove lives only on paused rows.
- **PAUSED → paused rows** (scrollable; sorted per Phase 2): colored attention bar; name + `Space ·
  List` subtitle; this-session short elapsed (`Xh YYm` / `Mm SSs`; **hidden when 0** to keep the
  untouched tail clean); round outlined **Play** button; **remove (×)** (the only place remove appears
— pause a running task before you can remove it).
- **Filter control** (the one new affordance `3a` lacks; minimal, not a new screen): toggles for
  **Assigned to me** and **Task status** (independent, multi-select status). View-only — narrows the
  PAUSED list; never affects ACTIVE (running tasks always shown), the fetch, or persistence.
- **Manual-task composer** (collapsed; toggled by footer): "NEW UNTRACKED TASK" eyebrow; title input;
  optional space + list inputs; Cancel / **Add** (blue) — the `3a` 3-field variant.
- **Footer:** left = **"Tasks refreshed Xm ago"** (the prototype's "Synced" label replaced — we don't push); right = "Add
  untracked task" (toggles composer). The filter control sits here too (compact).

**Fidelity:** exact colors, radii, spacing, fonts, animations (`klpulse` 1.4s; `klping` 1.6s) from
the prototype + `colors_and_type.css`. **No green.** All times `tabular-nums`.

**Wiring:** components are pure renders of Phase-2 selectors; buttons call Phase-2 operations over
IPC. No business logic in the renderer beyond the display tick.

**v0 UI deviations from pixel-faithful `3a` (only these):** the **filter control**; a **per-row remove
(×)**; `maximize` removed; `code` chip hidden when null; manual `code` = null/hidden (deliberate
exception to "`3a` wins", since a literal "Untracked" code chip is meaningless). *(Backend semantics
— session/union totals, interval math — are Phase-2 specs, not `3a` UI departures.)*

**Acceptance (machine-checkable + one human gate):** an automated Electron smoke test launches the
app, asserts DOM structure + key computed styles (radius, gradient, fonts, no-green), drives
start/pause/add-manual/remove/filter via IPC and asserts state + ordering changes, and screenshot-
diffs the panel against a render of the `3a` prototype within tolerance. **Final pixel sign-off is
the one human-gated check here.**

---

## Phase 4 — Tray & window behavior (the "flyout" feel)

**Deliverables**
- **Tray icon** with **live text/tooltip = the session total** (wall-clock "worked this session"),
  updated each second; tray menu: Show/Hide, Quit (the in-app token entry is added in Phase 5).
  Format tolerates 3-digit hours.
- **Click tray → toggle the flyout**, positioned bottom-right above the Windows taskbar near the tray
  (`screen.getPrimaryDisplay().workArea` + tray `getBounds()`; clamp to the work area for non-bottom
  taskbars).
- Window: frameless, always-on-top, `skipTaskbar`, **hides on blur** — **except disable hide-on-blur
  in dev / when DevTools is focused.**
- **Window controls wired:** minimize → hide to tray; close → hide to tray (**session stays alive**);
  **Quit only via tray** (ends the session, appends stops).
- **Autostart on login** via `app.setLoginItemSettings` (default on; persisted to config).
- **Single-instance lock** — the flyout is hidden by default, so a second launch must **show +
  reposition** the existing flyout, not merely "focus" it.

**Acceptance (machine-checkable + reboot human-gated):** automated test asserts no taskbar button,
tray tooltip reflects the session total, tray click shows the window within the work area, blur hides
it (with the dev exception), second instance shows the existing window. **Autostart-after-reboot is
human-gated.**

---

## Phase 5 — ClickUp READ integration (all spaces/lists)

**Auth & client** (`src/main/clickup.ts`)
- Token from `.env.local` (dev) / `safeStorage`-decrypted config (shipped). Header
  `Authorization: <pk_token>` (**no `Bearer`**). Base `https://api.clickup.com/api/v2`.
- **In-app token field** (encrypted via `safeStorage`), from the tray menu — fresh install needs no
  file editing.
- `GET /user` also yields the **current user id** — required for the "Assigned to me" filter.

**Catalogue fetch — mandated approach: per-list traversal**
1. `GET /user` (auth + user id) → `GET /team` (authorized workspaces).
2. Per team: `GET /team/{id}/space` → per space: `GET /space/{id}/folder` (lists in folders) +
   `GET /space/{id}/list` (folderless lists).
3. Per list: `GET /list/{id}/task?subtasks=true` (open tasks + subtasks; exclude closed/archived;
   paginate `page` until `last_page`, 100/page).
4. **Dedupe by task id** ("Tasks in Multiple Lists"): **first breadcrumb wins**, one row per id.

**Mapping → `Task`**
- `name`, `space` (name), `list` (name).
- `code = task.custom_id ?? null` (chip hidden when null; **do not** use `custom_task_ids`/`team_id` —
  those are lookup-input params, not response toggles).
- `color` = **deterministic local palette keyed by a stable hash of `list-id`** (no API list color);
  a list keeps the same color run-to-run; tasks inherit their list's color.
- Carry the task's **status** and **assignee ids** through to the renderer for the filters.
- `glyph` default per source; `source:'clickup'`.

**Refresh & resilience**
- Show cached catalogue immediately on launch, then refresh from the API; manual **Refresh** button;
  update the footer "Tasks refreshed Xm ago".
- **Refresh updates display metadata only** (name, breadcrumb, color, status, assignees) for tasks
  still in the catalogue, upserts `tasks-store.json`, and **never touches intervals, never reorders
  or interrupts a running card.**
- **Rate-limit aware:** throttle to the **100 req/min floor**; on `429` honor `X-RateLimit-Reset` and
  back off; on failure keep the cached catalogue + a non-blocking error.
- No-token / empty state: show a "Connect ClickUp" prompt, not a blank panel.
- Tasks missing from the live fetch render from `tasks-store.json` so they never vanish mid-session.

**Acceptance (machine-checkable):** a scripted fetch with the `.env.local` token returns the real
catalogue across all spaces/lists with correct `Space › List` breadcrumbs and deterministic colors,
deduped by id, with status + assignees attached; the Assigned-to-me and status filters narrow the
PAUSED set correctly; blanking the token yields the connect prompt; an injected `429` is backed off
without crashing; timers attach to ClickUp tasks and persist via the same worklog as manual tasks.

---

## Phase 6 — Persistence hardening, packaging & ship

**Deliverables**
- **New-session launch:** refetch catalogue (over cache), clear the removed-set, reset session
  timers/total to 0, all tasks paused; history log intact. Verify open intervals from a prior crashed
  run are closed in the log (no phantom time) without affecting the fresh session.
- Heartbeat writer (~30s) — bounds crash-tail loss.
- **Package** with electron-builder: Windows **NSIS installer** + portable exe; app icon; autostart
  wired into the installed build; single-instance confirmed; self-hosted fonts confirmed
  (offline-clean).
- Short root `README.md`: install, where data lives, how to set the token.

**Acceptance:** automated checks confirm new-session reset + log-history integrity + packaging.
**The only human-gated checks in the whole plan:** (1) install the packaged app on a clean Windows
session and confirm it starts on login, lives in the tray, reads ClickUp, and tracks parallel timers;
(2) reboot and confirm a clean new session (0 totals), autostart, and no phantom time.

---

## Cross-cutting (every phase)
- **No ClickUp push** anywhere — guard against re-introducing start/stop sync. Keep a clean seam
  where a future `add_time_entry` sync would attach; ship none of it.
- **Truth lives in the event log**; the UI is a session-scoped projection. `now()` and storage dir
  are injected.
- TypeScript strict; typed IPC only; secrets never logged or committed.
- `code` may be `null` and `color` is always local — never block on ClickUp data this workspace
  can't provide.

## Explicitly deferred (NOT in v0 — do not build)
ClickUp time-entry push · separate task-management / session-confirm screen · permanent delete &
rename · full idle detection (beyond suspend/lock auto-pause) · daily/weekly summaries · presence
layer (ActivityWatch) · output/productivity metric · multi-monitor positioning beyond clamping to
the primary work area.

## Settled product decisions (recorded — do not re-litigate)
- Two sections only (ACTIVE/PAUSED); fetch everything into PAUSED; tame via filter + remove.
- PAUSED sort: session ↓ → all-time ↓ → Space → List → name. ACTIVE: most-recently-started first.
- Filter = Assigned-to-me + Task-status, view-only. **Remove (×) only on PAUSED rows** (pause before
  removing), session-hide (reappears next launch), manual + ClickUp alike, no permanent delete in v0.
- live·idle pill: N = running count; **M idle = all paused tasks** (whole catalogue minus
  running/removed — intentionally can be large).
- "Session" = one app run; per-card timer = this-session elapsed; session total + tray = wall-clock
  union ("how long I worked this session"); minimise keeps the session, only Quit ends it.
- Auto-pause on suspend + lock; graceful Quit stops all timers; timers always return paused after
  restart/crash (no auto-resume).
- Refresh = metadata-only, never reorders/interrupts. `maximize` removed; `code` hidden when null.
