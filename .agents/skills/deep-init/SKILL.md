---
name: deep-init
description: 项目结构扫描与 AGENTS.md 更新。扫描 Go 包和前端组件结构，输出文档地图更新建议。
runAs: subagent
---

# 项目结构初始化

## 用途

当项目新增了 Go 包、前端组件、功能模块后，用于更新 AGENTS.md 的文档地图（§一）和项目结构速查（§五）。

## 扫描命令

### Go 后端

```bash
# 列出所有含 .go 文件的 Go 包
for d in go/*/; do
  if find "$d" -maxdepth 2 -name "*.go" -quit | grep -q .; then
    echo "$d" | sed 's|/*$||'
  fi
done
```

输出示例：
```
go/installer
go/sync
go/recycle
go/ysm
go/watcher
go/updater
go/paths
go/types
go/logs
go/version
go/threejs
```

### 前端组件

```bash
# 列出所有 Web Component 组件
ls -d frontend/js/components/*/ | xargs -n1 basename

# 列出所有业务功能模块
ls -d frontend/js/features/*/ | xargs -n1 basename

# 列出所有弹窗
ls -d frontend/js/dialogs/*/ | xargs -n1 basename

# 列出所有页面
ls -d frontend/js/pages/*/ | xargs -n1 basename

# 列出所有工具模块（.js 文件）
ls frontend/js/utils/*.js 2>/dev/null | xargs -n1 basename | sed 's/\.js$//'
```

### 组件拆分文件

检查大组件是否按规范拆分：

```bash
for d in frontend/js/components/*/; do
  name=$(basename "$d")
  count=$(find "$d" -maxdepth 1 -type f | wc -l)
  if [ "$count" -gt 1 ]; then
    echo "--- $name ---"
    ls "$d" | sed 's/^/  /'
  fi
done
```

### 新发现检查

```bash
# 检查 Go package 声明分布
grep -rn "^package " go/ --include="*.go" 2>/dev/null | awk -F: '{print $2}' | sort | uniq -c | sort -rn
```

## 输出格式

扫描后将结果填入 AGENTS.md 的以下两节：

### §5.1 Go 端

```
go/installer/  — 模型安装       go/sync/     — 整合包同步
go/recycle/    — 回收站管理     go/ysm/      — YSM 解析+摘要
go/watcher/    — 文件监听       go/updater/  — 自动更新
go/paths/      — 路径安全       go/types/    — 共享类型+注册表
go/logs/       — 导入日志       go/version/  — 版本号
go/threejs/    — 3D 骨骼计算    go/importer/ — 导入策略
```

**说明**: 新包加到最后，描述用 4 字概括，制表符 `/` 对齐。

### §5.2 前端

```
frontend/js/
  bus.js                 — 事件总线
  app-modules.js         — 组件入口 + 右键菜单映射
  components/            — Web Components (app-tree/sidebar/preview/content/nav)
  features/              — 业务功能 (import-queue/recycle-bin/version-updater/community)
  dialogs/               — 弹窗 (modal/rename/batch-rename/tag-editor)
  pages/                 — 页面渲染 (repository)
  core/                  — 基础设施 (buttons/global-handlers/theme/context-menus)
  utils/                 — 工具函数 (display/fmt/dom/icon/summarize/model3d)
  services/registry.js   — 服务注册
  wails/                 — Wails 桥接 (app.js + runtime.js)
```

**说明**: 新目录在括号内追加，保持单行紧凑。

## 输出示例

运行扫描后，汇报格式：

```
## 扫描结果

### 新增
- go/importer/ — 导入策略（未在 AGENTS.md §5.1 列出）
- frontend/js/wails/ — Wails 桥接（未在 AGENTS.md §5.2 列出）

### 缺失
- frontend/js/services/ 无 README 说明职责

### 建议更新
AGENTS.md §5.1 第 2 行添加：`go/importer/ — 导入策略`
```
