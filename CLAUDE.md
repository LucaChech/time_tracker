# Cadence — Parallel Time Tracker (project context)

## What this is
**Cadence** is a **Windows 11 desktop time tracker** — a system-tray flyout that floats above
the taskbar — whose differentiating feature is **tracking multiple tasks in parallel** (several
live timers at once), which almost no commercial tool supports. It reads the task catalogue from
**ClickUp** (all spaces / lists), lets Luca start/stop an independent timer per task, and lets him
add ad-hoc tasks that aren't in ClickUp.

**Status:** design done (Claude Design handoff — build the `3a` "Final" direction). **Build not
started.** Implementation plan: `IMPLEMENTATION_PLAN.md`.

## ▶ Session start — resume from the handoff (do this first)
At the start of every session in this project, **check for `_future_claude.md` in this project root.
If it exists, read it before anything else and resume from it.** It is the single rolling handoff that
`/future-claude` writes at the end of each session — current state, the next actions in priority order,
and decisions not to re-litigate. It's overwritten every session, so it always reflects the latest
state; treat it as the starting point (then this charter). If it's absent, just proceed normally.
*(This is the read-side bookend to the auto-`/future-claude` handoff rule — being trialled in this
project first.)*

## How to treat this project
- Internal **nice-to-have** tool and a **dogfood of hands-off AI delegation**. **Not
  mission-critical.** It is built to run with minimal supervision from Luca — the plan front-loads
  every human-only input into Phase 0 so the rest can proceed autonomously.
- It is its own sibling project under `AiConsultancy/`; the hub charter lives at `../manager/`.

## v0 scope (decided)
- ✅ **ClickUp READ** — fetch ALL open tasks + subtasks across all spaces/lists into the **PAUSED**
  section, with `Space › List` breadcrumbs. Two sections only: **ACTIVE** + **PAUSED**.
- ✅ **Parallel local timers** — any number running at once; live ticking UI. Start a paused task →
  ACTIVE; stop → PAUSED. PAUSED sort: session ↓ → all-time ↓ → Space → List → name.
- ✅ **Filter + remove** (the only *added* affordances beyond `3a`): an in-panel filter (**Assigned-to-me**
  + **Task-status**, view-only) and a **paused-row remove (×)** that hides for the session (reappears
  next launch). No permanent delete/rename in v0.
- ✅ **Manual / ad-hoc tasks** not in ClickUp.
- ✅ **Local persistence** — append-only event log is the source of truth (history across sessions).
- ✅ **Auto-pause** running timers on system suspend + screen lock + Quit; timers return paused after
  any restart/crash (no auto-resume).
- ❌ **NO ClickUp push / write-back of time entries in v0** (see constraint below).
- ❌ Deferred: separate task-management/session-confirm screen, permanent delete/rename, full idle
  detection, daily/weekly summaries, presence layer (ActivityWatch), output metric.

## The ClickUp single-live-timer constraint (why no push in v0)
Empirically verified (`../manager/time_tracking.md` §3): ClickUp enforces **one live timer per
user**, hard-wired on every plan, and the API can't even *enumerate* running timers. So parallel
live timers can never map onto ClickUp's start/stop timer. The deep-dive's resolution is to keep a
**local event log as source of truth** and *later* push **finished blocks** via `add_time_entry`
(overlap-safe — ClickUp is a permissive sink). **For v0 we drop push entirely** and track purely
locally; the architecture stays push-ready for a future phase.

## Architecture (resolved)
- **Local append-only event log** (`start` / `stop` / `heartbeat` events: timestamp + task id +
  source) is the **source of truth**. Current state is derived by replaying the log.
- **Elapsed is computed from intervals** — `Σ(stop − start)` for closed intervals `+ (now − start)`
  for the open one — **not** a naive per-second counter. Interval deltas are clamped `≥ 0` (defends
  against NTP/clock steps); **system sleep is excluded** by stopping running timers on
  `powerMonitor` `suspend`; restarts replay the log. (The prototype's `+1/sec` counter does none of
  this.)
- **"Session" = one app run** (launch → Quit; minimise-to-tray keeps it alive). Each launch starts a
  **new** session: per-task timers + the session total reset to 0, the catalogue is refetched, and
  session-removed rows reappear. The log persists **across** sessions as **history only** — no UI
  restore of totals after reboot.
- **Per-card timer = that task's elapsed this session.** **"Current session" total + tray tooltip =
  wall-clock UNION of all run-intervals this session** (time during which ≥1 timer ran; parallel
  overlaps don't double-count — 3 tasks × 1h parallel = **1h** = "how long I worked this session").
- Metadata for every task that is manual or has ever been started is snapshotted to
  `tasks-store.json`, so a tracked task that later leaves the ClickUp catalogue still renders and
  keeps its time.
- **ClickUp is a read-only source** of the task catalogue in v0; nothing ever touches ClickUp's
  live timer. UI shows **live local timers** only.

## Verified ClickUp data limits (target = Luca's Free-plan workspace, 2026-06-30)
- **Lists have no API `color`** → per-task card color is a **deterministic local palette** (hashed by
  list-id), not from ClickUp.
- **Custom Task IDs (`CU-…`) need Business+ and are null here** → the `code` chip shows only when
  present, else hidden. ("CU-482" in the prototype is mock data.)
- **Auth:** personal `pk_` token in the `Authorization` header, **no `Bearer`** prefix.
- Get-Tasks excludes subtasks + closed/archived by default; rate limit floor 100 req/min.

## Stack (decided — overridable)
**Electron + React + TypeScript + Vite (electron-vite), packaged with electron-builder.** Chosen
for **build reliability under autonomous development** (largest training corpus; simplest tray +
frameless always-on-top window model). Tauri v2 is the lighter alternative (tiny binary; official
`tray-icon` / `positioner` / `autostart` plugins) if footprint ever matters — not chosen because
its Rust + WebView2 surface gives an unsupervised agent more places to stall.

## Key references
- **Design handoff (build the `3a` panel):**
  `TimeTracker-handoff/timetracker/project/design_handoff_cadence_tracker/README.md`
  + prototype `TimeTracker-handoff/timetracker/project/Cadence Tracker.dc.html`. Pixel-level spec —
  recreate `3a` faithfully; ignore explorations `2a`–`2d`.
- **Design tokens:** `.../design_system/colors_and_type.css` ("Kinetic Logic"). Hard rule: **no
  green anywhere — success is communicated in blue.**
- **Architecture rationale + ClickUp empirics:** `../manager/time_tracking.md`.

## Conventions
- Times use `tabular-nums`. Session total shown as `Xh YYm` (**no seconds**); per-task live timers
  show `HH:MM:SS`.
- Icons: **Material Symbols Outlined**. Type: **Space Grotesk** (display/timers) + **Work Sans**
  (body/labels). **Self-host fonts** in the packaged app (no CDN at runtime).
