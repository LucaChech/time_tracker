---
name: future-claude
description: End-of-session handoff scratchpad for the next Claude instance. Invoke when the user types /future-claude or asks to "hand off", "save progress for next time", or "write a handoff". (Re)writes `_future_claude.md` in the CURRENT project's root capturing what this session accomplished, the current state, and the next actions, so the next session resumes with full context. Always overwrites — a single rolling handoff, never a log.
---

# /future-claude — write a session handoff for the next instance

Maintain one always-current handoff file, **`_future_claude.md`**, in the **current project's root**
(the directory holding this project's `CLAUDE.md`), so a future Claude session can pick up with full
context instead of reconstructing it.

## Steps
1. **Locate** `_future_claude.md` in the current project root.
   - **If it does not exist** → you'll create it.
   - **If it exists** → read it first (to carry forward anything still open), then you'll overwrite it
     — the old content is replaced, not appended.
2. **Reconstruct this session** from the conversation: decisions made, files created/edited (with
   paths), what got finished, what's mid-flight, blockers, and anything you're waiting on the user
   for. Read the project `CLAUDE.md` to state the *overall goal* as the anchor.
3. **Write `_future_claude.md`** using the template below. **Fold forward** any still-relevant open
   threads from the previous version so nothing important is lost across sessions; **drop** anything
   now resolved. The result must be a *standalone* handoff: the next session should be able to act
   from this file plus `CLAUDE.md` alone.
4. Be factual and specific — exact paths, exact decisions, exact next actions. No vague summaries.
5. Confirm to the user that the handoff was written (and whether it was created fresh or overwritten).

## Template
```
# Handoff — for the next Claude session
*Written: <absolute date + time>. Single rolling handoff — overwrites the prior one; reflects current state.*

## Overall goal (anchor)
<1–2 lines from CLAUDE.md: what this project is trying to achieve>

## What this session accomplished
- <decision / deliverable / file edited, with path>
- ...

## Current state
<where things stand right now: what exists, what's verified, what's not>

## Next actions (priority order)
1. <concrete next step>
2. ...

## Open threads / blockers / waiting-on-user
- <unresolved items, pending inputs, decisions already made that must NOT be re-litigated>

## Pointers
- <key files + where things live + gotchas the next session must know up front>
```

## Notes
- **Single rolling handoff, not a log** — always overwrite, never append.
- **Standalone** — next session needs only this file + the project `CLAUDE.md`.
- This is a lightweight handoff/scratchpad — distinct from a retrospective (`/retro`) and from any
  ClickUp action-point sweep.
