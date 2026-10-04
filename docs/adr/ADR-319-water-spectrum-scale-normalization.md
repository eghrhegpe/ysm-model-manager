# ADR-319：水面波场尺度归一与泡沫判据可达性

- **状态**：✅ 已采纳（Accepted，2026-10-04）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-10-04
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/preview-3d/caps/water-capability.ts` / `scripts/probe-water-wave.ts` / ADR-255（Gerstner + uniform 化）/ ADR-257 §6.4（振幅钳制「登记未改」）/ ADR-272（尺寸零重建）/ ADR-283（值域单一事实源）

---

## 1. 背景（Context）

<!-- ⚠️ 本节是「决策当时」的状态快照，ADR 落地后此处的病灶可能已治愈；评估「现在是否还这样」以当前源码树 + 知识卡实施进度为准，勿把本节当现状。 -->

水面波场自 ADR-255 起是「6 波 Gerstner + 振幅 `min(·, 0.5)` 钳制 + 陡度 `Σσ·k ≤ 0.8` 钳制」，ADR-257 §6.4 又顺带登记一笔：振幅钳制把设计的几何级数衰减抹平（wave0–4 全部顶到上限 0.5，仅 wave5 为 0.373），「改钳制会动波形观感，故仅登记」。

这笔账一直挂着，因为它无法靠拖滑块证伪——「浪比池子高」「泡沫不出现」「大水面没有细节」都是**数值命题而不是审美命题**。故先建量具：`scripts/probe-water-wave.ts` 用 JS 逐式复刻 `water-capability.ts|buildWaveWaterMaterial` 注入的 `gerstner()`，**第一步是标定**——复现 ADR-257 §6.4 的「几何法线 vs 解析法线」夹角：实测平均 1.18° / 最大 6.20°，与其 2.40° / 7.02° 同量级（网格密度不同），证明复刻忠实，后续数字方可采信。

标定后取 schema 现值（`waterSize=80`、`waterChoppiness=0.5`、`waterLevel=0.01`、`waterPoolHeight=0.3`、`WATER_WAVE_SEGMENTS=64`）实测：

| 命题 | 实测 | 结论 |
|---|---|---|
| 波高量级 | 峰 **+2.605 m** / 谷 **−2.691 m** / 峰谷差 **5.296 m** / RMS **0.834 m** | 六波同幅叠加，振幅是**绝对世界米制**，不随域宽、池深、水位中任何一个量归一 |
| 越壁（pool 语义） | **33.17%** 采样点水面高于池壁顶（壁顶 y=0.390 m） | 默认参数下浪比池子高，池壁（不随波起伏的定高平面）被水面穿透 |
| 穿地（film 语义） | **49.14%** 采样点水面低于 y=0 地面 | 水膜一半周期沉到地板以下，被不透明的地面啃出缺口 |
| 静水态可达性 | `choppiness=0` 时峰谷差仍 **5.296 m**（零变化） | 振幅不进 `steep` 链——「波峰尖度」只管水平 skew / 法线 / 泡沫，**面板上没有任何一栏能压浪高** |
| 泡沫可达性 | `Σσ·k` = 0.400（choppiness=0.5）/ 0.800（拖满）；`J_min` = **0.673** / **0.407**；`J ≤ 0` 占比 **0.00%** | 判据 `smoothstep(0.0, -0.25, J)` 要求 `J ≤ 0`（即波面自交），而 `Σσ·k ≤ 0.8` 的防自交钳制恰好保证了 `J > 0`——**两者互斥，`vFoam` 恒 0，泡沫是每帧计算、永不触发的死通道** |
| 频谱-尺度匹配 | `λ` 钉死世界 [10.53, 25.13] m；可呈现窗口 `λ ∈ [6·size/segments, size/2]` | `size=10` 时六波**全部长于域宽**（窗口内 0 条，水面只是一块倾斜的板）；`size=300` 时六波**全部被 aa 淡出**（窗口内 0 条，高频砍光）；只有 `size ≈ 53–107` m 附近六波才同时可呈现，而滑杆展示域是 **10–300 m** |

即：ADR-255 的 Gerstner **骨架**（水平+垂直位移、解析法线、陡度防自交）成立且已被 ADR-257 数值验证过；不成立的是它的**量纲约定**——振幅与波长都按「一片开阔大洋」标定，却被接到一个 0.3 m 深的泳池和一层贴地水膜上。

## 2. 决策（Decision）

**D1 — 波高入参数，并做分形态的容器钳制。** 新增 water 组 schema 键 `waterWaveHeight`（值域唯一事实源仍是 `ENV_STATE_SCHEMA.range`，ADR-283 纪律不动），shader 侧 `amp` 由该 uniform 驱动，取代写死的 `min(0.6·0.82ⁱ/freq, 0.5)`。钳制必须**按形态分派**：下钳 `Σ amp ≤ waterLevel`（波谷不穿地面，**film/pool 通用**——两者都有地面），上钳 `Σ amp ≤ waterPoolHeight − waterLevel`（波峰不过池壁顶，**仅 pool**——film 无壁，无上钳）。**上钳不可无条件套用**：film 下 `waterLevel` 可拖到 range 上限 5.0，而 `waterPoolHeight` 滑块仅 pool 可见（film 下锁死在默认 0.3），「两钳取小」会让水位过 0.3 m 时预算归零、浪高静默死平——落地后子代理复核发现（探针 `--level 0.5 --film` 实测 peakToTrough 从 0 回到 0.116 m），已改为 `effectiveWaveHeight(forPool)` 按形态传入。钳制量在 CPU 侧算好下发（`water-params.ts|effectiveWaveHeight`），避免 shader 里再长出一套容器假设。**单向钳制只治一半**——探针实测过：只钳池深时，`waterLevel=0.01` 的默认值仍会让水膜穿地。上钳取 `poolHeight` 而非外壁实际顶沿（`poolHeight + max(0.02, t·0.6)`，见 `water-body-strategies.ts|applyTransformLinks`）是**保守方向**：预算只会更小，不会越界。

**D2 — 频谱锚点从世界米制改为域宽相对。** `λ_i = waterSize / (baseN · 1.19^i)`（`baseN` 取 4，级数步长 1.19 保持 ADR-255 原设计）。收益是**自洽**：每波长顶点数与 `waterSize` 无关，六波恒落在可呈现窗口内，ADR-272 之后尺寸滑块放开到 300 m 所引入的摩尔纹问题从根上消失，`aa` 淡出从「处方」降级为纯保险。代价是波长的绝对语义丢失——真做 `ocean` 形态时须由形态策略声明谱锚点（相对 / 绝对），本 ADR 只定方向、不实现。

**D3 — 泡沫判据与防自交钳制的互斥必须表态，二选一。** (a) 保留泡沫：判据从「`J ≤ 0`」改为「相对压缩量」（探针口径 `smoothstep(0.75, 0.45, J)`，实测拖满 `choppiness` 时 `J_min=0.407` 可触发、静水时 `J=1` 不触发），并按 `choppiness` 归一；(b) 删通道：`vFoam` varying、Jacobian 三项累加、`mix` 一起退役。**不存在第三个选项——「每帧计算、永不触发」不是实现，是债**。**落地取 (b)**：D1/D2 落地后防自交钳制上界不变（探针 `steepSum = 0.8·choppiness`：默认 chopp=0.5 → 0.4，拖满 → 0.8），`J_min` 新尺度实测 **0.656**（chopp=0.5）/ **0.379**（拖满），`J ≤ 0` 占比恒 **0.00%**——原判据（`J ≤ 0` 才出沫）仍是死通道。如实记下 (a) 的代价：相对压缩判据（`smoothstep(0.75, 0.45, J)`）在新尺度下**已可达**（拖满时 `J_min=0.379 < 0.75`），要它就得重写判据、按 `choppiness` 归一、再加一层可见性门，等于给一条从没工作过的通道做第二次手术。取 (b) 删除，把设计权留给未来真要做泡沫的那一次——而不是让旧通道以「弱」的姿态假装活着。

**D4 — 量具不进门禁，结论进断言。** `probe-water-wave.ts` 退出码恒 0（它是探针不是闸）。实施时把三条结论落成 `water-capability.test.ts` 的**数值断言**（峰谷差 ≤ 容器预算、`J` 可达性、窗口覆盖条数），取代现有对 GLSL 字符串的 `toContain` / `indexOf` 字符断言——字符断言改个格式就红，却放过了这轮全部三个真缺陷。

**范围外（各自另议，不在本 ADR）**：倒影混合点位于 `tonemapping_fragment` 之后导致的 tone 曲线 / 雾化错位；`uBaseOpacity` 与 three `opacity` 通道的冗余双写；film 用 `metalness` 求高光造成的水色染色。

## 3. 后果（Consequences）

**正面**：浪高第一次成为用户可控量，静水态可达；小水池出波纹、大水面不被砍频，10–300 m 全域观感一致；水面不再漫过池壁、不再穿地面（越壁/穿地占比归零）；泡沫要么真的出现要么不存在，不再伪装成特性；`waterWaveHeight` 进 schema 后写侧持久化与值域钳制自动跟上（ADR-283 既有收益）。

**负面**：① 默认观感发生可感变更（现默认波形 = 5.3 m 峰谷差的「风暴」，改后是容器内可控涟漪），需要发版说明，且已保存的氛围/预设快照里带 `water*` 键的会与新默认不同步——预设是快照语义，可接受但须写明；② `waterLevel` 默认值若随 D1 上抬（探针显示 0.01 会把预算卡死、波退化成平面），要与 ADR-257 的「旧存档无 `waterLevel` 键时 pool 兜底取 `waterPoolHeight`」分支一起回归，别让兜底路径绕过新预算；③ D2 动了波形，ADR-272 的抗锯齿淡出用例（「分段数唯一事实源」「按每波长顶点数淡出」）须同步改写，否则锁的是旧频谱的形状。

**已知遗留**：形态策略表目前没有「谱锚点」这一维，`ocean` 形态真要落地时须扩 `WaterBodyStrategy`；D3 取 (b) 后知识卡里「Jacobian 出碎波泡沫」那条职责描述已随落地一并删除（不是只改代码）。

## 4. 数据溯源

- 来源：`node scripts/probe-water-wave.ts`（默认取 schema 现值）；`--json` 出结构化全量；`--size/--choppiness/--segments/--level/--depth/--amp` 可复扫任意参数点。
- 忠实度标定（①，**旧公式**复刻件）：对照 ADR-257 §6.4 表（修正后 2.40° / 7.02°），实测 1.18° / 6.20°——先自证复刻忠实再取数；新公式下的标定见本节下方「标定（①）在新公式下」。
- §1 六行表全部为该脚本默认调用的直接读数，无手工推算。
- 处方档（`--amp 0.004`、`level=0.06`，双向往钳制预算 **0.075 m**）实测：峰谷差 **0.144 m**、RMS **0.022 m**、越壁 **0.00%**、穿地 **0.00%**、aa 淡出 **0 条**、窗口内 **6 条**，且在 `size ∈ {10,20,40,80,160,300}` 上**指标不变**——尺度无关性由数据背书，不是推理。注意处方档的振幅参数化是 `amp·size/1.19ⁱ`，与实现公式 `uWaveHeight·0.26·0.82ⁱ` **不同源**（差在振幅分配曲线：处方 1.19 级数、实现 0.82 级数），落地后以实测配方为准，处方档只留作对照列。
- **视觉取证（e2e 真 3D 会话截图，2026-10-04，修复前）**：`frontend/e2e-web/water-wave-evidence.spec.ts`（swiftshader WebGL，`waveSpeed=0` 冻结波相使五场景同相可比）产出 `frontend/e2e-web/_shots/water-wave/s1..s5.png`，逐张人工回看与上表逐条对应：
  - `s1-film-default.png`：默认 film（size=80/choppiness=0.5）即明显起伏，地面网格横穿水膜（穿地 49.14% 的可见形态）；
  - `s2-choppiness-max-no-foam.png`：Choppiness 0.50→1.00 波形零变化（高度不进尖度链），全画面无白沫（泡沫判据不可达）；
  - `s3-pool-size10-overflow.png`：pool + size=10，水膜整体浮在池壁顶沿之上（越壁 33.17%）；
  - `s4-film-size10.png`：10 m 域宽内只有一段长涌，像波浪毯，无波纹；
  - `s5-film-size300.png`：300 m 域宽只剩地平线一道长涌，主体近水平。
- **落地后复核（2026-10-04，同脚本重跑新公式）**：D1/D2 落地后的实测（`freq = 2π·1.19ⁱ·4/size`、`amp = uWaveHeight·0.26·0.82ⁱ`、预算 `min(level, poolHeight − level)`，新默认 `waveHeight=0.06` / `level=0.15` / `poolHeight=0.3`）：预算 **0.150 m**（浪高 0.06 未被钳）、Σamp **0.060 m**（= h，0.26 归一成立）、峰谷差 **0.116 m** / RMS **0.018 m**、越壁 **0.00%**、穿地 **0.00%**；六波**全部落在可呈现窗口内**（aa 淡出 0 条、超域宽 0 条），且在 `size ∈ {10,20,40,80,160,300}` 上峰谷差 / 越壁 / 穿地 / 窗口内条数**全部不变**——尺度无关性由数据背书，不是推理。
- **D3b 依据复核**：`Σσ·k` = 0.400（`choppiness=0.5`）/ 0.800（拖满）；`J_min` = **0.656** / **0.379**；`J ≤ 0` 占比恒 **0.00%**。即便保留泡沫通道也是每帧计算、永不触发的死通道，故取 (b) 删除而非 (a) 改判据。
- **D1 分形态钳制复核（2026-10-04，子代理审计后二次修正）**：首版落地把「两钳取小」无条件套给两形态，film 无壁却套了 `poolHeight` 上钳——而 film 下 `waterPoolHeight` 滑块隐藏、锁死在默认 0.3，`waterLevel` range 却到 5.0，水位过 0.3 m 即预算归零、浪高静默死平（探针 `--level 0.5` 实测 peakToTrough **0**）。已改为 `effectiveWaveHeight(forPool)` 按形态分派，探针同步加 `--film` 分形态建模（默认仍按 pool 保留本 ADR 已发布命令的可复现性）。分形态实测（`--level 0.5`）：**pool** 预算 0 → peakToTrough 0 / 越壁 100%（过壁顶，符合预期）；**film** 预算 0.5 → peakToTrough **0.116 m**、越壁不适用、穿地 **0.00%**，且 `size ∈ {10,20,40,80,160,300}` 峰谷差恒 **0.11586 m**（D2 尺度无关性在 film 下同样成立）。默认档（`level=0.15`）两形态预算同为 0.15、数字与本节「落地后复核」完全一致，不受本次修正影响。测试以 `effectiveWaveHeight` describe 锁住四态（film 无上钳 / pool 有上钳 / pool 脏参数归零 / 下钳水位归零）。
- **兜底路径与几何钳制复核（2026-10-04，子代理审计）**：§3 负面 ② 预警的「兜底路径绕过新预算」确实成立——`loadState` 的 ADR-257 分支把旧 pool 存档兜底为 `waterPoolHeight`（旧语义「水填到池顶」），套新钳制后预算 = min(h, 0) = 0、浪退化成平面。已改为兜底取 `poolHeight × 0.5`（中池位：预算 `min(level, h−level)` 的最大值点，也是新默认 0.15/0.3 的比例）。另补 `applyTransformLinks` 对 `waterSize` 的钳制（原本 h/t 有二次防御而 size 裸用，防御口径不对称，任何绕过 `setEnvState` 的直调路径会把越界 size 静默烤进 10 件 mesh 的 transform）；shader 内 D3(b) 注释同步改为新结论（原判据仍死、相对压缩判据拖满时 `J_min=0.379` 可达）；圆角裁剪的「水面恒在原点」假设已补测试钉子（原为知识卡登记但零断言）。
- **遗留项归口**：① 注入检测的两条洞已收口（2026-10-04 `7214b629c`：六锚点——位移锚点 `transformed.z += gdisp.z` + `fragOk` 改查 `uReflTex`）；② `gerstner()` 每顶点算两次仍登记（beginnormal 取 nrm、begin_vertex 取 disp，各丢一半输出，非阻塞，升级 three 时一并议）。**实施进度以知识卡 `docs/knowledge/water.md` pitfalls 为准**（本条只作归口指针，不记进度）。
- **标定（①）在新公式下**：解析法线 vs 几何法线 0.030° / 0.161°。当前振幅比旧公式小两个量级、波面斜率趋零，偏差同步缩小属预期；旧公式的对照基准（2.40° / 7.02°）仍见 ADR-257 §6.4。
- **修复后回归取证（e2e，2026-10-04）**：同一 spec（`water-wave-evidence.spec.ts`）改为**六场景**并输出到 `frontend/e2e-web/_shots/water-wave/post319/`（`s1-film-default` / `s2-waveheight-max-clamped` / `s3-choppiness-max-no-foam` / `s4-pool-size10-contained` / `s5-film-size10` / `s6-film-size300`）；修复前的五张留在 `_shots/water-wave/` 同层，两组可并排对照。**坑**：2026-10 收口把 `waterEnabled` 默认改成 `false`（治理默认蓝膜压住地面承接面），spec 须先显式开水并**读回 checkbox 状态**，否则拍出来的是地面不是水、六张全废。开水入口也不在参数页——`waterEnabled` 是 `water-capability.ts|getMasterNodeId` 报出的 master 节点，渲染在 env 列表行的 `headerToggle` 上，参数页经 `envCapSubNodes` 把 master 节点过滤掉（在参数页里找 `cap-water-enabled` 必挂）。

<!-- 文件名: water-spectrum-scale-normalization.md → 实际文件 ADR-319-water-spectrum-scale-normalization.md -->
