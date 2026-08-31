# Bus 事件契约报告

> **自动生成** — 由 `scripts/event-graph.mjs` 生成。
> 基于 `frontend/src/bus.ts` 的 `BusEvents` 接口校验所有调用方（含 html 内联、可选链调用）。

## ✅ 无异常

所有调用均在 BusEvents 契约内，无孤儿发射 / 鬼订阅 / 未声明事件 / 缺参。

## 事件总览

| 事件 | 发射方 | 订阅方 | 一次性订阅 | 退订方 | 状态 |
|------|--------|--------|-----------|--------|------|
| `avatar:refresh` | 1 | 1 | 0 | 0 | ✅ |
| `batch:disable-all` | 1 | 1 | 0 | 0 | ✅ |
| `batch:enable-all` | 1 | 1 | 0 | 0 | ✅ |
| `batch:rename` | 1 | 1 | 0 | 0 | ✅ |
| `ctx:show` | 4 | 1 | 0 | 0 | ✅ |
| `dir:batch-rename` | 1 | 1 | 0 | 0 | ✅ |
| `dir:mkdir` | 1 | 1 | 0 | 0 | ✅ |
| `dir:recycle` | 1 | 1 | 0 | 0 | ✅ |
| `dir:rename` | 1 | 1 | 0 | 0 | ✅ |
| `instance:clear` | 1 | 1 | 0 | 0 | ✅ |
| `instance:export-list` | 1 | 1 | 0 | 0 | ✅ |
| `lang:changed` | 2 | 2 | 0 | 0 | ✅ |
| `menu:show` | 2 | 1 | 0 | 0 | ✅ |
| `model:select` | 8 | 1 | 0 | 0 | ✅ |
| `nav:changed` | 7 | 3 | 0 | 0 | ✅ |
| `package:selected` | 2 | 1 | 0 | 0 | ✅ |
| `repo:rtype-changed` | 3 | 6 | 0 | 0 | ✅ |
| `repo:search-creator` | 2 | 1 | 0 | 0 | ✅ |
| `repo:subdir-changed` | 1 | 1 | 0 | 0 | ✅ |
| `stats:refresh` | 25 | 2 | 0 | 0 | ✅ |
| `sync:download:done` | 2 | 2 | 0 | 0 | ✅ |
| `sync:download:missing` | 1 | 1 | 0 | 0 | ✅ |
| `sync:toggle:status` | 3 | 1 | 0 | 0 | ✅ |
| `toast:show` | 199 | 2 | 0 | 0 | ✅ |
| `tree:reload` | 13 | 1 | 0 | 0 | ✅ |
| `tree:set-search` | 1 | 1 | 0 | 0 | ✅ |

## 调用详情

### `avatar:refresh`

**发射方：**
| 文件 | 行 |
|------|----|
| `frontend/src/features/community/download-queue-store.ts` | 360 |

**订阅方（on）：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-content/init-workshop.ts` | 147 |

### `batch:disable-all`

**发射方：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-tree/toolbar-events.ts` | 213 |

**订阅方（on）：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-tree/bus-handlers.ts` | 30 |

### `batch:enable-all`

**发射方：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-tree/toolbar-events.ts` | 212 |

**订阅方（on）：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-tree/bus-handlers.ts` | 29 |

### `batch:rename`

**发射方：**
| 文件 | 行 |
|------|----|
| `frontend/src/core/context-menu-handlers.ts` | 183 |

**订阅方（on）：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-tree/bus-handlers.ts` | 35 |

### `ctx:show`

**发射方：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-sidebar/events.ts` | 123 |
| `frontend/src/views/app-tree/events.ts` | 296 |
| `frontend/src/views/app-tree/events.ts` | 320 |
| `frontend/src/views/app-tree/events.ts` | 331 |

**订阅方（on）：**
| 文件 | 行 |
|------|----|
| `frontend/src/core/context-menus.ts` | 57 |

### `dir:batch-rename`

**发射方：**
| 文件 | 行 |
|------|----|
| `frontend/src/core/context-menu-dir-handlers.ts` | 13 |

**订阅方（on）：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-tree/bus-handlers.ts` | 34 |

### `dir:mkdir`

**发射方：**
| 文件 | 行 |
|------|----|
| `frontend/src/core/context-menu-dir-handlers.ts` | 50 |

**订阅方（on）：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-tree/bus-handlers.ts` | 32 |

### `dir:recycle`

**发射方：**
| 文件 | 行 |
|------|----|
| `frontend/src/core/context-menu-dir-handlers.ts` | 51 |

**订阅方（on）：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-tree/bus-handlers.ts` | 33 |

### `dir:rename`

**发射方：**
| 文件 | 行 |
|------|----|
| `frontend/src/core/context-menu-dir-handlers.ts` | 11 |

**订阅方（on）：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-tree/bus-handlers.ts` | 31 |

### `instance:clear`

**发射方：**
| 文件 | 行 |
|------|----|
| `frontend/src/core/context-menu-handlers.ts` | 176 |

**订阅方（on）：**
| 文件 | 行 |
|------|----|
| `frontend/src/core/handlers/instance-ops.ts` | 98 |

### `instance:export-list`

**发射方：**
| 文件 | 行 |
|------|----|
| `frontend/src/core/context-menu-handlers.ts` | 166 |

**订阅方（on）：**
| 文件 | 行 |
|------|----|
| `frontend/src/core/handlers/instance-ops.ts` | 15 |

### `lang:changed`

**发射方：**
| 文件 | 行 |
|------|----|
| `frontend/src/core/i18n/locale.ts` | 100 |
| `frontend/src/core/i18n/locale.ts` | 151 |

**订阅方（on）：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-content/index.ts` | 114 |
| `frontend/src/views/app-nav/index.ts` | 165 |

### `menu:show`

**发射方：**
| 文件 | 行 |
|------|----|
| `frontend/src/core/context-menus.ts` | 58 |
| `frontend/src/features/community/events.ts` | 196 |

**订阅方（on）：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/context-menu/index.ts` | 32 |

### `model:select`

**发射方：**
| 文件 | 行 |
|------|----|
| `frontend/src/features/oldest-models.ts` | 59 |
| `frontend/src/features/recycle-bin.ts` | 192 |
| `frontend/src/views/app-content/diagnostics/dedup.ts` | 385 |
| `frontend/src/views/app-preview/detail-3d.ts` | 274 |
| `frontend/src/views/app-preview/detail-3d.ts` | 341 |
| `frontend/src/views/app-tree/events.ts` | 155 |
| `frontend/src/views/app-tree/events.ts` | 252 |
| `frontend/src/views/app-tree/index.ts` | 418 |

**订阅方（on）：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-preview/index.ts` | 117 |

### `nav:changed`

**发射方：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-content/index.ts` | 108 |
| `frontend/src/views/app-content/index.ts` | 180 |
| `frontend/src/views/app-content/site/events.ts` | 201 |
| `frontend/src/views/app-nav/index.ts` | 34 |
| `frontend/src/views/app-nav/index.ts` | 175 |
| `frontend/src/views/app-sidebar/events.ts` | 250 |
| `frontend/src/views/app-tree/toolbar-events.ts` | 116 |

**订阅方（on）：**
| 文件 | 行 |
|------|----|
| `frontend/src/core/page-store.ts` | 63 |
| `frontend/src/views/app-content/index.ts` | 99 |
| `frontend/src/views/app-nav/index.ts` | 151 |

### `package:selected`

**发射方：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-sidebar/events.ts` | 78 |
| `frontend/src/views/app-sidebar/events.ts` | 235 |

**订阅方（on）：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-content/init-pages.ts` | 37 |

### `repo:rtype-changed`

**发射方：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-content/settings/init.ts` | 278 |
| `frontend/src/views/app-content/settings/init.ts` | 300 |
| `frontend/src/views/app-nav/index.ts` | 95 |

**订阅方（on）：**
| 文件 | 行 |
|------|----|
| `frontend/src/features/repo-rtype.ts` | 33 |
| `frontend/src/views/app-content/init-pages.ts` | 79 |
| `frontend/src/views/app-content/init-pages.ts` | 255 |
| `frontend/src/views/app-nav/index.ts` | 167 |
| `frontend/src/views/app-sidebar/index.ts` | 435 |
| `frontend/src/views/app-sync-manager/index.ts` | 174 |

### `repo:search-creator`

**发射方：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-content/site/events.ts` | 169 |
| `frontend/src/views/app-content/site/events.ts` | 307 |

**订阅方（on）：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-content/index.ts` | 106 |

### `repo:subdir-changed`

**发射方：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-nav/index.ts` | 96 |

**订阅方（on）：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-sync-manager/index.ts` | 197 |

### `stats:refresh`

**发射方：**
| 文件 | 行 |
|------|----|
| `frontend/src/core/context-menu-shared.ts` | 20 |
| `frontend/src/core/handlers/android-events.ts` | 66 |
| `frontend/src/core/handlers/instance-ops.ts` | 150 |
| `frontend/src/core/handlers/sync.ts` | 86 |
| `frontend/src/core/handlers/sync.ts` | 215 |
| `frontend/src/features/community/download-queue-store.ts` | 258 |
| `frontend/src/features/community/download-queue.ts` | 114 |
| `frontend/src/features/import-executor.ts` | 34 |
| `frontend/src/features/import-executor.ts` | 220 |
| `frontend/src/features/pack-dnd.ts` | 167 |
| `frontend/src/features/recycle-bin.ts` | 116 |
| `frontend/src/features/recycle-bin.ts` | 176 |
| `frontend/src/views/app-content/diagnostics/dedup.ts` | 435 |
| `frontend/src/views/app-content/settings/init.ts` | 142 |
| `frontend/src/views/app-content/settings/path-cards.ts` | 78 |
| `frontend/src/views/app-content/settings/path-cards.ts` | 353 |
| `frontend/src/views/app-sidebar/index.ts` | 320 |
| `frontend/src/views/app-sidebar/launcher-detect.ts` | 76 |
| `frontend/src/views/app-sidebar/launcher-detect.ts` | 139 |
| `frontend/src/views/app-sync-manager/index.ts` | 220 |
| `frontend/src/views/app-tree/bus-handlers.ts` | 59 |
| `frontend/src/views/app-tree/bus-handlers.ts` | 93 |
| `frontend/src/views/app-tree/bus-handlers.ts` | 162 |
| `frontend/src/views/app-tree/events.ts` | 98 |
| `frontend/src/views/app-tree/events.ts` | 379 |

**订阅方（on）：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-sidebar/index.ts` | 427 |
| `frontend/src/views/app-sync-manager/index.ts` | 154 |

### `sync:download:done`

**发射方：**
| 文件 | 行 |
|------|----|
| `frontend/src/core/handlers/sync.ts` | 106 |
| `frontend/src/core/handlers/sync.ts` | 142 |

**订阅方（on）：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-sidebar/index.ts` | 196 |
| `frontend/src/views/app-sidebar/index.ts` | 217 |

### `sync:download:missing`

**发射方：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-sidebar/index.ts` | 210 |

**订阅方（on）：**
| 文件 | 行 |
|------|----|
| `frontend/src/core/handlers/sync.ts` | 268 |

### `sync:toggle:status`

**发射方：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-tree/bus-handlers.ts` | 308 |
| `frontend/src/views/app-tree/events.ts` | 96 |
| `frontend/src/views/app-tree/events.ts` | 471 |

**订阅方（on）：**
| 文件 | 行 |
|------|----|
| `frontend/src/core/handlers/sync.ts` | 274 |

### `toast:show`

**发射方：**
| 文件 | 行 |
|------|----|
| `frontend/src/app-modules.ts` | 68 |
| `frontend/src/app-modules.ts` | 78 |
| `frontend/src/app-modules.ts` | 88 |
| `frontend/src/app-modules.ts` | 119 |
| `frontend/src/core/context-menu-shared.ts` | 25 |
| `frontend/src/core/context-menu-shared.ts` | 68 |
| `frontend/src/core/context-menu-shared.ts` | 78 |
| `frontend/src/core/handlers/android-events.ts` | 25 |
| `frontend/src/core/handlers/android-events.ts` | 42 |
| `frontend/src/core/handlers/instance-ops.ts` | 36 |
| `frontend/src/core/handlers/instance-ops.ts` | 75 |
| `frontend/src/core/handlers/instance-ops.ts` | 85 |
| `frontend/src/core/handlers/instance-ops.ts` | 125 |
| `frontend/src/core/handlers/instance-ops.ts` | 141 |
| `frontend/src/core/handlers/instance-ops.ts` | 151 |
| `frontend/src/core/handlers/require-mcroot.ts` | 18 |
| `frontend/src/core/handlers/sync.ts` | 41 |
| `frontend/src/core/handlers/sync.ts` | 87 |
| `frontend/src/core/handlers/sync.ts` | 118 |
| `frontend/src/core/handlers/sync.ts` | 135 |
| `frontend/src/core/handlers/sync.ts` | 165 |
| `frontend/src/core/handlers/sync.ts` | 174 |
| `frontend/src/core/handlers/sync.ts` | 208 |
| `frontend/src/core/handlers/sync.ts` | 223 |
| `frontend/src/core/handlers/sync.ts` | 248 |
| `frontend/src/features/community/download-queue-store.ts` | 247 |
| `frontend/src/features/community/download-queue.ts` | 272 |
| `frontend/src/features/community/download-queue.ts` | 298 |
| `frontend/src/features/community/events.ts` | 141 |
| `frontend/src/features/community/events.ts` | 153 |
| `frontend/src/features/community/events.ts` | 222 |
| `frontend/src/features/community/events.ts` | 274 |
| `frontend/src/features/community/events.ts` | 311 |
| `frontend/src/features/import-dnd.ts` | 39 |
| `frontend/src/features/import-dnd.ts` | 57 |
| `frontend/src/features/import-dnd.ts` | 76 |
| `frontend/src/features/import-dnd.ts` | 86 |
| `frontend/src/features/import-dnd.ts` | 102 |
| `frontend/src/features/import-dnd.ts` | 188 |
| `frontend/src/features/import-executor.ts` | 29 |
| `frontend/src/features/import-executor.ts` | 211 |
| `frontend/src/features/import-executor.ts` | 224 |
| `frontend/src/features/pack-dnd.ts` | 37 |
| `frontend/src/features/preview-3d/adapters/mount-preview-core.ts` | 423 |
| `frontend/src/features/preview-3d/adapters/preview-loading.ts` | 38 |
| `frontend/src/features/preview-3d/adapters/switch-preview.ts` | 147 |
| `frontend/src/features/recycle-bin.ts` | 249 |
| `frontend/src/features/version-updater.ts` | 149 |
| `frontend/src/features/version-updater.ts` | 158 |
| `frontend/src/features/version-updater.ts` | 184 |
| `frontend/src/features/version-updater.ts` | 193 |
| `frontend/src/features/version-updater.ts` | 216 |
| `frontend/src/features/version-updater.ts` | 250 |
| `frontend/src/features/version-updater.ts` | 260 |
| `frontend/src/utils/dom/dialogs/batch-rename.ts` | 95 |
| `frontend/src/utils/dom/dialogs/batch-rename.ts` | 387 |
| `frontend/src/utils/dom/dialogs/batch-rename.ts` | 401 |
| `frontend/src/utils/dom/dialogs/batch-rename.ts` | 421 |
| `frontend/src/utils/dom/directory-picker.ts` | 34 |
| `frontend/src/utils/dom/directory-picker.ts` | 45 |
| `frontend/src/utils/dom/directory-picker.ts` | 57 |
| `frontend/src/utils/module-loader.ts` | 17 |
| `frontend/src/views/app-content/diagnostics/conflicts.ts` | 58 |
| `frontend/src/views/app-content/diagnostics/conflicts.ts` | 204 |
| `frontend/src/views/app-content/diagnostics/init.ts` | 41 |
| `frontend/src/views/app-content/diagnostics/init.ts` | 52 |
| `frontend/src/views/app-content/diagnostics/init.ts` | 58 |
| `frontend/src/views/app-content/diagnostics/init.ts` | 76 |
| `frontend/src/views/app-content/diagnostics/init.ts` | 88 |
| `frontend/src/views/app-content/diagnostics/init.ts` | 103 |
| `frontend/src/views/app-content/diagnostics/init.ts` | 111 |
| `frontend/src/views/app-content/diagnostics/perf-cli.ts` | 88 |
| `frontend/src/views/app-content/diagnostics/perf-cli.ts` | 354 |
| `frontend/src/views/app-content/index.ts` | 171 |
| `frontend/src/views/app-content/init-pages.ts` | 168 |
| `frontend/src/views/app-content/init-pages.ts` | 281 |
| `frontend/src/views/app-content/settings/init.ts` | 48 |
| `frontend/src/views/app-content/settings/init.ts` | 84 |
| `frontend/src/views/app-content/settings/init.ts` | 128 |
| `frontend/src/views/app-content/settings/init.ts` | 144 |
| `frontend/src/views/app-content/settings/init.ts` | 151 |
| `frontend/src/views/app-content/settings/init.ts` | 159 |
| `frontend/src/views/app-content/settings/init.ts` | 187 |
| `frontend/src/views/app-content/settings/init.ts` | 234 |
| `frontend/src/views/app-content/settings/keymap.ts` | 104 |
| `frontend/src/views/app-content/settings/keymap.ts` | 115 |
| `frontend/src/views/app-content/settings/keymap.ts` | 136 |
| `frontend/src/views/app-content/settings/path-cards.ts` | 79 |
| `frontend/src/views/app-content/settings/path-cards.ts` | 273 |
| `frontend/src/views/app-content/settings/path-cards.ts` | 279 |
| `frontend/src/views/app-content/settings/path-cards.ts` | 300 |
| `frontend/src/views/app-content/settings/path-cards.ts` | 306 |
| `frontend/src/views/app-content/settings/path-cards.ts` | 328 |
| `frontend/src/views/app-content/settings/path-cards.ts` | 354 |
| `frontend/src/views/app-content/settings/ui-prefs.ts` | 123 |
| `frontend/src/views/app-content/settings/ui-prefs.ts` | 134 |
| `frontend/src/views/app-content/settings/ui-prefs.ts` | 145 |
| `frontend/src/views/app-content/settings/ui-prefs.ts` | 157 |
| `frontend/src/views/app-content/settings/ui-prefs.ts` | 167 |
| `frontend/src/views/app-content/settings/worker-prefs.ts` | 44 |
| `frontend/src/views/app-content/site/drag.ts` | 44 |
| `frontend/src/views/app-content/site/drag.ts` | 81 |
| `frontend/src/views/app-content/site/drag.ts` | 104 |
| `frontend/src/views/app-content/site/drag.ts` | 113 |
| `frontend/src/views/app-content/site/edit.ts` | 115 |
| `frontend/src/views/app-content/site/edit.ts` | 143 |
| `frontend/src/views/app-content/site/edit.ts` | 150 |
| `frontend/src/views/app-content/site/edit.ts` | 224 |
| `frontend/src/views/app-content/site/edit.ts` | 231 |
| `frontend/src/views/app-content/site/edit.ts` | 246 |
| `frontend/src/views/app-content/site/events.ts` | 146 |
| `frontend/src/views/app-content/site/events.ts` | 271 |
| `frontend/src/views/app-content/workshop-site-opener.ts` | 134 |
| `frontend/src/views/app-content/workshop-site-opener.ts` | 144 |
| `frontend/src/views/app-content/workshop-site-opener.ts` | 150 |
| `frontend/src/views/app-content/workshop-site-opener.ts` | 162 |
| `frontend/src/views/app-content/workshop-site-opener.ts` | 173 |
| `frontend/src/views/app-content/workshop-site-opener.ts` | 179 |
| `frontend/src/views/app-content/workshop-tabs.ts` | 91 |
| `frontend/src/views/app-content/workshop-tabs.ts` | 139 |
| `frontend/src/views/app-nav/index.ts` | 114 |
| `frontend/src/views/app-preview/detail-3d.ts` | 287 |
| `frontend/src/views/app-preview/detail-3d.ts` | 353 |
| `frontend/src/views/app-preview/index.ts` | 245 |
| `frontend/src/views/app-preview/index.ts` | 267 |
| `frontend/src/views/app-preview/preview-library.ts` | 98 |
| `frontend/src/views/app-preview/preview-library.ts` | 130 |
| `frontend/src/views/app-preview/shot-panel-shared.ts` | 49 |
| `frontend/src/views/app-sidebar/events.ts` | 120 |
| `frontend/src/views/app-sidebar/index.ts` | 151 |
| `frontend/src/views/app-sidebar/index.ts` | 265 |
| `frontend/src/views/app-sidebar/index.ts` | 267 |
| `frontend/src/views/app-sidebar/index.ts` | 270 |
| `frontend/src/views/app-sidebar/index.ts` | 314 |
| `frontend/src/views/app-sidebar/index.ts` | 316 |
| `frontend/src/views/app-sidebar/index.ts` | 318 |
| `frontend/src/views/app-sidebar/index.ts` | 323 |
| `frontend/src/views/app-sidebar/launcher-detect.ts` | 37 |
| `frontend/src/views/app-sidebar/launcher-detect.ts` | 62 |
| `frontend/src/views/app-sidebar/launcher-detect.ts` | 77 |
| `frontend/src/views/app-sidebar/launcher-detect.ts` | 122 |
| `frontend/src/views/app-sidebar/launcher-detect.ts` | 140 |
| `frontend/src/views/app-sidebar/loader.ts` | 152 |
| `frontend/src/views/app-sync-manager/index.ts` | 151 |
| `frontend/src/views/app-sync-manager/network.ts` | 47 |
| `frontend/src/views/app-sync-manager/network.ts` | 55 |
| `frontend/src/views/app-sync-manager/store.ts` | 30 |
| `frontend/src/views/app-sync-manager/store.ts` | 64 |
| `frontend/src/views/app-toast/index.ts` | 133 |
| `frontend/src/views/app-toast/index.ts` | 152 |
| `frontend/src/views/app-toast/index.ts` | 161 |
| `frontend/src/views/app-tree/bus-handlers.ts` | 60 |
| `frontend/src/views/app-tree/bus-handlers.ts` | 95 |
| `frontend/src/views/app-tree/bus-handlers.ts` | 121 |
| `frontend/src/views/app-tree/bus-handlers.ts` | 166 |
| `frontend/src/views/app-tree/bus-handlers.ts` | 172 |
| `frontend/src/views/app-tree/bus-handlers.ts` | 189 |
| `frontend/src/views/app-tree/bus-handlers.ts` | 202 |
| `frontend/src/views/app-tree/bus-handlers.ts` | 221 |
| `frontend/src/views/app-tree/bus-handlers.ts` | 256 |
| `frontend/src/views/app-tree/bus-handlers.ts` | 268 |
| `frontend/src/views/app-tree/bus-handlers.ts` | 276 |
| `frontend/src/views/app-tree/bus-handlers.ts` | 311 |
| `frontend/src/views/app-tree/bus-handlers.ts` | 317 |
| `frontend/src/views/app-tree/events.ts` | 69 |
| `frontend/src/views/app-tree/events.ts` | 77 |
| `frontend/src/views/app-tree/events.ts` | 102 |
| `frontend/src/views/app-tree/events.ts` | 130 |
| `frontend/src/views/app-tree/events.ts` | 171 |
| `frontend/src/views/app-tree/events.ts` | 180 |
| `frontend/src/views/app-tree/events.ts` | 196 |
| `frontend/src/views/app-tree/events.ts` | 203 |
| `frontend/src/views/app-tree/events.ts` | 382 |
| `frontend/src/views/app-tree/events.ts` | 423 |
| `frontend/src/views/app-tree/events.ts` | 431 |
| `frontend/src/views/app-tree/events.ts` | 474 |
| `frontend/src/views/app-tree/events.ts` | 484 |
| `frontend/src/views/app-tree/index.ts` | 208 |
| `frontend/src/views/app-tree/index.ts` | 354 |
| `frontend/src/views/app-tree/index.ts` | 362 |
| `frontend/src/views/app-tree/index.ts` | 463 |
| `frontend/src/views/app-tree/index.ts` | 470 |
| `frontend/src/views/app-tree/loader.ts` | 31 |
| `frontend/src/views/app-tree/loader.ts` | 55 |
| `frontend/src/views/app-tree/toolbar-events.ts` | 44 |
| `frontend/src/views/app-tree/toolbar-events.ts` | 55 |
| `frontend/src/views/app-tree/toolbar-events.ts` | 161 |
| `frontend/src/views/app-tree/toolbar-events.ts` | 312 |
| `frontend/src/views/app-tree/toolbar-events.ts` | 330 |
| `frontend/src/views/app-tree/toolbar-events.ts` | 336 |
| `frontend/src/views/app-tree/toolbar-events.ts` | 347 |
| `frontend/src/views/app-tree/toolbar-search.ts` | 143 |
| `frontend/src/views/app-tree/toolbar-search.ts` | 162 |
| `frontend/src/views/app-tree/toolbar-search.ts` | 192 |
| `frontend/src/views/app-tree/toolbar-search.ts` | 208 |
| `frontend/src/views/app-tree/toolbar-search.ts` | 237 |
| `frontend/src/views/app-tree/toolbar-search.ts` | 243 |
| `frontend/src/views/app-tree/toolbar-search.ts` | 305 |
| `frontend/src/views/app-tree/toolbar-search.ts` | 314 |

**订阅方（on）：**
| 文件 | 行 |
|------|----|
| `frontend/src/core/error-diary.ts` | 55 |
| `frontend/src/views/app-toast/index.ts` | 69 |

### `tree:reload`

**发射方：**
| 文件 | 行 |
|------|----|
| `frontend/src/core/context-menu-shared.ts` | 19 |
| `frontend/src/core/handlers/android-events.ts` | 65 |
| `frontend/src/core/handlers/sync.ts` | 130 |
| `frontend/src/core/handlers/sync.ts` | 255 |
| `frontend/src/features/community/download-queue-store.ts` | 257 |
| `frontend/src/features/community/download-queue.ts` | 113 |
| `frontend/src/features/import-executor.ts` | 35 |
| `frontend/src/features/import-executor.ts` | 219 |
| `frontend/src/features/pack-dnd.ts` | 168 |
| `frontend/src/features/recycle-bin.ts` | 117 |
| `frontend/src/features/recycle-bin.ts` | 177 |
| `frontend/src/views/app-content/diagnostics/dedup.ts` | 436 |
| `frontend/src/views/app-sidebar/index.ts` | 321 |

**订阅方（on）：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-tree/bus-handlers.ts` | 36 |

### `tree:set-search`

**发射方：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-content/index.ts` | 110 |

**订阅方（on）：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-tree/index.ts` | 144 |
