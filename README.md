# Cadence

A Windows 11 **system-tray time tracker** whose differentiator is tracking multiple tasks
**in parallel** — several independent live timers at once, which almost no commercial tool
supports. It reads your task catalogue from **ClickUp** (all spaces / lists, read-only), lets you
start/stop an independent timer per task, and lets you add ad-hoc tasks that aren't in ClickUp.

Cadence lives in the tray and floats above the taskbar as a compact flyout. It is **local-first**:
an append-only event log on your machine is the source of truth, so your history survives restarts
and it works offline. It never writes to ClickUp.

## Install

Grab a build from the `dist/` output (or a release) and pick one:

- **`cadence-<version>-setup.exe`** — NSIS installer. Installs per-user, adds Start-menu + desktop
  shortcuts, and registers Cadence to **start on login** (it's a resident tray app). Uninstall from
  *Add or remove programs*.
- **`cadence-<version>-portable.exe`** — a single self-contained exe. No install; run it from
  anywhere (e.g. a USB stick). It still stores your data under `%APPDATA%` (below).

There's no code-signing certificate on v0, so Windows SmartScreen may warn on first run
(*More info → Run anyway*).

## Using it

- **Click the tray icon** to toggle the flyout. Closing or minimising the window hides it back to
  the tray — the session keeps running. **Quit** is only from the tray right-click menu (it stops
  all running timers).
- **Start / stop** any number of timers at once. A started task moves to **ACTIVE**; stopping it
  returns it to **PAUSED**. The "Current session" total and the tray tooltip show the wall-clock
  time you actually worked this session — parallel overlaps are counted once (3 tasks × 1h in
  parallel = 1h).
- **Add untracked tasks** from the footer for ad-hoc work not in ClickUp.
- **Filter** the paused list by *assigned-to-me* and *status*, and **remove (×)** a paused row to
  hide it for this session (it reappears next launch).
- A **session is one app run.** Each launch starts fresh: per-task timers and the session total
  reset to 0 and the catalogue is refetched. The event log is kept across sessions as history only —
  totals are not restored into the UI after a restart.

## Connecting ClickUp

No file editing needed in the installed app:

1. In ClickUp: **avatar → Settings → Apps → API Token → Generate**. The token starts with `pk_`.
2. In Cadence: tray right-click → **Connect ClickUp…**, paste the token, and confirm.

The token is stored **encrypted at rest** with the OS keychain (Windows DPAPI, via Electron
`safeStorage`) — the raw token is never written to disk in the clear or logged. Use **Refresh
tasks** (tray menu) to re-pull the catalogue at any time; Cadence only ever *reads* from ClickUp.

## Where your data lives

Everything is under the app's user-data folder — on Windows:

```
%APPDATA%\Cadence\
  worklog.jsonl        append-only event log — the source of truth (history across sessions)
  tasks-store.json     metadata snapshot of tracked/manual tasks (so they render even if they leave ClickUp)
  clickup-cache.json   last good ClickUp catalogue (instant + offline launch); contains NO secret
  clickup-token.enc    your ClickUp token, OS-encrypted (safeStorage/DPAPI)
```

To reset Cadence completely, quit it and delete that folder.

## Development

Requires Node.js LTS (≥ 22.12). This is an Electron + React + TypeScript app built with
electron-vite and packaged with electron-builder.

```bash
npm install            # restore dependencies
npm run dev            # run in dev (window shown, live reload)
npm test               # engine + UI unit tests (Vitest)
npm run typecheck      # tsc --noEmit (node + web)
npm run lint           # eslint
npm run build          # typecheck + electron-vite build → out/
npm run build:win      # build + package NSIS installer + portable exe → dist/
```

For local ClickUp development, put your token in an **untracked** `.env.local` at the repo root:

```
CLICKUP_TOKEN=pk_xxx
```

`.env.local` is gitignored — never commit a real token (this repo is public).

### Verify harnesses

Each build stage has an automated, isolated harness (window-less or on a throwaway user-data dir):

```bash
npm run smoke              # app shell launches cleanly, fonts load, renderer can't reach Node
npm run verify:ipc         # UI ↔ engine over IPC (start/stop/add/remove, ordering)
npm run verify:tray        # tray + flyout behavior (show/hide, auto-pause, single-instance, autostart)
npm run verify:clickup     # live ClickUp read against .env.local (real catalogue, dedupe, filters)
npm run verify:token       # safeStorage token round-trip + connection state machine
npm run verify:newsession  # new-session reset, crash-close (no phantom time), heartbeat writer
```

## License

MIT © Luca Chech
