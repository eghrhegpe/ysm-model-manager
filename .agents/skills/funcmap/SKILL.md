---
name: funcmap
description: 函数映射表。提取 Go/JS 所有函数和类型的注释，输出 Markdown 表格。
---

# 函数映射表

说"函数映射表"或"funcmap"，就会扫描全项目 Go + JS 代码，提取带注释的函数和类型定义。

```bash
python3 scripts/funcmap.py -o docs/funcmap.md
```

输出到 `docs/funcmap.md`，共 994+ 条记录。
