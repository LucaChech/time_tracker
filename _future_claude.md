# Handoff — for the next Claude session
*Written: 2026-06-30 (after the Phase 0 green-light). Single rolling handoff — overwrites the prior one; reflects current state.*
*Lives in the **time_tracker** project root: the next build session should be **rooted in time_tracker**.*

## Overall goal (anchor)
Build **Cadence** — a Windows 11 system-tray time tracker whose differentiator is tracking multiple
tasks **in parallel**; ClickUp read-only, local-first, pixel-faithful to the `3a` flyout design. It is a
hands-off **dogfood** build for the AI consultancy: goal = a usable v0 *and* a test of hands-off AI
delegation. (Charter: `CLAUDE.md`.)

## What this session accomplished
- **Ran the Phase 0 acceptance check — PASS ✅ (the green light).** Scripted live ClickUp calls with the
  `.env.local` token (token never echoed):
  - `GET /api/v2/user` → 200; user **"Luca Chech"**, id `302553911`, email `luca.chech.ai@gmail.com`.
  - `GET /api/v2/team` → 200; **exactly one workspace: "Luca Chech AI"** `[90121836206]` (1 member).
  - Scope drill-down: **2 spaces** ("Online presence", "Automations") → **5 open lists** → **5 open tasks**
    (all 5 live in *Automations*: Speed-to-Lead Build 3, Automation Discovery 1, Ops & Tooling 1; the two
    *Online presence* lists are currently empty). Catalogue is non-empty.
  - Confirmed the **no-`Bearer`** `Authorization: <pk_>` header works (verified ClickUp quirk holds).
- **Luca CONFIRMED the account** (T2 human gate): the `.ai` gmail alias `luca.chech.ai@gmail.com` (vs his
  personal `luca.chech@gmail.com` on Claude Code) is expected — "Luca Chech AI" **is** the intended workspace.
- **Node LTS confirmed:** `node v24.13.1` (active LTS) + `npm 11.10.1`.
- Check scripts live in this session's scratchpad (`phase0-check.mjs`, `phase0-tasks.mjs`) — disposable;
  no need to keep. Nothing was written into the project tree this session (still **no app code**).

## Doctrine that governs the build (do NOT re-derive — it's settled)
- **No human review of routine diffs.** Luca is deliberately out of the loop on ordinary code.
- **Mandatory autonomous "review panel" after every non-trivial phase** (>a few lines OR multi-file):
  multiple independent adversarial lenses (edge-cases · spec-conformance · security · integration-reality)
  → synthesize → fix → re-review until clean. Always-on, not token-constrained. `/code-review high` is the
  per-diff tool inside it.
- **Human (Luca) review only at 3 triggers:** T1 functional doubt the agent can't confidently resolve ·
  T2 a step only Luca can take · T3 visual/front-end judgment (actively ASK on substantial UI).
- **Execution cadence:** one phase = one **bounded session** (never stack phases — context/token budget);
  each phase ends with the review panel (→ short non-technical summary + "start a new session") OR a
  human-input request; **auto-run `/future-claude` before every handoff** (don't wait to be asked).

## Current state
- Plan (`IMPLEMENTATION_PLAN.md`) + spine (`VERIFICATION_SPINE.md`) + charter (`CLAUDE.md`) are complete,
  internally consistent, decision-complete.
- **Phase 0 is now fully GREEN and human-confirmed.** Token valid + right workspace + non-empty catalogue;
  Node LTS present. **No app code written yet.**
- Of the 3 total human touchpoints, **#1 (Stage 0 token/workspace) is DONE.** Remaining: Stage 3a (pixel
  sign-off, T3) and Stage 6 (clean-install + reboot, T2).

## Next actions (priority order) — run from a **fresh, time_tracker-rooted** session
1. **Stage 1 — project scaffold & app shell** per `IMPLEMENTATION_PLAN.md` Phase 1, verified per
   `VERIFICATION_SPINE.md` Stage 1. Electron + React + TS + Vite (electron-vite), electron-builder.
   Security baseline: `contextIsolation: true`, `nodeIntegration: false`, typed IPC via `contextBridge`.
   Write `.gitignore` covering `node_modules`, `dist`, **`.env.local`**, packaged output, userData.
   **Negative checks to actually run:** renderer can't reach node (`require`/node globals undefined in
   renderer — proves contextIsolation, not just configured), `.env.local` untracked, fonts load offline
   (no CDN at runtime). End with the **review panel** → short non-technical summary → auto-`/future-claude`.
2. Continue **one phase per bounded session**. Phase 3 is pre-split **3a** (static pixel-faithful UI →
   human pixel sign-off) / **3b** (wire to state); Phase 5 recommended split **5a**/**5b**.

## Open threads / blockers / waiting-on-user
- **No blockers.** Phase 0 is satisfied and confirmed; cleared for autonomous execution of Phases 1–6.
- **Do not re-litigate:** the plan's "Settled product decisions" block, the verification doctrine above,
  or the account identity (the `.ai` gmail alias is confirmed correct).
- **Riskiest stage = Phase 2 (state engine):** the whole app is a projection of it; the dangerous bugs are
  the silent interval/union boundary cases the plan's own fixtures DON'T cover — its `missing_checks` in the
  spine are the highest-value adds (touching intervals, zero-length, corrupt log line, pre-session open
  interval, large-set sort stability).
- **Workspace reality (useful for later ClickUp-read testing):** real data is small — 2 spaces, 5 lists,
  5 open tasks, all in *Automations*; both *Online presence* lists are empty. Free plan → `custom_id` null
  (no `CU-…` chips), lists have no API color (use the hashed local palette). The empty-list and
  empty-section states **will** be hit with real data, so they must render cleanly.
- **Optional hub housekeeping (manager project):** add `time_tracker/` to the manager `CLAUDE.md` portfolio
  index so the hub stays honest. Not done yet.

## Pointers
- Plan: `IMPLEMENTATION_PLAN.md` · Spine: `VERIFICATION_SPINE.md` · Charter: `CLAUDE.md`.
- Design handoff (build the **`3a`** panel only): `TimeTracker-handoff/timetracker/project/design_handoff_cadence_tracker/README.md` + `Cadence Tracker.dc.html`; `colors_and_type.css` for exact colors/type. **No green anywhere — success is blue.**
- ClickUp: base `https://api.clickup.com/api/v2`; header `Authorization: <pk_token>` (**no `Bearer`**);
  token in `.env.local` as `CLICKUP_TOKEN=pk_…` (untracked; never echo). Workspace id `90121836206`.
  Get-Tasks excludes subtasks + closed/archived by default; fetch with `subtasks=true&include_closed=false`
  and walk folderless lists + folder lists per space (as the Phase 0 scripts did).
- Architecture rationale + ClickUp empirics: `time_tracking.md` (this root) + the "Verified ClickUp facts"
  block atop the plan.
- Skills: `/verify-plan` lives only in `../manager/.claude/skills/`; `/future-claude` is in both projects.
- **Rooting note:** `time_tracker/` is a plain sibling folder (NOT its own git repo) — so `.env.local` here
  can't be accidentally committed; Phase 1 still writes a `.gitignore` for it. Run the actual build from a
  time_tracker-rooted session.
