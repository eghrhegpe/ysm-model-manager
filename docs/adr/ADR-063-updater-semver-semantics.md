# ADR-063：updater 版本比较语义化：semver 库接入替代手写比较

- **状态**：✅ 已采纳
- **日期**：2026-08-15
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`docs/archive/extensibility-index.md 6.9b`、`go/updater/updater.go:503-531`（`isNewer`/`splitVer`）、`go/updater/updater_test.go`

---

## 1. 背景（Context）

### 1.1 手写 semver 比较，预发布语义缺位

`go/updater/updater.go` 的版本比较为手写实现：

- `isNewer(tag, current)`（L503-512）：按点分数字段逐段比较。
- `splitVer(v)`（L514-531）：显式剥离 `-`/`+` 后缀——**预发布（`-beta.1`）与构建元数据（`+build.1`）被直接丢弃**，不参与比较。

可拓展点发掘（extensibility-index 6.9b）定位为**行为变更**：「接入 semver 库/预发布语义属行为变更（会改变升级判定）另议」——即当前手写实现把 `v1.0.0-beta.1` 与 `v1.0.0` 视为相等，接入标准语义后 `v1.0.0` 将判定为新于 `v1.0.0-beta.1`，升级判定结果会改变。

### 1.2 风险与约束

- **升级判定改变**：一旦发布过预发布 tag，接入 semver 库后部分用户的「检测到新版本」结果会变化——属用户可见行为变更，不能静默落地。
- 索引自评「另议」：需要独立立项评估，而非常规轮次顺手改。

## 2. 决策（Decision）

**updater 版本比较接入标准 semver 语义库，替代手写 `isNewer`/`splitVer`**，但**保留旧行为为默认开关**：

1. **库选型**：`github.com/Masterminds/semver/v3`（宽松约束集，支持预发布/构建元数据比较），或 `golang.org/x/mod/semver`（零依赖、严格 SemVer 2.0，但无约束解析）。倾向 `x/mod/semver`——本项目版本 tag 均为严格 `vX.Y.Z`，无需约束语法，零依赖更符合项目零依赖工具链偏好。
2. **语义对齐**：`isNewer` 内部改调库比较，**预发布语义默认关闭**（`semver` 比较时忽略 `-` 后缀，维持现状判定）；仅当发版流程引入预发布 tag 后开启。
3. **测试钉住**：补充 `v1.0.0` vs `v1.0.0-beta.1`、`v1.10.0` vs `v1.9.9`、`v1.0.0+build` 等边界用例，钉住升级判定结果，防手写实现漂移。
4. **行为变更门控**：接入库后 diff 若改变既有升级判定（如预发布比较），需同步更新 `docs/releases/` 发版流程说明，并经人工确认。

## 3. 后果（Consequences）

**正面**：
- 消除手写比较的边界缺陷（`1.10.0` vs `1.9.9` 逐段比较易错；预发布语义无法表达）。
- 与 Go 生态标准语义对齐，未来版本策略（pre-release/rc）可安全落地。

**负面**：
- 新增第三方依赖（若选 Masterminds）或零依赖（若选 x/mod）。
- 升级判定行为可能改变（预发布场景），需门控确认。

**已知遗留**：
- 与 ADR-062（AppConfig 可配置化）无交集；本 ADR 独立。
- `splitVer` 的构建元数据剥离行为在接入库后由库语义替代。

## 4. 数据溯源

来源：`docs/archive/extensibility-index.md` 6.9b（updater 手写 semver，索引自评「接入库/预发布语义属行为变更另议」）→ 结果：ADR-063 立项，编码按 §2 分阶段（库接入 → 语义对齐 → 测试钉住 → 行为门控确认）。

<!-- 文件名: updater-semver-semantics.md → 实际文件 ADR-063-updater-semver-semantics.md -->
