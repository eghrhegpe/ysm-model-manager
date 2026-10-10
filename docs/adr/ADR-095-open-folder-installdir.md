# ADR-095：OpenInstanceFolder 打开资源存储目录而非模组扫描目录

- **状态**：✅ 已采纳（Accepted）
- **日期**：2026-08-18
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`internal/app/app_scan.go` `OpenInstanceFolder`；`resource_types.json`（`installDir` / `scanDir` 字段）；`go/types/extensions.go` `FindInstDir` / `SubDirMap`

---

## 1. 背景（Context）

整合包实例右键菜单「打开文件夹」（`instance.open-folder` → `App.OpenInstanceFolder`）打开的路径是 `\config` 目录，匹配到的是模组配置文件而非资源包存储目录。

调用链与两处问题：

1. **语义错配（根因）**：`OpenInstanceFolder` 用 `SubDirMap(rtype)` 取 `scanDir`（如 ysm = `config/yes_steve_model/custom`）。`scanDir` 的语义是「模组从哪加载文件」，而资源包实际存放地由 `installDir`（如 ysm = `versions/{instance}/ysm/`）表达。打开文件夹的预期是存储目录，代码却用了加载目录。
2. **判定放大（加剧）**：`FindInstDir` 用 `SupportedExtsForType` 做「目录内包含该类型文件」判定，而 ysm 类型扩展名含 `.json`（`resource_types.json`），`config/` 下成堆模组配置文件/绑定 json 直接命中 `dirContainsExt`，返回 config 目录，兜底扫描连执行机会都没有。

对比：资源管理器视图工具栏「打开文件夹」按钮传 `_rpRoot`（`frontend/src/views/app-resource-manager/index.ts`），实例模式下按 `installDir` 推导为版本目录下的资源存储目录——同一功能两处口径不一致。

## 2. 决策（Decision）

`OpenInstanceFolder` 不再用 `SubDirMap` / `FindInstDir` 作为唯一探测手段，改为「installDir 标准推导 → scanDir 存在性回溯 → FindInstDir 兜底」三级，全部落空回退 `instDir`：

1. **候选 A/B（installDir 标准推导）**：先替换 `{instance}` 占位符为 `filepath.Base(instDir)`（实例名）：
   - 候选 A：`instDir` 直接拼接 `installDir` 掐掉 `versions/{instance}/` 前缀后的剩余段（instDir 已是版本目录/整合包根时，ysm = `instDir/ysm`）；
   - 候选 B：`instDir` 上两级（vanilla 布局的 `mcRoot`）+ 完整 `installDir`（resourcepack 等 `installDir` 为相对 mcRoot 的全局目录，如 `mcRoot/resourcepacks`）；
   - 覆盖：resourcepacks / shaderpacks / 3d-skin / tlm_custom_pack 等标准目录，config 零参与。
2. **候选 C（scanDir 存在性回溯）**：`ScanDir` 逐级上溯（`custom` → `yes_steve_model` → `config`），取第一个存在的目录。覆盖 ysm 模型真身在 config 树内的场景（PCL2 整合包实测 `versions/[海岛寿司店]v1.1/config/yes_steve_model`）。
3. **候选 D（FindInstDir 兜底扫描）**：标准/回溯均落空时复用计数/列表链路的同款探测，接住 Sable-Schematics 等非标准目录——弥合「列表显示正确（FindInstDir 兜底）但打开回退版本目录」的裂口。
4. 全落空 / 未知类型（无注册表配置）→ 返回 `instDir`（行为不变）。

**配套：`FindInstDir` 的 `.json` 弱证据收紧**（`go/types/extensions.go`）：
- ysm 扩展名含 `.json`，config 目录下模组配置文件泛滥导致 `dirContainsExt` 误命中 config 树；
- 收紧：`.json` 不再作为独立的「目录含该类型文件」证据；ysm 的 json 证据以 **`ysm.json` 标志文件**替代（新增 `dirContainsFlag` 递归查找），覆盖解压型模型目录（无 `.ysm` 主文件，靠 `ysm.json` + `models/` 识别）；
- 影响面：安装 / 同步 / 统计 / 扫描 / 打开共用 `FindInstDir`，一处收紧全链路受益，config 纯配置目录不再被误判为模型目录。

覆盖矩阵（实测用户环境 + 布局变体）：
| 场景 | 命中候选 | 结果 |
|------|----------|------|
| PCL2 资源包（`versions/…/resourcepacks`） | A | ✅ `instDir/resourcepacks` |
| PCL2 光影包（`versions/…/shaderpacks`） | A | ✅ `instDir/shaderpacks` |
| PCL2 3d-skin（`versions/…/3d-skin`） | A | ✅ `instDir/3d-skin` |
| TLM（`versions/…/tlm_custom_pack`，注册后） | A | ✅ `instDir/tlm_custom_pack` |
| ysm config 树（`versions/…/config/yes_steve_model`） | C | ✅ 回溯命中 `yes_steve_model`（custom 存在则命中最深层） |
| 蓝图 Sable（`Sable-Schematics/hello_new_generation_core`） | D | ✅ 兜底命中 `Sable-Schematics` |
| 全部落空 / 未知类型 | 回退 | ✅ `instDir` |

## 3. 后果（Consequences）

**正面**：
- 右键「打开文件夹」按「标准目录 → config 树回溯 → 非标准兜底」三级定位，与资源管理器工具栏按钮口径一致；
- 消除 `.json` 扩展名在 `config/` 目录上的误命中（`FindInstDir` 收紧），安装 / 同步 / 扫描 / 打开全链路不再把纯配置目录当模型目录；
- 保留非标准目录兜底能力（Sable-Schematics、tlm_custom_pack 等），不牺牲显示链路的探测精度；
- 修改集中在 `internal/app/app_scan.go` + `go/types/extensions.go`，前端与绑定签名不变。

**负面 / 已知遗留**：
- 推导依赖「候选目录真实存在」，未安装过资源的类型在整合包内打开时会回退到实例根目录（行为与原实现的目录不存在回退一致）；
- ysm 的 config 树回溯命中的是「模型公共目录」（如 `config/yes_steve_model`），若模型分散在多个子目录，打开粒度是公共祖先而非单模型目录；
- `SubDirMap` 仍被安装、同步链路（`app_install_instance.go`、`go/sync`）使用，本次仅改「打开文件夹」语义与 `FindInstDir` 判定，未动写入链路目标；
- **`.json` 收紧的安装漂移边界（已知）**：安装/同步链路共用 `FindInstDir`。若 `custom` 目录仅含配置文件（无 `ysm.json`/`.ysm`）且版本目录下另有含 `.ysm` 的目录，安装目标可能从 `custom` 漂移到兜底命中目录。真实模型目录几乎必有 `ysm.json`（标志文件命中），风险低；记为已知边界，不做额外守卫。若未来实测漂移，先查 `custom` 是否缺 `ysm.json`。
- TLM 条目由并行会话注册（`resource_types.json` 未提交时测试条件跳过），本 ADR 不依赖其落地。

## 4. 数据溯源

- 现象：右键打开 `\config` → `app_scan.go` `OpenInstanceFolder` → `SubDirMap`（`scanDir`）→ `FindInstDir` → `config/yes_steve_model/custom`。
- 根因字段：`resource_types.json` ysm 条目 `installDir: "versions/{instance}/ysm/"`（存储）vs `scanDir: "config/yes_steve_model/custom"`（加载），`extensions: [".ysm", ".zip", ".7z", ".json"]`（含 `.json`）。
- 正确口径参照：`frontend/src/views/app-resource-manager/index.ts` `_rpRoot` 的实例模式推导（`VersionDir + installDir.replace("{instance}", ...)`）。
- 修复验证：`go build ./go/...` + `internal/app` 测试。

<!-- 文件名: open-folder-installdir.md → 实际文件 ADR-095-open-folder-installdir.md -->
