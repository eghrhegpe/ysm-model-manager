# ADR-217：backend 分层治理：纯解析函数下沉 parsers 断环 + Tier 判定收敛

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-09
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/backend/`、`frontend/src/parsers/`、`frontend/src/preview-3d/decoder/`

---

## 1. 背景（Context）

`backend/` 是 `check-layering.ts` 明示的「法外之地」（不参与分层判定），内部依赖无人拦。
实测长出两处双向环：

- **环 A（backend⇄preview-3d）**：`backend/web-fs-bedrock.ts` 运行期 import `preview-3d/decoder/geometry.ts`
  与 `parse-ysm-json.ts` 的纯解析函数；而 `preview-3d/decoder/wasm-decode.ts` 反向 import `backend/app.ts`（`getApp`）。
  backend 作为基础设施层反向依赖渲染层解析函数，越界且构成环。
- **环 B（backend⇄workers）**：`backend/web-stats.ts` import `workers/stats-protocol.ts`；
  `workers/stats.worker.ts` 反向 import `backend/idb.ts` + `backend/web-common.ts`；`workers/coi-sw.ts` import `backend/platform-web.ts`。

另外平台 Tier（0/1/2）判定在 `platform.ts` / `platform-web.ts` 抄了三遍，由 `platform-parity.test.ts` 对拍守护等价性。

## 2. 决策（Decision）

### 2.1 环 A 断环（已落地）

将 `parseBedrockGeometryFromJSON` 与 `parseYsmJsonDirect` 两个**纯 JSON 解析函数**下沉至 `frontend/src/parsers/`：

- 新建 `parsers/bedrock-geometry.ts`：搬入 `parseBedrockGeometryFromJSON` + 4 个公开类型
  （`BedrockCube/BedrockSubModel/BedrockBone/BedrockGeometry`）+ 私有接口；仅 `import type AnimationClip`
  （来自 `@/utils/animation`，纯类型依赖）。
- 新建 `parsers/ysm-json.ts`：搬入 `parseYsmJsonDirect` + 守卫函数；`DecodedYsm` 类型仍
  `import type` 自 `preview-3d/decoder/utils.ts`（类型依赖，无运行期环）。
- 原 `preview-3d/decoder/geometry.ts` / `parse-ysm-json.ts` **改为 re-export 兜底**
  （`export { ... } from "@/parsers/..."`），使 decoder 内部与全部下游测试现有 import **零改动**。
- `backend/web-fs-bedrock.ts` 的 import 源由 `@/preview-3d/decoder/*` 改为 `@/parsers/*`。

效果：backend→preview-3d 运行期边消除，环 A 即破；`BedrockGeometry` 等类型消费方（~30 文件）不受影响。

### 2.2 环 B（后批已落地，见 f94625e4d）

原计划暂缓的环 B 随 isWebPlatform 上移中性层一并收口：`workers/stats.worker.ts` 的
`idbGet` / `parseWebPath` 改从 `utils/storage/idb.ts` / `utils/base/web-path.ts`（中性层）
取用，backend⇄workers 运行期环已破；`workers/coi-sw.ts` → `backend/platform.ts`
（isWebPlatform，中性叶子）为唯一保留边，不构成环。

### 2.3 Tier 判定收敛（已落地，见 P1-3 实施）

`platform.ts` 的 Tier 原语保留；新增单一 `resolveTier()` 组合函数，`platform-web.ts` 仅做 tier→mode 映射；
删除 `platform-parity.test.ts` 复制粘贴对拍守护（单一来源后无需对拍）。

## 3. 后果（Consequences）

- 正面：backend 不再运行期依赖渲染层（环 A 破）；workers 不再运行期依赖 backend（环 B 破）；
  `parsers/` 成为纯解析函数单一归属层；`utils/storage` / `utils/base/web-path` 收纳原 backend 中性能力。
- 负面：decoder 原文件退化为 re-export 转发（可接受，零回归）。
- 遗留：`parsers/ysm-json.ts` 因兄弟 AI 并行重构已将作者解析抽到 `preview-3d/decoder/ysm-authors.ts`，
  现运行期 `import { parseYsmAuthors }`（经 parsers 中转，backend 源码已无 `@/preview-3d` 直接依赖，环 A 直接边已断）；
  并仍 `import type { DecodedYsm }` 自 `preview-3d/decoder/utils.ts`（纯类型，无运行期环）。

## 4. 数据溯源

- 来源：上一轮 backend 锐评（P1-2 断环建议）→ `check-layering` 豁免名单 + 依赖边 grep 实证。
- 结果：新建 2 文件 + 2 re-export 改造 + 1 backend import 源改造 + 本 ADR。
