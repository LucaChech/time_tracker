# Handoff — for the next Claude session
*Written: 2026-07-01 11:50. Single rolling handoff — overwrites the prior one; reflects current state.*

## Overall goal (anchor)
Build **Cadence** — a Windows 11 system-tray time tracker whose differentiator is tracking multiple
tasks **in parallel**; ClickUp read-only, local-first, pixel-faithful to the `3a` flyout. Hands-off
**dogfood** build. (Charter: `CLAUDE.md`. Plan: `IMPLEMENTATION_PLAN.md`. Spine: `VERIFICATION_SPINE.md`.)

## ✅ Stage 5a (ClickUp READ — auth + traversal + mapping) is DONE, reviewed (3-lens panel), all gates green, fixes applied. Next stop: **Stage 5b — refresh / resilience / rate-limit / filters / connect-state.**
Stage 5a delivered a verified, real ClickUp catalogue: a pure, injected-deps read client that fetches
ALL open tasks + subtasks across every space/list, maps them to the local `Task` model, and feeds them
to the engine on launch. Verified live against Luca's real Free-plan workspace (`90121836206` "Luca Chech
AI", user id `302553911`, 5 tasks across 3 lists). Ended on the **automated review-panel gate** (no human
review) per the spine. Committed + pushed with this handoff.

## What this session accomplished
- **Re-confirmed the ClickUp v2 contract live + docs** (spine precondition; strengthened Stage-0 check).
  Authoritative findings that shaped the client (several corrected the prior handoff's assumptions):
  - Transport: **Node global `fetch`** works; `curl` fails in this env (TLS/egress — HTTP 000). Use fetch.
  - `/list/{id}/task` response IS `{ tasks, last_page }`; `page` is **0-indexed**, 100/page. Stop on
    `last_page === true` OR a short page (< 100).
  - A task's own `space` field is `{ id }` only — **no name**. So the `Space › List` breadcrumb comes
    from the **per-list traversal context**, never the task. (`task.list` does carry `{ id, name }`.)
  - Folderless lists report a synthetic `folder: { name: "hidden" }` → ignored (breadcrumb is Space › List).
  - `status` → `task.status.status` (e.g. "to do"); `assignees[].id` and `user.id` are **numbers** →
    normalized to strings. `custom_id` is **null** on this Free plan (code chip hidden).
  - Rate-limit headers present: `x-ratelimit-limit: 100`, `x-ratelimit-remaining`, `x-ratelimit-reset`
    (429/backoff is Stage 5b).
- **`src/main/clickup.ts` (new)** — the read client. **No Electron import**, all I/O injected (mirrors the
  engine), so it's fully unit-testable with a fake `fetch` and re-runnable live:
  - `resolveToken(envDir=cwd)` — `process.env.CLICKUP_TOKEN` → `<envDir>/.env.local` (parsed by pure
    `parseTokenFromEnv`) → null. App callers pass `app.getAppPath()`.
  - `colorForList(listId)` — **deterministic** djb2 hash into `CLICKUP_PALETTE` (the exact five signed-off
    `3a` card colors `['#0058bc','#fe9400','#c64f00','#4b3fb0','#0091b3']`; **no green**).
  - `mapTask(raw, ctx)` — `code = custom_id || null`; `color = colorForList(listId)`; `status`,
    `assigneeIds` (strings); breadcrumb from `ctx`; `source:'clickup'`.
  - `fetchCatalogue({token, fetchFn?, base?, perRequestTimeoutMs?})` — `/user` → `/team` → per space
    `/space/{id}/folder` (folders' lists) + `/space/{id}/list` (folderless) → per list `/list/{id}/task`
    (paginated). **Dedupe by id, first-breadcrumb-wins.** Returns `{ currentUserId, tasks }`. Each GET is
    bounded by a **per-request timeout** (`AbortSignal.timeout`, 20s default — a safety deadline, NOT 5b
    retry/backoff). Ids are `encodeURIComponent`d before interpolation. Non-2xx **and** a non-JSON 2xx both
    throw a typed `ClickUpApiError(status, path)` (never carries the token). GET-only — no push.
- **`src/shared/types.ts`** — added optional `status?: string|null` + `assigneeIds?: readonly string[]` to
  `Task` (the mapping target the filter's `FilterableRow` already anticipated). Optional → manual tasks
  and pre-5a data stay valid; engine derivation never branches on them; they flow `Task`→`TaskRow`
  (`toRow` spreads `...task`) → snapshot → renderer automatically.
- **`src/main/engine/store.ts`** — hardened `isTask` to validate `status`/`assigneeIds` **when present**
  (so a corrupt persisted row can't feed a bad value to the filter's `.includes`).
- **`src/main/index.ts`** — (1) `refreshCatalogueOnLaunch(engine)`: a **minimal, non-fatal** one-shot
  launch fetch — no token → log+skip; any error caught+logged (token never logged); on success
  `engine.setCatalogue(tasks)` + `pushState`. Wired via `if (!HARNESS) void refreshCatalogueOnLaunch(engine)`.
  (2) `CADENCE_CLICKUPTEST` **window-less** verify branch (`runClickUpVerify`) — resolves token, fetches
  real catalogue, runs it through a fresh engine on an isolated userData dir, asserts the contract, writes
  `clickup-result.json`, exits. Returns early in `whenReady` before any window/tray.
- **`src/main/clickup.test.ts` (new)** — 10 Vitest unit tests (injected fake fetch): token parse/resolve,
  color determinism, mapping, and a full traversal exercising folder+folderless lists, **100-boundary
  pagination**, **dedupe first-breadcrumb-wins**, assignee-number→string, name fallback, `ClickUpApiError`.
- **`scripts/clickup-verify.mjs` (new)** + `npm run verify:clickup` — reads `.env.local`, passes the token
  to the spawned electron via env, runs the CLICKUPTEST branch, reports 0/1. Skips loudly (exit 0) if no
  token. Never prints/persists the token.
- **Review panel (3 adversarial lenses, all clean):** integration/resilience (no critical/high; MEDIUM
  robustness edges), security/secrets (**CLEAN** — no token leak path), spec-conformance (**CONFORMANT**).
  **Fixes applied:** per-request timeout; `encodeURIComponent` on ids; typed error on non-JSON 2xx;
  softened the dedupe-determinism docstring; reconciled the `resolveToken` doc with `app.getAppPath()`;
  cross-referenced the duplicated token parse (clickup.ts ↔ clickup-verify.mjs); pinned the "child never
  prints the token" invariant; turned an always-`true` verify assertion into a real predicate.

## Current state
- **Stage 5a complete, reviewed, all gates green, committed + pushed.** Working tree clean after commit.
- **All gates:** `npm run typecheck` clean · `npm run lint` clean · `npm test` **99 passed**
  (57 engine + 12 filter + 20 window + **10 clickup**) · `npm run build` clean · `npm run smoke` 5/5 ·
  `npm run verify:ipc` **12/12** · `npm run verify:tray` **13/13** · **`npm run verify:clickup` 10/10 (LIVE)**.
- Launch the app now and it fetches the real ClickUp catalogue and renders it as PAUSED rows (deterministic
  colors, real Space › List breadcrumbs). No refresh loop / cache / filters yet (5b).
- Secret hygiene verified: `.env.local` gitignored (`.env.*` + `*.local`) & untracked; no `pk_` in tracked
  files or git history; client is GET-only. Next human gate is still **Stage 6** (T2, clean-install + reboot).

## Next actions (priority order) — Stage 5b: refresh / resilience / rate-limit / filters / connect-state
Read `IMPLEMENTATION_PLAN.md` **Phase 5** (Refresh & resilience) + `VERIFICATION_SPINE.md` **Stage 5**
`missing_checks` first. Build on the 5a seam (`refreshCatalogueOnLaunch` + `fetchCatalogue`).
1. **Cache-first launch:** persist the last good catalogue to `clickup-cache.json` (userData; the store
   module already reserves this filename in its header comment — add read/write there). Show cache
   immediately on launch, then refresh from the API. Update the footer "Tasks refreshed Xm ago".
2. **Manual Refresh** (tray menu + footer). **Refresh = metadata-only:** update name/breadcrumb/color/
   status/assignees for tasks still present, upsert `tasks-store.json`, **never touch intervals, never
   reorder/interrupt a running card.**
3. **Rate-limit + resilience:** throttle to the **100 req/min** floor; on `429` honor `X-RateLimit-Reset`
   and back off; on failure keep the cached catalogue + a non-blocking error. (5a already has a per-request
   timeout + typed `ClickUpApiError.status` to branch on — build the 429 path on that.) Consider per-list
   failure skipping (a single bad list shouldn't drop the whole catalogue).
4. **Wire the filter (already built + unit-tested):** capture `currentUserId` from the fetch (5a discards
   it — see `refreshCatalogueOnLaunch`) and thread it into `applyPausedFilter(rows, filter, currentUserId)`;
   the rows already carry `status`/`assigneeIds`. Add the FilterControl state plumbing.
5. **Connect-state:** no-token → "Connect ClickUp" prompt (not a blank panel). Add an **in-app token field
   encrypted via `safeStorage`** (DPAPI) reachable from the tray menu — the build's **secret-at-rest
   boundary**. Keep the raw token off disk/logs. `resolveToken` currently handles dev `.env.local`; add the
   `safeStorage` path for the shipped app.
6. **Stage 5b verification** = docs-check + `/verify` (injected 429 backoff; >100-task list pagination
   boundary; blank/invalid-token → connect prompt; safeStorage round-trip with raw `pk_` never on disk/logs;
   "Assigned to me" filters OUT a task assigned to someone else) + review panel (integration/resilience +
   security). Ends on the **automated** gate → summary + "start a new session"; auto-`/future-claude` first.

## Open threads / do-not-relitigate (settled)
- **Stage-5a settled decisions (flagged by the review panel, accepted):**
  1. **Launch fetch lives in 5a** (borderline 5a/5b): it ships ZERO 5b resilience (no cache/throttle/
     backoff/retry/connect-prompt) — it's just the minimal seam that makes the real catalogue render.
     Intentional; don't read it as scope-creep.
  2. **Per-request timeout is a safety deadline, NOT 5b's retry/backoff** — those stay 5b. Don't remove it.
  3. **Traversal is fully sequential** (defensible under the 100-req/min floor). The verify harness is
     bounded by a 60s external SIGKILL; the per-request timeout keeps a hung fetch inside that. If the
     workspace grows large enough that sequential traversal > 60s, revisit the harness timeout (not a 5a bug).
  4. **`code` maps empty-string `custom_id` → null** (stricter than literal `?? null`; an empty chip is
     meaningless) and endpoints add `?archived=false` (matches "exclude archived" intent). Accepted.
- **Carry-forwards from earlier stages (still holding, grep-verified none re-introduced this stage):**
  local event log = source of truth; **NO ClickUp push in v0** (client is GET-only); per-task elapsed =
  union; tray tooltip = union (never a per-task sum); `pausedCount` never shrinks under the filter;
  `sessionWorkedMs` in ms; self-hosted fonts; `sandbox:true`; `*.md` in `.prettierignore`; do NOT
  re-litigate the `3a` look (Luca signed it off, T3); `glyph` carried but not rendered; renderer is a pure
  projection (never re-sums/re-sorts).
- **Multi-monitor positioning** stays deferred (primary display only) — do not expand scope.

## Pointers
- **Build root must be local** (laptop C:), not `G:\Other computers\…`. Commands: `npm run dev`
  (electron-vite dev; renderer also at `http://localhost:5173/` in a browser → fixture fallback, no live
  engine) · `npm test` (99) · `npm run typecheck` · `npm run lint` · `npm run build` · `npm run smoke` ·
  `npm run verify:ipc` · `npm run verify:tray` · **`npm run verify:clickup`** (Stage-5a live real-data).
- **Stage-5a code:** `src/main/clickup.ts` (client — token/color/mapping/traversal/pagination/dedupe) ·
  `src/main/clickup.test.ts` (10 unit tests, injected fetch) · `scripts/clickup-verify.mjs` (live harness) ·
  `src/main/index.ts` (`refreshCatalogueOnLaunch`, `runClickUpVerify`, `CADENCE_CLICKUPTEST` branch,
  `whenReady` wiring) · `src/shared/types.ts` (`Task.status`/`assigneeIds`) · `src/main/engine/store.ts`
  (`isTask` guard). **Phase-5 engine entry point:** `engine.setCatalogue(tasks)` (metadata-only; one atomic
  store write; never touches the worklog).
- **The filter** (`src/renderer/src/flyout/filter.ts`) — `applyPausedFilter(rows, filter, currentUserId)`
  is pure + unit-tested and READY; `FilterableRow` = `TaskRow & { status?, assigneeIds? }`. 5b supplies
  `currentUserId` (from the fetch) + the FilterControl state.
- **Persistence** (`src/main/engine/store.ts`): `worklog.jsonl` (source of truth) + `tasks-store.json`
  (metadata snapshot, atomic write). `clickup-cache.json` is **reserved but not yet implemented** — 5b adds it.
- **Verify harnesses** all mirror one pattern: a `CADENCE_*` env branch in `src/main/index.ts` + a
  `scripts/*.mjs` spawner on an isolated userData dir (`smoke.mjs`/CADENCE_SMOKE, `ipc-verify.mjs`/
  CADENCE_IPCTEST, `tray-verify.mjs`/CADENCE_TRAYTEST, `clickup-verify.mjs`/CADENCE_CLICKUPTEST — the last
  is window-less and passes the token via env).
- Plan: `IMPLEMENTATION_PLAN.md` (**Phase 5** Refresh & resilience next) · Spine: `VERIFICATION_SPINE.md`
  (**Stage 5**, soft automated gate; `missing_checks` are the highest-value 5b adds) · Charter: `CLAUDE.md`.
  Doctrine: no human review of routine diffs; mandatory autonomous review panel after every non-trivial
  phase; human gates only at T1/T2/T3 (next is Stage 6 — T2); one phase = one bounded session;
  auto-`/future-claude` before every handoff.
- GitHub: `https://github.com/LucaChech/time_tracker` (PUBLIC, `main`, `origin`). gh authed as `LucaChech`.
  Secret hygiene load-bearing: real `pk_` token only in untracked `.env.local`.
- ClickUp (Stage 5b): base `https://api.clickup.com/api/v2`; header `Authorization: <pk_token>`
  (**no `Bearer`**); workspace id `90121836206` (2 spaces "Online presence" + "Automations", ~5 folderless
  lists); user id `302553911`; Free plan → `custom_id` null, lists have no API color. Use Node `fetch`, not curl.
