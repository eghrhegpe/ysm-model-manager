# ADR-337：创作者 type 字段拆分：站点归属与本地资源类型分字段，消除幻影平台徽章与本地作者隐形

- **状态**：✅ 已采纳（Accepted）
- **日期**：2026-10-13
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **准入理由**：数据模型语义纠正（方向性）；跨 Go types/binding/web/前端四层的字段契约变更（难逆转）；触及 scanner + 创作者频道展示 + 契约测试（跨域影响面）
- **相关**：`go/scanner/scanner_authors.go`（`ScanLocalAuthors` / `mergeOrAppendCreator`）、`internal/app/app_scan.go`（binding）、`frontend/src/features/community/community-data.ts`、`frontend/src/backend/web-community.ts`（web 同构）、`frontend/src/views/app-content/site/`（展示与过滤）、`docs/knowledge/wails-bindings.md`、`docs/knowledge/go-scanner.md`

---

## 1. 背景（Context）

<!-- ⚠️ 本节是「决策当时」的状态快照，ADR 落地后此处的病灶可能已治愈；评估「现在是否还这样」以当前源码树 + 知识卡实施进度为准，勿把本节当现状。 -->
`types.WorkshopCreator.Type` 在两种数据来源下承载了**两套互不相交的词汇表**：

| 来源 | `Type` 的实测取值 |
|---|---|
| 社区索引 `creators.json` | 站点 id：`mzhouse, bilibili, afdian, nicovideo, booth, github, deviantart, vroid, bowlroll` |
| `go/scanner/scanner_authors.go|ScanLocalAuthors` | 资源类型 rtype：`resourcepack, shaderpack, ysm, maid-model, blueprint, litematic, EntityPlayer, SceneModel, CustomAnim, CustomMorph, StageAnim, mmd-shader, DefaultAnim, DefaultMorph, fbx` |

两个集合**零交集**，而全部下游都只按「站点 id」解读：`site/workshop-data.ts|parseSiteIds`、
`internal/app/app_workshop.go|inTypeSegments`、`utils/icon/workshop-icons.ts|getSiteIcon`。

**后果 ①：幻影平台徽章。** `features/community/community-data.ts|mergeExistingLocalAuthor` 把
`la.type`（rtype）拼进 `found.type`（站点段）——`"bilibili"` 变 `"bilibili;ysm"`；而
`site/render.ts|creatorPlatformBadgesHtml` 对**每一段**都渲染徽章，`getSiteIcon("ysm")` 不在映射表
→ 回退 `ICONS.CREATOR`。卡片上于是多出一个 **👤「ysm」** 徽章。这不是边缘情况：本地模型文件名普遍是
`[作者]模型.ysm`，而「把本地下载关联到创作者」正是 `mergeLocalAuthorsInto` 存在的理由——用户越是从
创作者那里下载模型，越多卡片长出这个垃圾徽章。

**后果 ②：本地独有作者彻底隐形。** `appendLocalAuthor` 以 `type=rtype` 追加条目，而
`site/site-view.ts|renderSiteView` 按 `parseSiteIds(cr.type).includes(site.id)` 过滤——rtype 匹配不到
任何站点 tab。全仓没有「未过滤的 allCreators 渲染方」，故这些条目进了内存却永不渲染，是纯死重。

**后果 ③（潜伏）：rtype 段有机会落盘。** `creators.json` 的写入路径是
`internal/app/app_workshop.go|SaveWorkshopCreatorsBySite`。当前被「保存时 chip 组归一化」**偶然**挡住
（`site/edit.ts|eeSyncAllEditInputs` 会按 active chip 重建 `type`，顺带丢掉 rtype 段），但该归一化未经
文档化、无回归锁——任何绕过 chip 组的保存路径都会把 rtype 写进社区索引文件。

**文档还背书了这个误用**：`docs/knowledge/wails-bindings.md` 写「`ScanLocalAuthors` … 可直接合并进
creators.json」——正是当前缺陷的做法。

**关键事实（决定改法可以很小）**：📁 本地徽章与本地模型数**都不依赖 `type`**——前者由
`community-data.ts|mergeExistingLocalAuthor` 置的 `_fromLocal` 标记驱动，后者由 `site/site-view.ts|authorCountMap`
（来自 `internal/app/app_scan.go|ListModelAuthors`）驱动。故纠正 `type` 的误用**不损失任何现有可见功能**。

## 2. 决策（Decision）

把「站点归属」与「本地资源类型」拆成两个字段，`Type` 自此只有一种含义（站点 id 分号段）。

**Go 侧**：新增 `types.LocalAuthor{ Name string; Desc string; RTypes []string }`；
`scanner.ScanLocalAuthors` 签名从 `[]types.WorkshopCreator` 改为 `[]types.LocalAuthor`
（`mergeOrAppendCreator` 相应改写：rtype 进 `RTypes` 而非 `Type`）。binding
`internal/app/app_scan.go|ScanLocalAuthors` 同步改返回类型。

**前端侧**：本地作者合并只做两件事——

1. 名字命中已有创作者 → 置 `_fromLocal = true`（📁 徽章依据）；**不再**把 rtype 并入 `type`；
2. 名字未命中 → **不再追加条目**（本地独有作者在任何站点 tab 都不可见，追加纯属死重）。

即 `community-data.ts|mergeExistingLocalAuthor` 删掉 type 合并分支、`appendLocalAuthor` 整体删除。

**网页版同构**：`frontend/src/backend/web-community.ts|scanWebLocalAuthors` 返回同形状。

**`RTypes` 必须有真实消费者**（免落成死字段）：`go/cli/creator.go|runCreatorScan` 目前只打作者名，
改为 `名称 (ysm,litematic)`——该函数本来就算出了类型却丢掉，顺手补上。

### 回归锁（实施时须同时落地）

1. 前端：`mergeLocalAuthorsInto` 之后，名字命中的创作者 `type` **不含**任何 rtype 段；
2. 前端：本地独有作者**不出现在**结果列表里（列表长度不变）；
3. Go：`ScanLocalAuthors` 返回 `LocalAuthor`；跨 rtype 同作者的 `RTypes` 正确合并去重；
4. 契约：web 侧 `ScanLocalAuthors` 与 Go 同形状（`browser-adapter.contract-b3.test.ts`）；
5. 写入侧加固：落盘后断言 `creators.json` 的 `type` 段全部 ∈ 站点 id 集合。

## 3. 后果（Consequences）

正面：

- **幻影徽章消失**：`getSiteIcon` 不再收到 rtype，卡片徽章只反映真实平台归属。
- **`type` 恢复单一语义**：与 `inTypeSegments` / `parseSiteIds` / `getSiteIcon` 的既有契约一致，消灭一处「同名字段两套词表」的认知陷阱。
- **`ScanLocalAuthors` 的类型不再撒谎**：返回专用 `LocalAuthor` 而非复用 `WorkshopCreator`——后者正是「把它当创作者合并」的诱因。
- **去掉一条无声的内存膨胀路径**：本地独有作者不再以「进了列表但永不渲染」的形式滞留。
- **关闭潜伏的落盘污染**：`type` 段只可能来自站点来源，不再依赖「保存时 chip 组恰好归一化」这个未文档化的巧合。

负面 / 已知遗留：

- **binding 签名变更**：须 `cd frontend && npm run generate:bindings`；web 侧 `scanWebLocalAuthors` 必须同批改，否则桌面/网页版形状分叉。
- **测试改写清单**：`go/scanner/scanner_test.go|TestScanLocalAuthors`、`scanner_hotspots_extra_test.go|TestScanLocalAuthors_Branches`、`frontend/src/backend/browser-adapter.contract-b3.test.ts`、`browser-adapter.test.ts`（两例直接断言 `type` 语义）、`community-data.integration.test.ts`。
- **文档同步**：`docs/knowledge/wails-bindings.md` 那条「可直接合并进 creators.json」**必须删除或改写**（它是缺陷的书面背书）；`go-scanner.md`、`architecture.md` 的签名描述同步。
- **落盘数据是否需要清洗：实施前必须实测**。推理上无需迁移——`creators.json` 的 `type` 本来就是站点 id，本地作者从未成功落盘（隐形 + 被站点过滤挡在 `siteCreators` 之外）；但若实测发现生产数据已含 rtype 段，须一次性清洗并另开条目。
- **不动任何 UI 交互、不新增浏览维度**：本 ADR 只纠正类型语义。
- **回滚**：Go types + binding + web + 前端四处同批改，回滚 = revert 该批提交（签名变更是编译期可查的）。

## 4. 数据溯源

`scanner.ScanLocalAuthors(roots: rtype→dir)` → `ScanEntriesLite` → 文件名 `[作者]` 提取 →
`LocalAuthor{Name, Desc, RTypes}` → 前端只取 `Name` 做 `_fromLocal` 标记；
本地模型计数另走 `ListModelAuthors` → `authorCountMap`（**与 `type` 无关**）。

站点归属侧不变：`creators.json` → `LoadWorkshopCreators` → `type`（站点 id 分号段）→ `parseSiteIds` 过滤与展示。

## 5. 实施边界（不在本 ADR 范围）

- **不给本地独有作者开「本地」伪站点 tab**：那是新增浏览维度，属独立产品决策。
- **不动 `creators.json` 的 `type` 语义**：它一直是对的，本次只纠正另一侧的误用。
- **不处理同名身份问题**（`name` 同时充当合并键 / 收藏键 / ADR-335 的解除名单键）：独立议题。

<!-- 文件名: creator-type-site-vs-rtype.md → 实际文件 architecture/ADR-337-creator-type-site-vs-rtype.md（ADR-320 architecture 全量模板） -->
