# preview-3d 写法锐评（2026-09-12）

> 评审对象：`frontend/src/preview-3d/`（189 生产文件 / 37,825 行，136 测试文件）
> 评审基线：知识卡 `preview_3d_migration` / `scene_capability_registry` / `3d-oversize-file-codesplit-feasibility` / `frontend_design_critique`
> 方法：知识库定标 → 项目自带 CLI 取客观指标 → 按复杂度/参数榜优先级实锤读源码

---

## 一、总体结论

**不需要推倒重来，但需要一次「函数级 + 契约级」的写法收口。加权 3.7/5。**

城邦的**主干道是干净的**：分层零违、依赖零环、类型零侵蚀、孤儿导出零。这说明治理体系（check-layering / check-circular / check-type-safety / check-orphan-exports）是真在起作用的。

问题全部出在**街巷内部**——函数体的写法、通用设施的消费率、迁移遗留的兼容层。这些恰恰是门禁扫不到的地带。

| 维度 | 分 | 判定 |
|------|----|------|
| 架构治理（分层 / 环 / 类型 / 孤儿） | 4.5 | 🟢 全绿，无需动 |
| 契约一致性（通用设施消费率） | 3.0 | 🟡 设施存在但半消费 |
| 函数级写法（复杂度 / 参数 / 分派） | 3.2 | 🟡 27 个红榜函数 |
| 迁移收口（兼容层 / 命名） | 3.4 | 🟡 活化石待清理 |
| 性能纪律（帧内分配） | 4.0 | 🟢 主干已守，IK 未对齐 |

一句话：**不是「该拆没拆」的债，是「该复用没复用」的债。**

---

## 二、客观指标（项目 CLI 实测）

| 工具 | 结果 | 解读 |
|------|------|------|
| `check-layering` | R0–R6 全 0 条，反向边 0 | 🟢 分层纪律到位 |
| `check-circular` | 889 模块，0 环 | 🟢 |
| `check-type-safety` | 生产域 `as any`/`@ts-ignore` 全 0（`!` 非空 156） | 🟢 上限侧稳；但双断言绕过扫不到（见 P0） |
| `check-orphan-exports` | 1305 导出符号，0 孤儿 | 🟢 |
| `check-complexity` | **preview-3d 命中 117（🟥27 / 🟧33 / 🟨57）** | 🔴 全仓 302 命中里占 39% |
| `check-params` | `renderPreviewDock` p10/b1、`mdVrStage5BuildResult` p9、`addMeshToBoneGroup` p8/b2、`applyWasdCameraMotion` p8/b2 | 🟡 |
| `check-deadcode-baseline` | ERROR 0（preview-3d 基线内 102 条，knip 类 56） | 🟡 存量放行，非新增 |
| `check-file-lines` | 受控文件全部在红线内 | 🟢 |

---

## 三、问题清单（按优先级）

### 🔴 P0-1　通用设施建好了，两个 cap 不吃：`restoreFields` 半消费

**证据**：`restoreFields` 定义在 `caps/scene-capability.ts:226`，被 `fog-capability.ts:228`、`ground-capability.ts:466` 正确消费；但
- `caps/light-capability.ts:40-41` 只 import `persistState, restoreState`，**不引 `restoreFields`**
- `caps/light-capability.ts:588` `loadState()` 认知复杂度 **75**（🟥 全仓 cap 类最高）
- `caps/water-capability.ts:628` `loadState()` 认知 35，同款手写

**现状写法**（light-capability.ts:617-650 节选）：

```ts
if (state.spotlight && typeof state.spotlight === "object") {
  const sp = state.spotlight as Record<string, unknown>;
  const assignments: Record<string, unknown> = {};
  if (typeof sp.enabled === "boolean") assignments.lightSpotEnabled = sp.enabled;
  if (typeof sp.color === "number")   assignments.lightSpotColor = sp.color;
  // … 7 个字段逐一手写
  if (Object.keys(assignments).length > 0) {
    setEnvState(assignments as Partial<EnvState>, { source: "manual" });
  }
}
```

三重代价：
1. `as Record<string, unknown>` + `as Partial<EnvState>` **双重断言**——`check-type-safety` 只扫 `any`，这类断言逃逸检测，字段名拼错不报错；
2. `ambient` / `spotlight` / `volumetric` 三段是**同构复制**，新增一个灯光通道就要复制一遍；
3. 认知复杂度 75 全部由 `if` 堆叠贡献。

**建议**：声明式映射表 + `restoreFields` 复用（与 fog/ground 同口径）：

```ts
const SPOT_FIELDS = {
  enabled: "lightSpotEnabled", color: "lightSpotColor", intensity: "lightSpotIntensity",
  angle: "lightSpotAngle", penumbra: "lightSpotPenumbra",
  distance: "lightSpotDistance", decay: "lightSpotDecay",
} as const satisfies FieldMap<EnvState>;

restoreFields(state.spotlight, { map: SPOT_FIELDS, apply: (a) => setEnvState(a, { source: "manual" }) });
```

收益：认知 75 → 约 20，字段名由 `satisfies` 兜底编译期校验，且与既有 cap 范式统一。

---

### 🔴 P0-2　`renderPreviewDock` 10 参数，其中 2 个是死参数

**位置**：`menu/core.ts:425`

```ts
function renderPreviewDock(
  dock: HTMLElement,
  _ctx: PreviewMenuCtx,        // ← 注释自述「仅保签名兼容」
  menu: SlideMenuHandle,
  showMenu, makeRowFn, makePanelViewFn, makeGroupViewFn, actionCtx,
  _hideMenu: () => void,       // ← 同样未使用
  adapterItemsRef: { v: PreviewMenuNode[] },
): void
```

**问题**：
- `_ctx` / `_hideMenu` 是**下划线死参数**——签名留着只为兼容旧调用点，属「显式废件」；
- `makeRowFn` / `makePanelViewFn` / `makeGroupViewFn` 三个工厂 + `showMenu` + `actionCtx` = **5 个注入函数**，本质是同一个「菜单能力集」的碎片化传递；
- 这是 `check-params` 全仓第 4 长参数列表。

**建议**：先删两个死参数（调用点零改动，TS 直接受益）；再把 5 个注入函数收敛为一个 `DockDeps` 接口，或直接复用已注入的 `menu: SlideMenuHandle` 承载——「句柄已经传进来了，还要再传三个从句柄里取的函数」是典型的依赖传递没想清楚。

---

### 🟡 P1-1　分派逻辑手写化：`renderMenu` 的 switch + 三元链

**位置**：`menu/render.ts:609`（认知 79，🟥）

```ts
if (node.kind === "card") { … continue; }
if (node.kind === "folder" || Array.isArray(node.children)) { … continue; }
switch (node.kind) {
  case "field":  rmAppendField(container, node); break;
  case "button": rmAppendButton(container, node, deps.actionCtx); break;
  case "row":    rmAppendDynamicRow(container, node, deps.actionCtx); break;
  case "select": case "slider": case "toggle": case "color": {
    const view = nodeControlToView(node, snapshot, deps.menu);
    const renderer =
      node.kind === "toggle" ? renderCapToggle
      : node.kind === "slider" ? renderCapSlider
      : node.kind === "select" ? renderCapSelect
      : renderCapColor;                       // ← switch 里再套三元链
    renderer(container, view); break;
  }
}
```

**问题**：`switch` 内部再嵌一条四段三元链选渲染器——**同一个分派维度用了两套机制**。而且前面还有两条 `if continue` 的前置判定（注释承认是「分派穷举化保留」的历史形状修复）。

**建议**：表驱动 registry，分派维度单一化：

```ts
const NODE_RENDERERS: Record<PreviewMenuNodeKind, NodeRenderer> = {
  field: rmAppendField, button: (…)=>…, row: (…)=>…,
  toggle: viaCap(renderCapToggle), slider: viaCap(renderCapSlider),
  select: viaCap(renderCapSelect), color: viaCap(renderCapColor),
  /* folder/card 由前置形状分派处理 */
};
```

收益：认知 79 → 约 25；新增节点类型 = 加一行表项，零改分派函数；`Record<Kind, …>` 让「漏实现某种 kind」变成**编译期错误**，而 `switch` 做不到（除非写 `never` 兜底）。

---

### 🟡 P1-2　函数名与模块边界脱钩：`mdVr*` / `mdYs*` 前缀污染

**证据**：`adapters/vrm-adapter.ts` 含 16 个 `mdVr*` 前缀函数、`ysm-adapter.ts` 含 `mdYs*` 前缀——血统来自历史 `model2d` 模块，与当前 `preview-3d/adapters/` 边界毫无语义关系。

更严重的是 **stage 定义乱序**：

```
vrm-adapter.ts:308  mdVrStage1ReadParse
vrm-adapter.ts:419  mdVrStage3Materials      ← 3 在 2 前
vrm-adapter.ts:433  mdVrStage2BonesHumanoid
vrm-adapter.ts:490  mdVrStage4MenuPanels
vrm-adapter.ts:562  mdVrStage5BuildResult
```

阅读时必须靠编号跳转，线性读代码会得到错误的执行顺序认知。

**建议**：stage 函数按序排列；前缀统一为格式语义（`vrm*`/`ysm*`），去掉 `md` 残骸。纯改名，`codemod.ts` 可批量，`check-redlines` 兜底。

---

### 🟡 P2-1　兼容层活化石（两处 re-export 未收敛）

| 兼容层 | 来源 | 消费方规模 | 现状 |
|--------|------|-----------|------|
| `decoder/geometry.ts` | ADR-217 下沉 `parsers/bedrock-geometry.ts` | 约 30 处 | 纯 re-export 壳 |
| `menu/node-types.ts` | ADR-195 刀2 下沉 `menu-node-types.ts` | 30+ 处 | re-export + 保留 `PreviewMenuCtx` |

**判定**：不是 bug，是**迁移未收口**。两处注释都写明「保消费者 import 零改动」——这在当时是正确的止损，但半年后仍 untouched，就变成新人认知负担：「到底该从哪个 import？」

**建议**：排期一次性批量改 import（机械替换 + typecheck 兜底），删壳。优先级 P2，因为零功能收益、纯认知卫生。

---

### 🟡 P2-2　复杂度红榜 27 个（含 Go 镜像固有债）

| 函数 | 位置 | 认知 | 性质 |
|------|------|------|------|
| `parseBedrockGeometry` | `model/spec-builder.ts:149` | 129 | Go `geometry/parse.go` TS 镜像 |
| `buildPmxScene` | `adapters/mmd-pmx-parser.ts:64` | 125 | 有 `maybeYield` 切片，写得不错但过长 |
| `Stage3Ktx2Hydrate` | `adapters/mmd-build-scene.ts:81` | 82 | 嵌套 6 |
| `renderMenu` | `menu/render.ts:609` | 79 | 见 P1-1 |
| `buildYsmObject` | `model/ysm-object.ts:50` | 77 | |
| `Stage1bFileScan` | `adapters/mmd-build-load.ts:117` | 76 | 嵌套 6 |
| `loadState` | `caps/light-capability.ts:588` | 75 | 见 P0-1 |
| `HandleYsmJsonSpec` | `decoder/wasm-decode.ts:133` | 71 | |

**拆分准则（对齐 `3d-oversize-file-codesplit-feasibility` 既有定论）**：**看缝不看行数**。
- `parseBedrockGeometry` 有真缝（bone 解析 / cube 解析 / 钳制校验三段可顶层化）→ 可拆；
- `buildPmxScene` 已是 stage 管线形态，沿 `maybeYield` 边界切 3-4 段 → 可拆；
- 单纯「行数大」的（如闭包编排）→ 不拆。

---

### 🟢 P3-1　孪生命名歧义

`model/spec-builder.ts:149 parseBedrockGeometry` 与 `@/parsers/bedrock-geometry.ts:96 parseBedrockGeometryFromJSON` 名字孪生但**语义不同**（前者产出内部 `BedrockModel` spec 结构，后者产出 `BedrockGeometry`），且 `decoder/geometry.ts` 又在 re-export 后者。三个名字两个实现，跨目录相邻。

**建议**：至少把 `spec-builder` 内的改名（如 `parseGeometryToModelSpec`），并加一行注释说明与 `parsers` 版本的分工。

---

### 🟢 P3-2　帧内分配铁律：主干已守，IK 未对齐

`3d-patterns` R1-P1-1 铁律（帧内禁 `new` 数学对象）实际抽查：

| 位置 | 状态 |
|------|------|
| `adapters/render-host.ts:86-89` | 🟢 `private readonly _camDir/_forward/_right/_move` 预分配 |
| `adapters/unified-pick.ts:19-20` | 🟢 raycaster/pointer 工厂闭包级复用 |
| `bone/mmd-foot-ik.ts:61-62` | 🟢 `target`/`footPos` 工厂闭包级复用 |
| `adapters/shared/perception/*` | 🟢 刀① 已整改 |
| `bone/ik-solver.ts:92-97` | 🟡 `solveIK` **每次调用**分配 6×Vector3 + 1×Quaternion |

`solveIK` 经 `mmd-foot-ik` 在动画帧内调用 → 每帧 7 次分配。**建议**：提模块级 scratch（该函数无重入/无异步，安全）；或对齐 perception 的闭包 scratch 范式。

---

## 四、明确不建议动的（避免重蹈覆辙）

| 项 | 依据 |
|----|------|
| `mount-preview-core.ts` 拆分 | `3d-oversize-file-codesplit-feasibility` 2026-09-03 复核：闭包编排单体、无 stage 缝，维持不拆。且已按 ADR-167 拆出 `assembleShell`/`buildInfra`/`runBuild`/`recoverMountFailure`/`commitSession` 五段 |
| `mmd-adapter.ts` 拆分 | ADR-167 已拆完（9 文件），旧判「断注册链」已被推翻 |
| GPU 预算 / 拾取 / WASM 拷贝 | 刀⑦⑩⑪⑫⑬ 已闭环，勿重复立项 |
| `caps/` 按能力再拆 | 33 文件能力单元制，量级合理 |

---

## 五、建议执行顺序

1. **P0-1** light/water `loadState` 吃 `restoreFields`（收益最大：认知 75→20 + 消除双断言 + 范式统一）
2. **P0-2** `renderPreviewDock` 删 2 死参数 + 收敛 5 注入为 1 deps
3. **P1-1** `renderMenu` 改表驱动 registry
4. **P1-2** vrm/ysm 前缀清理 + stage 排序
5. **P2-1/P2-2/P3** 兼容层收口、复杂度拆缝、命名消歧、IK scratch

## 六、验证命令

```bash
cd frontend && npx vite build && npm run typecheck
node scripts/check-complexity.ts 2>&1 | grep preview-3d | head -20
node scripts/check-params.ts 2>&1 | grep preview-3d
node scripts/check-biome.ts --files <改动文件...>
npx vitest --run frontend/src/preview-3d
```
