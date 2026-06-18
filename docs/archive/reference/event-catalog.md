# 事件总线目录

命名规范：`scope:action`，所有修饰语用 `:` 连接（不用 `-`）。

## 导航

| 事件          | 方向 | 载荷                        |
| ------------- | ---- | --------------------------- |
| `nav:change`  | emit | `{ page }` — 请求切换页面   |
| `nav:changed` | emit | `{ page }` — 页面已切换完成 |

## 仓库

| 事件                  | 方向 | 载荷                                 |
| --------------------- | ---- | ------------------------------------ |
| `repo:rtype-changed`  | emit | `rtype` — 资源类型已切换             |
| `repo:switch-tab`     | emit | `{ tab: "import" }` — 切换到指定 tab |
| `repo:search-creator` | emit | `name` — 搜索创作者                  |

## 同步

| 事件                    | 方向 | 载荷                                       |
| ----------------------- | ---- | ------------------------------------------ |
| `sync:download:missing` | emit | `{ instanceName?, rtype? }` — 下载缺失资源 |
| `sync:download:done`    | emit | — 下载完成                                 |
| `sync:toggle:status`    | emit | — 触发启用/禁用状态同步                    |
| `sync:toggle:done`      | emit | — 状态同步完成                             |
| `sync:upload:done`      | emit | — 上传完成                                 |

## 模型 / 文件

| 事件                | 方向 | 载荷                               |
| ------------------- | ---- | ---------------------------------- |
| `model:select`      | emit | `{ path, isDir? }` — 选择模型文件  |
| `entry:toggle`      | emit | `{ path }` — 切换文件启用/禁用状态 |
| `batch:rename`      | emit | `{ paths }` — 批量重命名           |
| `batch:enable-all`  | emit | — 全部启用                         |
| `batch:disable-all` | emit | — 全部禁用                         |

## 目录操作

| 事件               | 方向 | 载荷                       |
| ------------------ | ---- | -------------------------- |
| `dir:select-repo`  | emit | — 选择仓库目录             |
| `dir:rename`       | emit | `{ dir }` — 重命名目录     |
| `dir:batch-rename` | emit | `{ dir }` — 批量重命名目录 |
| `dir:mkdir`        | emit | `{ dir }` — 创建目录       |
| `dir:recycle`      | emit | `{ dir }` — 回收目录       |

## 实例（整合包）

| 事件                   | 方向 | 载荷                             |
| ---------------------- | ---- | -------------------------------- |
| `instance:install`     | emit | `{ name }` — 安装模型到整合包    |
| `instance:sync`        | emit | `{ name }` — 同步整合包          |
| `instance:export-list` | emit | `{ name, rtype }` — 导出模型清单 |
| `instance:clear`       | emit | `{ name }` — 清空整合包模型      |

## 菜单

| 事件        | 方向 | 载荷                                                                            |
| ----------- | ---- | ------------------------------------------------------------------------------- |
| `menu:show` | emit | `{ x, y, items }` — 显示右键菜单                                                |
| `ctx:show`  | emit | `{ x, y, type, ... }` — 显示上下文菜单（`context-menus.js` 转换为 `menu:show`） |

## UI 通知

| 事件                            | 方向 | 载荷                                          |
| ------------------------------- | ---- | --------------------------------------------- |
| `toast:show`                    | emit | `{ msg, duration?, type? }` — 显示 toast 通知 |
| `config:updated`                | emit | — 配置已更新                                  |
| `config:resource-types-changed` | emit | — 资源类型配置已更改                          |

## 刷新

| 事件                            | 方向 | 载荷             |
| ------------------------------- | ---- | ---------------- | -------------------- |
| `stats:refresh`                 | emit | — 刷新统计数据   |
| `stats:upload`                  | emit | — 上传统计       |
| `tree:reload`                   | emit | — 重新加载文件树 |
| `logs:refresh`                  | emit | — 刷新导入日志   |
| `loading:start` / `loading:end` | emit | — 加载状态       |
| `filter:results`                | emit | `results         | null` — 高级筛选结果 |

## 导入 / 拖放

| 事件                   | 方向 | 载荷                       |
| ---------------------- | ---- | -------------------------- |
| `import:pending-files` | emit | `files[]` — 待导入文件列表 |
| `package:selected`     | emit | `pkg` — 选中整合包         |

## 命名历史

以下事件已从旧名迁移：

| 旧名                    | 新名                    | 日期       |
| ----------------------- | ----------------------- | ---------- |
| `sync:download-missing` | `sync:download:missing` | 2026-06-14 |
| `sync:toggle-status`    | `sync:toggle:status`    | 2026-06-14 |
