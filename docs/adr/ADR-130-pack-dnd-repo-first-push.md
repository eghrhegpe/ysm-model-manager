# ADR-130：整合包卡片拖拽导入：先入仓库再推送

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-08-29
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：ADR-038（导入架构）、ADR-060（DnD 组件级绑定）、ADR-064（相对路径同步）、知识卡 `import_queue` / `app_sidebar` / `go_installer` / `go_sync`

---

## 1. 背景（Context）

模型仓库页已有成熟拖拽导入（ADR-060：`<app-tree>` 容器级绑定 + 共享收集器），但整合包（Minecraft 实例）侧没有对应入口——把模型装进整合包只能先拖进仓库，再右键「推送到整合包」走弹窗选实例，两段操作、一次选型。用户直觉期望：**拖到哪张实例卡片，就装进哪个整合包**。

同时，设置页的「🎮 HMCL / PCL」启动器检测按钮使用场景有限：一次性初始化入口埋在设置页深处，而用户真正遇到「找不到整合包」的地方是实例页空态。

## 2. 决策（Decision）

1. **整合包卡片拖拽导入走「先入仓库再推送」两段式**，不做绕过仓库的直拷贝：
   - 仓库是单一事实源——先入仓才能让硬链接模式、同步面板差异计算、后续移动/重命名/标签管理自然成立；直拷贝会在实例与仓库间制造无链接的双份内容。
   - 数据流与既有「下载产物先入仓库，再由上层触发安装」同构（go-installer 定位）。
   - 类型判定、仓库落点、实例子目录解析**全在 Go 侧**（职责归属红线：前端只读不判型）——新增 `ImportFileAndPushToInstance` / `ImportFolderAndPushToInstance` binding，导入核心复用 `importer.ImportFromBase64`（扩展返回 `destPath/rtype`）与 `WriteModelFolder`，推送复用 `ysmsync.PushSingleResource` 管线。
   - 前端只收集/分组/编排：`features/pack-dnd.ts`，收集口径与仓库页共用 `dnd-shared.collectDropFiles`（消除第三份收集逻辑）。
2. **根级目录级安装入口前置拒绝**：`.pmx/.pmd/ysm.json` 会触发 `InstallDir(父目录)`，父目录=仓库根时整仓落地——binding 层防线（前端同款 ysm.json 提示），比右键推送存量路径更易命中的拖拽场景必须有守卫。
3. **HMCL/PCL 启动器检测搬家到实例页空态**：空态就地提供「🔍 自动搜索 / 🎮 HMCL / PCL」两入口（HMCL/PCL 分离实例目录是自动搜索盲区，这是唯一免手填路径的入口）；settings 版按钮与 MutationObserver 注入逻辑删除，功能收敛单点。

## 3. 后果（Consequences）

**正面**
- 实例卡片 = 推送目标，右键推送里「弹窗选实例」一步消失；入仓+推送一拖完成。
- 新增 UI 能力零新增判定逻辑：Go 侧两条 binding 全部复用既有管线（导入核心 / 推送核心 / 缓存失效口径），行为与同步面板逐文件推送一致。
- 实例页形成闭环：空态解决「整合包怎么进来」，卡片拖拽解决「模型怎么进整合包」。

**负面 / 已知遗留**
- 拖拽导入在实例页缺少 rtype 上下文，文件夹类型走内容推断（与默认仓库页同口径）；页面上下文路由（拖到哪页落哪页根）在实例页不适用——实例页是中性页，这是有意让位内容推断。
- 推送失败时仓库可能已落盘（导入先于推送完成），前端以「只要有 binding 调用即刷新」对冲陈旧窗口；失败提示引导用户在仓库侧处理。
- `PushSingleResourceToInstance`（右键推送存量路径）对根级 `.pmx/.pmd/ysm.json` 的整仓落地风险仍存在，本 ADR 只在新链路加了守卫——后续可让存量路径复用同一 helper 收口。

## 4. 数据溯源

- 决策来源：用户提出「仓库有拖拽导入，整合包是不是也可以有」+ 对 HMCL/PCL 按钮场景有限的反思；AI 摸底既有管线（`import-executor` / `PushSingleResourceToInstance` / `findInstanceDir`）后给出方案，用户拍板「折腾吧」。
- 结果：Go `internal/app/app_install_import.go` 新增两 binding（测试 `app_install_pack_test.go`）、`go/importer/importer_file.go` 签名扩展；前端 `features/pack-dnd.ts` + `app-sidebar` 接线 + `launcher-detect.ts` 搬家（测试 `pack-dnd.test.ts` / `launcher-detect.test.ts`）。
