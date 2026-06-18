# app-content-1 - Work Plan

## TL;DR (For humans)
<!-- Fill this LAST, after the detailed plan below is written, so it summarizes the REAL plan. -->
<!-- Plain English for a non-engineer: NO file paths, NO todo numbers, NO wave/agent/tool names. -->

**What you'll get:** <fill last - deliverables in human terms, 1-2 sentences>

**Why this approach:** <fill last - the one or two load-bearing decisions and why>

**What it will NOT do:** <fill last - 1-3 plain lines mirroring Must NOT have>

**Effort:** <Quick | Short | Medium | Large | XL>
**Risk:** <Low | Medium | High> - <one-line driver>
**Decisions to sanity-check:** <fill last - the few choices worth a human glance>

Your next move: <fill - e.g. approve, or run a high-accuracy review>. Full execution detail follows below.

---

> TL;DR (machine): <1 line - effort, risk, deliverables>

## Scope
### Must have
### Must NOT have (guardrails, anti-slop, scope boundaries)

## Verification strategy
> Zero human intervention - all verification is agent-executed.
- Test decision: <TDD | tests-after | none> + framework
- Evidence: .omo/evidence/task-<N>-app-content-1.<ext>

## Execution strategy
### Parallel execution waves
> Target 5-8 todos per wave. Fewer than 3 (except the final) means you under-split.

### Dependency matrix
| Todo | Depends on | Blocks | Can parallelize with |
| --- | --- | --- | --- |

## Todos

### Phase 1: Community Component Split (HEAVY)
- `frontend/js/components/app-content/community/`: Create new directory and extract all community-related logic from `community-site-view.js` and `community-css.js`.
  - **Acceptance**: `community-site-view.js` must be empty, `community-css.js` must be empty, and all extracted code must reside in the new `community/` directory with identical behavior.
  - **Verify**: `lsp_diagnostics frontend/js/components/app-content/community/` (0 errors), `npx vite build` (0 errors), `visual-qa --baseline community` (no visual regression).

### Phase 2: Settings Component Split (HEAVY)
- `frontend/js/components/app-content/settings/`: Create new directory and extract all settings-related logic from `settings-view.js` and `settings-css.js`.
  - **Acceptance**: `settings-view.js` and `settings-css.js` must be empty, and all extracted code must reside in the new `settings/` directory.
  - **Verify**: `lsp_diagnostics frontend/js/components/app-content/settings/` (0 errors), `npx vite build` (0 errors), `visual-qa --baseline settings` (no visual regression).

### Phase 3: Diagnostics Component Split (HEAVY)
- `frontend/js/components/app-content/diagnostics/`: Create new directory and extract all diagnostics-related logic from `diagnostics-view.js` and `diagnostics-css.js`.
  - **Acceptance**: `diagnostics-view.js` and `diagnostics-css.js` must be empty, and all extracted code must reside in the new `diagnostics/` directory.
  - **Verify**: `lsp_diagnostics frontend/js/components/app-content/diagnostics/` (0 errors), `npx vite build` (0 errors), `visual-qa --baseline diagnostics` (no visual regression).

### Phase 4: Test Coverage & Final Verification (LIGHT)
- `frontend/js/components/app-content/test/`: Add new unit tests for each of the three new components.
  - **Acceptance**: `npm test` must pass with 100% coverage on the new `community/`, `settings/`, and `diagnostics/` directories.
  - **Verify**: `npm test -- --coverage` (100% coverage), `npx vite build` (0 errors), `visual-qa --final` (full app screenshot comparison).
> Implementation + Test = ONE todo. Never separate.
<!-- APPEND TASK BATCHES BELOW THIS LINE WITH edit/apply_patch - never rewrite the headers above. -->
- [ ] 1. <title>
  What to do / Must NOT do: <...>
  Parallelization: Wave <N> | Blocked by: <...> | Blocks: <...>
  References (executor has NO interview context - be exhaustive): <src/path:lines>
  Acceptance criteria (agent-executable): <exact command or assertion>
  QA scenarios (name the exact tool + invocation): happy + failure, Evidence .omo/evidence/task-1-app-content-1.<ext>
  Commit: <Y/N> | <type>(<scope>): <summary>

## Final verification wave
> Runs in parallel after ALL todos. ALL must APPROVE. Surface results and wait for the user's explicit okay before declaring complete.
- [ ] F1. Plan compliance audit
- [ ] F2. Code quality review
- [ ] F3. Real manual QA
- [ ] F4. Scope fidelity

## Commit strategy

## Success criteria
