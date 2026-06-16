# YSM Model Manager — Annual Roadmap

Version: 2026-2027  
Last updated: 2026-06-16  

---

## 1. Strategic Objectives

| Quarter | Focus | Success Metric |
|---------|-------|----------------|
| Q3 2026 | Stability & UX polish | Crash rate < 0.5%, 90% animation coverage |
| Q4 2026 | Performance & scale | 10k-file repo remains responsive, preview cache hit rate > 60% |
| Q1 2027 | Extensibility | Plugin API stable, 3+ community resource types supported |
| Q2 2027 | Distribution | Auto-update reliability > 95%, onboarding friction reduced by 30% |

---

## 2. Architecture Principles

- **Backend**: Go (Wails v2 bindings). File ops, scanning, sync, and YSM decoding belong in Go.
- **Frontend**: Native JS + Web Components + Shadow DOM. No framework migration.
- **State**: Module-level singletons for cross-page persistence (`download-queue.js` pattern).
- **Styling**: CSS variables + `adoptedStyleSheets`. No inline styles.
- **Decoding**: WASM-first, CLI fallback. Both paths must produce identical output.

---

## 3. Workstreams

### 3.1 Core Reliability

| # | Task | Owner | Target | Notes |
|---|------|-------|--------|-------|
| 1.1 | Harden `GetRepoRoot` edge cases | Backend | Q3 | Empty `rtype`, missing config, cross-type search |
| 1.2 | Unify error handling path | Frontend | Q3 | `friendlyError` + toast prefixes only |
| 1.3 | Add graceful degradation when Node.js/WASM missing | Backend | Q3 | Clear user messaging, no silent failures |
| 1.4 | File watcher stress tests | Backend | Q4 | Rapid rename/ban cycles |

### 3.2 Performance

| # | Task | Owner | Target | Notes |
|---|------|-------|--------|-------|
| 2.1 | model2D preview cache | Frontend | Q4 | SHA256 + size key, LRU 50, canvas invalidation |
| 2.2 | Virtual scroll for app-tree | Frontend | Q4 | Already prototyped in v1.5.x, re-integrate safely |
| 2.3 | Scan cache invalidation strategy | Backend | Q4 | Avoid full rescans on every tab switch |
| 2.4 | Lazy-load non-critical WASM data | Frontend | Q1 | Reduce initial bundle warning |

### 3.3 User Experience

| # | Task | Owner | Target | Notes |
|---|------|-------|--------|-------|
| 3.1 | Complete animation system | Frontend | Q3 | Remaining lists, empty states, dialogs |
| 3.2 | Overlay UX refinement | Frontend | Q3 | Third-party review items |
| 3.3 | List / grid view toggle | Frontend | Q4 | Compact row template, persistent preference |
| 3.4 | Onboarding flow | Frontend | Q2 | First-launch directory detection wizard |
| 3.5 | Improved empty/error states | Frontend | Q4 | Consistent illustrations and actions |

### 3.4 Resource Type Expansion

| # | Task | Owner | Target | Notes |
|---|------|-------|--------|-------|
| 4.1 | Resource type registry v2 | Backend | Q4 | JSON-driven, user-editable |
| 4.2 | MMD / VRC first-class support | Both | Q4 | Stable push/pull/install flow |
| 4.3 | Shader pack & schematic workflows | Both | Q1 | Use registry, no hardcoded types |
| 4.4 | Plugin API draft | Backend | Q2 | Hook into scan, install, preview pipelines |

### 3.5 Quality & Testing

| # | Task | Owner | Target | Notes |
|---|------|-------|--------|-------|
| 5.1 | Frontend test expansion | Frontend | Q4 | download-queue, render.js, bus events |
| 5.2 | Go test coverage: installer/importer/watcher | Backend | Q4 | Currently gaps |
| 5.3 | Integration test harness | Both | Q1 | Temporary directories, deterministic fixtures |
| 5.4 | Release checklist automation | DevOps | Q2 | Build + smoke tests + SHA256SUMS |

### 3.6 Documentation & Terminology

| # | Task | Owner | Target | Notes |
|---|------|-------|--------|-------|
| 6.1 | `docs/TERMINOLOGY.md` | Docs | Q3 | UI copy / code field / definition |
| 6.2 | `docs/ARCHITECTURE_DECISIONS.md` | Docs | Q4 | Why WASM-first, why no framework, etc. |
| 6.3 | User guide refresh | Docs | Q1 | Match new resource types and UI |
| 6.4 | AI onboarding index update | Docs | Ongoing | Keep `AGENTS.md` / `AI_INDEX.md` current |

---

## 4. Technical Debt Register

| Item | Risk if ignored | Planned resolution |
|------|-----------------|-------------------|
| Inline style remnants | Inconsistent UI, animation gaps | Audit + migrate by Q4 |
| Mixed Chinese copy terminology | Confusing UX, translation blockers | Terminology lock by Q3 |
| Large WASM bundle | Slow startup, build warning | Lazy load or split by Q1 |
| Preview cache missing | Repeated CPU work on community browse | Implement by Q4 |
| `window.*` debug globals | Pollution, breakage risk | Enforce ESLint rule by Q3 |

---

## 5. Milestones

- **v1.8.0** (Q3 2026): Terminology lock, animation completion, reliability fixes.
- **v1.9.0** (Q4 2026): Performance release — preview cache, virtual scroll, scan optimization.
- **v2.0.0** (Q1 2027): Resource type registry v2 + MMD/VRC GA + plugin API beta.
- **v2.1.0** (Q2 2027): Distribution & onboarding — auto-update hardening, setup wizard.

---

## 6. Non-Goals

- No migration to React/Vue/Svelte.
- No cloud account or telemetry.
- No online model marketplace integration.
- No macOS/Linux as primary targets this year.

---

## 7. Review Cadence

- Monthly: roadmap vs. actual check.
- Per release: update this document and `docs/release-notes/`.
- Quarterly: architecture decision review.
