# Handoff: Cadence — Windows Time Tracker (ClickUp)

## Overview
**Cadence** is a Windows 11 desktop time-tracker that pulls task lists from ClickUp, lets the user confirm which task(s) they're working on, and tracks time across **several tasks in parallel** (multiple live timers at once). It lives as a **system-tray flyout** that floats above the Windows taskbar — not a full window. The user can start/stop each task independently and add ad-hoc tasks that don't exist in ClickUp yet.

The implementation target is the **Final** direction (`#3a` in the prototype). The same file also contains four earlier explorations (`#2a`–`#2d`) — **ignore those**; they are kept only for reference. Build `3a`.

## About the Design Files
The file in this bundle (`Cadence Tracker.dc.html`) is a **design reference created in HTML** — a working prototype showing the intended look and behavior. It is **not production code to copy directly**. It's authored as a "Design Component" (a custom HTML format with a template + a logic class); treat it as a visual + behavioral spec, not as a source module.

Your task is to **recreate the `3a` design in the target codebase's environment** using its established patterns and libraries. For a Windows desktop app this most likely means **Electron + React** (or Tauri, WinUI 3, WPF, etc. — use whatever the project already standardizes on). If no environment exists yet, Electron + React is a reasonable default for a tray app of this kind. Do not ship the HTML as-is.

## Fidelity
**High-fidelity (hifi).** Colors, typography, spacing, radii, and interactions are final. Recreate the `3a` UI pixel-perfectly using the codebase's component libraries. Exact values are in **Design Tokens** below.

## Screens / Views

### Screen: Tray Flyout — Live Tracking Dashboard (the only screen built)
- **Purpose:** At-a-glance view of the current work session. See which ClickUp tasks are actively timing, which are paused, total session time, and start/stop any task. Add a manual task not in ClickUp.
- **Window model:** A floating flyout panel anchored to the bottom-right of the screen, above the Windows taskbar. In the prototype the panel and a representation of the Windows 11 taskbar are stacked; in production **only the flyout panel is your app** — the taskbar is the OS. The flyout is **380px wide**, height fits content.

#### Layout (top → bottom)
1. **Title bar** (44px tall): app icon (19px blue rounded square w/ white `timer` glyph) + "Cadence" wordmark on the left; Windows window controls on the right — minimize (`remove`), maximize (`open_in_full`), close (`close`). Close button hovers to red (`#c0504c`) bg + white icon; the other two hover to `rgba(0,0,0,.06)`. Bottom hairline `1px solid rgba(0,0,0,.05)`.
2. **Content** (padding 15px):
   - **Current session line** (single row, items vertically centered): left = "Current session" label (Space Grotesk 700, 15px, `#16161a`) + total session time in `Xh YYm` format (Space Grotesk 700, 15px, `#16161a`, tabular-nums, **no seconds**). Right = **live·idle pill**: rounded-full, bg `rgba(0,88,188,.09)`, text `#0058bc` 600/10.5px, content "● N live · M idle" with a pulsing 6px blue status dot.
   - **"ACTIVE"** section label (Work Sans 600, 9.5px, letter-spacing .14em, `rgba(0,0,0,.32)`).
   - **Active task cards** (one per running task) — see component below.
   - **"PAUSED"** section label (same style as ACTIVE).
   - **Paused task rows** (one per paused task) — see component below.
   - **Manual-task composer** (collapsed by default; expands inline) — see component below.
   - **Footer row** (top hairline `1px solid rgba(0,0,0,.05)`): left = "Synced 2m ago" (`sync` icon + text, `rgba(0,0,0,.45)` 600/11px); right = "Add task not in ClickUp" (`edit_note` icon + text, `#0058bc` 600/11px) — this toggles the composer.

#### Component: Active task card (running timer)
- Full-width rounded card, `border-radius:16px`, padding `14px 16px 15px`, margin-bottom 10px.
- **Background:** a 135° gradient from the task's list color to a darkened (×0.68) shade of it: `linear-gradient(135deg, <color> 0%, <darkened> 100%)`. Soft colored shadow `0 10px 22px -8px <color@16%>`.
- **Top row:** left column =
  - **Breadcrumb (ClickUp hierarchy):** a Space pill (`folder_open` 12px glyph + Space name, white text 600/9px caps, letter-spacing .09em, bg `rgba(255,255,255,.2)`, rounded-full, padding `4px 9px`) → `chevron_right` (14px, `rgba(255,255,255,.6)`) → **List** name (white 600/10px, `rgba(255,255,255,.92)`).
  - **Task title** below (white 600/15.5px, single line, ellipsis, max-width 240px).
  - Right of the top row: a **pulsing/pinging white status dot** (8px; inner solid dot + outer `ping` ring animation).
- **Bottom row:** left = big timer `HH:MM:SS` (Space Grotesk 700, 26px, white, tabular-nums) + the ClickUp id (e.g. `CU-482`) in faint white 500/10px beside it. Right = **Pause pill** button: white bg `rgba(255,255,255,.94)`, dark text `#1a1a1f` 600/12px, `pause` (filled) icon, rounded-full, padding `8px 14px`. Clicking pauses that task (moves it to PAUSED).

#### Component: Paused task row
- Flex row, items centered, gap 11px, padding `8px 6px`.
- **Left:** a 3px-wide colored **vertical attention bar**, 34px tall, `border-radius:2px`, background = task's list color.
- **Middle:** task name (Work Sans 600/13px, `#26262b`, ellipsis) + breadcrumb subtitle "`Space · List`" (Work Sans 500/10.5px, `rgba(0,0,0,.42)`).
- **Right:** the elapsed-so-far short time `Xh YYm` / `Mm SSs` (Space Grotesk 600/12.5px, `rgba(0,0,0,.42)`) followed by a **round outlined Play button** at the far right: 34px circle, white bg, `1.5px` border in `<color@28%>`, `play_arrow` (filled) icon in the task color. Clicking resumes (moves it to ACTIVE).
- **Placement rule:** the start (Play) button on paused rows and the stop/pause button on active cards are **both right-aligned** for consistency.

#### Component: Manual-task composer (add task not in ClickUp)
- Hidden until "Add task not in ClickUp" is clicked. When open: a `#f4f3ef` panel, `border-radius:13px`, padding 13px.
- Eyebrow "NEW TASK · NOT IN CLICKUP" (Work Sans 600/9.5px, letter-spacing .12em, `rgba(0,0,0,.42)`).
- Text input "What are you working on?" (full width, white bg, `border-radius:8px`, padding `9px 11px`, no border, 12.5px).
- Row: a "List (optional)" text input (same style, flex:1) + **Cancel** (text button, `rgba(0,0,0,.45)` 600/12px) + **Add** (blue button `#0058bc`, white text 600/12px, `border-radius:8px`, padding `9px 15px`).
- On Add: create a new **paused** task with the typed name, list (defaults to "Manual"), a space of "Personal", `source:'manual'`, elapsed 0; clear inputs and collapse. Manual tasks are color-cycled through `['#c64f00','#4b3fb0','#0091b3','#fe9400']` and icon-cycled through `['edit_note','draw','task_alt','bolt']`. Their breadcrumb subtitle reads "Personal · <list>" and they are visually tagged "Manual".

## Interactions & Behavior
- **Parallel timers:** any number of tasks can run at once; each ticks independently, +1s every second.
- **Toggle:** Pause button on an active card stops that task's timer and moves it to PAUSED; Play button on a paused row starts it and moves it to ACTIVE. No limit on concurrent active tasks.
- **Session totals:** "Current session" total = sum of **all** tasks' elapsed time, shown as `Xh YYm` (no seconds). The taskbar tray timer (in the prototype) shows the sum of **running** tasks as `HH:MM:SS`.
- **live·idle pill:** N = count of running tasks, M = count of paused tasks; live updates.
- **Clock/date** (prototype taskbar): `HH:MM` and `DD/MM` from system time, updates each second. Production: this is the OS taskbar — not your responsibility.
- **Window controls:** minimize / maximize / close behave per OS window conventions. Close hovers red.
- **Animations:** status dots pulse (`opacity 1→.3→1`, 1.4s ease-in-out infinite); active-card dot also "pings" (scale .9→2.4, opacity fade, 1.6s). Button presses should feel tactile (subtle scale-down on active is on-brand). Durations 300–500ms, default easing.

## State Management
Single session store:
- `tasks: Array<{ id, name, space, list, code, color, glyph, elapsed (seconds), running (bool), source: 'clickup'|'manual' }>`
- Derived: `running = tasks.filter(running)`, `paused = tasks.filter(!running)`, `runningCount`, `pausedCount`, `totalSeconds`, `runningSeconds`.
- `composerOpen: bool`, `draftName: string`, `draftList: string`.
- A 1-second interval increments `elapsed` for every running task.
- **Data fetching:** tasks originate from the **ClickUp API** (Spaces → Lists → Tasks hierarchy). Each task maps to `{space, list, name, code (ClickUp custom/short id), color (from the ClickUp list color)}`. Time entries should be pushed back to ClickUp's time-tracking endpoints on start/stop (not wired in the prototype — see Open Questions). Manual tasks are local-only until optionally pushed to ClickUp.

## Design Tokens
This design follows the **"Luca Chech AI / Kinetic Logic"** system. Colors:
- **Primary / Electric Blue:** `#0058bc` (CTAs, live pill, links, blue task color)
- **Secondary / Solar Orange:** `#fe9400` (the live-timer tray accent; used sparingly; tray pill text `#ffba52` on dark)
- **Tertiary / Burnt Sienna:** `#c64f00` (task color variety only)
- **Other task colors:** `#4b3fb0` (indigo), `#0091b3` (teal)
- **Error / close-hover red:** `#c0504c`
- **Text:** primary `#16161a` / `#1a1a1f` / `#1c1c20`; secondary `#26262b`/`#46464c`; muted `rgba(0,0,0,.32–.45)`
- **Surfaces:** card white `#fff`; composer/idle fill `#f4f3ef` / `#f3f2ef`; page bg `#e9e7e1`; **taskbar dark `#1f1f23`** (OS — reference only)
- **No green anywhere** (hard rule — success is communicated in blue).
- Active-card gradient: `135deg, <color> → <color>×0.68`. Tints used: `<color>@10%` (tint), `@5.5%` (tint6), `@16%` (soft/shadow), `@28%` (ring/border).

Typography (Google Fonts):
- **Space Grotesk** (400–700) — display/headlines/timers; tight letter-spacing −1% to −2%; tabular-nums for all times.
- **Work Sans** (400–600) — body, labels, task names; section labels use ALL-CAPS + wide letter-spacing (.12–.14em).

Radius: buttons/inputs `8px`; rows `8–13px`; cards `14–16px`; pills full (`999px`).
Shadows: flyout panel `0 22px 54px -14px rgba(20,20,45,.34), 0 2px 8px rgba(20,20,45,.08)`; active card `0 10px 22px -8px <color@16%>`.

Iconography: **Google Material Symbols Outlined** (variable font). Glyphs used: `timer, remove, open_in_full, close, folder_open, chevron_right, pause, play_arrow, edit_note, sync, bug_report, description, rate_review, forum, code, draw, task_alt, bolt`. Some emphasis icons use `FILL 1`. **No emoji, no custom SVG icon set.**

## Assets
- No raster/image assets are required. Icons come from the Material Symbols Outlined font (Google Fonts CDN). Fonts: Space Grotesk + Work Sans (Google Fonts). In a packaged desktop app, self-host these fonts rather than relying on the CDN.
- App icon: a rounded blue square with a white `timer` glyph is used as a placeholder mark; replace with the real Cadence app icon.

## Files
- `Cadence Tracker.dc.html` — the design prototype. **Build the `3a` ("Final") panel.** Sections `2a`–`2d` are superseded explorations; do not implement them. The `<section id="t3">` block is `3a`; its logic (timer ticking, toggle, composer, formatting helpers) lives in the `class Component extends DCLogic` script at the bottom of the file — read it for exact behavior and number formatting.

## Open Questions / Not Yet Designed
- **Session-confirm / onboarding step** ("suggest today's ClickUp tasks, confirm which to work on") is **not yet designed** — only the live dashboard exists.
- ClickUp OAuth/connection flow, real API wiring, and pushing time entries back to ClickUp are not built.
- Idle detection, daily/weekly summaries, and keyboard shortcuts are not designed.
