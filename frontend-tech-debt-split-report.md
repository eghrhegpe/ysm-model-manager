# frontend/src 生产代码大文件（技术债候选）拆分优先级清单

> 范围：`frontend/src/**/*.ts`（排除 `*.test.ts` / `*.spec.ts` / `*.d.ts` / `*_test.ts`）
> 判定方式：PowerShell 行数排序 → 逐文件读头部注释/导入/顶层导出 → 结合 AGENTS.md 前端三约束 + `docs/knowledge/fe-layering-seams.md` 红线判断
> 结论：**Top 20 里 9 个不宜拆，真正干净可拆的只有 3 个**（且都是中低优先级）。本仓前端已经过 ADR-040 / ADR-167 / ADR-190 / ADR-208 等多轮拆分，剩余大文件大多是有意为之的「薄封装 + 注册表」或「已拆子模块的门面」。

---

## 一、候选 Top 10 表

按生产代码行数排序（去掉纯数据词典后的前 10 逻辑文件）：

| # | 文件路径 | 行数 | 单一职责判断 | 建议动作 |
|---|---------|-----|-------------|---------|
| 1 | `frontend/src/backend/web-fs.ts` | 1030 | **已拆门面 + 少量内联段**（§4 扫描 / §10 搜索 / §13 移动复制 / §16 bindings 装配还在主文件） | **可拆（中优先）**：沿用 ADR-040 拆分套路，把残余段下沉到 `web-fs-scan.ts` / `web-fs-search.ts` / `web-fs-bindings.ts`，主文件只留门面 re-export |
| 2 | `frontend/src/preview-3d/caps/sky-capability.ts` | 995 | **单一职责**：`SkyCapability` 类 + `injectSkySunScalePatch` 补丁函数 | 不宜拆：sky-menu / sun-beams / environment-ownership 已抽出，剩下的就是「核心 + 薄封装」套路本体 |
| 3 | `frontend/src/preview-3d/adapters/mount-preview-core.ts` | 989 | **单一职责编排器**：mount3D 全生命周期（shell 装配 → 相机桥 → 根菜单 → infra → commit session） | 不宜拆：ADR-167 已把 stage 拆成 `assembleShell` / `assembleOverlayShell` / `makeCamBridge` / `mountRootMenu` / `buildInfra` 具名函数，再拆就是拆编排，收益低、风险高 |
| 4 | `frontend/src/preview-3d/state/env-state-schema.ts` | 897 | **契约锚点**：`ENV_STATE_SCHEMA` 单一事实源 + `EnvState` 类型 | 不宜拆：schema 定义 + 派生函数必须同文件（类型锚点，跨文件会循环依赖） |
| 5 | `frontend/src/preview-3d/caps/postprocessing-capability.ts` | 881 | **单一职责**：`PostprocessingCapability` + `DEFAULT_POSTPROC_PARAMS` | 不宜拆：postprocessing-state / postprocessing-menu 已抽出，本文件就是能力注册主体 |
| 6 | `frontend/src/preview-3d/caps/ground-capability.ts` | 875 | **单一职责**：`GroundCapability` + 材质预设键 | 不宜拆：ground-menu / ground-migrations / ground-surface-spec / layer-offsets 已抽出 |
| 7 | `frontend/src/preview-3d/caps/environment-capability.ts` | 848 | **单一职责**：`EnvironmentCapability` | 不宜拆：environment-menu / environment-state / environment-migrations / environment-ownership 已抽出 |
| 8 | `frontend/src/preview-3d/caps/light-capability.ts` | 846 | **单一职责**：`LightCapability` + 灯光参数换算 | 不宜拆：light-params / light-math / light-cone / light-persist / light-controls 已抽出 |
| 9 | `frontend/src/preview-3d/decoder/wasm-decode.ts` | 831 | **多内联 helper**：策略分派 / 纹理累积 / 几何合并 / 模型装配 | **可拆（中低优先）**：纯函数 helper 可下沉 `wasm-geometry.ts` / `wasm-strategy.ts` |
| 10 | `frontend/src/parsers/ysm-header.ts` | 807 | **两块独立解析**：① YSGP/text 段头解析 ② ZIP/JSON 摘要提取（Go port） | 可拆（低优先，风险中）：可拆成 `ysm-header-text.ts` + `ysm-summary.ts` + 共享 helper；但它是 Go-port parity 文件，被 binding 层 re-export，属契约锚点，须谨慎 |

### 数据词典（Top 20 中未列入上表）

| 文件 | 行数 | 结论 |
|-----|-----|------|
| `frontend/src/locales/ja.ts` | 1717 | 纯 i18n 数据表，**不是技术债**，不拆 |
| `frontend/src/locales/en.ts` | 1716 | 同上 |
| `frontend/src/locales/zh-CN.ts` | 1670 | 同上（含 `LocaleKey` 类型锚点，更不宜拆） |

---

## 二、推荐优先拆 3 个（最干净、风险最低、收益最大）

**1. `frontend/src/backend/web-fs.ts`（1030 行）→ 完成 ADR-040 拆分收尾**

- **为什么最干净**：拆分套路仓内已验证（web-fs-auth / web-fs-import / web-fs-read / web-fs-shared / web-fs-pack / web-fs-bedrock / web-fs-container 都已抽出，同目录同名 `web-fs-*.ts` 共 7 个兄弟文件），主文件头注释明确标注「§X → 下文」的段落归属，拆分就是照着注释搬运。
- **收益**：主文件降到 <400 行，只剩门面 + 少量装配代码；残余段按 §4 扫描 / §10 搜索 / §13 移动复制 / §16 bindings 装配各自独立，职责清晰。
- **风险**：低。公共 API 由门面 re-export 保持原路径不变（注释已声明「消费面零改动」），消费方（browser-adapter / web-store / web-community）不动。本文件在 `backend/` 目录内，**不属于 features 生产文件**，不触发 R5 直引 `backend/app.ts` 红线；拆分后新文件仍走相对路径 `./` 同目录 import，不触发 R6 裸目录聚口红线。
- **注意事项**：`webFsBindings` 装配涉及 binding 契约，搬运时须 `grep` 消费方，建议配 `node scripts/audit-split.ts` / `rollback-impact.ts` 做影响面分析。

**2. `frontend/src/views/app-content/settings/tpl-settings.ts`（703 行）→ 按 tab 分片**

- **为什么最干净**：文件本身就是「tpl 模板聚合器」，内含 10 个独立 `render*` 函数（基本路径 / 存储 / 语言 / 主题 / 字体 / 动画 / 默认页 / 预览3D / 解析器 worker），每段对应一个设置 tab，切分边界天然存在。仓内已有先例：`tpl-settings-about.ts` 已被拆出。
- **收益**：主文件降到 <200 行，每片 60-120 行，阅读与维护成本显著下降。
- **风险**：中低。拆分时需把共享常量（`SETTINGS_TAB_META` / `PATH_CARD_PLATFORMS` / `THEME_*` label 映射）下沉到共享模块（如 `tpl-settings-shared.ts`），新增一个叶子文件。
- **注意事项**：本文件输出 HTML 字符串（模板模块，属 ADR-190/R8 基线内的存量模板职责，非违规），拆分时**不得**引入新的 HTML 字面量到非模板文件，且 import 仍须走 `@/顶层/具体文件` 精确路径，禁止 `@/dir` 裸目录聚口。文件头 `VIEW_TESTIDS` 被测试引用，须保持稳定导出。

**3. `frontend/src/preview-3d/decoder/wasm-decode.ts`（831 行）→ 抽纯函数 helper**

- **为什么最干净**：文件内含 ~25 个模块私有纯函数，多为无状态字节/几何处理（`applyMergedGeometry` / `findZipEntryByRel` / `computeBoneTexRange` / `matchTexKey` / `collectTexturesAndAvatars` / `boxUvEnd` / `faceUvEnd` 等），可整体搬到 `wasm-geometry.ts` / `wasm-strategy.ts`，主文件只保留 `decodeYsmViaWasm` 编排 + 状态管理。
- **收益**：主文件降到 ~300 行，纯函数层可独立单测。
- **风险**：中低。纯函数搬移不改行为；唯一注意事项是**不能把 backend import（`getApp` / `readModelBytes`）带进新文件**——新文件保持零 backend 依赖即可，否则触发 R5。`decoder/` 目录下已有 `geometry.ts` / `utils.ts` / `model-cache.ts` / `ysm-meta-parser.ts` 等 20+ 兄弟文件，拆分风格一致。
- **注意事项**：`DecodeStrategies` 分派表依赖 `decodeYsmFile`（WASM）与 `parseYsmJsonDirect`，搬移时若带这三者会引入跨模块耦合，建议只搬纯字节/几何处理部分。

---

## 三、不建议拆的理由（红线 / 耦合 / 锚点）

### A. 数据词典——不是技术债

- **`frontend/src/locales/{ja,en,zh-CN}.ts`**（1717 / 1716 / 1670 行）：纯 i18n 数据表，每行一个翻译条目。拆分（如按命名空间分文件）会破坏 `LocaleKey` 类型锚点（`zh-CN.ts` 是 key 派生事实源），且 i18n 加载器按整文件加载，分片无收益。**不是技术债，保持原样。**

### B. 薄封装 + 注册表套路（ADR-073 设计本体）——不宜拆

- **`sky-capability.ts` / `postprocessing-capability.ts` / `ground-capability.ts` / `environment-capability.ts` / `light-capability.ts`**（995 / 881 / 875 / 848 / 846 行）：每个文件实现「核心（three 对象/材质）+ 状态订阅 + dispose 还原」，辅助逻辑**已经**抽出为同目录兄弟文件（`*-menu.ts` / `*-state.ts` / `*-params.ts` / `*-migrations.ts` / `*-ownership.ts` 等，每个能力 3-6 个兄弟文件）。
- **拆分理由的反驳**：把「能力类」本身再拆会导致 `SceneCapability` 实现被拆散，注册表按类发现会失效；且每个能力都有 20k-128k 字节的测试（`environment-capability.test.ts` 86k、`light-capability.test.ts` 86k、`postprocessing-capability.test.ts` 98k、`water-capability.test.ts` 128k），改动即触发全量回归。**ADR-073 的核心套路就是「核心 + 薄封装 + 注册表」，拆分反而破坏设计意图。**

### C. 编排器——不宜拆

- **`mount-preview-core.ts`**（989 行）：统一 3D 预览核心编排器，ADR-167 已把 mount3D 按 stage 拆成 5 个具名子函数（`assembleShell` / `assembleOverlayShell` / `makeCamBridge` / `mountRootMenu` / `buildInfra`），每个 100-200 行。再拆就是拆「编排」本身，函数间通过 `MountCtx` 隐式共享 `ctx` / `infra` / `session` 状态，拆到多文件会需要引入显式 context 传参或闭包工厂，**收益低、风险高**。

### D. 契约锚点——不宜拆

- **`env-state-schema.ts`**（897 行）：`ENV_STATE_SCHEMA` 是 EnvState 类型/默认值/范围的单一事实源，`EnvState` / `EnvStateKey` 类型被整个 preview-3d 消费；派生函数 `deriveDefaultEnvState` / `getPresetKeys` / `getParamRange` / `clampFieldValue` 必须与 schema 同文件，否则 schema 更新时派生函数漂移。**类型锚点，拆了就是制造不一致。**
- **`ysm-header.ts`**（807 行）：Go port parity 文件（对齐 `go/ysm/header.go` + `go/ysm/summary.go`），被 binding 层（`web-fs.ts`）re-export，是「前端解析语义 = Go 解析语义」的对照锚点。拆分虽技术可行，但会削弱 parity 对照的直观性，且 `web-fs.ts` 的 import 面要同步改。**低优先，若要拆需先写 ADR 记录 parity 对照策略。**

### E. 单组件 WebComponent——不宜拆

- **`views/app-tree/index.ts`**（669 行）：单个 `AppTree` 组件定义，但**已经**把逻辑拆成同目录兄弟文件（`authors.ts` / `bus-handlers.ts` / `data.ts` / `events.ts` / `loader.ts` / `toolbar-events.ts` / `tree-state.ts` / `app-tree-styles.ts`），主文件只剩组件类 + 装配，import 面干净（走 `@/views/backend-deps.ts` seam，合规）。**继续拆只会拆散单一组件聚合点，无收益。**

### F. 红线相关提醒（拆分新文件时须避开的雷）

| 红线 | 约束 | 涉及候选 |
|-----|------|---------|
| R5 | features/views 生产文件禁直引 `backend/app.ts` | tpl-settings（已在 views 下，拆分时新增文件仍须走 seam）、wasm-decode（若抽出 backend 调用到新文件即违规） |
| R6 | 禁 `@/dir` 裸目录聚口 | 所有新拆文件：import 一律 `@/顶层/具体文件` 或精确同目录 `./` |
| R8 | features 生产文件禁 HTML 字面量（存量只减不增） | tpl-settings 拆分时**不能**把 HTML 字面量扩散到非模板文件；`cap-controls.ts`（menu/render 层，含大量 DOM 渲染）亦属存量，拆分须保 baseline 只减不增 |
| ADR-190 | features→backend 唯一出口 = `*-deps.ts` seam | 拆分 web-fs / tpl-settings 时，若有 features 侧消费方，需确认走的是 seam |
| binding 契约 | 绑定生成走 `cd frontend && npm run generate:bindings` | web-fs.ts 的 `webFsBindings` 装配涉及 binding 面，拆前用 `node scripts/binding-check.ts` 确认 |

---

## 四、落地建议（给主代理）

1. **先做 3 个推荐拆分中的第 1 个（web-fs.ts）**：拆分套路已验证、兄弟文件 7 个、门面 re-export 保持公共 API 不变，是最低风险的一刀。用 `node scripts/audit-split.ts --files frontend/src/backend/web-fs.ts` 先跑影响面分析。
2. **第 2 个（tpl-settings.ts）** 次之：按 tab 分片 + 新建 `tpl-settings-shared.ts`，改完跑 `cd frontend && npx vite build && npm run typecheck` + `node scripts/check-biome.ts --files <改动文件...>`。
3. **第 3 个（wasm-decode.ts）** 最后：只搬纯函数 helper，**绝不**把 `getApp` / `readModelBytes` 带进新文件；`wasm-decode.test.ts` 存在，改完跑 vitest。
4. **Top 20 里其余 9 个大文件（5 个 caps + mount-preview-core + env-state-schema + app-tree/index + locales）不建议动**，它们是有意的架构形态（薄封装 / 编排器 / 契约锚点 / 数据表），拆了只增风险不增收益。
5. 拆分前**先写 ADR**（触及架构级形态如 caps 拆分须 `--tier architecture`；执行拍板级用 `--tier decisions`）；改完**必须同步知识卡**（`fe-layering-seams.md` 的 baseline / seam 组合根表）。

**底线：本仓前端已经历 ADR-040 / ADR-066 / ADR-073 / ADR-167 / ADR-178 / ADR-190 / ADR-208 多轮拆分，当前大文件是「拆完剩的硬核」——可拆空间已经不大，剩余拆分收益递减、回归成本递增，切勿「为拆而拆」。**