# 地面系统锐评 + 决策批执行报告（2026-10-04）

> 报告型文档（非知识卡）：记录 2026-10-04 地面系统锐评的**决策当时**结论与拍板批执行过程。
> 现状判断一律以当前源码树 + 知识卡（`ground_surface_spec.md`）为准——本报告是快照，不是事实源。

## §1 锐评主体（当前源码树为据）

### 1.1 给好脸色（不批的）

- **纪律是全仓 10 cap 里最铁的**：spec 单源（`ground-surface-spec.ts`）、默认值统一取 `DEFAULT_GROUND_SURFACE_PARAMS`（ADR-249 §2.6 治双源）、值域钳制唯一写入口（ADR-283）、持久化写侧 schema 键集派生（G-8）、预设置位中间件单源 + `RESTORE_SOURCE` 收敛 + 重入治理（suspend/resume 一次落地）。896 行里约六成是注释，六成即病史化石，值钱。
- **地面自证（不变量 17）收口干净**：默认 `sourceKind="solid"` + `ysmGroundProbe` 探针 + `menu-3d-session.spec.ts` 钉死「默认可见 + 经菜单切 none 回落」，机器一眼认得地面在 y=0。旧病「只有网格线、地面=天空」已除。
- **2026-10 收口批全落了**：默认关水（蓝膜不再压承接面）、`groundDivisions` 60→40、网格色换暖中灰（0x8a8278/0x6a6258）、软阴影默认、水位抬 0.15 + ADR-319 波高下钳治死「叠层被水膜压」历史病例。

### 1.2 四刀（该批的）

| # | 刀 | 位置 | 裁定（拍板批） |
|---|----|------|----------------|
| 1 | `enabled` 僵尸持久化往返：cap 私有字段（registry 恒不传 → 构造默认 true；生产 UI 无 setEnabled 写口——env 一级行 headerToggle 绑 ground-visible master 节点走 schema `groundVisible`，场景组根视图 headerToggle 只覆盖 camera/lighting/shadow/postproc）却手写存/读两边，恒真值绕圈 | `ground-capability.ts\|saveState` / `\|loadState` | ✅ 已摘除（对照 water 侧同病收口 2026-09-22「enabled 幽灵键」；防回填注释留闸；真·根治 = enabled 收编 schema 键，归 ADR-321 已知遗留） |
| 2 | 读侧双轨未根治：写侧「一处参数自动跟随 schema」，读侧 `restoreFields` 仍手写 24 字段清单，round-trip 契约锁是绷带不是手术；「加一个键、登记两个地方」的病只切了一半 | `ground-capability.ts\|loadState` | ⏳ 另立 ADR-321（跨 cap 统一议题，📝 提议中，实施不混入本期） |
| 3 | `clearCustomTexture` 清图停在 `canvas+plain`：与默认态 `solid` 名实差一格（solid/plain 渲染输出统一，ADR-254 §2.5），同一画面两张菜单脸 | `ground-capability.ts\|clearCustomTexture` | ✅ 已改为回出厂三轴（`solid`+`plain`；三条理由入注释：画面不变/中间件置 custom 正确/样式轴防悬空） |
| 4 | 跨层序关系靠人肉登记：「waterLevel 低于 0.005 水膜被承接面吞掉——逐字段 schema range 管不到这条」（已知已登记，audit P2-1④）；ADR-283 只立法了单字段值域，没立法层间序关系 | `scene-capability.ts\|GROUND_LAYER_OFFSETS` 注释 | ⏳ 维持登记制（水侧在途收口中）；将来层数再加时立「层间序关系」校验 |

## §2 决策批执行记录（2026-10-04 拍板）

| 决策 | 拍板 | 执行 |
|------|------|------|
| 雷霆 `write_diag` 整件摘除 | 「验证完成，临时工具使命结束；方法论沉淀知识卡」 | ✅ commit `a040fd8da`（write_diag.go + 平台桩 + app.go 钩子；`workspace_exe_write_denied` / `experience` 卡引用同步） |
| `enabled` 僵尸往返摘除 + `clearCustomTexture` 回出厂三轴 | 用户加固：删的只是持久化往返（setEnabled 有测试/生命周期消费方，不删）；防回填注释留闸；读侧另立 ADR | ✅ commit `7e8cca648`（G-8 幽灵键断言反转 + 两处清图断言改 solid + 知识卡不变量 3/存档归一条目） |
| P0 地平线真淡出：轻雾路线**先取证**（三条纪律：判据=模型可读性不靠调密度硬救 / 雾参数走 schema 禁 cap 私货 / 默认开不拍脑袋，取证支持哪条再写 ADR） | 用户拍板 | ✅ 探针 spec + 取证完成，**不过关 → 维持现状**（§3 证据记录） |
| P1 批（微噪点 + 微反射）P0 取证后紧接着做 | 用户拍板 | ✅ commit `07db29897`（代码/测试/知识卡全绿，落地明细 §2.1） |
| 读侧派生开独立 ADR | 用户拍板（「够格开 ADR」「跨 cap 统一议题，一次拍全局」） | ✅ ADR-321（commit `c769270ce`，📝 提议中，不实现） |

### 2.1 P1 批落地明细（microNoise + envMapIntensity）

- **matMicroNoise（structural）**：`GroundMaterialParams` 新字段（默认 6，±/255）；plain 系生成器（`surface-pixels/plain.ts`）经 4D 环面 `tiledFbm`（freq 24 / 3 octaves）高频微细节，平铺无缝；`rebuildSurface` tex 分派改道——**microNoise>0 时 solid/plain 走生成纹理**（ADR-254 §2.5 的纯色快路径仅在 =0 时保留），否则该参数在默认地面路径上是死代码（本批自审抓出）；矩阵 `paramIsEffective` 锁死「仅 solid/plain 消费，噪声材质/texture 不读」。
- **matEnvMapIntensity（appearance）**：默认 0.15（极低 IBL 接地反射，摄影棚 floor 手法）；`applyGroundSurfaceAppearance` 单路径原地落地（改值不触发纹理重建，测试锁死材质引用不变）；独立于模型全局 `envIntensity`（承接面不随模型反射档 1:1 联动）。
- **纪律接线**：两键进 `ENV_STATE_SCHEMA`（默认值单源取 spec，值域归 ADR-283）+ `loadState` 手写还原表登记（ADR-321 收口前 G-8 round-trip 契约锁兜底）+ 效果矩阵/像素/能力三层测试同步 + 知识卡不变量 12（纯色快路径例外注记）/18（新增）。
- **未做（有意）**：菜单控件化（微噪点/反射强度滑杆）——探索档 P2「场景预设层」议题；默认值语义 = 「开箱即产品级」，用户要精细控制时再上控件。

## §3 P0 雾单变量取证记录（不过关 → 维持现状）

**探针**：`frontend/e2e-web/fog-horizon-evidence.spec.ts`（真 3D 会话 + fixture 01_taisho_maid，同机位同模型，唯一变量 = `fogEnabled`，经 env-state 单写入口直写；场景级 `scene.fog` 落地断言 + 两图 sha256 互异防假绿灯）。

**截图**：`frontend/e2e-web/_shots/fog-horizon/s1-fog-off.png`（基线）/ `s2-fog-on.png`（雾开，schema 默认雾参数 near=10 / far=200 / 线性 / 0xaac4e8）。

**三判据执行（读图回看）**：

| 判据 | 结果 |
|------|------|
| ① S1 网格「切天边」硬切（现状基线） | 成立——平面边缘硬缝清晰（地面与天际交界的深色带） |
| ② S2 地平线是否软化融入天际 | **不成立**——平面边缘硬缝仍在；仅远带（平面远端）向雾色 0xaac4e8 微亮，两图 sha 差异 18 字节量级（差异真实但观感不可辨） |
| ③ S2 模型轮廓/阴影接触面可读性 | 保持（模型在 near=10 雾外区，零影响）——**swiftshader 软渲染下阴影贴图不渲染**（shadow-compare-model spec 既有结论），阴影接触面判据需真实 GPU 复核，本批不阻塞 |

**裁定**：证据**不过关**——schema 默认雾参数下 P0 目标（消除地平线硬切）未达成，「默认开」= 无效操作 + 全局副作用（fog 是全局键，天空盒/水面/模型全被裹挟）。按拍板纪律「不过关退维持现状，**不再加参数试**」（调 fogFar 去救 = 被禁的密度硬救）：

- `fogEnabled` 默认维持 `false`；地面系统维持现状（divisions 40 + 暖色温缓解版生效中）；
- **P0「真·地平线距离淡出」= 已知未收口**（探索档 P0 项保持未落，自建 LineSegments 顶点 alpha / horizon blend 留作架构项，不进本期）；
- 未触发「取证支持某路线 → 写 ADR 定接口」（cap 反向写全局态的架构面不开）。

**假绿灯防线复核**：S1/S2 截图非零字节 ✓、sha 互异 ✓（18 字节级差异正是「雾生效但默认参数观感无效」的证据本身，非流程假动）。

**环境注记**：首跑失败 = 并行会话写 `screenshot-cone.ts` 触发 vite HMR 整页重载（execution context destroyed）——与 e2e-visual-feedback 卡「并行会话干扰」条目同形；重跑即绿。

## §4 遗留与后续

1. **ADR-321（📝）**：cap 持久化读侧派生（restoreFields 由 schema 键集统一驱动，跨 cap 一次拍全局）——实施单独立执行批。
2. **P0 真·地平线淡出**：架构项（LineSegments 顶点 alpha 撕 GridHelper 重建逻辑 / 或 horizon blend），待视觉底座（P1 批）稳定后重估。
3. **P2 场景预设层 / 叠层默认设计感**：探索档原样搁置（依赖 P0/P1 视觉底座 + 三轴纪律）。
4. **enabled 幽灵键真·根治**（收编 schema 键、私有门与 schema 键合一）：ADR-321 已知遗留，判据复用 reflector F-1 双门收口口径。
5. **（已解决）水面在途批互踩**：P1 提交前契约测试曾被兄弟会话 untracked 决策区文件（`docs/adr/decisions/ADR-266-d1-*`）挡一次（「decisions 区当前为空」过时断言 + dry-run 占号漂移）——其落定后翻转 `test_adr_tiering` 编号快照（321→322，随 ADR-321 提交 `c769270ce`），P1 批 `07db29897` 一次通过。并发会话期 ADR 契约测试的互踩面在此留档。
