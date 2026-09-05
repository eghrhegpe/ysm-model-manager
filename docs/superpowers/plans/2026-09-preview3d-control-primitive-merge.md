# 控件原语归一：rm 栈（节点声明式控件）并入 cap 栈（能力控件）实施方案

> 状态：调研方案（未动业务代码）
> 关联提交：bb47ecda（已补 `MenuControlDef.onChange` + `slider.numeric`，cap 渲染端已支持）
> 范围：`frontend/src/preview-3d/menu/`

## 1. 目标与红线对齐

**目标**：消除菜单控件渲染的双栈实现——让 `PreviewMenuNode` 的 `select/slider/toggle`（rm 栈）在渲染层构造 `MenuControlDef` 委托 `renderCapControls`（cap 栈）渲染，删除 `rmAppendSelect/rmAppendToggle/rmAppendSlider`，testid 统一为 `cap-<id>`。最终「新增控件原语只写一遍、所有数组类菜单可调用」。

**红线对齐（AGENTS.md）**：
- ✅ **3d 菜单只允许 visibleWhen**：本方案不动 visibleWhen 机制。节点级 `visibleWhen` 仍在 `renderMenu` 入口求值（render.ts:542），转换出的 `MenuControlDef` 不携带 `visibleWhen`，不引入任何新的条件显隐入口。
- ✅ **新增 UI 功能必须可被所有数组类菜单调用**：归一后 `numeric / onChange / onCommit / unit / label` 等能力沉淀在 `MenuControlDef`（cap 栈），任何 `PreviewMenuNode`（经 `kind:"controls"` 或本方案的三类节点转换）与任何 cap 自报控件都共享同一渲染器——正是本铁律的落地。
- ✅ **通用化 / 复用既有函数**：不重写 `renderCap*`，只新增一个薄转换层把 `PreviewControlSpec` 投影到 `MenuControlDef`，复用 `renderCapControls` 全部分派。

**关键架构决策（长治久安）**：**数据契约不动、只动渲染层**。
- `PreviewMenuNode` + `PreviewControlSpec` 仍是适配器的**数据输出契约**（litematic / perception / morph / multi-model / mmd-controls / settings 六个工厂的产出结构不变）。
- 归一发生在 `render.ts` 的**渲染时转换**：`node.control` → `MenuControlDef` → `renderCapControls`。
- 收益：数据层的 6 个工厂、以及直接读 `node.control.get/set/onChange` 的测试（morph/perception/multi-model/mmd/vrm/litematic-3d 等）**零改动、零断链**。迁移面收敛到 `render.ts` + 两个 DOM 测试文件。

## 2. 现状双栈差异对比表（能力字段映射）

### 2.1 渲染结构差异

| 维度 | rm 栈（render.ts 三函数） | cap 栈（cap-controls.ts） | 归一后影响 |
|---|---|---|---|
| testid | `preview-<id>` | `cap-<id>` | **统一 `cap-<id>`** |
| toggle DOM | `<div.rm-control-row-lg>` + `<span.rm-control-label-strong>` + `<button.rm-toggle-track><span.rm-toggle-knob>` | `<div.slide-item.cc-row>` + `<div.cc-labelbox>`(label+hint) + `<label.toggle.header-toggle>`(input[type=checkbox]+span.slider) | 结构变，`querySelector("button")` 断 |
| slider DOM | `<div.rm-control-row>` + 可选 label + `<input.rm-range>` (+ numeric `<input.rm-range-num>`) | `<div.slide-item.cc-row-col>` + `<div.cc-head>`(name+当前值) + `<input.cc-range>` (+ numeric `<input.rm-range-num>`) | 多一层 head+当前值显示；`.slide-label` 恒存在 |
| select DOM | `<div.rm-control-row>` + label + `<select.setting-select>` | `<div.slide-item.cc-row>` + `<span.cc-label-grow>` + `<select.setting-select.cc-select>` | class 微调，testid 变 |
| slider 当前值显示 | ❌ 无 | ✅ `formatCapSliderValue`（unit 感知） | 归一后 slider 多显示当前值 |
| toggle 自更新注册 | ❌ 无 | ✅ control-registry（header-toggle bind） | 归一后 toggle 获得重渲染自更新 |

### 2.2 `PreviewControlSpec` → `MenuControlDef` 字段映射

| PreviewControlSpec 字段 | MenuControlDef 落点 | 保留策略 |
|---|---|---|
| `bind` | 无对应字段 → 在转换层折进 `getValue`/`setValue` | ⚠️ **当前零消费者（死字段）**；保留映射能力（见 §5），见 §6 裁决 |
| `min` / `max` / `step` | `slider.min/max/step` | ✅ 直接映射 |
| `options` | `select` | ✅ 直接映射 |
| `get(v?)` | `getValue()` | ✅ 包装 `() => spec.get ? spec.get(undefined) : ...` |
| `set(v)` | `setValue(v)` | ✅ 包装（先 `spec.set` → 若 bind 写状态层 → 触发 `spec.onChange`） |
| `onChange(v)` | `onChange(v)` | ✅ 直接映射（cap 渲染端已在 setValue 后调用） |
| `numeric` | `slider.numeric` | ✅ 直接映射（bb47ecda 已加） |
| `refreshOnChange` | 无对应字段 → 在转换层注入 `onChange: () => menu.refresh()` | ✅ 转换层注入（见 §4 顺序） |
| `icon` | 无对应字段 | ❌ 丢弃（三类控件不使用 icon） |
| `value` / `text` | 无对应字段 | ➖ 不涉及（field/button 专属，归一只覆盖 select/slider/toggle） |

**`unit`**：`PreviewControlSpec` 无 `unit`（仅 `MenuControlDef.slider.unit` 有）。归一后 node slider 缺省无 unit → `formatCapSliderValue` 走 `toFixed(2)`，slider 会多出一个「当前值」显示（`1.00` 形式）。若未来 node slider 需要单位，在转换层补 `unit` 透传即可（当前无消费者，暂不补）。

## 3. 消费者完整清单（`kind:"select/slider/toggle"` 的 PreviewMenuNode 声明）

> 只列「声明式节点栈」（`control:` 字段）消费者；`caps/*.ts` 里的 `kind:"toggle/slider/select"` 全是 `MenuControlDef`（cap 栈，**不在迁移范围**）。

| 文件 | 节点 id | kind | control 字段集 | onChange | refreshOnChange | bind |
|---|---|---|---|---|---|---|
| `adapters/litematic-adapter.ts:308-330`（`layerSlider` 工厂，产出 3 个 slider） | `slice-layer` / `slice-range-start` / `slice-range-end` | slider | min/max/numeric/get/set/**onChange** | ✅ applyLayer | ❌ | ❌ |
| `adapters/litematic-adapter.ts:333-350` | `slice-axis` | select | options/get/set/**onChange**/**refreshOnChange** | ✅ applyLayer | ✅ | ❌ |
| `adapters/litematic-adapter.ts:351-372` | `slice-mode` | select | options/get/set/**onChange**/**refreshOnChange** | ✅ applyLayer | ✅ | ❌ |
| `adapters/perception-controls.ts:54-65` | `perception-*`（5 个） | toggle | get/set | ❌ | ❌ | ❌ |
| `adapters/morph-controls.ts:33-50` | `morph-<name>` | toggle | get/set（**无 labelKey，fallback 承载动态名**） | ❌ | ❌ | ❌ |
| `menu/multi-model.ts:52-72` | `multi-model-select` | select | options/get/set/（可选 refreshOnChange） | ❌ | 可选 | ❌ |
| `views/app-preview/mmd-controls.ts:100-128`（`playNodes`） | `play-toggle` / `play-select` | toggle / select | get/set（select 加 options） | ❌ | ❌ | ❌ |
| `menu/settings.ts:216-236`（`bsBuildPerfPresetRow`） | `settings-perf-preset` | select | options/get/set（set 内部自调 `menu.refresh()`） | ❌ | ❌（refresh 在 set 内） | ❌ |

**结论**：
- `bind` 字段**全仓零消费者**（grep 仅命中 cap-controls.ts / env.ts 的 `createHeaderToggle` `bind`，非 `PreviewControlSpec.bind`）→ `rmSelectCurrent` 的 bind 分支 + render.ts 的 `isPathAvailable/setStateValue/KNOWN_PATHS` 导入是死代码。
- 唯一「重渲染」语义来源有两类：① litematic 的 `refreshOnChange:true`（render 层 `menu.refresh()`）；② settings 的 `set` 内闭包自调 `menu.refresh()`。前者必须在转换层注入 `onChange` 钩子，后者 `set` 闭包自带、转换层无需额外处理。

## 4. 受影响测试清单（文件:行号）

### 4.1 需改的 DOM 断言（testid `preview-` → `cap-` + 结构断言）

**`menu/node-render.test.ts`**
| 行 | 现值 | 归一后 | 备注 |
|---|---|---|---|
| 57-80（toggle 用例） | 70 `preview-perception-breath`；73 `row.querySelector("button")`；`btn.click()` | `cap-perception-breath`；改 `querySelector(".header-toggle")` 或 `input[type=checkbox]`，click 改 label 点击 | 结构断言重写 |
| 321-352（slider） | 341 `preview-layer-slider`；343-347 range 断言 | `cap-layer-slider`；range 断言**兼容**（min/max/value 同） | 仅 testid |
| 354-380（numeric） | 365 `preview-num-slider`；number 联动断言 | `cap-num-slider`；联动/clamp **兼容** | 仅 testid |
| 382-391（bare slider） | 388 `preview-bare-slider`；389 `.slide-label` 为 null | `cap-bare-slider`；**389 断言必破**（cap head 恒有 `.slide-label`） | 需改：断言「head 内 label 文案 = fallback/id」或删除该 label-null 断言 |

**`adapters/litematic-layer-controls.test.ts`**
| 行 | 现值 | 归一后 |
|---|---|---|
| 255 | `preview-slice-mode` | `cap-slice-mode` |
| 269 | `preview-slice-axis` | `cap-slice-axis` |
| 299 / 300 | `preview-slice-mode` / `preview-slice-axis` | `cap-slice-mode` / `cap-slice-axis` |
| 215/219/224/266/267 | `input[type="range"]` / `input[type="number"]` 计数 | **兼容**（cap slider 仍产 range + numeric number） |
| 236-274（集成） | 真实 select change → set → onChange → refreshOnChange → refresh | **关键回归锁**：验证转换层 onChange 注入 `menu.refresh`，仅 testid 改 `cap-` |

### 4.2 不受影响（数据层契约保留，零改动）

- `adapters/morph-controls.test.ts`、`adapters/perception-controls.test.ts`（纯数据节点断言）
- `menu/multi-model.test.ts`、`views/app-preview/mmd-controls.test.ts`（纯数据）
- `adapters/mmd-adapter.test.ts`（1490/1513/1522 经 `node.find().control` 访问，非 testid）
- `adapters/vrm-adapter.test.ts`（245/515 stub，数据层）
- `views/app-preview/litematic-3d.test.ts`（340/345/537 经 `node.control.onChange/set` 直调，非 DOM）
- `menu/items.test.ts`（324/325 `preview-play` 是 **panel 节点**非控件；448 是数据断言）、`menu/roles.test.ts`（175/194 同 `preview-play` panel）
- `menu/cap-controls.test.ts`、`menu/env.test.ts`（cap 栈，已用 `cap-` testid）、`state/preview-state.test.ts`（cap 栈 + 本地 render helper）

### 4.3 e2e 影响

**零影响**。`frontend/e2e/preview.spec.ts` 只依赖 app-preview 预览区的 `#preview-content / #preview-detail / #preview-skeleton / .preview-fab#btn-3d-preview / #btn-pack-model-3d`（CSS id 选择器），**不触碰** `preview-3d/menu/` 的控件 testid。`legacyTestId`（node-types.ts:157，如 `litematic-slice-entry`）挂在 panel 入口节点（非控件），不受影响。全 e2e 目录 grep `slice / cap- / data-testid` 无 3d 控件依赖。

## 5. 语义保留矩阵

| 语义 | 保留? | 在哪层实现 |
|---|---|---|
| `bind`（状态层读写） | ⚠️ 保留映射能力（零消费者） | 转换层：`getValue = () => spec.get ? spec.get(snapshot[bind]) : snapshot[bind]`；`setValue = v => { const val = spec.set?spec.set(v):v; if(bind){isPathAvailable(path)&&setStateValue(path,val)} }` |
| `refreshOnChange`（切档后 menu.refresh） | ✅ 保留 | 转换层注入 `onChange: () => menu.refresh()`，与 `spec.onChange` 顺序见下 |
| `numeric`（数字输入联动） | ✅ 保留 | `slider.numeric` → `renderCapSlider`（bb47ecda 已实现，双向联动 + clamp） |
| `onCommit`（松手离散提交） | ✅ 保留（cap 原生） | `MenuControlDef.slider.onCommit`，仅 cap 侧使用；node slider 无此字段（无消费者） |
| `unit`（值格式化） | ✅ 保留（cap 原生） | `formatCapSliderValue`；node slider 无 unit → 默认 toFixed(2) 显示当前值 |
| `label`（labelKey/fallback） | ⚠️ 保留但取值语义微变 | 见 §7 风险 3 |
| `onChange` 副作用钩子 | ✅ 保留 | 转换层 `setValue` 末尾调 `spec.onChange`，或直接映射 `onChange` 字段 |
| 节点级 `visibleWhen` | ✅ 保留（不动） | `renderMenu` 入口（render.ts:542） |

**refreshOnChange 顺序保证**（对齐 rmAppendSelect:346-362 的 `set → onChange → refresh`）：
`renderCapSelect/Slider/Toggle` 在交互时调用 `c.setValue(v)` 后调 `c.onChange(v)`。转换层只需：
- `setValue(v)` = 执行 `spec.set`（+ bind 写）+ `spec.onChange`；
- `onChange(v)` = 若 `refreshOnChange` 则 `menu.refresh()`。

这样顺序恒为 `spec.set → bind写 → spec.onChange → menu.refresh`，与现状逐字一致。

## 6. 分步实施顺序（4 步，每步独立跑绿）

### 步骤 1：新增转换助手 `nodeControlToCapControl` + 纯函数单测（纯增量，绿）
- **改 `menu/render.ts`**：新增导出函数
  ```ts
  export function nodeControlToCapControl(
    node: PreviewMenuNode,          // 取 node.control / labelKey / fallback
    snapshot: Record<string, unknown>,
    menu?: SlideMenuHandle,
  ): MenuControlDef
  ```
  实现三类投影：
  - `id = node.id`、`kind = node.kind`（select/slider/toggle）
  - `labelKey = node.labelKey ?? ""`、`fallback = node.fallback ?? node.id`
  - `getValue`：slider/toggle 取 `Number/Bool(spec.get?.(undefined))`；select 复用 `rmSelectCurrent` 的「bind 优先」逻辑（先不删 rmSelectCurrent，此步只加不改分派）
  - `setValue`：封装 `spec.set` + bind 写 + `spec.onChange`
  - `onChange`：`refreshOnChange` 时 `() => menu?.refresh()`
  - `slider` / `select` / `slider.numeric` 直接映射
- **改 `menu/node-render.test.ts`**：新增 `describe("nodeControlToCapControl")`，锁 bind 映射、refreshOnChange→onChange 注入、numeric 透传、无 labelKey 时 fallback 兜底。
- **验证**：`cd frontend && npx vitest --run src/preview-3d/menu/node-render.test.ts`

### 步骤 2：切分派 + 同步改两测试文件的 testid/结构断言（原子，绿）
- **改 `menu/render.ts`**：`renderMenu` 分派中（551-556）把
  ```ts
  } else if (node.kind === "select")  { rmAppendSelect(...) }
  } else if (node.kind === "slider")  { rmAppendSlider(...) }
  } else if (node.kind === "toggle")  { rmAppendToggle(...) }
  ```
  收敛为：
  ```ts
  } else if (node.kind === "select" || node.kind === "slider" || node.kind === "toggle") {
    const def = nodeControlToCapControl(node, snapshot, deps.menu);
    renderCapControls(container, [def], snapshot);
  }
  ```
  （单个 def 无 group，不套 section 壳，视觉对齐现状平铺。）
- **改 `menu/node-render.test.ts`**：§4.1 四处 testid + toggle 结构断言 + bare-slider label 断言。
- **改 `adapters/litematic-layer-controls.test.ts`**：§4.1 四处 testid。
- **验证**：`cd frontend && npx vitest --run src/preview-3d/menu/node-render.test.ts src/preview-3d/adapters/litematic-layer-controls.test.ts`

### 步骤 3：删除三函数 + 死导入 + 死 CSS 类（纯删除，绿）
- **改 `menu/render.ts`**：
  - 删 `rmAppendSelect`(317-365)、`rmAppendToggle`(367-396)、`rmAppendSlider`(398-455)、`rmSelectCurrent`(306-315，若步骤 1 已把其逻辑内联进转换助手)
  - 删死导入：`isPathAvailable`、`setStateValue`、`KNOWN_PATHS`（`previewSnapshot` 仍用）
  - 删死 CSS（`ensureMenuStyles` 内）：`.rm-toggle-track`(101-109)、`.rm-toggle-knob`(110-118)、`.rm-range`(119-124)、`.rm-slider-label-fixed`(87-91)、`.rm-control-row-lg`(67-72)、`.rm-control-label`(76-81)、`.rm-control-label-strong`(82-86)
  - ⚠️ **保留** `.rm-range-num`(125-135)：cap 滑块 numeric 输入复用该类（cap-controls.ts:205），但该类目前只在 render.ts 注入——见 §7 风险 5（建议迁入 cap-controls `ensureCapStyles`）
  - ⚠️ **保留** `.rm-control-row`(61-66)、`.rm-label-ellipsis`(92-100)、`.rm-eye`/`.rm-op`：material-row 仍用
- **验证**：`cd frontend && npm run typecheck`（死导入删除后确认无未用报错）+ `npx vitest --run src/preview-3d`

### 步骤 4：bind 字段裁决 + 全量验证收口
- **裁决（推荐）**：`PreviewControlSpec.bind` 保留（不删字段），转换助手已实现其映射（步骤 1）；理由：类型是状态层能力的未来入口，删除会连锁改 node-types.ts 注释/单测，收益低。**替代**：若团队倾向「零死代码」，删 `PreviewControlSpec.bind` 字段 + 转换助手内 bind 分支 + 相关注释，改动面 +`node-types.ts` 几行。
- **可选加固**：把 `.rm-range-num` 样式迁入 cap-controls `ensureCapStyles`（消除 cap 栈对 render.ts 的隐式样式耦合），删 render.ts 中该段。
- **验证（全量）**：
  ```bash
  cd frontend && npx vite build
  cd frontend && npm run typecheck
  node scripts/check-biome.ts
  cd frontend && npx vitest --run   # 全仓前端单测
  ```
- **同步知识卡 / ADR**（按需）：若做架构级说明，走 `node scripts/new-adr.ts`；进度写知识卡（check-knowledge-drift 自动兜底）。

## 7. 风险点与回滚策略

**风险点**
1. **toggle 结构翻转**（node-render.test.ts:73）：cap toggle 是 `<label><input checkbox>` 无 `<button>`；既有依赖 `querySelector("button")` 的测试/样式选择器需同步。风险低（仅 1 处测试 + 无生产 button 依赖）。
2. **bare slider 视觉增益**：归一后所有 slider 多显示「当前值」（`formatCapSliderValue` 默认 `toFixed(2)`），且恒有 label（head 内 `.slide-label`）。无 labelKey 的裸 slider 会显示 label=fallback/id + 当前值。风险：视觉/测试断言变化，功能无碍。
3. **label 取值语义微变**：`rmLabel` 无 labelKey 返回 `node.id`；cap 侧 `tr("", fallback)` 返回 fallback。对 morph toggle（无 labelKey、fallback=表情名）归一后显示从 `morph-微笑`（id）变为 `微笑`（fallback）——**实际是修复潜在显示 bug**，但属行为变化，需在 PR 描述中显式声明。
4. **refreshOnChange 顺序**：若转换层把 `menu.refresh` 错注入到 `setValue` 而非 `onChange`，会打乱 `spec.onChange(applyLayer)` 与 `menu.refresh` 的相对顺序。litematic-layer-controls.test.ts:236-274 集成用例是顺序回归锁。
5. **`.rm-range-num` 样式耦合**：cap slider numeric 输入用 `.rm-range-num`，但该类仅在 render.ts `ensureMenuStyles` 注入；env.ts 直调 `renderCapControls`（215/318/350）不经过 `ensureMenuStyles`，若未来 env 面板用 numeric 会丢样式。步骤 4 建议迁类到 `ensureCapStyles` 一劳永逸。

**回滚策略**（每步独立，不用 `git stash`，遵循 AGENTS.md）
- 每一步都是原子可回退：`git log --oneline -3 -- <file>` 定位 → `git checkout -- <file>` 精确恢复单文件。
- 归一整体改崩：`git reset --soft HEAD~1`（改动保留工作区），逐文件 `git diff HEAD` 复查。
- 步骤 2 是唯一「代码+测试同步改」的耦合步，若 vitest 未绿，优先检查 testid 断言是否漏改，而非回退实现。

## 8. 验证命令清单

```bash
# 单文件（步骤 1/2/3 各自跑绿）
cd frontend && npx vitest --run src/preview-3d/menu/node-render.test.ts
cd frontend && npx vitest --run src/preview-3d/adapters/litematic-layer-controls.test.ts

# 全 preview-3d（步骤 3）
cd frontend && npx vitest --run src/preview-3d

# 全仓收口（步骤 4）
cd frontend && npx vite build
cd frontend && npm run typecheck
node scripts/check-biome.ts
cd frontend && npx vitest --run
```

## 9. 预估改动量

| 文件 | 改动 | 行数估算 |
|---|---|---|
| `menu/render.ts` | 删三函数+rmSelectCurrent（~137 行）删死 CSS（~40 行）删死导入（3 行），新增转换助手（~50 行） | 净 **-130** 行 |
| `menu/node-render.test.ts` | 4 testid + 2 结构断言 + 新增转换助手单测（~30 行） | **+30** 行 |
| `adapters/litematic-layer-controls.test.ts` | 4 testid | **±4** 行 |
| （可选）`menu/node-types.ts` | bind 字段裁决 | **±3** 行 |
| （可选）`menu/cap-controls.ts` | `.rm-range-num` 样式迁入 | **+8** 行 |
| **合计** | | **约 -90 行净减**（含可选项约 -80） |

## 10. Top 5 关键发现

1. **消费者 = 6 个文件、8 个控件节点**：litematic-adapter（3 slider + 2 select，唯一用 `refreshOnChange`/`numeric`/`onChange` 的重度消费者）、perception-controls（5 toggle）、morph-controls（toggle，唯一无 labelKey）、multi-model（select）、mmd-controls playNodes（toggle+select）、settings 性能档位（select，`menu.refresh` 在 set 闭包内自调）。**`bind` 字段全仓零消费者——死代码**。
2. **测试迁移面极小**：仅 `node-render.test.ts`（4 testid + 2 结构断言）与 `litematic-layer-controls.test.ts`（4 testid）需改；数据层测试（morph/perception/multi-model/mmd/vrm/litematic-3d 等 10+ 文件）因「数据契约不动」**零改动**。
3. **语义风险集中在三点**：toggle DOM 由 `<button>` 变 `<label><input checkbox>`；slider 归一后恒多「label + 当前值」两层（bare slider 的 `.slide-label=null` 断言必破）；无 labelKey 的 label 取值从 `node.id` 变 `fallback`（morph 显示修复，属行为变化需声明）。
4. **建议 4 步**，核心是「渲染时转换」而非「数据层重写」——`render.ts` 新增 `nodeControlToCapControl` 薄转换层，`PreviewControlSpec → MenuControlDef` 投影后复用 `renderCapControls`，`refreshOnChange` 折进 `onChange` 钩子注入 `menu.refresh`。
5. **预估净减 ~90 行**（render.ts -130，测试 +30），e2e 零影响，`legacyTestId` 过渡机制不涉及（panel 入口非控件）。
