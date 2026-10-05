---
kind: pack-gui-light
name: gui_light 语义与「死解析立牌」（pack 模型光照元数据）
tier: leaf
category: rendering
status: active
source_files:
  - frontend/src/preview-3d/model/parse-java-model.ts
auto_fields:
  symbols_with_lines:
    - isRenderableModel
    - JavaModelFace
    - JavaModelResult
    - modelEntryFor
    - PackEntryReader
    - parseJavaModel
use_when:
  - 想把模型 JSON 的 gui_light / display / ambientocclusion 接进渲染或灯光
  - 查 pack 模型「声明了光照偏好却不生效」
  - 资源包模型预览光照
pitfalls:
  - gui_light 是 MC GUI 显示上下文的 front/side 二选一打光开关，不是灯位/强度参数——「映射灯位」是范畴错误
  - 本产品无 GUI display 渲染上下文，gui_light/display/ambientocclusion 是「有意不消费」的死解析数据，不是漏接
  - 禁止接入 LightCapability：ADR-282 解耦 + envState source 优先级复写用户设置 + 仅 pack 带此字段跨类型不一致
quick_groups:
  - 3D 预览与模型追加
quick_intents:
  - gui_light 是什么意思
  - 为什么模型声明了光照偏好却不生效
  - 想按模型声明打光怎么做
quick_risk_lines:
  - 别把 gui_light 接进 LightCapability（三理由：ADR-282 / source 优先级 / 跨类型不一致）
invariant_anchors:
  - frontend/src/preview-3d/model/parse-java-model.ts|死解析立牌
---

# gui_light 语义与「死解析立牌」（pack 模型光照元数据）

## 概览

Java 资源包模型 JSON 里的三个「光照/显示元数据」字段——`gui_light`、`display`、`ambientocclusion`——在本产品中解析后**有意不消费**（死解析）。本卡立牌：说清上游语义、为何不消费、以及若未来要「尊重模型光照偏好」的正确姿势，防止再次发生「看到解析了没人用就拍脑袋接进灯系统」的误判（2026-10 曾发生一次，源码 `parse-java-model.ts` 字段处有同款立牌注释）。

## 核心职责

- 记录 `parse-java-model.ts` 的 `gui_light` / `display` / `ambientocclusion` 三字段的真实语义与不消费理由，作为源码注释的展开版。
- 明确「本产品不消费是正确行为」：pack 适配器走共享 3D 场景（`pack-model-adapter.ts` 的 `requireSharedInfra` + `scene.add`），挂 `LightCapability` 灯架，没有 MC 的 GUI display 渲染上下文，故语义上不适用。

## 对外 API / 入口

- `parse-java-model.ts|JavaModelResult` —— 三字段在此声明并带回（parent 链继承）；字段处有立牌注释。
- `parse-java-model.ts|isRenderableModel` —— 「可渲染」判定只看 faces 纹理，不看三字段。

## 与其他子系统关系

- 灯光系统 `preview-3d/caps/light-capability.ts`（LightCapability）：**禁止**消费本卡三字段。ADR-282 已令灯光与模型类别解耦（灯光是场景属性，不是内容元数据），且 envState 写路径有 source 优先级（manual > auto-model）——接入要么复写用户设置、要么被 shouldOverwrite 挡住，且换模型灯架跳变。
- pack 适配器 `pack-model-adapter.ts`：内容层自给光照的正确落点——顶点色烘焙（biome tint / AO）已有成例，见知识卡 `mc-ao-tint`。

## 不变量

- `gui_light` 取值仅 front|side，缺省 side；语义 = MC 物品栏/GUI 渲染的二选一打光（side 像方块受光 / front 像扁平物品正面受光），不携带灯位/强度/颜色参数（上游：https://minecraft.wiki/w/Model）。
- 本产品零渲染消费方：全仓 `gui_light` / `display` 数据访问仅存在于 parse 层与其测试。
- 若未来要做「按模型声明打光」，落点 = pack 适配器内容层（顶点色/材质烘焙），不碰全局灯架。

## 相关

- 知识卡 `mc-ao-tint`（pack 适配器顶点 AO/tint 成例）
- ADR-282（灯光与模型类别解耦）、ADR-293-d1（灯光首启默认分治）
- 上游规格：https://minecraft.wiki/w/Model
