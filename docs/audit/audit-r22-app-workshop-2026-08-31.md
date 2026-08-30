# R22 审核 — internal/app/app_workshop.go 创意工坊配置（站点 + 创作者）

**审核日期**：2026-08-31
**审核者**：主模型（串行模式）
**范围**：`internal/app/app_workshop.go`（380 行，24 符号）+ `internal/app/app_workshop_test.go`（230 行）+ 前端消费方（`community-data.ts` / `init-github.ts` / `site/drag.ts`）+ web 桥 `web-community.ts`（双轨对照）+ 契约测试 `browser-adapter.contract-b2.test.ts`
**方向岔开依据**：最近 50 条提交 `app_workshop.go` 零命中（最近一次 0f68a223 于 2026-08-21 第八轮三路并行审核）；R21 报告点名推荐
**门禁状态**：`go build ./go/...` ✅；`go test -race -timeout 300s ./internal/app/` → `ok 5.036s` ✅；`go vet ./internal/app/` ✅

---

## 总体结论

**有条件通过**——薄壳层基础设施质量良好（ADR-046 fail-fast / BOM 单点 / 迁移保护 / bundled 兜底链 / 原子写盘），但发现 **1 项 P2 真实缺陷**（全新用户 Merge/Replace/Reset 全部不可用，且 web 桥无此问题 = **双轨漂移**）+ **3 项 P3** + **3 项 P4**。

**与 R19/R20/R21 对照的规律再次成立**：每条 binding 链都有「测试未覆盖的契约不一致」——本模块 230 行测试全部覆盖在基础设施（读/写/CSV/迁移），**8 个业务编排函数（BySite/Presets/Reset/Backup/Merge/Replace）零单测**，P2 就藏在其中。

---

## 亮点（12 项）

| # | 模式 | 位置 |
|---|------|------|
| 1 | **ADR-046 fail-fast**：configDir 缺失 → 落点空串、写盘失败，绝不降级 CWD/exe 旁 | `app_workshop.go:23-29` + `TestWorkshopConfigDirEmpty_NoOp` |
| 2 | **BOM 单点**：readJSONFile/loadBundledJSON 统一 `StripBOM`（cd18c52a 修复） | `app_workshop.go:83-101` + `TestReadJSONFile_BOMTrim` |
| 3 | **旧 exe 旁配置迁移**：先写后删、失败保留旧文件不丢数据 | `app_workshop.go:34-65` + `TestWorkshopConfigMigrateFromExe` |
| 4 | **bundled 兜底链**：用户配置 > 内联 bundled > 硬编码默认（3 站） | `DefaultWorkshopSites`/`LoadWorkshopCreators`/`LoadGitHubRepos` |
| 5 | **三重备份保护**：Reset/Merge/Replace 前置 `BackupWorkshopCreators`（原子 .bak） | `app_workshop.go:218, 334, 376` |
| 6 | **写盘全走 `fsutil.WriteFileAtomic`**（原子替换防半截文件） | 全部 Save* 路径 |
| 7 | **CSV 导出格式契约测试**（表头 7 列锁定） | `TestExportWorkshopSitesCSV_Format` |
| 8 | **web 桥契约测试**：覆盖层优先级 / 损坏回退 / 深拷贝（B2 契约） | `browser-adapter.contract-b2.test.ts` |
| 9 | **binding 七签名全对齐**（陷阱 #5 通过）：DefaultWorkshopSites/LoadWorkshopCreators/SaveWorkshopSites/LoadGitHubRepos/BySite/Presets/Merge | 前端 getApp() 调用逐一核对 |
| 10 | **Merge 完整性校验**：合并后 <100 条 → 报错不写盘（内存回滚成立） | `app_workshop.go:362-364` |
| 11 | **迁移与 app_config 同构**（migrateLegacyConfig 对齐，注释明示） | `app_workshop.go:34` |
| 12 | **Go/web Merge 语义一致**（Name 为 key 的合并 + 仅补空字段） | `app_workshop.go:337-365` vs `web-community.ts:300-309` |

---

## 风险清单

### 🟠 P2-1（必修）`BackupWorkshopCreators` 在 creators.json 不存在时失败——全新用户 Merge/Replace/Reset 全部不可用

**位置**：`app_workshop.go:311-316`（Backup 本体）+ `218`（Reset）/ `334`（Merge）/ `376`（Replace）

**观察**：

```go
func (a *App) BackupWorkshopCreators() (string, error) {
	path := creatorsPath()
	bakPath := path + "." + time.Now().Format("20060102-150405") + ".bak"
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err   // ← creators.json 不存在（全新用户）时返回错误
	}
```

**触发链路**（全部经前端对**所有用户**开放的入口）：
- 全新安装 → 用户目录无 `creators.json`（数据走 bundled 兜底，`LoadWorkshopCreators` 正常返回非空）
- 拖拽导入创作者 JSON（`site/drag.ts:70` 无门槛）→ `MergeWorkshopCreatorsFromJSON` → Backup 读不存在文件 → `err` → **「备份创作者数据失败，中止合并」**——首次导入必失败
- `ResetWorkshopConfigs`（重置）与 `ReplaceWorkshopCreatorsFromJSON`（替换导入）同病

**双轨漂移（红线）**：`web-community.ts:290-309` 的 Merge **无备份步骤**，全新状态直接合并成功——桌面失败、网页成功，同一操作两轨行为不一致。

**为什么没被发现**：`app_workshop_test.go` 只测 readJSONFile/默认站点/CSV/迁移/落点，`BackupWorkshopCreators`/`MergeWorkshopCreatorsFromJSON`/`ReplaceWorkshopCreatorsFromJSON`/`ResetWorkshopConfigs` **零测试覆盖**。

**修复建议**（最小变更，+3 行 + 2 测试）：

```go
	data, err := os.ReadFile(path)
	if err != nil {
		// 全新用户无用户配置（数据走 bundled 兜底）：无数据可备份 ≠ 错误，
		// 否则 Merge/Replace/Reset 首次使用全部中止（R22 审核 P2-1）。
		// 与 web 桥（web-community.ts 无备份步骤直接合并）行为对齐。
		if os.IsNotExist(err) {
			return "", nil
		}
		return "", err
	}
```

**配套测试**：`TestBackupWorkshopCreators_NoFile`（用户目录无文件 → ("", nil) 不报错）+ `TestMergeWorkshopCreatorsFromJSON_FreshUser`（全新用户拖拽导入成功、added>0）。

**验收**：`go test -race ./internal/app/` ✅

---

### 🟡 P3-1 `SaveWorkshopCreatorsBySite` Type 段匹配**真子串误判**（3.4③ 边界对称反例）

**位置**：`app_workshop.go:181` + `web-community.ts:276`（**双轨同病**）

**观察**：

```go
if c.Type == siteID || strings.Contains(c.Type, siteID+";") || strings.HasSuffix(c.Type, ";"+siteID) {
```

`strings.Contains(c.Type, siteID+";")` 是裸子串匹配：siteID=`"a"` 时，`c.Type="ba;c"`（另一站点"ba"的条目）含 `"a;"` → **误判为该站点条目而被删除**。多站点创作者（Type 分号分隔 `"site1;site2"`）会误删/误归。web 桥 `t.includes(siteID + ";")` 复刻同一缺陷（注释自称「对齐 Go」）。

**修复**：精确段比较（Go + web 两侧同改）：

```go
// inTypeSegments 判断 siteID 是否为 c.Type 的分号分隔精确段（3.4③ 词边界，
// 裸 Contains 会把 "ba;c" 误配 siteID="a"——R22 审核 P3-1）
func inTypeSegments(typeStr, siteID string) bool {
	for _, seg := range strings.Split(typeStr, ";") {
		if seg == siteID {
			return true
		}
	}
	return false
}
```

**为什么没被发现**：`SaveWorkshopCreatorsBySite` 无单测；web 桥契约测试只测覆盖层优先级，未测 Type 段匹配。

---

### 🟡 P3-2 `println` ×3 不走环形日志（R19 同类教训未同步）

**位置**：`app_workshop.go:45, 59, 231`

**观察**：诊断输出走 `println` 直写 stdout，不经 `log.SetOutput` 重定向（app.go ServiceStartup 只重定向 log 包）→ **环形日志面板看不到**。R19 watcher 已修同类问题（「ServiceShutdown println 改 log.Printf 接入环形日志」），此处未同步。全 `internal/app` 共 **9 处**残留（app.go:178、app_config.go:89/95/109/117、app_workshop.go:45/59/231）——本文件 3 处必修，其余记录。

**修复**：3 处 `println` → `log.Printf`（错误分类语义不变）。

---

### 🟡 P3-3 `ImportWorkshopSitesCSV` 无备份直接覆盖 + 弱校验

**位置**：`app_workshop.go:278-302`

**观察**：与 Merge/Replace 的备份保护**不对称**——`len(row) < 6 → continue` 静默跳过，**全非法行 → sites 为空 → `SaveWorkshopSites([])` 覆盖清空用户站点配置**；只有 `len(rows) >= 2` 校验（表头 + 任意 1 行即过），无「至少 1 条有效行」校验、无备份。

**修复**：有效行计数，0 有效行报错；可选与 Merge 同构加备份。

**为什么没被发现**：`TestImportWorkshopSitesCSV_Validation` 只测空/表头/全有效行，未测「全非法行」分支。

---

### 🟢 P4（记录，不修）

| # | 位置 | 问题 |
|---|------|------|
| P4-1 | `app_workshop.go:200` | `SaveWorkshopPresetsBySite` siteID 不存在时静默 `return nil`——前端以为保存成功实际无操作 |
| P4-2 | `app_workshop.go:331, 362, 373` | Merge/Replace 的 20/100 条下限魔法数，无常量化无注释 |
| P4-3 | `app_workshop.go:246` | `ExportWorkshopSitesCSV` 的 `w.Write` 错误未检查（Flush 兜底，内存写不失败） |

---

## 反模式 / 致命陷阱 排查清单

| 编号 | 检查项 | 结果 |
|------|--------|------|
| 反模式-1 | 隐式状态写入 | ✅ 无模块级状态，全走文件读写 |
| 反模式-2 | 职责过载 | ✅ 薄壳 380 行 < 500 红线（ADR-040），24 方法职责单一 |
| 反模式-3 | 魔法数值 | ⚠️ P4-2（20/100 下限） |
| 反模式-4 | 显著重复 | ⚠️ `migrateWorkshopConfig` 与 `app_config.migrateLegacyConfig` 同构双实现（注释明示「对齐」，可接受但属重复——**全仓同理可收敛**） |
| 反模式-12 | 文本匹配错误分类 | ⚠️ P3-1（`Contains` 裸子串，且是数据匹配非错误分类） |
| 反模式-13/14/15/17 | Once / goroutine / defer 循环 / Reader Close | ✅ 全部无/安全（os.ReadFile 自动关闭） |
| 陷阱 #5 | Go Binding 函数名 | ✅ 七个 binding 签名与前端 getApp() 调用逐一核对一致 |
| 陷阱 #11 | 错误分类 | ✅ Backup 错误 `%w` 包装 + errors.Is 可判（但 P2-1 说明 IsNotExist 需特判） |
| 陷阱 #17 | 零值哨兵 | ✅ `LoadWorkshopCreators` nil 由前端 `\|\| []` 兜底（契约测试记录） |
| 红线 3.4③ | 边界对称 / 词边界 | ⚠️ P3-1（分号段匹配裸 Contains） |
| 红线 3.4③ | 字符串比较 | ⚠️ P3-2（println 不走环形日志，R19 同类） |

**路径守卫**：本文件无 dir 入参型 binding（全部落点收敛 configDir），第八轮 P0×3 路径守卫不适用——守卫面窄是结构使然，✅。

---

## ADR 关联

| ADR | 关联点 | 状态 |
|-----|--------|------|
| ADR-046 平台配置根 | ✅ workshopConfigPath fail-fast，不降级 CWD/exe 旁 | 已采纳 |
| ADR-049 web 桥接 | ⚠️ Merge 双轨漂移（P2-1：桌面失败 / web 成功） | 部分采纳 → 本 P2 修复 |
| cd18c52a BOM 单点 | ✅ StripBOM 统一 | 已修复 |
| 第八轮审核 | ✅ P0×3 路径守卫对本文件不适用（无 dir binding）；P2×15 双轨漂移教训**在本文件再现**（P2-1） | 复盘 |

无新 ADR 建议。

---

## 修复清单

- **R22-FIX-1（P2 必修）**：`BackupWorkshopCreators` IsNotExist → `("", nil)`（+3 行）+ `TestBackupWorkshopCreators_NoFile` + `TestMergeWorkshopCreatorsFromJSON_FreshUser`
- **R22-FIX-2（P3）**：`SaveWorkshopCreatorsBySite` Type 段精确匹配（Go `app_workshop.go:181` + web `web-community.ts:276` 同改）+ 单测
- **R22-FIX-3（P3）**：`println` → `log.Printf` ×3（app_workshop.go:45/59/231；app_config.go 5 处记录不修）
- **R22-FIX-4（P3）**：`ImportWorkshopSitesCSV` 有效行计数校验（0 有效行报错，不覆盖写空）

验收：`go test -race ./internal/app/` ✅ + `go build ./go/...` ✅

**修复状态**：四项全部落地——FIX-1 已于前提交 `e7940862` 完成（`IsNotExist` → `("", nil)` + `TestBackupWorkshopCreators_NoFile` + `TestMergeWorkshopCreatorsFromJSON_FreshUser`）；FIX-2 Type 段精确匹配 Go 侧 `inTypeSegments` + web 桥 `t.split(";").includes(siteID)` 同改 + `TestSaveWorkshopCreatorsBySite_TypeSegmentMatch`；FIX-3 三处 `println` → `log.Printf`（接入环形日志，与 R19 watcher 同类教训同步）；FIX-4 CSV 有效行校验（0 有效行报错不覆盖）+ `TestImportWorkshopSitesCSV_AllInvalidRows`。门禁：`go build ./go/...` + `go test -race ./internal/app/` + `go vet` + `vite build` + `tsc --noEmit` 全绿。

---

## 审核元数据

- 审核耗时：单轮串行审，约 25 分钟（380 源码 + 230 测试 + 前端 4 文件对照）
- 阅读文件：
  - `internal/app/app_workshop.go`（380 行，全文）
  - `internal/app/app_workshop_test.go`（230 行，全文）
  - `frontend/src/views/app-content/site/drag.ts:50-99`（Merge 拖拽入口）
  - `frontend/src/views/app-content/community-data.ts:80-139`（loadCommunityData）
  - `frontend/src/views/app-content/init-github.ts:45-74`（LoadGitHubRepos）
  - `frontend/src/backend/web-community.ts:250-309`（web 桥 workshop 段，双轨对照）
  - `frontend/src/backend/browser-adapter.contract-b2.test.ts`（契约测试参照）
  - `docs/audit/audit-framework.md`（清单）
- 工具：`git log -50`、`glob`、`grep`、`go build`、`go test -race`、`go vet`
- 未触达：web 桥 `web-community.ts` 仅核对 workshop 段（未逐行审全文）；web 契约测试未跑 vitest（桌面模式为主）；`app_config.go` 的 migrateLegacyConfig 全文未读（仅确认存在与同构）

---

## 与 R21 审核的对照

| 维度 | R21 (go/dedup) | R22 (app_workshop) |
|---|---|---|
| 源码体量 | 427 行 | 380 行 |
| 测试体量 | 1361 行（1:3.19） | 230 行（1:0.6） |
| 测试分布 | 黄金对照锁死契约核心 | 全在基础设施，**8 个业务编排函数零覆盖** |
| **真实 P2** | 零 P2 | **Backup IsNotExist → 全新用户三功能不可用**（双轨漂移） |
| 真实 P3 | 子树软跳过 / 双实现 / 入口重复 | Type 段子串误判 / println ×3 / CSV 无备份 |
| 核心契约保障 | 串行↔并行黄金对照 | web 桥契约测试只锁了读路径，**写路径业务编排裸奔** |

**对照结论**：R21 零 P2 与 R22 一项 P2 的差异，再一次落在**测试是否覆盖了契约锚点**——dedup 的黄金对照覆盖「同一输入两种实现逐字节一致」；workshop 的写路径（备份→合并→落盘）是典型的「状态变更契约」，没有等价锚点测试。230 行测试密度 1:0.6 本身偏低，且密度分布错位（基础设施 100%、业务编排 0%）——**密度与分布双缺**，是 R19-R21 三个 Go 模块里最薄的一层。

---

**下次审核建议**：`internal/app/app_install*.go`（导入/安装管线，绑定多、状态变更密）；或 `go/recycle`（去重删除执行侧）；或 app_config.go 的 println ×5 收口（与 P3-2 同源，一次清完）。
