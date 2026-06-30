# Cadence — Verification Spine (companion to `IMPLEMENTATION_PLAN.md`)

*Produced by `/verify-plan`, 2026-06-30. This routes verification per phase, hunts the checks the plan
omits, and encodes the phase-boundary execution protocol. The executor (next session) follows this
alongside the plan. Not a rewrite of the plan — a contract layered on top.*

---

## Verification doctrine (Luca's standing rules — applied throughout)

1. **No human review of routine diffs.** Luca is deliberately out of the loop on ordinary code; the
   goal is maximal hands-off automation.
2. **Mandatory adversarial multi-angle automated review after every non-trivial phase** — "non-trivial"
   = more than a few lines OR multiple-file edits. Always on, not token-constrained. This is the default
   verifier (the **"review panel"**, defined below).
3. **Human (Luca) review is reserved for exactly three triggers:**
   - **T1** — genuine functional doubt the agent cannot confidently resolve on its own;
   - **T2** — a step only Luca can take (tokens, accounts, a real reboot, anything external);
   - **T3** — visual / front-end judgment (and here actively *ask* Luca on substantial UI changes).
   Bias gates hard toward automated review; mark a human gate only where one of T1–T3 genuinely applies.

### The "review panel" (the default verifier this spine routes to)
A **multi-perspective adversarial review run autonomously** at each non-trivial phase gate: several
independent reviewer passes, each a **different lens** (correctness/edge-cases · spec-conformance vs the
plan · security/secrets · integration-reality) → synthesize → fix → re-review until clean. Hands-off and
not token-limited. `/code-review` (high) is the per-diff tool inside it; `/code-review ultra` (cloud
multi-agent) is the heavier escalation Luca can opt into but the panel does **not** require it.

> *Note on the earlier "ultracode not warranted" call:* that was about the **build** mode. Luca has since
> made comprehensive multi-angle review at **every** phase a standing requirement — so review intensity
> is higher than the original "single /code-review at gates." That's a deliberate doctrine update, not a
> conflict.

---

## Phase-boundary execution protocol (how each phase ends)

This governs *cadence of control*, orthogonal to *what gets verified*.

- **One phase = one bounded session.** Do **not** stack phases to save round-trips — bounded
  context/token budget is the priority. Even when two or three back-to-back phases are pure code the
  agent could do unattended, each runs in its **own session**.
- **If a phase is too large for one bounded session, split it** (this spine pre-splits Phase 3 → 3a/3b and
  recommends Phase 5 → 5a/5b). Sub-stage = its own session.
- **Every phase ends exactly one of two ways:**
  1. **Automated review-panel gate** (code phases) — the panel runs, findings fixed, re-reviewed clean.
     The only thing asked of Luca is a process step: a **short, non-technical summary** + *"start a new
     session."* No diff review.
  2. **Human-input gate** (only when T1/T2/T3 applies) — token, feedback, or visual sign-off.
- **`/future-claude` fires automatically right before handing control back, at every phase end.** Luca
  never has to request it; a handoff is always needed before the next session. (Can't be a settings hook —
  a hook can't author a context-aware handoff — so it's a standing rule the agent executes.)

---

## Stage 0: Prerequisites (Phase 0 — human-only)

Pure human-input gathering. The only real failure mode is a **wrong-scope token**: a `pk_` that 200s on
`/user` but points at the wrong account or an empty workspace would let every downstream ClickUp
verification pass locally and fail against reality. The plan's "GET /user → 200" check is too weak — it
proves auth, not the *right* account.

```yaml
verification-profile:
  stage: "Prerequisites"
  kind: mechanical
  failure_mode: "wrong/expired/wrong-scope token → every downstream ClickUp check is misdiagnosed; Node LTS missing"
  preconditions: ["token is a personal pk_ token (not OAuth), for the intended workspace"]
  verifiers:
    - type: human
      tool: "Luca mints pk_ token + drops it in .env.local"
      lens: "T2 — only Luca can do this"
    - type: verify
      tool: "scripted GET /api/v2/user + GET /api/v2/team with the token"
      lens: "auth + scope"
  missing_checks:
    - "GET /user returns the EXPECTED user/workspace, not just any 200 (catch a wrong-account token)"
    - "GET /team returns >=1 authorized workspace with lists/tasks (token isn't on an empty account)"
  depth_rule: "single scripted live call; no review panel (no code yet)"
  gate: hard
  human_gate_reason: "T2 — only Luca can mint the pk_ token and confirm the workspace; blocks all of 1-6"
  feedback: { outcome: null }
```

---

## Stage 1: Project scaffold & app shell (Phase 1)

Mostly mechanical scaffold, but it sets two things that quietly poison everything if wrong: the
**security posture** (`contextIsolation`/`nodeIntegration`) and the **transparent-frameless window**
(a Windows-specific rendering gotcha — black corners / missing shadow). The plan configures these but its
acceptance only proves "window opens without console errors" — it never proves the renderer *can't* reach
node, or that `.env.local` is actually gitignored before a real token exists.

```yaml
verification-profile:
  stage: "Project scaffold & app shell"
  kind: mechanical
  failure_mode: "insecure defaults silently on; transparent window renders black corners on Windows; toolchain drift mid-build; .env.local not actually ignored"
  preconditions: ["electron-vite + electron-builder current majors confirmed vs current docs before pinning the lockfile"]
  verifiers:
    - type: verify
      tool: "/verify — automated launch, no console errors, window renders without black corners"
      lens: "shell renders"
    - type: docs-check
      tool: "Electron transparent/frameless window on Windows (current guidance)"
      lens: "rounded-corner + shadow recipe"
    - type: code-review
      tool: "review panel — lens=security, lens=spec-conformance"
      lens: "IPC/contextBridge + pinned toolchain + gitignore"
  missing_checks:
    - "negative: in the renderer, `require`/node globals are undefined — proves contextIsolation actually holds, not just configured"
    - "`git status` shows `.env.local` untracked BEFORE any real token exists"
    - "block the network and confirm self-hosted fonts still render (no runtime CDN fetch)"
  depth_rule: "pass1 lens=security; pass2 lens=spec-conformance iff pass1 substantive; stop on nits"
  gate: soft
  feedback: { outcome: null }
```
*Ends with: review panel → summary + "start a new session". No human review.*

---

## Stage 2: State engine (Phase 2) — **the riskiest stage**

Pure, injected-dependency logic — and the entire app is a projection of it, so a silent bug here makes
every later "it works" untrustworthy. Highest-value checks are the **boundary cases the plan's fixtures
omit**: exactly-touching intervals (the union edge), zero-length intervals, corrupt log lines, and the
session-scope boundary (`ts ≥ sessionStartTs`) on an interval that *started before* the session but is
still running. The plan's union=1h fixture is good but only tests clean overlaps.

```yaml
verification-profile:
  stage: "State engine"
  kind: logic
  failure_mode: "union double-counts parallel overlaps; sort key off; idempotency holes; clock-step negative elapsed; session-scope off-by-one on a pre-session open interval"
  preconditions: []
  verifiers:
    - type: eval-harness
      tool: "Vitest fixtures (the plan's acceptance set) — primary, machine-checkable"
      lens: "interval/union/sort/idempotency/reset"
    - type: code-review
      tool: "review panel — lens=edge-cases (interval/union math), lens=spec-conformance"
      lens: "math correctness"
  missing_checks:
    - "union of EXACTLY-touching intervals (stopA == startB) merges to one — no double count, no phantom gap"
    - "zero-length interval (start==stop) contributes 0 and doesn't destabilise the sort"
    - "corrupt log line (stop with no start / start with no stop) is handled, never NaN"
    - "open interval whose start < sessionStartTs but still running → session elapsed counts only from sessionStartTs"
    - "PAUSED sort is deterministic and stable with a large set (~250 tasks), final tiebreak by name"
    - "perf: all-time tiebreaker doesn't re-scan a long log per render badly enough to lag the 1s tick (flag if it does)"
  depth_rule: "unit fixtures primary; pass1 lens=edge-cases; pass2 lens=spec-conformance iff pass1 substantive; stop on nits"
  gate: hard
  feedback: { outcome: null }
```
*Hard **automated** gate — correctness boundary; failure invalidates all downstream verification. Ends
with: review panel → summary + "start a new session". No human review.*

---

## Stage 3a: Static pixel-faithful UI (Phase 3, split — front-end)

Recreate the `3a` flyout pixel-faithfully, **before** wiring. This is the one phase where taste is
load-bearing and the agent should *not* self-certify. Automation can diff styles and screenshots; only
Luca can sign off that it *looks right*. Missing: the diff must cover the populated, empty, and long-list
states — not just the default — and must not flag the deliberate v0 deviations as regressions.

```yaml
verification-profile:
  stage: "Static pixel-faithful UI"
  kind: design
  failure_mode: "drifts from the 3a prototype (color/radius/spacing/font/animation); 'no green' violated; non-tabular times; diff misses non-default states"
  preconditions: []
  verifiers:
    - type: verify
      tool: "/verify — screenshot-diff vs a render of the 3a prototype within tolerance; assert key computed styles"
      lens: "fidelity"
    - type: human
      tool: "Luca — final pixel sign-off"
      lens: "T3 — visual judgment"
  missing_checks:
    - "screenshot-diff covers BOTH sections populated, the empty state, AND a long PAUSED list (scroll) — not just the default"
    - "the intended v0 deviations (filter, per-row x, maximize removed, code hidden) are present and NOT flagged as regressions"
  depth_rule: "automated style+screenshot diff primary; human sign-off is the final call"
  gate: hard
  human_gate_reason: "T3 — pixel fidelity is taste/intent and the named acceptance milestone for a pixel-faithful build; ASK Luca"
  feedback: { outcome: null }
```
*Ends with: a request to Luca for **visual sign-off** (T3).* 

---

## Stage 3b: Wire UI to state over IPC (Phase 3, split)

Components must be **pure projections** of Phase-2 selectors — no business logic in the renderer. The
dangerous failures are silent semantic ones: the renderer re-summing per-task times (double-counting the
union), the filter leaking into the fetch/persistence, or remove (×) appearing on active cards. The
plan's acceptance drives the happy path; the high-value adds are the **negative** assertions.

```yaml
verification-profile:
  stage: "Wire UI to state over IPC"
  kind: logic
  failure_mode: "renderer computes business logic / re-sums (double-counts union); filter affects fetch or persistence; remove shown on active cards; ordering not re-derived on toggle"
  preconditions: []
  verifiers:
    - type: verify
      tool: "/verify — drive start/pause/add/remove/filter via IPC, assert state + ordering"
      lens: "wiring"
    - type: code-review
      tool: "review panel — lens=spec-conformance (pure projection), lens=edge-cases (transitions)"
      lens: "no renderer-side logic"
  missing_checks:
    - "filter is view-only: assert it never changes the fetch, persistence, or the ACTIVE list (negative: a running task stays visible under any filter)"
    - "remove (x) renders ONLY on paused rows, never on active cards (negative)"
    - "per-task elapsed shown == Phase-2 selector value (no renderer recompute drift)"
    - "session total shown == union selector (renderer does NOT sum per-task and double-count parallel work)"
  depth_rule: "pass1 lens=spec-conformance; pass2 lens=edge-cases iff pass1 substantive; stop on nits"
  gate: soft
  feedback: { outcome: null }
```
*Ends with: review panel → summary + "start a new session". No human review.*

---

## Stage 4: Tray & window behavior (Phase 4)

OS-integration seams. Correct-looking code that fails on the edges: positioning for non-bottom taskbars,
blur-hide firing in dev, single-instance only `focus()`-ing an invisible window instead of show+
reposition. **Autostart's real proof needs a reboot (T2) — but defer that to Phase 6**; here, verify the
login-item/registry entry is *written* programmatically so this phase stays hands-off.

```yaml
verification-profile:
  stage: "Tray & window behavior"
  kind: integration
  failure_mode: "positioning wrong for top/left/right taskbar; blur-hide fires in dev/DevTools; single-instance focuses an invisible window instead of show+reposition; tray tooltip truncates at 3-digit hours"
  preconditions: []
  verifiers:
    - type: verify
      tool: "/verify — tray click shows in work area, blur hides (dev exception), 2nd instance shows+repositions"
      lens: "flyout behavior"
    - type: code-review
      tool: "review panel — lens=edge-cases (positioning/single-instance), lens=integration-reality"
      lens: "seams"
  missing_checks:
    - "positioning clamps for top/left/right taskbars, not just bottom (edge test)"
    - "blur-hide is disabled when DevTools is focused (else dev is unusable)"
    - "single-instance 2nd launch SHOWS the default-hidden flyout + repositions, not just app.focus()"
    - "tray tooltip renders 3-digit hours without truncation"
    - "login-item/registry entry is actually written (programmatic proxy; real-reboot proof deferred to Phase 6)"
  depth_rule: "live /verify primary; pass1 lens=edge-cases; pass2 iff substantive; stop on nits"
  gate: soft
  feedback: { outcome: null }
```
*Ends with: review panel → summary + "start a new session". Autostart's reboot proof is rolled into the
Phase 6 human gate, so no human interrupt here.*

---

## Stage 5: ClickUp READ integration (Phase 5) — recommend split 5a/5b

External-API integration. Read-only (GETs only — no irreversible action), so not a hard gate, but it has
the build's **secret-at-rest boundary** (`safeStorage`) and the most external-contract surface. The
verified-facts block was captured today; **re-confirm against current ClickUp v2 docs at build time** —
third-party APIs drift. If one session can't hold it: **5a** = auth + traversal + mapping → real
catalogue verified; **5b** = refresh/resilience/rate-limit/filters/connect-state.

```yaml
verification-profile:
  stage: "ClickUp READ integration"
  kind: integration
  failure_mode: "pagination stops early; dedupe wrong (task in 2 lists); 429 not honored; custom_id mapping wrong; assignee/status not passed through (filters break); token not encrypted at rest"
  preconditions: ["ClickUp v2 request/response shapes re-confirmed vs CURRENT docs (endpoints, params, pagination, custom_id, rate-limit headers) — not training memory"]
  verifiers:
    - type: docs-check
      tool: "current ClickUp API v2 docs/changelog"
      lens: "external contract"
    - type: verify
      tool: "/verify — scripted real fetch with .env.local token → catalogue, breadcrumbs, dedupe, filters"
      lens: "real data"
    - type: code-review
      tool: "review panel — lens=integration/resilience, lens=security (token via safeStorage, never logged)"
      lens: "seams + secrets"
  missing_checks:
    - "injected 429 honors X-RateLimit-Reset and resumes (not merely 'doesn't crash')"
    - "pagination: a list with >100 open tasks fetches ALL pages (boundary at exactly 100)"
    - "dedupe: a task genuinely in 2 lists -> one row, first-breadcrumb-wins, deterministic"
    - "blank/invalid token -> 'Connect ClickUp' prompt, not a crash or blank panel (negative)"
    - "safeStorage round-trip: token encrypts at rest, decrypts next launch; raw pk_ never on disk or in logs (grep userData + logs)"
    - "'Assigned to me' uses the GET /user id; a task assigned to someone else is filtered OUT (negative)"
  depth_rule: "live real-data /verify + docs-check primary; pass1 lens=integration/resilience; pass2 lens=security iff substantive; stop on nits"
  gate: soft
  feedback: { outcome: null }
```
*Ends with: review panel → summary + "start a new session". No human review (builder self-verifies with
the token).* 

---

## Stage 6: Persistence hardening, packaging & ship (Phase 6)

Final acceptance. The packaged build can diverge from dev (CDN font leak, autostart not wired into the
installed build, single-instance breaking under NSIS), and the new-session/crash semantics need proof on
the *shipped* artifact. Two checks only Luca can run: **clean-machine install** and **real reboot** (T2).
Plus the **end-of-build secret sweep** belongs here.

```yaml
verification-profile:
  stage: "Persistence hardening, packaging & ship"
  kind: integration
  failure_mode: "packaged build != dev (CDN fonts, autostart not in installer, single-instance breaks); new-session reset leaks prior totals; crash intervals not closed (phantom time); a secret committed"
  preconditions: []
  verifiers:
    - type: verify
      tool: "/verify — automated: new-session reset, log-history integrity, NSIS + portable build produced"
      lens: "reset + packaging"
    - type: code-review
      tool: "review panel — lens=spec-conformance (reset/crash-close), lens=security/release"
      lens: "ship integrity"
    - type: human
      tool: "Luca — clean-install on a fresh Windows session + real reboot"
      lens: "T2 — only Luca can install on a clean machine + reboot"
  missing_checks:
    - "PACKAGED app renders fonts with the network blocked (no CDN leak in the installed build, not just dev)"
    - "autostart fires after a real reboot on the installed build (the deferred Phase-4 proof)"
    - "new-session reset proven on the packaged build: reboot -> 0 totals, removed-set cleared, history log intact"
    - "secret sweep: working tree + git history contain no pk_ token, .env.local, or safeStorage blob"
  depth_rule: "automated reset/packaging + security sweep primary; human gate = clean-install + reboot acceptance"
  gate: hard
  human_gate_reason: "T2 + named final acceptance milestone — only Luca can clean-install and reboot; ASK Luca"
  feedback: { outcome: null }
```
*Ends with: a request to Luca for the **clean-install + reboot** acceptance (T2).* 

---

## Whole-slice checks

### Acceptance-criteria ledger (criterion → the check that proves it)
- `GET /user 200 + Node LTS` → **Stage 0** scripted call *(strengthened: also confirm expected workspace + non-empty `/team`)*.
- `npm run build runnable; lint + tsc clean; launch no console errors` → **Stage 1** /verify + CI checks.
- `parallel per-task elapsed; union=1h (3×1h); toggle ACTIVE↔PAUSED; idempotent start/stop; 5-key PAUSED sort; removed-set reappears; manual persists; new-session reset; clock-step ≥0; catalogue-absent renders` → **Stage 2** Vitest fixtures. ⚠️ *Touching-interval union, zero-length interval, and corrupt-line cases are NOT in the plan's fixtures — added via Stage-2 `missing_checks`; unverified unless those are added.*
- `DOM + computed styles + screenshot-diff + IPC-driven state/order + pixel sign-off` → **Stage 3a** (visual + human) and **Stage 3b** (wiring).
- `no taskbar button; tray tooltip = session total; tray click in work area; blur hides (dev exception); 2nd instance shows existing` → **Stage 4** /verify. ⚠️ *`autostart-after-reboot` is NOT proven in Stage 4 — deferred to the Stage 6 human gate; flagged so it isn't assumed.*
- `real catalogue across spaces/lists; breadcrumbs; deterministic colors; dedupe; status+assignees; filters narrow PAUSED; blank-token prompt; injected 429 backoff; timers persist via worklog` → **Stage 5** real-data /verify.
- `new-session reset + log integrity + packaging; clean-install starts-on-login/tray/reads-ClickUp/parallel-timers; reboot → clean session + autostart + no phantom time` → **Stage 6** automated + human gate.

### End-of-build safety sweep
- No `pk_` token, `.env.local`, or `safeStorage` blob in the working tree **or** git history (`git log -p` grep).
- `.gitignore` verified to cover `.env.local`, `node_modules`, `dist`, packaged output, userData artifacts.
- Secrets never logged — grep app logs + console output for `pk_`.

### System-wide invariants (only visible end-to-end)
- **No ClickUp push anywhere.** Grep the whole tree for any write/`add_time_entry`/start-stop-sync call — must be zero. The push-ready seam exists but ships nothing.
- **Union never double-counts parallel work** — the `3×1h = 1h` invariant holds end-to-end (tray tooltip, session line, engine), not only in the Stage-2 unit test.
- **Truth lives in the event log; UI is a pure projection** — after a refresh, no state diverges from a fresh replay of `worklog.jsonl`.
- **Secrets never logged or committed** (ties the safety sweep to a standing invariant).

---

## Summary

**9 build sessions** across **7 plan phases** (Phase 3 pre-split → 3a/3b; Phase 5 recommended split →
5a/5b), each its own bounded session per the execution protocol. **Hard gates land at four points:**
Stage 0 (human — the `pk_` token, blocks everything), Stage 2 (automated — the correctness boundary every
later check depends on), Stage 3a (human — pixel sign-off, T3), and Stage 6 (human — clean-install +
reboot acceptance, T2). **Only three human touchpoints in the whole build** (Stages 0, 3a, 6); every other
phase ends with the autonomous review panel + a "start a new session" summary, and `/future-claude` fires
before each handoff. **The single riskiest stage is Stage 2 (state engine)** — pure logic the whole app
project from, where the dangerous bugs are silent boundary cases the plan's own fixtures don't cover; the
spine's highest-leverage adds are its `missing_checks`. The `feedback.outcome` fields are filled in
post-build (real-issue / noise / not-run) to tune next time's routing.
