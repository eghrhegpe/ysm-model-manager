# CLI 命令参考

> **自动生成**：由 `node scripts/gen-cli-doc.mjs` 从 `go/cli/` 命令注册表（`RegisterCommandC` + `print*Usage`）
> 静态提取生成，**单一事实来源 = 源码注册**。新增命令/子命令/选项只改 `go/cli/` 源码，
> 重跑本脚本即同步；`--check` 已接入 `doctor.mjs` 防漂移。
>
> 顶层命令共 **39** 个。入口姿势与常用场景见根 `AGENTS.md`「CLI 模式使用说明」。

<!-- GEN: cli-commands -->
## 模型管理

### `analyze`
分析单个模型的详细信息

```bash
app --cli --files-root <路径> analyze [选项...]
```


| 选项 | 类型 | 说明 |
|------|------|------|
| `--model` | string — 模型文件或目录路径 |


### `benchmark`
性能基准测试

```bash
app --cli --files-root <路径> benchmark [选项...]
```


| 选项 | 类型 | 说明 |
|------|------|------|
| `--iterations` | int — 迭代次数 |


### `copy`
复制模型文件（源与目标须在同一仓库根内）

```bash
app --cli --files-root <路径> copy [选项...]
```


| 选项 | 类型 | 说明 |
|------|------|------|
| `--src` | string — 源文件路径（必填） |
| `--dst` | string — 目标目录路径（必填） |


### `export`
导出模型结构信息

```bash
app --cli --files-root <路径> export [选项...]
```


| 选项 | 类型 | 说明 |
|------|------|------|
| `--model` | string — 模型文件路径 |
| `--output` | string — 输出文件路径 |


### `install`
安装模型到 Minecraft（全局/整合包自定义目录）

```bash
app --cli --files-root <路径> install [选项...]
```


| 选项 | 类型 | 说明 |
|------|------|------|
| `--model` | string — 模型文件路径（必填） |
| `--mc-root` | string — Minecraft 根目录（全局安装时必填） |
| `--custom-dir` | string — 整合包自定义目录（安装到整合包时使用） |


### `list`
列出所有模型的摘要信息

```bash
app --cli --files-root <路径> list [选项...]
```


| 选项 | 类型 | 说明 |
|------|------|------|
| `--limit` | int — 显示条目数上限 (0=全部) |
| `--format` | string （默认: table）— 输出格式: json 或 table |


### `move`
移动模型文件（源与目标须在同一仓库根内）

```bash
app --cli --files-root <路径> move [选项...]
```


| 选项 | 类型 | 说明 |
|------|------|------|
| `--src` | string — 源文件路径（必填） |
| `--dst` | string — 目标目录路径（必填） |


### `rename`
重命名模型文件或目录

```bash
app --cli --files-root <路径> rename [选项...]
```


| 选项 | 类型 | 说明 |
|------|------|------|
| `--path` | string — 要重命名的文件或目录路径（必填） |
| `--name` | string — 新名称（必填） |


### `search`
搜索模型（支持关键词过滤）

```bash
app --cli --files-root <路径> search [选项...]
```


| 选项 | 类型 | 说明 |
|------|------|------|
| `--keyword` | string — 搜索关键词 |
| `--min-bones` | int — 最小骨骼数 |
| `--max-bones` | int — 最大骨骼数 |
| `--min-cubes` | int — 最小立方块数 |
| `--max-cubes` | int — 最大立方块数 |
| `--min-tex` | int — 最小贴图尺寸 |
| `--max-tex` | int — 最大贴图尺寸 |
| `--format` | string （默认: json）— 输出格式: json 或 table |


### `tags`
模型标签管理（子命令: list/set/by/count/get）

```bash
app --cli --files-root <路径> tags [选项...]
```

**子命令**（用法：`app --cli --files-root <路径> tags <子命令> [选项...]`）：

| 子命令 | 说明 |
|--------|------|
| `list` | 列出所有标签（按使用次数降序） |
| `set` | 设置模型的标签（覆盖写入） |
| `by` | 按标签查模型 |
| `count` | 统计标签使用次数 |
| `get` | 查看模型的标签 |



### `toggle`
切换模型启用/禁用状态（.ban）

```bash
app --cli --files-root <路径> toggle [选项...]
```


| 选项 | 类型 | 说明 |
|------|------|------|
| `--path` | string — 模型文件路径（必填） |


### `verify`
验证模型文件完整性

```bash
app --cli --files-root <路径> verify [选项...]
```


| 选项 | 类型 | 说明 |
|------|------|------|
| `--repair` | bool — 尝试自动修复问题 |


## 性能诊断

### `concurrent-bench`
并发能力基准测试（串行 vs 并行对比，建议先优化单模型）

```bash
app --cli --files-root <路径> concurrent-bench [选项...]
```


| 选项 | 类型 | 说明 |
|------|------|------|
| `--workers` | int — 并发 worker 数量 |
| `--max-models` | int — 最多测试的模型数量 |


### `file-bench`
测试大文件读取性能（模拟 MMD/PMX/VRM 加载）

```bash
app --cli --files-root <路径> file-bench [选项...]
```


| 选项 | 类型 | 说明 |
|------|------|------|
| `--dir` | string — 测试目录路径（扫描此目录下的大文件） |
| `--file` | string — 单个测试文件路径 |
| `--iterations` | int — 迭代次数 |
| `--output` | string — 输出文件路径（JSON 格式，用于基准对比） |
| `--compare` | string — 对比基准文件路径 |


### `gui-flow`
模拟 GUI 完整加载流程（配置→扫描→加载→渲染预估）

```bash
app --cli --files-root <路径> gui-flow [选项...]
```


| 选项 | 类型 | 说明 |
|------|------|------|
| `--model` | string — 指定模型路径（可选，不填则用第一个） |
| `--verbose` | bool — 详细输出每个阶段的细节 |


### `perf-log`
输出优化记录日志（按时间倒序，含问题/做法/效果/提交）

```bash
app --cli --files-root <路径> perf-log [选项...]
```



### `perf-snapshot`
一站式性能快照（AI 友好 JSON，前置探测瓶颈）

```bash
app --cli --files-root <路径> perf-snapshot [选项...]
```


| 选项 | 类型 | 说明 |
|------|------|------|
| `--model` | string — 指定模型路径（可选，不填则用第一个） |
| `--iterations` | int — 基准测试迭代次数 |


### `single-bench`
单模型加载基准测试（优化基础，单模型快=所有场景快）

```bash
app --cli --files-root <路径> single-bench [选项...]
```


| 选项 | 类型 | 说明 |
|------|------|------|
| `--model` | string — 指定模型路径（必填） |
| `--iterations` | int — 重复测试次数 |
| `--baseline` | string — 对比基准 JSON 文件（[{name,ms}]），任一阶段退化超 --threshold 时返回失败 |
| `--save-baseline` | string — 把本次各阶段平均耗时写入该 JSON 文件（供后续 --baseline 对比） |
| `--threshold` | float — 退化阈值百分比（默认 50），配合 --baseline 使用 |
| `--format` | string （默认: text）— 输出格式: text（人类可读）/ json（AI 友好） |


## 缓存管理

### `cache-clear`
清空纹理缓存

```bash
app --cli --files-root <路径> cache-clear [选项...]
```


| 选项 | 类型 | 说明 |
|------|------|------|
| `--yes` | bool — 跳过确认，直接清空 |


### `cache-diag`
诊断缓存流程（哈希计算、读写功能、目录权限）

```bash
app --cli --files-root <路径> cache-diag [选项...]
```



### `cache-status`
查看纹理缓存状态（路径、大小、文件数）

```bash
app --cli --files-root <路径> cache-status [选项...]
```



### `cache-verify`
检查模型贴图的缓存命中情况

```bash
app --cli --files-root <路径> cache-verify [选项...]
```


| 选项 | 类型 | 说明 |
|------|------|------|
| `--dir` | string — MMD 模型目录路径 |
| `--verbose` | bool — 显示详细的缓存命中信息 |


## 资源仓库

### `analyze-mmd`
分析 MMD 模型资产（贴图、PMX、VMD 等）

```bash
app --cli --files-root <路径> analyze-mmd [选项...]
```


| 选项 | 类型 | 说明 |
|------|------|------|
| `--dir` | string — MMD 模型目录路径 |


### `avatar`
创作者头像管理（子命令: batch/cached/cache）

```bash
app --cli --files-root <路径> avatar [选项...]
```

**子命令**（用法：`app --cli --files-root <路径> avatar <子命令> [选项...]`）：

| 子命令 | 说明 |
|--------|------|
| `batch` | 批量提取所有有本地模型的创作者头像 |
| `cached` | 查看缓存中指定作者的头像（data URI） |
| `cache` | 从模型文件缓存作者头像 |



### `creator`
创作者数据管理（子命令: scan/list/export/backup）

```bash
app --cli --files-root <路径> creator [选项...]
```

**子命令**（用法：`app --cli --files-root <路径> creator <子命令> [选项...]`）：

| 子命令 | 说明 |
|--------|------|
| `scan` | 扫描本地资源目录，从文件名提取作者 |
| `list` | 列出已保存的创作者 |
| `export` | 导出创作者 JSON 文件 |
| `backup` | 备份创作者数据（带时间戳） |



### `dedup`
仓库去重检测与清理（子命令: scan/count/clean）

```bash
app --cli --files-root <路径> dedup [选项...]
```

**子命令**（用法：`app --cli --files-root <路径> dedup <子命令> [选项...]`）：

| 子命令 | 说明 |
|--------|------|
| `scan` | 扫描重复文件（按 SHA256 分组列出） |
| `count` | 快速统计重复组数与多余文件数 |
| `clean` | 把重复文件移入回收站（默认 dry-run，--yes 执行） |



### `download`
下载队列管理（子命令: enqueue/status/cancel/github）

```bash
app --cli --files-root <路径> download [选项...]
```

**子命令**（用法：`app --cli --files-root <路径> download <子命令> [选项...]`）：

| 子命令 | 说明 |
|--------|------|
| `enqueue` | 入队一个下载任务（URL 须 https://） |
| `status` | 查看队列状态 |
| `cancel` | 取消队列中所有任务 |
| `github` | 从 GitHub 下载（raw URL） |



### `health-report`
一键全仓体检报告（完整性+缓存+资源+去重，--bench 追加性能基线）

```bash
app --cli --files-root <路径> health-report [选项...]
```


| 选项 | 类型 | 说明 |
|------|------|------|
| `--dir` | string — 仓库目录（默认使用 --files-root） |
| `--output` | string — 输出文件路径（JSON 格式） |
| `--bench` | bool — 追加首个模型的 single-bench 性能基线（默认关闭，耗时高） |


### `hub`
浏览 YSM Hub 公共 API（models/search/model）

```bash
app --cli --files-root <路径> hub [选项...]
```

**子命令**（用法：`app --cli --files-root <路径> hub <子命令> [选项...]`）：

| 子命令 | 说明 |
|--------|------|
| `models` | 列出公开模型 |
| `search` | 搜索公开模型 |
| `model` | 查看模型详情 |



### `instance`
整合包实例管理（子命令: list/sync/push/pull）

```bash
app --cli --files-root <路径> instance [选项...]
```

**子命令**（用法：`app --cli --files-root <路径> instance <子命令> [选项...]`）：

| 子命令 | 说明 |
|--------|------|
| `list` | 列出所有整合包实例 |
| `sync` | 查看资源同步状态（JSON） |
| `push` | 推送缺失资源到整合包 |
| `pull` | 拉取多余资源回仓库 |



### `recycle`
回收站管理（子命令: list/restore/empty）

```bash
app --cli --files-root <路径> recycle [选项...]
```

**子命令**（用法：`app --cli --files-root <路径> recycle <子命令> [选项...]`）：

| 子命令 | 说明 |
|--------|------|
| `list` | 列出回收站所有条目 |
| `restore` | 从回收站恢复文件到仓库 |
| `empty` | 清空所有回收站 |



### `repo-audit`
仓库健康审计（完整性 + 缓存 + 资产）

```bash
app --cli --files-root <路径> repo-audit [选项...]
```


| 选项 | 类型 | 说明 |
|------|------|------|
| `--dir` | string — 目录路径（默认使用 --files-root） |
| `--output` | string — 输出文件路径（JSON 格式） |


### `resource-scan`
扫描模型仓库资源，统计资产分布

```bash
app --cli --files-root <路径> resource-scan [选项...]
```


| 选项 | 类型 | 说明 |
|------|------|------|
| `--dir` | string — 目录路径（默认使用 --files-root） |
| `--output` | string — 输出文件路径（JSON 格式） |


### `scan`
扫描入口聚合（子命令: models/authors/resources）

```bash
app --cli --files-root <路径> scan [选项...]
```

**子命令**（用法：`app --cli --files-root <路径> scan <子命令> [选项...]`）：

| 子命令 | 说明 |
|--------|------|
| `models` | 扫描目录下的模型条目 |
| `authors` | 统计 [作者] 前缀（走扫描缓存） |
| `resources` | 扫描模型仓库资源，统计资产分布 |



### `scan-dir`
扫描 MMD 目录结构并统计资产

```bash
app --cli --files-root <路径> scan-dir [选项...]
```


| 选项 | 类型 | 说明 |
|------|------|------|
| `--dir` | string — 目录路径 |
| `--detail` | bool — 显示详细文件列表 |
| `--output` | string — 输出文件路径（JSON 格式） |


### `workshop`
工坊站点管理（子命令: sites/validate）

```bash
app --cli --files-root <路径> workshop [选项...]
```

**子命令**（用法：`app --cli --files-root <路径> workshop <子命令> [选项...]`）：

| 子命令 | 说明 |
|--------|------|
| `sites` | 列出所有工坊站点 |
| `validate` | 校验站点配置文件 |



## 配置

### `config`
配置管理（子命令: show/path/mc-paths/mirror/link-mode）

```bash
app --cli --files-root <路径> config [选项...]
```

**子命令**（用法：`app --cli --files-root <路径> config <子命令> [选项...]`）：

| 子命令 | 说明 |
|--------|------|
| `show` | 查看当前配置（同 config-show） |
| `path` | 查看配置文件路径 |
| `mc-paths` | 检测 Minecraft 安装路径 |
| `mirror` | 设置下载镜像 |
| `link-mode` | 查看或设置链接模式 |



### `config-show`
查看当前配置

```bash
app --cli --files-root <路径> config-show [选项...]
```



### `link-mode`
查看或设置链接模式（symlink/hardlink/copy）

```bash
app --cli --files-root <路径> link-mode [选项...]
```


| 选项 | 类型 | 说明 |
|------|------|------|
| `--mode` | string — 链接模式: symlink|hardlink|copy（不填则查看当前模式） |


<!-- /GEN: cli-commands -->
