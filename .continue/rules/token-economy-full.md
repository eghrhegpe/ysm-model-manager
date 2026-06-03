---
alwaysApply: true
---

# Token 经济规则 - 完整版

## 修改前备份规则
每次修改文件前，先执行备份命令：
cp {filepath} {filepath}.bak

备份后：
- 用相对路径执行 single_find_and_replace 或 edit_existing_file 修改
- 如果构建报错，用 diff -u {filepath}.bak {filepath} 只看差异（~50 tokens，远比 read_file 经济）（相对路径）
- 如果改坏了，用 mv {filepath}.bak {filepath} 回退（0 tokens）
- 如果改成功了，删除备份文件 rm {filepath}.bak

例外情况：
- 新建文件不需要备份
- 只读操作（read_file、grep_search）不需要备份
- 多文件修改时，在每个文件修改前分别备份

## Token 经济规则 - 方法优先级

按以下优先级选择最经济的方法：

### 第 1 梯队（最经济，优先使用）
1. **single_find_and_replace** — 精确字符串替换，~300-500 tokens/次，但别把整个文件内容加载到我的上下文中，这会导致缓存命中率奇低。
   - 直接替换已知内容，不读文件，
   - 失败时最多 read_file 一次。
2. **grep_search**（具体关键词）— ~100 tokens/次
   - 搜索关键片段代替读全文件

### 第 2 梯队（必要时使用）
3. **edit_existing_file** — ~1000-2000 tokens/次
   - 只写改动部分，不贴完整文件
4. **read_file 指定行范围** — ~500-1000 tokens/次
   - 只读需要的行，禁止不指定范围的全文读取

### 而不是：
- 读整个文件（5000 tokens）
- 一次性改 2~5 个地方（1300 ~ 3000 tokens）
- 贴完整修改说明（2000 tokens）

## 构建规则
- 只跑 `npx vite build 2>&1 | Select-String "error"` 检查语法错误
- 不跑全量 build 除非用户明确要求
- 大型修改前指令备份文件，便于回退错误。

## 核心原则 - 每次 read_file 前的自问
每次执行 read_file 前，先问三个问题：
1. 我真的需要读这个文件吗？→ 先 grep 再决定
2. 我能少读一点吗？→ 指定行范围
3. 我是想"理解上下文"还是想"修改"？→ 修改时直接 single_find_and_replace

## Token 消耗汇总
在每个回复末尾（修改/查询/构建之后），附上一行 token 消耗汇总，格式：
[本次操作: grep×2 + replace×1 + edit×0 + read×0 + build×1 + ls×0 = ~650 tokens]

各操作单价（估算）：
- grep_search: ~100 tokens/次
- single_find_and_replace: ~300 tokens/次
- edit_existing_file: ~1500 tokens/次
- read_file（指定行）: ~500 tokens/次
- read_file（全文件）: ~5000 tokens/次（禁止使用）
- run_terminal_command（过滤 error）: ~50 tokens/次
- run_terminal_command（全量）: ~300 tokens/次
- create_new_file: ~2000 tokens/次
- ls: ~50 tokens/次
