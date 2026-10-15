---
kind: go-pinyin
name: 拼音搜索匹配 go/pinyin
tier: leaf
category: go
status: active
source_files:
  - go/pinyin/
  - go/cli/pinyin_table.go
  - tests/fixtures/search-golden.json
auto_fields:
  symbols_with_lines:
    - CharPinyin
    - FullPinyin
    - Initials
    - MatchKeyword
    - PinyinOf
    - Table
use_when:
  - 拼音搜索
  - 首字母搜索
  - 关键词匹配口径
  - pinyin-table 生成
  - 中文模型名搜索
perf:
  - single-thread
invariant_anchors:
  - go/pinyin/pinyin.go|MatchKeyword
quick_groups:
  - 模型扫描与仓库管理
quick_intents:
  - 搜索关键词匹配、拼音/首字母、SearchModels 关键词面
quick_risk_lines:
  - 拼音表生成物 pinyin-table.ts 与 Go 判据必须同源（CLI pinyin-table 重生成 + 金样例对账），跨语言手抄即漂移
  - 升级 go-pinyin 依赖 = 拼音判据变更，须重跑 pinyin-table 并补金样例
pitfalls:
  - PinyinDict 直读带声调符（xiǎo）——Table 必须经 PinyinOf（NewArgs Normal 风格，无声调）派生，否则 TS 面全拼匹配恒失
  - 混合关键词（CJK+拉丁，如「狐li」）拼音面语义未定义——只走 CJK 直接面，宁漏勿误（isLatins 门槛）
  - 绝对路径匹配面已废止（ADR-343-d1 ①）：relPath 入参必须是仓库根相对路径，根前缀不得参与匹配
  - TS 表裁切 CJK 基本区（U+4E00..U+9FFF）——Go 面（全 PinyinDict）对扩展区生僻字是超集，只会多命中不会少，金样例只锁基本区
---

# 拼音搜索匹配 go/pinyin

## 概览

`go/pinyin/` 是搜索关键词匹配的**单点判据包**（ADR-343-d1 C1 搜索语义收敛）：`MatchKeyword(name, relPath, keyword)` 统一「名/相对路径子串面 + 纯拉丁关键词全拼/首字母拼音面」三路语义。依赖 `github.com/mozillazg/go-pinyin`（默认读音集，多音字取默认音）——仓内唯一拼音数据源。

## 核心职责

- `MatchKeyword` — 搜索关键词命中判据（`go/pinyin/pinyin.go|MatchKeyword`）：空关键词命中全部；`kw = ToLower(TrimSpace)`；name / relPath 小写子串命中（CJK 直接面）；关键词**全为 ASCII 字母数字**（`isLatins`）时再试 name 的 `FullPinyin` / `Initials` 子串（拼音面）。混合词（CJK+拉丁）拼音面语义未定义，只走直接面
- `PinyinOf` / `FullPinyin` / `Initials` — 单字默认读音（无声调小写）与全拼/首字母展开（非汉字原样保留；zh/ch/sh 首字母取整）
- `Table()` — CJK 基本区（U+4E00..U+9FFF）码点→全拼映射（经 `PinyinOf` 派生，无声调）；CLI `pinyin-table` 命令的输入
- **跨语言单源派生**：Go 侧匹配直接走库；TS 侧读生成表 `frontend/src/utils/search/pinyin-table.ts`（CLI `pinyin-table` 命令由 `Table()` 写出，头部注释带生成器命令 + 依赖版本；升级依赖须重跑并随提交入 git）。两侧判据同语义、同表数据，漂移由金样例拦

## 对外 API / 入口

- `MatchKeyword(name, relPath, keyword string) bool` — 消费方：`internal/app/app_scan.go|SearchModels` 关键词预过滤（Phase 1，relPath = TrimPrefix filesRoot）；CLI `search` 命令经 SearchModels 继承
- `Table() []CharPinyin` — 消费方：`go/cli/pinyin_table.go|runPinyinTable`（`go run . --cli … pinyin-table`，缺省输出仓库根 `frontend/src/utils/search/pinyin-table.ts`，输出到仓库外须 `--output`）
- TS 对偶实现：`frontend/src/utils/search/match.ts|keywordMatches`（树内联搜索 `render.ts|visibleFileRow` + web 面 `web-fs-scan.ts|searchWebModels` 消费；纯函数，Worker/主线程同模块）

## 与其他子系统关系

- `internal/app/app_scan.go` — SearchModels 关键词面（数值面不变，几何分析分流见 search / go-geometry-* 卡）
- `frontend/src/utils/search/` — match.ts（同判据 TS 实现）+ pinyin-table.ts（生成物）；金样例 `tests/fixtures/search-golden.json` 双读对账（Go `TestMatchKeyword_Golden` + TS `match.test.ts`，「跨语言靠测试对账而非共享代码」范式，genindex 双工先例）
- 卡片：`search.md`（编排层）、`go-cli-search.md`（CLI 面）、`app-tree.md`（树内联面）、`web-fs-mutate-scan.md`（web 面）

## 不变量

- 拼音面只对**纯拉丁关键词**生效（`isLatins` 门槛）——混合词与 CJK 关键词不走拼音展开（语义未定义，宁漏勿误）；大小写三路（name/relPath/kw）全折叠
- 匹配面 = **name + 仓库根相对路径**——绝对路径匹配面已废止（原 `strings.Contains(entry.Path, kw)` 的「作者文件夹墙」误中面）；relPath 兜底 = 根下文件取 Name
- `Table()` 只出**基本区且经 PinyinOf**（无声调）——直读 `gopinyin.PinyinDict` 会得到带声调符的 `xiǎo`（全拼匹配恒失，已实证踩过）
- 生成物 `pinyin-table.ts` 与判据变更必须**同提交**：升级 go-pinyin 依赖 / 改 `MatchKeyword` 语义 → 重跑 CLI + 补金样例 + 双跑 Go/TS golden 测试
- 表体积（~329KB / 20901 条目）为有意裁切（基本区）——桌面应用一次性加载成本，web 开发模式同量级，已裁定接受（ADR-343-d1 后果段）；再裁剪须改 `Table()` 码点范围并同步 ADR

## 相关

- `go/cli/pinyin_table.go` — CLI 生成命令
- `tests/fixtures/search-golden.json` — 金样例（双面共读）
- `frontend/src/utils/search/match.ts` — TS 同判据实现
