# Bus 事件契约报告

> **自动生成** — 由 `scripts/event-graph.ts` 生成。
> 基于 `frontend/src/bus.ts` 的 `BusEvents` 接口校验所有调用方（含 html 内联、可选链调用）。
> 合法发射者登记表闸（ADR-270-d3）：`docs/.bus-emitters.json` 之外新增发射文件 = 硬错误；表内未被命中条目 = 可收紧提示。

## ✅ 无异常

所有调用均在 BusEvents 契约与合法发射者登记表内：无孤儿发射 / 鬼订阅 / 未声明事件 / 缺参 / 发射者表外新增。

## 事件总览

| 事件 | 发射方 | 订阅方 | 一次性订阅 | 退订方 | 状态 |
|------|--------|--------|-----------|--------|------|
| `avatar:refresh` | 1 | 1 | 0 | 0 | ✅ |
| `batch:rename` | 1 | 1 | 0 | 0 | ✅ |
| `community:clear-cache` | 1 | 1 | 0 | 0 | ✅ |
| `ctx:show` | 6 | 1 | 0 | 0 | ✅ |
| `dir:batch-rename` | 1 | 1 | 0 | 0 | ✅ |
| `dir:mkdir` | 1 | 1 | 0 | 0 | ✅ |
| `dir:recycle` | 1 | 1 | 0 | 0 | ✅ |
| `dir:rename` | 1 | 1 | 0 | 0 | ✅ |
| `instance:clear` | 1 | 1 | 0 | 0 | ✅ |
| `instance:export-list` | 1 | 1 | 0 | 0 | ✅ |
| `lang:changed` | 2 | 2 | 0 | 0 | ✅ |
| `menu:show` | 1 | 1 | 0 | 0 | ✅ |
| `model:select` | 8 | 2 | 0 | 0 | ✅ |
| `nav:changed` | 7 | 2 | 0 | 0 | ✅ |
| `package:selected` | 2 | 1 | 0 | 0 | ✅ |
| `repo:focus-search` | 1 | 1 | 0 | 0 | ✅ |
| `repo:rtype-changed` | 1 | 6 | 0 | 0 | ✅ |
| `repo:search-creator` | 2 | 1 | 0 | 0 | ✅ |
| `repo:subdir-changed` | 1 | 1 | 0 | 0 | ✅ |
| `stats:refresh` | 26 | 2 | 0 | 0 | ✅ |
| `sync:download:done` | 2 | 2 | 0 | 0 | ✅ |
| `sync:download:missing` | 1 | 1 | 0 | 0 | ✅ |
| `sync:toggle:status` | 3 | 1 | 0 | 0 | ✅ |
| `toast:show` | 17 | 2 | 0 | 0 | ✅ |
| `tree:reload` | 15 | 1 | 0 | 0 | ✅ |
| `tree:set-search` | 1 | 1 | 0 | 0 | ✅ |
| `ui:card-density` | 1 | 1 | 0 | 0 | ✅ |

## 调用详情

### `avatar:refresh`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| cancelDownloads | `frontend/src/features/community/download-queue-store.ts` | 364 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| initWorkshopPage | `frontend/src/views/app-content/init-workshop.ts` | 146 |

### `batch:rename`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| createContextMenuHandlers | `frontend/src/features/context-menu/context-menu-handlers.ts` | 203 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| bindBusEvents | `frontend/src/views/app-tree/bus-handlers.ts` | 51 |

### `community:clear-cache`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| cmDqCleanupProgressUI | `frontend/src/features/community/download-queue.ts` | 117 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| connectedCallback | `frontend/src/views/app-content/index.ts` | 91 |

### `ctx:show`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| cmReBindContextMenu | `frontend/src/features/community/repo-events-bindings.ts` | 126 |
| showMenu | `frontend/src/features/context-menu/context-menus.setup.ts` | 152 |
| bindCardContextHandler | `frontend/src/views/app-sidebar/events.ts` | 135 |
| atTeBindContextMenu | `frontend/src/views/app-tree/events.ts` | 260 |
| atTeBindContextMenu | `frontend/src/views/app-tree/events.ts` | 286 |
| atTeBindContextMenu | `frontend/src/views/app-tree/events.ts` | 298 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| registerContextMenus | `frontend/src/features/context-menu/context-menus.ts` | 96 |

### `dir:batch-rename`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| (顶层) | `frontend/src/features/context-menu/context-menu-dir-handlers.ts` | 11 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| bindBusEvents | `frontend/src/views/app-tree/bus-handlers.ts` | 46 |

### `dir:mkdir`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| (顶层) | `frontend/src/features/context-menu/context-menu-dir-handlers.ts` | 22 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| bindBusEvents | `frontend/src/views/app-tree/bus-handlers.ts` | 36 |

### `dir:recycle`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| (顶层) | `frontend/src/features/context-menu/context-menu-dir-handlers.ts` | 23 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| bindBusEvents | `frontend/src/views/app-tree/bus-handlers.ts` | 41 |

### `dir:rename`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| (顶层) | `frontend/src/features/context-menu/context-menu-dir-handlers.ts` | 10 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| bindBusEvents | `frontend/src/views/app-tree/bus-handlers.ts` | 31 |

### `instance:clear`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| runBatchFileOp | `frontend/src/features/context-menu/context-menu-handlers.ts` | 194 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| registerInstanceOps | `frontend/src/features/pack-ops/instance-ops.ts` | 90 |

### `instance:export-list`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| runBatchFileOp | `frontend/src/features/context-menu/context-menu-handlers.ts` | 184 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| registerInstanceOps | `frontend/src/features/pack-ops/instance-ops.ts` | 17 |

### `lang:changed`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| setLang | `frontend/src/core/i18n/locale.ts` | 172 |
| initI18n | `frontend/src/core/i18n/locale.ts` | 227 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| connectedCallback | `frontend/src/views/app-content/index.ts` | 83 |
| connectedCallback | `frontend/src/views/app-nav/index.ts` | 209 |

### `menu:show`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| registerContextMenus | `frontend/src/features/context-menu/context-menus.ts` | 97 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| connectedCallback | `frontend/src/views/context-menu/index.ts` | 74 |

### `model:select`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| handleContainerClick | `frontend/src/features/maintenance/oldest-models.ts` | 67 |
| onRecycleListClick | `frontend/src/features/maintenance/recycle-bin.ts` | 214 |
| bindPreviewClicks | `frontend/src/views/app-content/diagnostics/dedup-render.ts` | 107 |
| showMorphPreview | `frontend/src/views/app-preview/detail-3d.ts` | 247 |
| showStagePreview | `frontend/src/views/app-preview/detail-3d.ts` | 334 |
| atTeClickRowFolder | `frontend/src/views/app-tree/events.ts` | 142 |
| atTeClickRowFile | `frontend/src/views/app-tree/events.ts` | 216 |
| _onKeyArrowNav | `frontend/src/views/app-tree/index.ts` | 656 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| initPerfPanel | `frontend/src/views/app-content/diagnostics/perf.ts` | 222 |
| connectedCallback | `frontend/src/views/app-preview/index.ts` | 72 |

### `nav:changed`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| connectedCallback | `frontend/src/views/app-content/index.ts` | 71 |
| _pageInitFailed | `frontend/src/views/app-content/index.ts` | 193 |
| cmBbBindEmptyLocalBtn | `frontend/src/views/app-content/site/events.ts` | 267 |
| anActivateNavPage | `frontend/src/views/app-nav/index.ts` | 51 |
| connectedCallback | `frontend/src/views/app-nav/index.ts` | 219 |
| bindFooter | `frontend/src/views/app-sidebar/events.ts` | 276 |
| atTlBindRepoSwitch | `frontend/src/views/app-tree/toolbar-events.ts` | 88 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| connectedCallback | `frontend/src/views/app-content/index.ts` | 58 |
| connectedCallback | `frontend/src/views/app-nav/index.ts` | 189 |

### `package:selected`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| bindCardClickHandler | `frontend/src/views/app-sidebar/events.ts` | 91 |
| restoreSelectedCard | `frontend/src/views/app-sidebar/events.ts` | 262 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| initInstancesPage | `frontend/src/views/app-content/init-pages.ts` | 73 |

### `repo:focus-search`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| anActivateNavPage | `frontend/src/views/app-nav/index.ts` | 57 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| bindBusEvents | `frontend/src/views/app-tree/bus-handlers.ts` | 62 |

### `repo:rtype-changed`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| anBindDualSelects | `frontend/src/views/app-nav/index.ts` | 127 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| useCurrentResourceType | `frontend/src/features/repo/repo-rtype.ts` | 21 |
| initRepositoryPage | `frontend/src/views/app-content/init-pages.ts` | 121 |
| initDedupTab | `frontend/src/views/app-content/init-pages.ts` | 300 |
| connectedCallback | `frontend/src/views/app-nav/index.ts` | 211 |
| connectedCallback | `frontend/src/views/app-sidebar/index.ts` | 130 |
| _subscribeBus | `frontend/src/views/app-sync-manager/index.ts` | 304 |

### `repo:search-creator`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| cmCrBindOverlayEvents | `frontend/src/views/app-content/site/events.ts` | 199 |
| cmBbBindLocalBadges | `frontend/src/views/app-content/site/events.ts` | 354 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| connectedCallback | `frontend/src/views/app-content/index.ts` | 69 |

### `repo:subdir-changed`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| anBindDualSelects | `frontend/src/views/app-nav/index.ts` | 128 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| _subscribeBus | `frontend/src/views/app-sync-manager/index.ts` | 327 |

### `stats:refresh`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| runWebEnqueue | `frontend/src/features/community/download-queue-web.ts` | 107 |
| cmDqCleanupProgressUI | `frontend/src/features/community/download-queue.ts` | 124 |
| refreshUI | `frontend/src/features/context-menu/context-menu-shared.ts` | 19 |
| handleInstanceDrop | `frontend/src/features/dnd/pack-dnd.ts` | 164 |
| (顶层) | `frontend/src/features/import/executor.ts` | 49 |
| importWebFilesWithToast | `frontend/src/features/import/executor.ts` | 177 |
| setupRecycleActions | `frontend/src/features/maintenance/recycle-bin.ts` | 128 |
| onRecycleEmptyClick | `frontend/src/features/maintenance/recycle-bin.ts` | 198 |
| registerInstanceOps | `frontend/src/features/pack-ops/instance-ops.ts` | 132 |
| registerAndroidEvents | `frontend/src/features/platform/android-events.ts` | 55 |
| runDownloadMissing | `frontend/src/features/sync/sync.ts` | 87 |
| runSyncToggleStatus | `frontend/src/features/sync/sync.ts` | 197 |
| runExecDelete | `frontend/src/views/app-content/diagnostics/dedup.ts` | 118 |
| relinkAllInstancesInner | `frontend/src/views/app-content/settings/init.ts` | 230 |
| bindPathClick | `frontend/src/views/app-content/settings/path-cards.ts` | 93 |
| initMcDetect | `frontend/src/views/app-content/settings/path-cards.ts` | 311 |
| runMcSearch | `frontend/src/views/app-sidebar/launcher-detect.ts` | 76 |
| runLauncherDetect | `frontend/src/views/app-sidebar/launcher-detect.ts` | 141 |
| runPull | `frontend/src/views/app-sidebar/sync-flow.ts` | 288 |
| _bindDelegate | `frontend/src/views/app-sync-manager/index.ts` | 226 |
| _bindDelegate | `frontend/src/views/app-sync-manager/index.ts` | 245 |
| runBatchRename | `frontend/src/views/app-tree/bus-handlers.ts` | 104 |
| atBeHandleDirRename | `frontend/src/views/app-tree/bus-handlers.ts` | 131 |
| atBeHandleDirRecycle | `frontend/src/views/app-tree/bus-handlers.ts` | 198 |
| atTeBindSelCheckboxes | `frontend/src/views/app-tree/events.ts` | 98 |
| atTeBindRenameInput | `frontend/src/views/app-tree/events.ts` | 363 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| connectedCallback | `frontend/src/views/app-sidebar/index.ts` | 122 |
| _subscribeBus | `frontend/src/views/app-sync-manager/index.ts` | 284 |

### `sync:download:done`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| handleSyncDownloadMissing | `frontend/src/features/sync/sync.ts` | 131 |
| handleSyncDownloadMissing | `frontend/src/features/sync/sync.ts` | 134 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| pushOne | `frontend/src/views/app-sidebar/sync-flow.ts` | 135 |
| waitBusQuiet | `frontend/src/views/app-sidebar/sync-flow.ts` | 157 |

### `sync:download:missing`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| pushOne | `frontend/src/views/app-sidebar/sync-flow.ts` | 150 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| registerSync | `frontend/src/features/sync/sync.ts` | 234 |

### `sync:toggle:status`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| runBatchToggle | `frontend/src/views/app-tree/bus-handlers.ts` | 337 |
| atTeBindSelCheckboxes | `frontend/src/views/app-tree/events.ts` | 96 |
| toggleFolderBatch | `frontend/src/views/app-tree/events.ts` | 473 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| registerSync | `frontend/src/features/sync/sync.ts` | 236 |

### `toast:show`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| checkUpdateSilent | `frontend/src/features/maintenance/version-updater.ts` | 187 |
| toast | `frontend/src/utils/dom/toast.ts` | 18 |
| bindDragEvents | `frontend/src/views/app-content/site/drag.ts` | 60 |
| bindDragEvents | `frontend/src/views/app-content/site/drag.ts` | 96 |
| bindDragEvents | `frontend/src/views/app-content/site/drag.ts` | 118 |
| bindDragEvents | `frontend/src/views/app-content/site/drag.ts` | 127 |
| eeBindToolbarBtns | `frontend/src/views/app-content/site/edit.ts` | 189 |
| eeBindToolbarBtns | `frontend/src/views/app-content/site/edit.ts` | 227 |
| eeBindToolbarBtns | `frontend/src/views/app-content/site/edit.ts` | 234 |
| eeBindFetchBtn | `frontend/src/views/app-content/site/edit.ts` | 308 |
| eeBindFetchBtn | `frontend/src/views/app-content/site/edit.ts` | 315 |
| eeBindFetchBtn | `frontend/src/views/app-content/site/edit.ts` | 331 |
| cmCrBindOverlayEvents | `frontend/src/views/app-content/site/events.ts` | 170 |
| cmBbBindStarBtns | `frontend/src/views/app-content/site/events.ts` | 321 |
| show | `frontend/src/views/app-toast/index.ts` | 163 |
| show | `frontend/src/views/app-toast/index.ts` | 182 |
| show | `frontend/src/views/app-toast/index.ts` | 191 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| registerErrorDiary | `frontend/src/core/error-diary.ts` | 136 |
| connectedCallback | `frontend/src/views/app-toast/index.ts` | 95 |

### `tree:reload`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| runWebEnqueue | `frontend/src/features/community/download-queue-web.ts` | 106 |
| cmDqCleanupProgressUI | `frontend/src/features/community/download-queue.ts` | 123 |
| refreshUI | `frontend/src/features/context-menu/context-menu-shared.ts` | 18 |
| handleInstanceDrop | `frontend/src/features/dnd/pack-dnd.ts` | 165 |
| (顶层) | `frontend/src/features/import/executor.ts` | 50 |
| importWebFilesWithToast | `frontend/src/features/import/executor.ts` | 176 |
| setupRecycleActions | `frontend/src/features/maintenance/recycle-bin.ts` | 129 |
| onRecycleEmptyClick | `frontend/src/features/maintenance/recycle-bin.ts` | 199 |
| registerAndroidEvents | `frontend/src/features/platform/android-events.ts` | 54 |
| handleSyncDownloadMissing | `frontend/src/features/sync/sync.ts` | 118 |
| handleSyncToggleStatus | `frontend/src/features/sync/sync.ts` | 223 |
| runExecDelete | `frontend/src/views/app-content/diagnostics/dedup.ts` | 119 |
| applyFsaState | `frontend/src/views/app-content/settings/init.ts` | 389 |
| onWebRepoAuthClick | `frontend/src/views/app-content/settings/init.ts` | 417 |
| runPull | `frontend/src/views/app-sidebar/sync-flow.ts` | 289 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| bindBusEvents | `frontend/src/views/app-tree/bus-handlers.ts` | 56 |

### `tree:set-search`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| connectedCallback | `frontend/src/views/app-content/index.ts` | 77 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| connectedCallback | `frontend/src/views/app-tree/index.ts` | 301 |

### `ui:card-density`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| initUiPrefs | `frontend/src/views/app-content/settings/ui-prefs.ts` | 200 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| bindBusEvents | `frontend/src/views/app-tree/bus-handlers.ts` | 69 |
