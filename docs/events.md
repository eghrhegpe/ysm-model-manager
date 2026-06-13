# 事件总线规范

> 所有组件间通信通过 `bus.emit()` / `bus.on()` 进行，禁止跨 Shadow DOM 的 `document.getElementById`。

## 命名规则

| 类型               | 格式                 | 语义                 | 示例                            |
| ------------------ | -------------------- | -------------------- | ------------------------------- |
| **命令（请求）**   | `domain:action`      | 请求某个模块执行操作 | `nav:change`, `tree:reload`     |
| **通知（已完成）** | `domain:action:done` | 操作已完成，携带结果 | `nav:changed`, `config:updated` |
| **数据事件**       | `domain:event`       | 传递数据，无命令语义 | `menu:show`, `package:selected` |

- 动词用原形表示命令，过去分词表示通知
- `:` 分隔领域和动作（不用 `/` 或 `.`）
- payload 格式需与事件名一同维护

## 事件目录

### 导航

| 事件名        | 类型 | payload            | 触发者                                           | 消费者                         |
| ------------- | ---- | ------------------ | ------------------------------------------------ | ------------------------------ |
| `nav:change`  | 命令 | `{ page: string }` | `app-modules.js`, `app-nav.js`, `handler-dnd.js` | `app-content/index.js`         |
| `nav:changed` | 通知 | `{ page: string }` | `app-content/index.js`                           | `app-nav.js`, `handler-dnd.js` |

### 文件树

| 事件名           | 类型 | payload              | 触发者                                                              | 消费者                     |
| ---------------- | ---- | -------------------- | ------------------------------------------------------------------- | -------------------------- |
| `tree:reload`    | 命令 | 无                   | `context-menus.js`, `workshop-events.js`, `workshop-diagnostics.js` | `app-tree/bus-handlers.js` |
| `entry:toggle`   | 命令 | `{ path: string }`   | `app-tree` 内部                                                     | `app-tree/bus-handlers.js` |
| `entries:dedup`  | 命令 | 无                   | `app-tree` 内部                                                     | `app-tree/bus-handlers.js` |
| `filter:results` | 数据 | `{ results: Array }` | `app-tree` 内部                                                     | `app-tree/index.js`        |

### 右键菜单

| 事件名      | 类型 | payload                                                                              | 触发者                                   | 消费者                |
| ----------- | ---- | ------------------------------------------------------------------------------------ | ---------------------------------------- | --------------------- |
| `ctx:show`  | 通知 | `{ x, y, type, instanceName?, path?, banned?, dir?, name?, count?, paths?, rtype? }` | `app-sidebar/events.js`, `app-tree`      | `context-menus.js`    |
| `menu:show` | 通知 | `{ x, y, items: Array }`                                                             | `context-menus.js`, `workshop-events.js` | `<context-menu>` 组件 |

### 侧栏（整合包列表）

| 事件名                  | 类型 | payload                   | 触发者                   | 消费者                                                                  |
| ----------------------- | ---- | ------------------------- | ------------------------ | ----------------------------------------------------------------------- |
| `package:selected`      | 通知 | 实例对象 (InstanceStatus) | `app-sidebar/events.js`  | `app-content/index.js`, `app-preview/index.js`, `app-preview/events.js` |
| `versions:updated`      | 通知 | `{ instances: Array }`    | `app-sidebar` 加载完成后 | `app-sidebar/events.js`                                                 |
| `sidebar:rtype-changed` | 通知 | `{ rtype: string }`       | `app-sync-manager`       | `app-sidebar/index.js`                                                  |

### 同步/安装

| 事件名                  | 类型 | payload                                    | 触发者                                                           | 消费者                                          |
| ----------------------- | ---- | ------------------------------------------ | ---------------------------------------------------------------- | ----------------------------------------------- |
| `sync:download-missing` | 命令 | `{ instanceName: string, rtype?: string }` | `context-menus.js`, `app-sidebar/index.js`, `preview-actions.js` | `handler-sync.js`                               |
| `sync:download:done`    | 通知 | 无                                         | `handler-sync.js`                                                | `app-sidebar/index.js`, `app-preview/events.js` |
| `sync:toggle-status`    | 命令 | 无                                         | `preview-actions.js`                                             | `handler-sync.js`                               |
| `sync:toggle:done`      | 通知 | 无                                         | `handler-sync.js`                                                | `app-preview/events.js`                         |
| `sync:upload:done`      | 通知 | 无                                         | `handler-upload.js`                                              | `app-preview/events.js`                         |
| `stats:upload`          | 命令 | 无                                         | `preview-actions.js`                                             | `handler-upload.js`                             |

### 实例操作

| 事件名                 | 类型 | payload            | 触发者             | 消费者                         |
| ---------------------- | ---- | ------------------ | ------------------ | ------------------------------ |
| `instance:install`     | 命令 | `{ name: string }` | 右键菜单           | `app-tree/instance-actions.js` |
| `instance:sync`        | 命令 | `{ name: string }` | 右键菜单           | `app-tree/instance-actions.js` |
| `instance:clear`       | 命令 | `{ name: string }` | `context-menus.js` | `handler-other.js`             |
| `instance:export-list` | 命令 | `{ name: string }` | `context-menus.js` | `handler-other.js`             |

### 统计/刷新

| 事件名          | 类型 | payload | 触发者               | 消费者                                         |
| --------------- | ---- | ------- | -------------------- | ---------------------------------------------- |
| `stats:refresh` | 命令 | 无      | 多处                 | `app-sidebar/index.js`, `app-preview/index.js` |
| `logs:refresh`  | 命令 | 无      | `preview-actions.js` | `app-preview/index.js`                         |

### 导入

| 事件名                 | 类型 | payload                                                | 触发者           | 消费者                 |
| ---------------------- | ---- | ------------------------------------------------------ | ---------------- | ---------------------- |
| `import:pending-files` | 通知 | `Array<{name, file}>`（兜底 `window.__pendingImport`） | `handler-dnd.js` | `import-queue.js`      |
| `repo:switch-tab`      | 命令 | `{ tab: string }`                                      | `handler-dnd.js` | `app-content/index.js` |

### 批量操作

| 事件名              | 类型 | payload               | 触发者             | 消费者                     |
| ------------------- | ---- | --------------------- | ------------------ | -------------------------- |
| `batch:rename`      | 命令 | `{ paths: string[] }` | `context-menus.js` | `app-tree/bus-handlers.js` |
| `batch:enable-all`  | 命令 | 无                    | `app-tree` 内部    | `app-tree/bus-handlers.js` |
| `batch:disable-all` | 命令 | 无                    | `app-tree` 内部    | `app-tree/bus-handlers.js` |
| `batch:enable`      | 命令 | `{ dir: string }`     | `app-tree` 内部    | `app-tree/bus-handlers.js` |
| `batch:disable`     | 命令 | `{ dir: string }`     | `app-tree` 内部    | `app-tree/bus-handlers.js` |

### 目录操作

| 事件名             | 类型 | payload           | 触发者             | 消费者                     |
| ------------------ | ---- | ----------------- | ------------------ | -------------------------- |
| `dir:rename`       | 命令 | `{ dir: string }` | `context-menus.js` | `app-tree/bus-handlers.js` |
| `dir:batch-rename` | 命令 | `{ dir: string }` | `context-menus.js` | `app-tree/bus-handlers.js` |
| `dir:mkdir`        | 命令 | `{ dir: string }` | `context-menus.js` | `app-tree/bus-handlers.js` |
| `dir:recycle`      | 命令 | `{ dir: string }` | `context-menus.js` | `app-tree/bus-handlers.js` |
| `dir:select-repo`  | 命令 | 无                | `app-tree` 内部    | `app-tree/bus-handlers.js` |

### 配置

| 事件名           | 类型 | payload | 触发者                 | 消费者 |
| ---------------- | ---- | ------- | ---------------------- | ------ |
| `config:updated` | 通知 | 无      | `workshop-settings.js` | -      |

### 预览/模型

| 事件名         | 类型 | payload                             | 触发者                    | 消费者                 |
| -------------- | ---- | ----------------------------------- | ------------------------- | ---------------------- |
| `model:select` | 命令 | `{ path: string, isDir?: boolean }` | `workshop-diagnostics.js` | `app-preview/index.js` |

### Toast

| 事件名       | 类型 | payload                                                                                          | 触发者 | 消费者             |
| ------------ | ---- | ------------------------------------------------------------------------------------------------ | ------ | ------------------ |
| `toast:show` | 命令 | `{ msg: string, undo?: function, duration?: number, type?: 'success'\|'warn'\|'error'\|'info' }` | 多处   | `<app-toast>` 组件 |

## 已知不一致（待清理）

| 问题                                                             | 说明                                               | 方案                                                                 |
| ---------------------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------- |
| ~~`navigate:settings` 与 `nav:change` `{page:"settings"}` 重复~~ | ~~两个事件都触发设置页导航~~                       | ✅ 已移除 `navigate:settings`，统一用 `nav:change {page:"settings"}` |
| ~~`sync:*-complete` 后缀不一致~~                                 | ~~`sync:download/upload/toggle-complete`~~         | ✅ 已改为 `sync:*:done`                                              |
| ~~`import:pending-files` 无 payload~~                            | ~~数据通过 `window.__pendingImport` 全局变量传递~~ | ✅ 已改为带 payload `{files}`                                        |

同时同步事件目录中的事件名：
