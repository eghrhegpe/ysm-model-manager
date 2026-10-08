# ADR-117：地面材质 spec 单一事实源

- **状态**：✅ 已采纳
- **日期**：2026-08-23
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/preview-3d/caps/ground-surface-spec.ts` / `ground-capability.ts`；参考 MikuMikuAR ADR-089/226/231（地面模式拆分、GroundMaterialSpec 单一事实源、程序化图案走 canvas 管线）；ADR-073/097（caps/ 能力模式与注册表）

---

## 1. 背景（Context）

GroundCapability 长期只有 GridHelper + 水面叠加层，没有可换的表面材质/贴图能力。用户提出补齐「地面材质」。

参考项目 MikuMikuAR 的演进史给出了完整的踩坑清单：

- **双路径分叉**（其 ADR-226）：`applyGround` 曾有重建与原地两套手写平行逻辑——程序化 normal 被原地路径清掉、canvas 纹理密度重建路径漏除 scale、同一不变量两条路径各修一遍必漏一条。
- **手拼 typeKey 脆弱**：漏加字段 → 该变化不触发重建；key 里的值与渲染语义不一致 → 「改参数不生效 / 多余重建」双向 bug。
- **特例守卫不穷举**：新材质体系覆盖特殊模式语义。
- **引入新材质体系的代价**（其 ADR-231）：shader 注入方案因升级兼容性风险被否，回到 CPU 像素生成管线。

## 2. 决策（Decision）

### 2.1 spec 单一事实源（移植 MikuMikuAR GroundMaterialSpec 精髓）

新建纯数据模块 `ground-surface-spec.ts`，所有下游只从 spec 取值：

```
buildGroundSurfaceSpec(params, textureToken)   # 唯一数据生成点
  → { structural: { mode, color, lineColor, gridSize, textureToken },
      appearance: { opacity, textureScale, rotationRad, roughness, metalness } }
surfaceSpecKey(spec)                           # structural 子集确定性序列化
groundSurfaceNeedsRebuild(prev, next)          # key 比较，重建/原地唯一判据
applyGroundSurfaceAppearance(mat, spec, meshSize)  # 外观参数唯一落地入口
generateSurfacePixels(st, sizePx)              # CPU 像素生成（DataTexture，node 可测）
```

- **specKey 自动序列化**杀死手拼 key：新增结构性字段在 `surfaceSpecKey` 补一行即自动纳入重建判别。
- **纹理密度不变量单点**：`textureRepeat(meshSize, scale) = meshSize / TILE_WORLD_SIZE / scale` 只在 spec 模块实现一次。
- **扁平 mode 枚举** `"none"|"solid"|"plain"|"grid"|"checker"|"texture"`：单字段表达来源+样式组合，从根上避免「sourceKind × style 双字段耦合需要穷举守卫」的坑。

### 2.2 不引入新材质体系

延续 Three.js 内置 `MeshStandardMaterial` + CPU 像素生成（Uint8Array → DataTexture），对齐既有 `generateNormalMap` 口径。512×512 动态纹理下 CPU 生成足够且 node 可测（无需 DOM canvas）。未来 wood/marble 等程序化材质只需扩展像素生成器，架构零改动。

### 2.3 能力内嵌而非独立 capability

surface 层挂入既有 GroundCapability（y=0.005，介于网格 y=0 与水面 y=0.01 之间），复用其显隐开关/持久化/菜单分组框架；不新增 registry 条目。

### 2.4 自定义贴图生命周期

照抄 EnvironmentCapability customHdrTex 成熟模式：File → TextureLoader 解码 → `customTex` 缓存（独立于当前材质）→ rebuild；**缓存不随材质 dispose**（切 preset 不重复解码）；不持久化二进制，loadState 读回 texture 模式但无缓存时回退 plain。

## 3. 后果（Consequences）

### 正面
- **合约测试锁死双路径等价**：「同 state 下 rebuild 产物 == in-place 产物」（opacity/scale/rotation/PBR 迁移三组断言），MikuMikuAR 用血泪换来的教训在本仓以测试固化。
- 新增程序化样式 = 扩展 `generateSurfacePixels` 一个函数，菜单/spec/持久化零改动。
- 像素生成纯函数 node 可测（16 用例含像素级采样验证）。

### 负面
- `surfaceSpecKey` 是 JSON.stringify 固定字段序——新增结构性字段必须记得补进 key 函数（有 S1 测试兜底：字段序无关性已锁）。
- CPU 像素生成性能上限低于 shader 方案（512² 可接受，更大分辨率需重评）。

### 已知遗留
- 反射层（ReflectorCapability）未感知 surface 材质粗糙度，后续可对接。
- UV 滚动动画、自发光地屏、程序化材质三件套为规划项，按需扩展。

## 4. 数据溯源

- 用户需求「环境折腾很多，唯独漏了往地面添加材质」→ 查证确认空白 → 参考项目调研（MikuMikuAR ADR-052~231 演进线 + 探索代理移植建议）→ TDD 实现：spec 模块 16 用例 + capability 表面层套件全绿 → 本 ADR 固化决策。
