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
| `community:clear-cache` | 2 | 1 | 0 | 0 | ✅ |
| `config:changed` | 1 | 1 | 0 | 0 | ✅ |
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
| `repo:rtype-changed` | 1 | 5 | 0 | 0 | ✅ |
| `repo:search-creator` | 2 | 1 | 0 | 0 | ✅ |
| `repo:subdir-changed` | 1 | 1 | 0 | 0 | ✅ |
| `stats:refresh` | 26 | 2 | 0 | 0 | ✅ |
| `sync:download:done` | 2 | 2 | 0 | 0 | ✅ |
| `sync:download:missing` | 1 | 1 | 0 | 0 | ✅ |
| `sync:toggle:status` | 4 | 1 | 0 | 0 | ✅ |
| `toast:show` | 17 | 2 | 0 | 0 | ✅ |
| `tree:reload` | 15 | 1 | 0 | 0 | ✅ |
| `tree:set-search` | 1 | 1 | 0 | 0 | ✅ |
| `ui:card-density` | 1 | 1 | 0 | 0 | ✅ |

## 调用详情

### `avatar:refresh`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| cancelDownloads | `frontend/src/features/community/download-queue-store.ts` | 366 |

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
| reload | `frontend/src/views/app-tree/bus-handlers.ts` | 250 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| connectedCallback | `frontend/src/views/app-content/index.ts` | 91 |

### `config:changed`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| writeAppConfig | `frontend/src/views/config-write.ts` | 99 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| bindMcPathLabel | `frontend/src/views/app-sidebar/events.ts` | 363 |

### `ctx:show`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| cmReBindContextMenu | `frontend/src/features/community/repo-events-bindings.ts` | 126 |
| showMenu | `frontend/src/features/context-menu/context-menus.setup.ts` | 164 |
| bindCardContextHandler | `frontend/src/views/app-sidebar/events.ts` | 154 |
| atTeBindContextMenu | `frontend/src/views/app-tree/events.ts` | 288 |
| atTeBindContextMenu | `frontend/src/views/app-tree/events.ts` | 310 |
| atTeBindContextMenu | `frontend/src/views/app-tree/events.ts` | 322 |

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
| registerInstanceOps | `frontend/src/features/pack-ops/instance-ops.ts` | 93 |

### `instance:export-list`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| runBatchFileOp | `frontend/src/features/context-menu/context-menu-handlers.ts` | 184 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| registerInstanceOps | `frontend/src/features/pack-ops/instance-ops.ts` | 18 |

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
| connectedCallback | `frontend/src/views/context-menu/index.ts` | 71 |

### `model:select`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| handleContainerClick | `frontend/src/features/maintenance/oldest-models.ts` | 60 |
| onRecycleListClick | `frontend/src/features/maintenance/recycle-bin.ts` | 216 |
| bindPreviewClicks | `frontend/src/views/app-content/diagnostics/dedup-render.ts` | 107 |
| showMorphPreview | `frontend/src/views/app-preview/detail-3d.ts` | 298 |
| showStagePreview | `frontend/src/views/app-preview/detail-3d.ts` | 386 |
| atTeClickRowFolder | `frontend/src/views/app-tree/events.ts` | 170 |
| atTeClickRowFile | `frontend/src/views/app-tree/events.ts` | 244 |
| _onKeyArrowNav | `frontend/src/views/app-tree/index.ts` | 704 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| initPerfPanel | `frontend/src/views/app-content/diagnostics/perf.ts` | 194 |
| connectedCallback | `frontend/src/views/app-preview/index.ts` | 72 |

### `nav:changed`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| connectedCallback | `frontend/src/views/app-content/index.ts` | 71 |
| _pageInitFailed | `frontend/src/views/app-content/index.ts` | 193 |
| cmBbBindEmptyLocalBtn | `frontend/src/views/app-content/site/events.ts` | 231 |
| anActivateNavPage | `frontend/src/views/app-nav/index.ts` | 51 |
| connectedCallback | `frontend/src/views/app-nav/index.ts` | 219 |
| bindMcPathLabel | `frontend/src/views/app-sidebar/events.ts` | 360 |
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
| bindCardClickHandler | `frontend/src/views/app-sidebar/events.ts` | 106 |
| restoreSelectedCard | `frontend/src/views/app-sidebar/events.ts` | 289 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| initInstancesPage | `frontend/src/views/app-content/init-pages.ts` | 72 |

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
| initRepositoryPage | `frontend/src/views/app-content/init-pages.ts` | 129 |
| connectedCallback | `frontend/src/views/app-nav/index.ts` | 211 |
| connectedCallback | `frontend/src/views/app-sidebar/index.ts` | 120 |
| _subscribeBus | `frontend/src/views/app-sync-manager/index.ts` | 301 |

### `repo:search-creator`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| cmCrBindOverlayEvents | `frontend/src/views/app-content/site/events.ts` | 160 |
| cmBbBindLocalBadges | `frontend/src/views/app-content/site/events.ts` | 349 |

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
| _subscribeBus | `frontend/src/views/app-sync-manager/index.ts` | 323 |

### `stats:refresh`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| runWebEnqueue | `frontend/src/features/community/download-queue-web.ts` | 115 |
| cmDqCleanupProgressUI | `frontend/src/features/community/download-queue.ts` | 124 |
| refreshUI | `frontend/src/features/context-menu/context-menu-shared.ts` | 19 |
| handleInstanceDrop | `frontend/src/features/dnd/pack-dnd.ts` | 182 |
| (顶层) | `frontend/src/features/import/executor.ts` | 49 |
| importWebFilesWithToast | `frontend/src/features/import/executor.ts` | 177 |
| setupRecycleActions | `frontend/src/features/maintenance/recycle-bin.ts` | 130 |
| onRecycleEmptyClick | `frontend/src/features/maintenance/recycle-bin.ts` | 200 |
| registerInstanceOps | `frontend/src/features/pack-ops/instance-ops.ts` | 135 |
| registerAndroidEvents | `frontend/src/features/platform/android-events.ts` | 55 |
| runDownloadMissing | `frontend/src/features/sync/sync.ts` | 102 |
| runSyncToggleStatus | `frontend/src/features/sync/sync.ts` | 183 |
| runExecDelete | `frontend/src/views/app-content/diagnostics/dedup.ts` | 188 |
| relinkAllInstancesInner | `frontend/src/views/app-content/settings/init.ts` | 230 |
| bindPathClick | `frontend/src/views/app-content/settings/path-cards.ts` | 93 |
| initMcDetect | `frontend/src/views/app-content/settings/path-cards.ts` | 311 |
| runMcSearch | `frontend/src/views/app-sidebar/launcher-detect.ts` | 76 |
| runLauncherDetect | `frontend/src/views/app-sidebar/launcher-detect.ts` | 141 |
| runPull | `frontend/src/views/app-sidebar/sync-flow.ts` | 364 |
| _bindDelegate | `frontend/src/views/app-sync-manager/index.ts` | 229 |
| runBatchRename | `frontend/src/views/app-tree/bus-handlers.ts` | 94 |
| atBeHandleDirRename | `frontend/src/views/app-tree/bus-handlers.ts` | 121 |
| atBeHandleDirRecycle | `frontend/src/views/app-tree/bus-handlers.ts` | 182 |
| atTeBindSelCheckboxes | `frontend/src/views/app-tree/events.ts` | 115 |
| atTeBindRenameInput | `frontend/src/views/app-tree/events.ts` | 387 |
| _executeTreeMove | `frontend/src/views/app-tree/index.ts` | 771 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| connectedCallback | `frontend/src/views/app-sidebar/index.ts` | 111 |
| _subscribeBus | `frontend/src/views/app-sync-manager/index.ts` | 282 |

### `sync:download:done`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| handleSyncDownloadMissing | `frontend/src/features/sync/sync.ts` | 146 |
| handleSyncDownloadMissing | `frontend/src/features/sync/sync.ts` | 149 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| pushOne | `frontend/src/views/app-sidebar/sync-flow.ts` | 185 |
| waitBusQuiet | `frontend/src/views/app-sidebar/sync-flow.ts` | 236 |

### `sync:download:missing`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| pushOne | `frontend/src/views/app-sidebar/sync-flow.ts` | 210 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| registerSync | `frontend/src/features/sync/sync.ts` | 223 |

### `sync:toggle:status`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| runBatchToggle | `frontend/src/views/app-tree/bus-handlers.ts` | 306 |
| atTeBindSelCheckboxes | `frontend/src/views/app-tree/events.ts` | 114 |
| toggleFolderBatch | `frontend/src/views/app-tree/events.ts` | 490 |
| _executeTreeMove | `frontend/src/views/app-tree/index.ts` | 770 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| registerSync | `frontend/src/features/sync/sync.ts` | 225 |

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
| eeBindFetchBtn | `frontend/src/views/app-content/site/edit.ts` | 304 |
| eeBindFetchBtn | `frontend/src/views/app-content/site/edit.ts` | 311 |
| eeBindFetchBtn | `frontend/src/views/app-content/site/edit.ts` | 322 |
| cmCrBindOverlayEvents | `frontend/src/views/app-content/site/events.ts` | 131 |
| cmBbBindStarBtns | `frontend/src/views/app-content/site/events.ts` | 285 |
| show | `frontend/src/views/app-toast/index.ts` | 130 |
| show | `frontend/src/views/app-toast/index.ts` | 149 |
| show | `frontend/src/views/app-toast/index.ts` | 158 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| registerErrorDiary | `frontend/src/core/error-diary.ts` | 136 |
| connectedCallback | `frontend/src/views/app-toast/index.ts` | 62 |

### `tree:reload`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| runWebEnqueue | `frontend/src/features/community/download-queue-web.ts` | 114 |
| cmDqCleanupProgressUI | `frontend/src/features/community/download-queue.ts` | 123 |
| refreshUI | `frontend/src/features/context-menu/context-menu-shared.ts` | 18 |
| handleInstanceDrop | `frontend/src/features/dnd/pack-dnd.ts` | 183 |
| (顶层) | `frontend/src/features/import/executor.ts` | 50 |
| importWebFilesWithToast | `frontend/src/features/import/executor.ts` | 176 |
| setupRecycleActions | `frontend/src/features/maintenance/recycle-bin.ts` | 131 |
| onRecycleEmptyClick | `frontend/src/features/maintenance/recycle-bin.ts` | 201 |
| registerAndroidEvents | `frontend/src/features/platform/android-events.ts` | 54 |
| handleSyncDownloadMissing | `frontend/src/features/sync/sync.ts` | 133 |
| handleSyncToggleStatus | `frontend/src/features/sync/sync.ts` | 212 |
| runExecDelete | `frontend/src/views/app-content/diagnostics/dedup.ts` | 189 |
| applyFsaState | `frontend/src/views/app-content/settings/init.ts` | 389 |
| onWebRepoAuthClick | `frontend/src/views/app-content/settings/init.ts` | 417 |
| runPull | `frontend/src/views/app-sidebar/sync-flow.ts` | 365 |

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
| connectedCallback | `frontend/src/views/app-tree/index.ts` | 338 |

### `ui:card-density`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| initUiPrefs | `frontend/src/views/app-content/settings/ui-prefs.ts` | 200 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| bindBusEvents | `frontend/src/views/app-tree/bus-handlers.ts` | 69 |
