---
kind: fe_layering_seams
name: 前端分层 seam 与 import 路径
tier: leaf
category: core
status: active
source_files:
  - scripts/check-layering.ts
  - scripts/check-path-hygiene.ts
  - frontend/src/features/backend-deps.ts
auto_fields:
  symbols_with_lines:
    - backendGetApp
    - htmlLiteralHits
    - matchImports
    - MENU_SUB_RANK
    - menuSubOf
    - P3D_LOWER_SUBS
    - P3D_UPPER_SUBS
    - p3dSubOf
    - R10_WHITELIST_FILES
    - R10_WHITELIST_PREFIXES
    - r10EdgeViolates
    - r10TargetAllowed
    - r7EdgeViolates
    - R8_ALLOW_MARKER
    - r9EdgeViolates
use_when:
  - src/core 想新增文件或依赖前
  - features 模块需要拿到 backend 能力时
  - 写 import 犹豫用 @/ 还是 ../ 时
  - 门禁报 check-layering / check-path-hygiene 编号不知道查哪条
pitfalls:
  - 三套门禁同号异策——R5 在 check-layering 是 seam 红线、在 check-path-hygiene 是同目录别名提示，勿混（见下方对照表）
  - core 测试文件同样受 check-layering R6 约束（引擎无关对 type 感知不成立）
  - HTML 字面量存量在 baseline 只减不增，触碰即顺手收敛，新增即红
quick_groups:
  - 前端分层与边界
quick_intents:
  - core 准入三条全满足才可入；绑定能力走依赖注入不走直引
  - features 拿 backend 能力唯一出口是 *-deps.ts seam + 注入形态
  - import 非精确同目录一律 @/顶层/具体文件，禁裸目录聚口
quick_risk_lines:
  - core 直引 backend/* 或 features 直引 backend/app.ts = 门禁阻断
invariant_anchors:
  - scripts/check-layering.ts|R5（零容忍）
  - scripts/check-layering.ts|R8（防回退）
  - scripts/check-layering.ts|R9（防回退）
  - scripts/check-layering.ts|R10（防回退）
---

# 前端分层 seam 与 import 路径

## 概览

前端三大分层约束的完整版（原 AGENTS.md「src/core 准入」「features→backend seam」「前端 import 路径约定」三节全文迁入，2026-10-04 常驻层瘦身）。执法闸：`scripts/check-layering.ts` + `scripts/check-path-hygiene.ts`。

## 三套门禁同号异策对照表（根治「勿混淆」注脚）

| 规则号 | check-layering（分层） | check-path-hygiene（路径） | check-redlines（治理，R1–R10 见 skills/governance-rules.md） |
|--------|------------------------|---------------------------|------------------ |
| R0 | core 禁运行时 import utils/dom（零容忍） | — | — |
| R3 | — | 深 `../` 上跳 > 3 提示 | 禁回调式 API |
| R4 | — | 越 `src` 边界阻断 | 禁 `display:none/block` 动画 |
| R5 | features/views 生产文件禁直引 `backend/app.ts`（零容忍） | 兄弟文件用 `@/` 别名提示 | 禁硬编码颜色 |
| R6 | core 测试文件禁 import backend/*（零容忍） | 禁 `@/dir` 裸目录聚口 | 禁 `public/` 放 JS |
| R7 | preview-3d/menu/ 子目录内 import 方向按 rank 自顶向下（零容忍，ADR-270） | — | — |
| R8 | features 生产文件禁 HTML 字面量（防回退） | — | 禁未转义拼接 HTML |
| R9 | preview-3d 全区 import 方向闸（防回退，ADR-270-d1） | — | — |
| R10 | views 禁穿透 preview-3d 内部件，仅入口面白名单（防回退，ADR-270-d2） | — | — |

## src/core 准入准则（ADR-189 D4）

`frontend/src/core` 是**引擎无关内核**（i18n + page-store + 注入式 error-diary + model-path-store），准入三条全满足才可入：

1. **引擎无关**：不 import three/Wails。
2. **不依赖上层与 DOM 原语层**：features/views/backend/utils/dom 一律禁止；`utils/base/` 允许——其中 `pure/` 是真纯函数层（array, clamp, gh-links, guards, recycle-path, safe-error-msg, tex-size, apperror-text），零副作用；`primitives/` 是副作用原语层（async, base64, debounce, disposable, lock, log, main-thread-watch, storage），仍零上层依赖。core 现状依赖 primitives/ 的 log/storage、@/bus 及 @/locales/*（类型源），依赖方向只许别人引它。越层执法：utils/dom 越层走 check-layering R0、backend 越层走 R6（含 core 测试文件——ADR-189 D4 引擎无关对 type 感知不成立）。
3. **无 Wails 也能单测**。

- 需要绑定的能力（如 `AddOpLog`）走**依赖注入**：core 定义接口（`DiarySink`），`backend/` 提供适配器，装配层（`app-modules.ts`）接线——禁止 core 直接 `import backend/*`（回归红线，check-layering R6 兜底；测试文件越层 2026-09 补齐后无盲区）。
- DOM 原语（toast 等）归 `utils/dom/`，不进 core；原 `utils/core/` 已迁入 `utils/base/` 结构，勿再新建同名目录。
- ⚠️ `utils/async/load-guard.ts` 非「待收敛孤岛」——ADR-230 代际守卫唯一出口，禁止迁入 `utils/base/`，详见知识卡 `load_guard.md`。

## features→backend seam（ADR-190 D2 / ADR-208 D1，回归红线）

- features 生产文件**禁止直接 import `backend/app.ts`**；唯一合法出口 = `*-deps.ts` seam 组合根（features 根 `backend-deps.ts` 供零散模块 + 目录级 `community-deps.ts` / `context-menu-deps.ts`）。
- 「生产默认 getApp」一律写 `deps?.fn || backendGetApp` 注入形态。check-layering 门禁 R5 兜底。
- **features 生产文件禁 HTML 字面量（check-layering R8，防回退，2026-09-20 立法）**：ADR-190 D1a / ADR-208 D2「HTML 模板归 views」执法——字符串/模板串含 HTML 标签即违规；存量在 `docs/.layering-baseline.json`（只减不增，触碰即顺手收敛：tpl 注入或 DOM API 构建 + `outerHTML`），新增即红；确属 HTML 数据语义的场景用行尾注 `// layering-allow: html` 精确豁免。

## 前端 import 路径约定（ADR-146，别让大模型手写错路径深度）

- **任何非精确同目录的 import**（跨顶层**或**同顶层内不同子目录）→ 一律 `@/<顶层目录>/具体文件`（如 `@/features/repo/x.ts`）。别手算 `../` 深度——精确同目录就写 `./`，其余就写 `@/`。
- **精确同目录**（兄弟文件）→ 用相对 `./xxx`；同目录还用别名是噪音（path-hygiene R5 提示）。
- **神桶红线**：import 只从**具体文件**进，禁止 `@/dir`（裸目录聚口）或 `@/dir/index` 入口——尤其测试文件，防「一根测试拉起一整个模块」（path-hygiene R6 提示）。src 根文件 `@/bus`、`@/theme-core` 是**文件级别名**（指向具体叶），不算桶。
- 相对深度已全仓归零（仅 `./` 精确同目录 + 越界相对），已全量收敛。

## 相关

- `load_guard.md`（ADR-230）；`fe_go_boundary.md`（前端 vs Go 归属）；skills/governance-rules.md（check-redlines R1–R10）；ADR-146 / ADR-189 / ADR-190 / ADR-208 / ADR-230
