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
| `repo:rtype-changed` | 1 | 6 | 0 | 0 | ✅ |
| `repo:search-creator` | 2 | 1 | 0 | 0 | ✅ |
| `repo:subdir-changed` | 1 | 1 | 0 | 0 | ✅ |
| `stats:refresh` | 26 | 2 | 0 | 0 | ✅ |
| `sync:download:done` | 2 | 2 | 0 | 0 | ✅ |
| `sync:download:missing` | 1 | 1 | 0 | 0 | ✅ |
| `sync:toggle:status` | 3 | 1 | 0 | 0 | ✅ |
| `toast:show` | 172 | 2 | 0 | 0 | ✅ |
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
| connectedCallback | `frontend/src/views/app-content/index.ts` | 86 |

### `ctx:show`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| cmReBindContextMenu | `frontend/src/features/community/repo-events-bindings.ts` | 134 |
| showMenu | `frontend/src/features/context-menu/context-menus.setup.ts` | 152 |
| bindCardContextHandler | `frontend/src/views/app-sidebar/events.ts` | 139 |
| atTeBindContextMenu | `frontend/src/views/app-tree/events.ts` | 283 |
| atTeBindContextMenu | `frontend/src/views/app-tree/events.ts` | 309 |
| atTeBindContextMenu | `frontend/src/views/app-tree/events.ts` | 321 |

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
| connectedCallback | `frontend/src/views/app-content/index.ts` | 78 |
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
| _onKeyArrowNav | `frontend/src/views/app-tree/index.ts` | 671 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| initPerfPanel | `frontend/src/views/app-content/diagnostics/perf.ts` | 222 |
| connectedCallback | `frontend/src/views/app-preview/index.ts` | 88 |

### `nav:changed`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| connectedCallback | `frontend/src/views/app-content/index.ts` | 66 |
| _pageInitFailed | `frontend/src/views/app-content/index.ts` | 191 |
| cmBbBindEmptyLocalBtn | `frontend/src/views/app-content/site/events.ts` | 266 |
| anBindNavItems | `frontend/src/views/app-nav/index.ts` | 52 |
| connectedCallback | `frontend/src/views/app-nav/index.ts` | 224 |
| bindFooter | `frontend/src/views/app-sidebar/events.ts` | 275 |
| atTlBindRepoSwitch | `frontend/src/views/app-tree/toolbar-events.ts` | 87 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| connectedCallback | `frontend/src/views/app-content/index.ts` | 53 |
| connectedCallback | `frontend/src/views/app-nav/index.ts` | 194 |

### `package:selected`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| bindCardClickHandler | `frontend/src/views/app-sidebar/events.ts` | 91 |
| restoreSelectedCard | `frontend/src/views/app-sidebar/events.ts` | 261 |

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
| anBindDualSelects | `frontend/src/views/app-nav/index.ts` | 128 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| useCurrentResourceType | `frontend/src/features/repo/repo-rtype.ts` | 21 |
| initRepositoryPage | `frontend/src/views/app-content/init-pages.ts` | 120 |
| initDedupTab | `frontend/src/views/app-content/init-pages.ts` | 303 |
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
| connectedCallback | `frontend/src/views/app-content/index.ts` | 64 |

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
| runDownloadMissing | `frontend/src/features/sync/sync.ts` | 87 |
| runSyncToggleStatus | `frontend/src/features/sync/sync.ts` | 197 |
| runExecDelete | `frontend/src/views/app-content/diagnostics/dedup.ts` | 115 |
| relinkAllInstancesInner | `frontend/src/views/app-content/settings/init.ts` | 244 |
| bindPathClick | `frontend/src/views/app-content/settings/path-cards.ts` | 91 |
| initMcDetect | `frontend/src/views/app-content/settings/path-cards.ts` | 350 |
| runMcSearch | `frontend/src/views/app-sidebar/launcher-detect.ts` | 83 |
| runLauncherDetect | `frontend/src/views/app-sidebar/launcher-detect.ts` | 156 |
| runPull | `frontend/src/views/app-sidebar/sync-flow.ts` | 313 |
| _bindDelegate | `frontend/src/views/app-sync-manager/index.ts` | 223 |
| _bindDelegate | `frontend/src/views/app-sync-manager/index.ts` | 242 |
| runBatchRename | `frontend/src/views/app-tree/bus-handlers.ts` | 103 |
| atBeHandleDirRename | `frontend/src/views/app-tree/bus-handlers.ts` | 130 |
| atBeHandleDirRecycle | `frontend/src/views/app-tree/bus-handlers.ts` | 204 |
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
| handleSyncDownloadMissing | `frontend/src/features/sync/sync.ts` | 131 |
| handleSyncDownloadMissing | `frontend/src/features/sync/sync.ts` | 134 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| pushOne | `frontend/src/views/app-sidebar/sync-flow.ts` | 138 |
| waitBusQuiet | `frontend/src/views/app-sidebar/sync-flow.ts` | 160 |

### `sync:download:missing`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| pushOne | `frontend/src/views/app-sidebar/sync-flow.ts` | 153 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| registerSync | `frontend/src/features/sync/sync.ts` | 234 |

### `sync:toggle:status`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| runBatchToggle | `frontend/src/views/app-tree/bus-handlers.ts` | 375 |
| atTeBindSelCheckboxes | `frontend/src/views/app-tree/events.ts` | 103 |
| toggleFolderBatch | `frontend/src/views/app-tree/events.ts` | 508 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| registerSync | `frontend/src/features/sync/sync.ts` | 236 |

### `toast:show`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| (顶层) | `frontend/src/app-modules.ts` | 30 |
| runStartupSteps | `frontend/src/app-modules.ts` | 90 |
| (顶层) | `frontend/src/app-modules.ts` | 175 |
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
| bindTreeDnD | `frontend/src/features/dnd/import-dnd.ts` | 221 |
| (顶层) | `frontend/src/features/dnd/pack-dnd.ts` | 42 |
| (顶层) | `frontend/src/features/import/executor.ts` | 51 |
| importWebFilesWithToast | `frontend/src/features/import/executor.ts` | 176 |
| importWebFilesWithToast | `frontend/src/features/import/executor.ts` | 189 |
| initRecycleBin | `frontend/src/features/maintenance/recycle-bin.ts` | 298 |
| promptUpdate | `frontend/src/features/maintenance/version-updater.ts` | 159 |
| promptUpdate | `frontend/src/features/maintenance/version-updater.ts` | 168 |
| checkUpdateSilent | `frontend/src/features/maintenance/version-updater.ts` | 194 |
| checkUpdateSilent | `frontend/src/features/maintenance/version-updater.ts` | 203 |
| initVersionUpdater | `frontend/src/features/maintenance/version-updater.ts` | 224 |
| initVersionUpdater | `frontend/src/features/maintenance/version-updater.ts` | 259 |
| initVersionUpdater | `frontend/src/features/maintenance/version-updater.ts` | 269 |
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
| dgInCopyActiveLog | `frontend/src/views/app-content/diagnostics/init.ts` | 100 |
| webGate | `frontend/src/views/app-content/diagnostics/web-gate.ts` | 29 |
| _pageInitFailed | `frontend/src/views/app-content/index.ts` | 181 |
| bindTabs | `frontend/src/views/app-content/init-pages.ts` | 229 |
| initSettingsPage | `frontend/src/views/app-content/init-pages.ts` | 345 |
| initDefaultPagePrefs | `frontend/src/views/app-content/settings/default-page.ts` | 59 |
| initDefaultPagePrefs | `frontend/src/views/app-content/settings/default-page.ts` | 70 |
| onMirrorChange | `frontend/src/views/app-content/settings/init.ts` | 102 |
| stgBindUpdateInterval | `frontend/src/views/app-content/settings/init.ts` | 147 |
| emitRelinkToast | `frontend/src/views/app-content/settings/init.ts` | 185 |
| emitRelinkToast | `frontend/src/views/app-content/settings/init.ts` | 193 |
| relinkAllInstancesInner | `frontend/src/views/app-content/settings/init.ts` | 216 |
| relinkAllInstancesInner | `frontend/src/views/app-content/settings/init.ts` | 237 |
| relinkAllInstances | `frontend/src/views/app-content/settings/init.ts` | 261 |
| stgBindLinkMode | `frontend/src/views/app-content/settings/init.ts` | 343 |
| tdRenderKeymap | `frontend/src/views/app-content/settings/keymap.ts` | 152 |
| tdRenderKeymap | `frontend/src/views/app-content/settings/keymap.ts` | 166 |
| initKeymap | `frontend/src/views/app-content/settings/keymap.ts` | 185 |
| bindPathClick | `frontend/src/views/app-content/settings/path-cards.ts` | 92 |
| initAdvancedGrid | `frontend/src/views/app-content/settings/path-cards.ts` | 273 |
| initAdvancedGrid | `frontend/src/views/app-content/settings/path-cards.ts` | 279 |
| initAdvancedGrid | `frontend/src/views/app-content/settings/path-cards.ts` | 302 |
| initAdvancedGrid | `frontend/src/views/app-content/settings/path-cards.ts` | 308 |
| initMcDetect | `frontend/src/views/app-content/settings/path-cards.ts` | 331 |
| initMcDetect | `frontend/src/views/app-content/settings/path-cards.ts` | 351 |
| initUiPrefs | `frontend/src/views/app-content/settings/ui-prefs.ts` | 174 |
| initUiPrefs | `frontend/src/views/app-content/settings/ui-prefs.ts` | 185 |
| initUiPrefs | `frontend/src/views/app-content/settings/ui-prefs.ts` | 205 |
| initUiPrefs | `frontend/src/views/app-content/settings/ui-prefs.ts` | 217 |
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
| bindCardContextHandler | `frontend/src/views/app-sidebar/events.ts` | 132 |
| (顶层) | `frontend/src/views/app-sidebar/launcher-detect.ts` | 42 |
| runMcSearch | `frontend/src/views/app-sidebar/launcher-detect.ts` | 65 |
| runMcSearch | `frontend/src/views/app-sidebar/launcher-detect.ts` | 84 |
| runLauncherDetect | `frontend/src/views/app-sidebar/launcher-detect.ts` | 135 |
| runLauncherDetect | `frontend/src/views/app-sidebar/launcher-detect.ts` | 157 |
| doLoadInstances | `frontend/src/views/app-sidebar/loader.ts` | 147 |
| beginSync | `frontend/src/views/app-sidebar/sync-flow.ts` | 118 |
| runPush | `frontend/src/views/app-sidebar/sync-flow.ts` | 252 |
| runPush | `frontend/src/views/app-sidebar/sync-flow.ts` | 258 |
| runPush | `frontend/src/views/app-sidebar/sync-flow.ts` | 264 |
| runPull | `frontend/src/views/app-sidebar/sync-flow.ts` | 296 |
| runPull | `frontend/src/views/app-sidebar/sync-flow.ts` | 302 |
| runPull | `frontend/src/views/app-sidebar/sync-flow.ts` | 307 |
| runPull | `frontend/src/views/app-sidebar/sync-flow.ts` | 316 |
| _showError | `frontend/src/views/app-sync-manager/index.ts` | 267 |
| performSingleOp | `frontend/src/views/app-sync-manager/network.ts` | 52 |
| performSingleOp | `frontend/src/views/app-sync-manager/network.ts` | 60 |
| loadData | `frontend/src/views/app-sync-manager/store.ts` | 77 |
| show | `frontend/src/views/app-toast/index.ts` | 163 |
| show | `frontend/src/views/app-toast/index.ts` | 182 |
| show | `frontend/src/views/app-toast/index.ts` | 191 |
| runBatchRename | `frontend/src/views/app-tree/bus-handlers.ts` | 104 |
| atBeHandleDirRename | `frontend/src/views/app-tree/bus-handlers.ts` | 132 |
| atBeHandleDirMkdir | `frontend/src/views/app-tree/bus-handlers.ts` | 157 |
| atBeHandleDirRecycle | `frontend/src/views/app-tree/bus-handlers.ts` | 208 |
| atBeHandleDirRecycle | `frontend/src/views/app-tree/bus-handlers.ts` | 214 |
| atBeHandleDirBatchRename | `frontend/src/views/app-tree/bus-handlers.ts` | 231 |
| atBeHandleDirBatchRename | `frontend/src/views/app-tree/bus-handlers.ts` | 245 |
| atBeHandleBatchRename | `frontend/src/views/app-tree/bus-handlers.ts` | 267 |
| reload | `frontend/src/views/app-tree/bus-handlers.ts` | 309 |
| runBatchToggle | `frontend/src/views/app-tree/bus-handlers.ts` | 325 |
| runBatchToggle | `frontend/src/views/app-tree/bus-handlers.ts` | 333 |
| runBatchToggle | `frontend/src/views/app-tree/bus-handlers.ts` | 378 |
| runBatchToggle | `frontend/src/views/app-tree/bus-handlers.ts` | 384 |
| atTeBindSelCheckboxes | `frontend/src/views/app-tree/events.ts` | 76 |
| atTeBindSelCheckboxes | `frontend/src/views/app-tree/events.ts` | 84 |
| atTeBindSelCheckboxes | `frontend/src/views/app-tree/events.ts` | 109 |
| atTeOpenAuthor | `frontend/src/views/app-tree/events.ts` | 136 |
| atTeClickRowPreview | `frontend/src/views/app-tree/events.ts` | 169 |
| atTeClickRowCopy | `frontend/src/views/app-tree/events.ts` | 185 |
| atTeClickRowCopy | `frontend/src/views/app-tree/events.ts` | 192 |
| atTeBindRenameInput | `frontend/src/views/app-tree/events.ts` | 394 |
| toggleFolderBatch | `frontend/src/views/app-tree/events.ts` | 440 |
| toggleFolderBatch | `frontend/src/views/app-tree/events.ts` | 448 |
| toggleFolderBatch | `frontend/src/views/app-tree/events.ts` | 511 |
| toggleFolderBatch | `frontend/src/views/app-tree/events.ts` | 521 |
| toastThrottled | `frontend/src/views/app-tree/index.ts` | 100 |
| _attrChangeReloadAsync | `frontend/src/views/app-tree/index.ts` | 419 |
| _onKeyDelete | `frontend/src/views/app-tree/index.ts` | 594 |
| _onKeyDelete | `frontend/src/views/app-tree/index.ts` | 602 |
| _deleteSelected | `frontend/src/views/app-tree/index.ts` | 724 |
| _deleteSelected | `frontend/src/views/app-tree/index.ts` | 731 |
| toastLoadError | `frontend/src/views/app-tree/loader.ts` | 32 |
| maybePromptAndroidStorage | `frontend/src/views/app-tree/loader.ts` | 56 |
| runImport | `frontend/src/views/app-tree/toolbar-commands.ts` | 61 |
| runImport | `frontend/src/views/app-tree/toolbar-commands.ts` | 72 |
| runImport | `frontend/src/views/app-tree/toolbar-commands.ts` | 178 |
| runImport | `frontend/src/views/app-tree/toolbar-commands.ts` | 196 |
| runToolbarCommand | `frontend/src/views/app-tree/toolbar-commands.ts` | 219 |
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
| handleSyncDownloadMissing | `frontend/src/features/sync/sync.ts` | 118 |
| handleSyncToggleStatus | `frontend/src/features/sync/sync.ts` | 223 |
| runExecDelete | `frontend/src/views/app-content/diagnostics/dedup.ts` | 116 |
| applyFsaState | `frontend/src/views/app-content/settings/init.ts` | 417 |
| onWebRepoAuthClick | `frontend/src/views/app-content/settings/init.ts` | 445 |
| runPull | `frontend/src/views/app-sidebar/sync-flow.ts` | 314 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| bindBusEvents | `frontend/src/views/app-tree/bus-handlers.ts` | 55 |

### `tree:set-search`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| connectedCallback | `frontend/src/views/app-content/index.ts` | 72 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| connectedCallback | `frontend/src/views/app-tree/index.ts` | 304 |

### `ui:card-density`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| initUiPrefs | `frontend/src/views/app-content/settings/ui-prefs.ts` | 204 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| bindBusEvents | `frontend/src/views/app-tree/bus-handlers.ts` | 68 |
