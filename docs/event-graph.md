# Bus 事件契约报告

> **自动生成** — 由 `scripts/event-graph.ts` 生成。
> 基于 `frontend/src/bus.ts` 的 `BusEvents` 接口校验所有调用方（含 html 内联、可选链调用）。

## ✅ 无异常

所有调用均在 BusEvents 契约内，无孤儿发射 / 鬼订阅 / 未声明事件 / 缺参。

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
| `repo:rtype-changed` | 3 | 6 | 0 | 0 | ✅ |
| `repo:search-creator` | 2 | 1 | 0 | 0 | ✅ |
| `repo:subdir-changed` | 1 | 1 | 0 | 0 | ✅ |
| `stats:refresh` | 26 | 2 | 0 | 0 | ✅ |
| `sync:download:done` | 2 | 2 | 0 | 0 | ✅ |
| `sync:download:missing` | 1 | 1 | 0 | 0 | ✅ |
| `sync:toggle:status` | 3 | 1 | 0 | 0 | ✅ |
| `toast:show` | 172 | 2 | 0 | 0 | ✅ |
| `tree:reload` | 13 | 1 | 0 | 0 | ✅ |
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
| initWorkshopPage | `frontend/src/views/app-content/init-workshop.ts` | 190 |

### `batch:rename`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| createContextMenuHandlers | `frontend/src/features/context-menu/context-menu-handlers.ts` | 203 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| bindBusEvents | `frontend/src/views/app-tree/bus-handlers.ts` | 50 |

### `community:clear-cache`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| cmDqCleanupProgressUI | `frontend/src/features/community/download-queue.ts` | 116 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| connectedCallback | `frontend/src/views/app-content/index.ts` | 81 |

### `ctx:show`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| cmReBindContextMenu | `frontend/src/features/community/repo-events-bindings.ts` | 134 |
| showMenu | `frontend/src/features/context-menu/context-menus.setup.ts` | 152 |
| bindCardContextHandler | `frontend/src/views/app-sidebar/events.ts` | 129 |
| atTeBindContextMenu | `frontend/src/views/app-tree/events.ts` | 283 |
| atTeBindContextMenu | `frontend/src/views/app-tree/events.ts` | 307 |
| atTeBindContextMenu | `frontend/src/views/app-tree/events.ts` | 319 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| registerContextMenus | `frontend/src/features/context-menu/context-menus.ts` | 94 |

### `dir:batch-rename`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| (顶层) | `frontend/src/features/context-menu/context-menu-dir-handlers.ts` | 11 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| bindBusEvents | `frontend/src/views/app-tree/bus-handlers.ts` | 45 |

### `dir:mkdir`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| (顶层) | `frontend/src/features/context-menu/context-menu-dir-handlers.ts` | 22 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| bindBusEvents | `frontend/src/views/app-tree/bus-handlers.ts` | 35 |

### `dir:recycle`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| (顶层) | `frontend/src/features/context-menu/context-menu-dir-handlers.ts` | 23 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| bindBusEvents | `frontend/src/views/app-tree/bus-handlers.ts` | 40 |

### `dir:rename`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| (顶层) | `frontend/src/features/context-menu/context-menu-dir-handlers.ts` | 10 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| bindBusEvents | `frontend/src/views/app-tree/bus-handlers.ts` | 30 |

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
| connectedCallback | `frontend/src/views/app-content/index.ts` | 73 |
| connectedCallback | `frontend/src/views/app-nav/index.ts` | 214 |

### `menu:show`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| registerContextMenus | `frontend/src/features/context-menu/context-menus.ts` | 95 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| connectedCallback | `frontend/src/views/context-menu/index.ts` | 72 |

### `model:select`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| handleContainerClick | `frontend/src/features/maintenance/oldest-models.ts` | 56 |
| onRecycleListClick | `frontend/src/features/maintenance/recycle-bin.ts` | 199 |
| bindPreviewClicks | `frontend/src/views/app-content/diagnostics/dedup-render.ts` | 107 |
| showMorphPreview | `frontend/src/views/app-preview/detail-3d.ts` | 247 |
| showStagePreview | `frontend/src/views/app-preview/detail-3d.ts` | 334 |
| atTeClickRowFolder | `frontend/src/views/app-tree/events.ts` | 153 |
| atTeClickRowFile | `frontend/src/views/app-tree/events.ts` | 239 |
| _onKeyArrowNav | `frontend/src/views/app-tree/index.ts` | 554 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| initPerfPanel | `frontend/src/views/app-content/diagnostics/perf.ts` | 222 |
| connectedCallback | `frontend/src/views/app-preview/index.ts` | 83 |

### `nav:changed`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| connectedCallback | `frontend/src/views/app-content/index.ts` | 65 |
| _pageInitFailed | `frontend/src/views/app-content/index.ts` | 179 |
| cmBbBindEmptyLocalBtn | `frontend/src/views/app-content/site/events.ts` | 266 |
| anBindNavItems | `frontend/src/views/app-nav/index.ts` | 52 |
| connectedCallback | `frontend/src/views/app-nav/index.ts` | 224 |
| bindFooter | `frontend/src/views/app-sidebar/events.ts` | 260 |
| atTlBindRepoSwitch | `frontend/src/views/app-tree/toolbar-events.ts` | 87 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| connectedCallback | `frontend/src/views/app-content/index.ts` | 52 |
| connectedCallback | `frontend/src/views/app-nav/index.ts` | 194 |

### `package:selected`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| bindCardClickHandler | `frontend/src/views/app-sidebar/events.ts` | 83 |
| restoreSelectedCard | `frontend/src/views/app-sidebar/events.ts` | 246 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| initInstancesPage | `frontend/src/views/app-content/init-pages.ts` | 72 |

### `repo:focus-search`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| anBindNavItems | `frontend/src/views/app-nav/index.ts` | 58 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| bindBusEvents | `frontend/src/views/app-tree/bus-handlers.ts` | 61 |

### `repo:rtype-changed`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| applyFsaState | `frontend/src/views/app-content/settings/init.ts` | 388 |
| onWebRepoAuthClick | `frontend/src/views/app-content/settings/init.ts` | 415 |
| anBindDualSelects | `frontend/src/views/app-nav/index.ts` | 128 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| useCurrentResourceType | `frontend/src/features/repo/repo-rtype.ts` | 21 |
| initRepositoryPage | `frontend/src/views/app-content/init-pages.ts` | 107 |
| initDedupTab | `frontend/src/views/app-content/init-pages.ts` | 272 |
| connectedCallback | `frontend/src/views/app-nav/index.ts` | 216 |
| connectedCallback | `frontend/src/views/app-sidebar/index.ts` | 127 |
| _subscribeBus | `frontend/src/views/app-sync-manager/index.ts` | 305 |

### `repo:search-creator`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| cmCrBindOverlayEvents | `frontend/src/views/app-content/site/events.ts` | 198 |
| cmBbBindLocalBadges | `frontend/src/views/app-content/site/events.ts` | 353 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| connectedCallback | `frontend/src/views/app-content/index.ts` | 63 |

### `repo:subdir-changed`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| anBindDualSelects | `frontend/src/views/app-nav/index.ts` | 129 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| _subscribeBus | `frontend/src/views/app-sync-manager/index.ts` | 328 |

### `stats:refresh`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| runWebEnqueue | `frontend/src/features/community/download-queue-web.ts` | 107 |
| cmDqCleanupProgressUI | `frontend/src/features/community/download-queue.ts` | 123 |
| refreshUI | `frontend/src/features/context-menu/context-menu-shared.ts` | 19 |
| handleInstanceDrop | `frontend/src/features/dnd/pack-dnd.ts` | 171 |
| (顶层) | `frontend/src/features/import/executor.ts` | 56 |
| importWebFilesWithToast | `frontend/src/features/import/executor.ts` | 185 |
| setupRecycleActions | `frontend/src/features/maintenance/recycle-bin.ts` | 115 |
| onRecycleEmptyClick | `frontend/src/features/maintenance/recycle-bin.ts` | 183 |
| registerInstanceOps | `frontend/src/features/pack-ops/instance-ops.ts` | 132 |
| registerAndroidEvents | `frontend/src/features/platform/android-events.ts` | 55 |
| runDownloadMissing | `frontend/src/features/sync/sync.ts` | 75 |
| runSyncToggleStatus | `frontend/src/features/sync/sync.ts` | 185 |
| runExecDelete | `frontend/src/views/app-content/diagnostics/dedup.ts` | 111 |
| relinkAllInstancesInner | `frontend/src/views/app-content/settings/init.ts` | 218 |
| bindPathClick | `frontend/src/views/app-content/settings/path-cards.ts` | 93 |
| initMcDetect | `frontend/src/views/app-content/settings/path-cards.ts` | 357 |
| runMcSearch | `frontend/src/views/app-sidebar/launcher-detect.ts` | 93 |
| runLauncherDetect | `frontend/src/views/app-sidebar/launcher-detect.ts` | 166 |
| runPull | `frontend/src/views/app-sidebar/sync-flow.ts` | 315 |
| _bindDelegate | `frontend/src/views/app-sync-manager/index.ts` | 223 |
| _bindDelegate | `frontend/src/views/app-sync-manager/index.ts` | 242 |
| runBatchRename | `frontend/src/views/app-tree/bus-handlers.ts` | 98 |
| atBeHandleDirRename | `frontend/src/views/app-tree/bus-handlers.ts` | 125 |
| atBeHandleDirRecycle | `frontend/src/views/app-tree/bus-handlers.ts` | 194 |
| atTeBindSelCheckboxes | `frontend/src/views/app-tree/events.ts` | 105 |
| atTeBindRenameInput | `frontend/src/views/app-tree/events.ts` | 386 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| connectedCallback | `frontend/src/views/app-sidebar/index.ts` | 119 |
| _subscribeBus | `frontend/src/views/app-sync-manager/index.ts` | 285 |

### `sync:download:done`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| handleSyncDownloadMissing | `frontend/src/features/sync/sync.ts` | 119 |
| handleSyncDownloadMissing | `frontend/src/features/sync/sync.ts` | 122 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| pushOne | `frontend/src/views/app-sidebar/sync-flow.ts` | 140 |
| waitBusQuiet | `frontend/src/views/app-sidebar/sync-flow.ts` | 161 |

### `sync:download:missing`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| pushOne | `frontend/src/views/app-sidebar/sync-flow.ts` | 154 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| registerSync | `frontend/src/features/sync/sync.ts` | 222 |

### `sync:toggle:status`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| runBatchToggle | `frontend/src/views/app-tree/bus-handlers.ts` | 362 |
| atTeBindSelCheckboxes | `frontend/src/views/app-tree/events.ts` | 103 |
| toggleFolderBatch | `frontend/src/views/app-tree/events.ts` | 497 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| registerSync | `frontend/src/features/sync/sync.ts` | 224 |

### `toast:show`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| (顶层) | `frontend/src/app-modules.ts` | 29 |
| runStartupSteps | `frontend/src/app-modules.ts` | 89 |
| (顶层) | `frontend/src/app-modules.ts` | 174 |
| resolveAndroidRepoDir | `frontend/src/backend/directory-picker.ts` | 37 |
| resolveAndroidRepoDir | `frontend/src/backend/directory-picker.ts` | 48 |
| resolveAndroidRepoDir | `frontend/src/backend/directory-picker.ts` | 60 |
| runWebEnqueue | `frontend/src/features/community/download-queue-web.ts` | 96 |
| cmDqEnqueue | `frontend/src/features/community/download-queue.ts` | 312 |
| cmDqEnqueue | `frontend/src/features/community/download-queue.ts` | 336 |
| cmReBindDlSelected | `frontend/src/features/community/repo-events-bindings.ts` | 70 |
| cmReBindDlSelected | `frontend/src/features/community/repo-events-bindings.ts` | 82 |
| cmReHandleSingleDownload | `frontend/src/features/community/repo-events-bindings.ts` | 156 |
| cmReBindRowClick | `frontend/src/features/community/repo-events-bindings.ts` | 206 |
| cmReBindRowClick | `frontend/src/features/community/repo-events-bindings.ts` | 240 |
| dgBrApplyReplace | `frontend/src/features/dialogs/batch-rename-form.ts` | 51 |
| dgBrBindApplyClick | `frontend/src/features/dialogs/batch-rename-form.ts` | 266 |
| dgBrBindApplyClick | `frontend/src/features/dialogs/batch-rename-form.ts` | 280 |
| dgBrBindApplyClick | `frontend/src/features/dialogs/batch-rename-form.ts` | 299 |
| handleTreeDrop | `frontend/src/features/dnd/import-dnd.ts` | 45 |
| handleTreeDrop | `frontend/src/features/dnd/import-dnd.ts` | 63 |
| handleTreeDrop | `frontend/src/features/dnd/import-dnd.ts` | 82 |
| handleTreeDrop | `frontend/src/features/dnd/import-dnd.ts` | 92 |
| handleTreeDrop | `frontend/src/features/dnd/import-dnd.ts` | 110 |
| bindTreeDnD | `frontend/src/features/dnd/import-dnd.ts` | 215 |
| (顶层) | `frontend/src/features/dnd/pack-dnd.ts` | 42 |
| (顶层) | `frontend/src/features/import/executor.ts` | 51 |
| importWebFilesWithToast | `frontend/src/features/import/executor.ts` | 176 |
| importWebFilesWithToast | `frontend/src/features/import/executor.ts` | 189 |
| initRecycleBin | `frontend/src/features/maintenance/recycle-bin.ts` | 298 |
| promptUpdate | `frontend/src/features/maintenance/version-updater.ts` | 156 |
| promptUpdate | `frontend/src/features/maintenance/version-updater.ts` | 165 |
| checkUpdateSilent | `frontend/src/features/maintenance/version-updater.ts` | 191 |
| checkUpdateSilent | `frontend/src/features/maintenance/version-updater.ts` | 200 |
| initVersionUpdater | `frontend/src/features/maintenance/version-updater.ts` | 221 |
| initVersionUpdater | `frontend/src/features/maintenance/version-updater.ts` | 256 |
| initVersionUpdater | `frontend/src/features/maintenance/version-updater.ts` | 266 |
| mountRootMenu | `frontend/src/preview-3d/adapters/mount-preview-core.ts` | 691 |
| beginSwitch | `frontend/src/preview-3d/adapters/switch-preview.ts` | 169 |
| guardGpuBudget | `frontend/src/preview-3d/infra/gpu-budget.ts` | 54 |
| warnLargeModelIfNeeded | `frontend/src/preview-3d/infra/large-model.ts` | 65 |
| showLoadFailure | `frontend/src/preview-3d/infra/preview-loading.ts` | 44 |
| toast | `frontend/src/utils/dom/toast.ts` | 18 |
| copyWithToast | `frontend/src/views/app-content/diagnostics/copy-toast.ts` | 26 |
| dgInBindRefreshClear | `frontend/src/views/app-content/diagnostics/init.ts` | 28 |
| dgInBindRefreshClear | `frontend/src/views/app-content/diagnostics/init.ts` | 39 |
| dgInBindRefreshClear | `frontend/src/views/app-content/diagnostics/init.ts` | 45 |
| dgInCopyActiveLog | `frontend/src/views/app-content/diagnostics/init.ts` | 99 |
| webGate | `frontend/src/views/app-content/diagnostics/web-gate.ts` | 29 |
| _pageInitFailed | `frontend/src/views/app-content/index.ts` | 170 |
| bindTabs | `frontend/src/views/app-content/init-pages.ts` | 203 |
| initSettingsPage | `frontend/src/views/app-content/init-pages.ts` | 307 |
| initDefaultPagePrefs | `frontend/src/views/app-content/settings/default-page.ts` | 59 |
| initDefaultPagePrefs | `frontend/src/views/app-content/settings/default-page.ts` | 70 |
| onMirrorChange | `frontend/src/views/app-content/settings/init.ts` | 82 |
| stgBindUpdateInterval | `frontend/src/views/app-content/settings/init.ts` | 123 |
| emitRelinkToast | `frontend/src/views/app-content/settings/init.ts` | 160 |
| emitRelinkToast | `frontend/src/views/app-content/settings/init.ts` | 167 |
| relinkAllInstancesInner | `frontend/src/views/app-content/settings/init.ts` | 190 |
| relinkAllInstancesInner | `frontend/src/views/app-content/settings/init.ts` | 211 |
| relinkAllInstances | `frontend/src/views/app-content/settings/init.ts` | 235 |
| stgBindLinkMode | `frontend/src/views/app-content/settings/init.ts` | 317 |
| tdRenderKeymap | `frontend/src/views/app-content/settings/keymap.ts` | 152 |
| tdRenderKeymap | `frontend/src/views/app-content/settings/keymap.ts` | 166 |
| initKeymap | `frontend/src/views/app-content/settings/keymap.ts` | 185 |
| bindPathClick | `frontend/src/views/app-content/settings/path-cards.ts` | 94 |
| initAdvancedGrid | `frontend/src/views/app-content/settings/path-cards.ts` | 275 |
| initAdvancedGrid | `frontend/src/views/app-content/settings/path-cards.ts` | 281 |
| initAdvancedGrid | `frontend/src/views/app-content/settings/path-cards.ts` | 303 |
| initAdvancedGrid | `frontend/src/views/app-content/settings/path-cards.ts` | 309 |
| initMcDetect | `frontend/src/views/app-content/settings/path-cards.ts` | 331 |
| initMcDetect | `frontend/src/views/app-content/settings/path-cards.ts` | 358 |
| initUiPrefs | `frontend/src/views/app-content/settings/ui-prefs.ts` | 159 |
| initUiPrefs | `frontend/src/views/app-content/settings/ui-prefs.ts` | 170 |
| initUiPrefs | `frontend/src/views/app-content/settings/ui-prefs.ts` | 185 |
| initUiPrefs | `frontend/src/views/app-content/settings/ui-prefs.ts` | 197 |
| initWorkerPrefs | `frontend/src/views/app-content/settings/worker-prefs.ts` | 44 |
| bindDragEvents | `frontend/src/views/app-content/site/drag.ts` | 60 |
| bindDragEvents | `frontend/src/views/app-content/site/drag.ts` | 96 |
| bindDragEvents | `frontend/src/views/app-content/site/drag.ts` | 118 |
| bindDragEvents | `frontend/src/views/app-content/site/drag.ts` | 127 |
| eeBindToolbarBtns | `frontend/src/views/app-content/site/edit.ts` | 180 |
| eeBindToolbarBtns | `frontend/src/views/app-content/site/edit.ts` | 218 |
| eeBindToolbarBtns | `frontend/src/views/app-content/site/edit.ts` | 225 |
| eeBindFetchBtn | `frontend/src/views/app-content/site/edit.ts` | 299 |
| eeBindFetchBtn | `frontend/src/views/app-content/site/edit.ts` | 306 |
| eeBindFetchBtn | `frontend/src/views/app-content/site/edit.ts` | 322 |
| cmCrBindOverlayEvents | `frontend/src/views/app-content/site/events.ts` | 169 |
| cmBbBindStarBtns | `frontend/src/views/app-content/site/events.ts` | 320 |
| bindSiteEvents | `frontend/src/views/app-content/site/workshop-site-opener.ts` | 129 |
| bindSiteEvents | `frontend/src/views/app-content/site/workshop-site-opener.ts` | 139 |
| bindSiteEvents | `frontend/src/views/app-content/site/workshop-site-opener.ts` | 145 |
| bindSiteEvents | `frontend/src/views/app-content/site/workshop-site-opener.ts` | 156 |
| bindSiteEvents | `frontend/src/views/app-content/site/workshop-site-opener.ts` | 167 |
| bindSiteEvents | `frontend/src/views/app-content/site/workshop-site-opener.ts` | 173 |
| initWorkshopTabs | `frontend/src/views/app-content/site/workshop-tabs.ts` | 104 |
| initWorkshopTabs | `frontend/src/views/app-content/site/workshop-tabs.ts` | 169 |
| anBindViewerFab | `frontend/src/views/app-nav/index.ts` | 150 |
| openModel3DFullscreen | `frontend/src/views/app-preview/preview-library.ts` | 110 |
| openModel3DFullscreen | `frontend/src/views/app-preview/preview-library.ts` | 149 |
| openModel3DFullscreen | `frontend/src/views/app-preview/preview-library.ts` | 200 |
| routeModelPreview | `frontend/src/views/app-preview/preview-router.ts` | 42 |
| routeModelPreview | `frontend/src/views/app-preview/preview-router.ts` | 67 |
| makeShotAction | `frontend/src/views/app-preview/shot-panel-shared.ts` | 49 |
| bindCardContextHandler | `frontend/src/views/app-sidebar/events.ts` | 122 |
| (顶层) | `frontend/src/views/app-sidebar/launcher-detect.ts` | 42 |
| runMcSearch | `frontend/src/views/app-sidebar/launcher-detect.ts` | 75 |
| runMcSearch | `frontend/src/views/app-sidebar/launcher-detect.ts` | 94 |
| runLauncherDetect | `frontend/src/views/app-sidebar/launcher-detect.ts` | 145 |
| runLauncherDetect | `frontend/src/views/app-sidebar/launcher-detect.ts` | 167 |
| doLoadInstances | `frontend/src/views/app-sidebar/loader.ts` | 157 |
| beginSync | `frontend/src/views/app-sidebar/sync-flow.ts` | 120 |
| runPush | `frontend/src/views/app-sidebar/sync-flow.ts` | 254 |
| runPush | `frontend/src/views/app-sidebar/sync-flow.ts` | 260 |
| runPush | `frontend/src/views/app-sidebar/sync-flow.ts` | 266 |
| runPull | `frontend/src/views/app-sidebar/sync-flow.ts` | 298 |
| runPull | `frontend/src/views/app-sidebar/sync-flow.ts` | 304 |
| runPull | `frontend/src/views/app-sidebar/sync-flow.ts` | 309 |
| runPull | `frontend/src/views/app-sidebar/sync-flow.ts` | 318 |
| _showError | `frontend/src/views/app-sync-manager/index.ts` | 267 |
| performSingleOp | `frontend/src/views/app-sync-manager/network.ts` | 52 |
| performSingleOp | `frontend/src/views/app-sync-manager/network.ts` | 60 |
| loadData | `frontend/src/views/app-sync-manager/store.ts` | 77 |
| show | `frontend/src/views/app-toast/index.ts` | 163 |
| show | `frontend/src/views/app-toast/index.ts` | 182 |
| show | `frontend/src/views/app-toast/index.ts` | 191 |
| runBatchRename | `frontend/src/views/app-tree/bus-handlers.ts` | 99 |
| atBeHandleDirRename | `frontend/src/views/app-tree/bus-handlers.ts` | 127 |
| atBeHandleDirMkdir | `frontend/src/views/app-tree/bus-handlers.ts` | 152 |
| atBeHandleDirRecycle | `frontend/src/views/app-tree/bus-handlers.ts` | 198 |
| atBeHandleDirRecycle | `frontend/src/views/app-tree/bus-handlers.ts` | 204 |
| atBeHandleDirBatchRename | `frontend/src/views/app-tree/bus-handlers.ts` | 221 |
| atBeHandleDirBatchRename | `frontend/src/views/app-tree/bus-handlers.ts` | 235 |
| atBeHandleBatchRename | `frontend/src/views/app-tree/bus-handlers.ts` | 257 |
| reload | `frontend/src/views/app-tree/bus-handlers.ts` | 296 |
| runBatchToggle | `frontend/src/views/app-tree/bus-handlers.ts` | 312 |
| runBatchToggle | `frontend/src/views/app-tree/bus-handlers.ts` | 320 |
| runBatchToggle | `frontend/src/views/app-tree/bus-handlers.ts` | 365 |
| runBatchToggle | `frontend/src/views/app-tree/bus-handlers.ts` | 371 |
| atTeBindSelCheckboxes | `frontend/src/views/app-tree/events.ts` | 76 |
| atTeBindSelCheckboxes | `frontend/src/views/app-tree/events.ts` | 84 |
| atTeBindSelCheckboxes | `frontend/src/views/app-tree/events.ts` | 109 |
| atTeOpenAuthor | `frontend/src/views/app-tree/events.ts` | 136 |
| atTeClickRowPreview | `frontend/src/views/app-tree/events.ts` | 169 |
| atTeClickRowCopy | `frontend/src/views/app-tree/events.ts` | 185 |
| atTeClickRowCopy | `frontend/src/views/app-tree/events.ts` | 192 |
| atTeBindRenameInput | `frontend/src/views/app-tree/events.ts` | 389 |
| toggleFolderBatch | `frontend/src/views/app-tree/events.ts` | 435 |
| toggleFolderBatch | `frontend/src/views/app-tree/events.ts` | 443 |
| toggleFolderBatch | `frontend/src/views/app-tree/events.ts` | 500 |
| toggleFolderBatch | `frontend/src/views/app-tree/events.ts` | 510 |
| toastThrottled | `frontend/src/views/app-tree/index.ts` | 69 |
| _attrChangeReloadAsync | `frontend/src/views/app-tree/index.ts` | 322 |
| _onKeyDelete | `frontend/src/views/app-tree/index.ts` | 477 |
| _onKeyDelete | `frontend/src/views/app-tree/index.ts` | 485 |
| _deleteSelected | `frontend/src/views/app-tree/index.ts` | 607 |
| _deleteSelected | `frontend/src/views/app-tree/index.ts` | 614 |
| toastLoadError | `frontend/src/views/app-tree/loader.ts` | 32 |
| maybePromptAndroidStorage | `frontend/src/views/app-tree/loader.ts` | 56 |
| runImport | `frontend/src/views/app-tree/toolbar-commands.ts` | 60 |
| runImport | `frontend/src/views/app-tree/toolbar-commands.ts` | 71 |
| runImport | `frontend/src/views/app-tree/toolbar-commands.ts` | 169 |
| runImport | `frontend/src/views/app-tree/toolbar-commands.ts` | 187 |
| runToolbarCommand | `frontend/src/views/app-tree/toolbar-commands.ts` | 210 |
| atTlBindAdvFilter | `frontend/src/views/app-tree/toolbar-events.ts` | 137 |
| advFilterFetchTagPaths | `frontend/src/views/app-tree/toolbar-search.ts` | 182 |
| advFilterSearchModelPaths | `frontend/src/views/app-tree/toolbar-search.ts` | 201 |
| advFilterSearchModelPaths | `frontend/src/views/app-tree/toolbar-search.ts` | 231 |
| advFilterWarnWebDegraded | `frontend/src/views/app-tree/toolbar-search.ts` | 247 |
| advFilterToastAndRender | `frontend/src/views/app-tree/toolbar-search.ts` | 276 |
| advFilterToastAndRender | `frontend/src/views/app-tree/toolbar-search.ts` | 282 |
| pickWebFilesAndImport | `frontend/src/views/app-tree/toolbar-search.ts` | 349 |
| pickWebFilesAndImport | `frontend/src/views/app-tree/toolbar-search.ts` | 358 |

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
| cmDqCleanupProgressUI | `frontend/src/features/community/download-queue.ts` | 122 |
| refreshUI | `frontend/src/features/context-menu/context-menu-shared.ts` | 18 |
| handleInstanceDrop | `frontend/src/features/dnd/pack-dnd.ts` | 172 |
| (顶层) | `frontend/src/features/import/executor.ts` | 57 |
| importWebFilesWithToast | `frontend/src/features/import/executor.ts` | 184 |
| setupRecycleActions | `frontend/src/features/maintenance/recycle-bin.ts` | 116 |
| onRecycleEmptyClick | `frontend/src/features/maintenance/recycle-bin.ts` | 184 |
| registerAndroidEvents | `frontend/src/features/platform/android-events.ts` | 54 |
| handleSyncDownloadMissing | `frontend/src/features/sync/sync.ts` | 106 |
| handleSyncToggleStatus | `frontend/src/features/sync/sync.ts` | 211 |
| runExecDelete | `frontend/src/views/app-content/diagnostics/dedup.ts` | 112 |
| runPull | `frontend/src/views/app-sidebar/sync-flow.ts` | 316 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| bindBusEvents | `frontend/src/views/app-tree/bus-handlers.ts` | 55 |

### `tree:set-search`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| connectedCallback | `frontend/src/views/app-content/index.ts` | 67 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| connectedCallback | `frontend/src/views/app-tree/index.ts` | 249 |

### `ui:card-density`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| initUiPrefs | `frontend/src/views/app-content/settings/ui-prefs.ts` | 184 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| bindBusEvents | `frontend/src/views/app-tree/bus-handlers.ts` | 68 |
