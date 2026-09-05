# Bus 事件契约报告

> **自动生成** — 由 `scripts/event-graph.ts` 生成。
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
| `community:clearCache` | 1 | 1 | 0 | 0 | ✅ |
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
| `toast:show` | 179 | 2 | 0 | 0 | ✅ |
| `tree:reload` | 13 | 1 | 0 | 0 | ✅ |
| `tree:set-search` | 1 | 1 | 0 | 0 | ✅ |

## 调用详情

### `avatar:refresh`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| eventArr | `frontend/src/features/community/download-queue-store.ts` | 384 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| initWorkshopPage | `frontend/src/views/app-content/init-workshop.ts` | 151 |

### `batch:disable-all`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| atTlBindBatchMenu | `frontend/src/views/app-tree/toolbar-events.ts` | 205 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| bindBusEvents | `frontend/src/views/app-tree/bus-handlers.ts` | 25 |

### `batch:enable-all`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| atTlBindBatchMenu | `frontend/src/views/app-tree/toolbar-events.ts` | 204 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| bindBusEvents | `frontend/src/views/app-tree/bus-handlers.ts` | 24 |

### `batch:rename`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| (顶层) | `frontend/src/features/context-menu/context-menu-handlers.ts` | 200 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| bindBusEvents | `frontend/src/views/app-tree/bus-handlers.ts` | 47 |

### `community:clearCache`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| cmDqCleanupProgressUI | `frontend/src/features/community/download-queue.ts` | 107 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| (顶层) | `frontend/src/views/app-content/community-data.ts` | 85 |

### `ctx:show`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| bindCardContextHandler | `frontend/src/views/app-sidebar/events.ts` | 122 |
| atTeBindContextMenu | `frontend/src/views/app-tree/events.ts` | 294 |
| atTeBindContextMenu | `frontend/src/views/app-tree/events.ts` | 318 |
| atTeBindContextMenu | `frontend/src/views/app-tree/events.ts` | 329 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| registerContextMenus | `frontend/src/features/context-menu/context-menus.ts` | 90 |

### `dir:batch-rename`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| (顶层) | `frontend/src/features/context-menu/context-menu-dir-handlers.ts` | 14 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| bindBusEvents | `frontend/src/views/app-tree/bus-handlers.ts` | 42 |

### `dir:mkdir`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| (顶层) | `frontend/src/features/context-menu/context-menu-dir-handlers.ts` | 57 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| bindBusEvents | `frontend/src/views/app-tree/bus-handlers.ts` | 32 |

### `dir:recycle`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| (顶层) | `frontend/src/features/context-menu/context-menu-dir-handlers.ts` | 58 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| bindBusEvents | `frontend/src/views/app-tree/bus-handlers.ts` | 37 |

### `dir:rename`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| (顶层) | `frontend/src/features/context-menu/context-menu-dir-handlers.ts` | 13 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| bindBusEvents | `frontend/src/views/app-tree/bus-handlers.ts` | 27 |

### `instance:clear`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| (顶层) | `frontend/src/features/context-menu/context-menu-handlers.ts` | 193 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| registerInstanceOps | `frontend/src/features/pack-ops/instance-ops.ts` | 90 |

### `instance:export-list`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| (顶层) | `frontend/src/features/context-menu/context-menu-handlers.ts` | 183 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| registerInstanceOps | `frontend/src/features/pack-ops/instance-ops.ts` | 17 |

### `lang:changed`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| setLang | `frontend/src/core/i18n/locale.ts` | 100 |
| initI18n | `frontend/src/core/i18n/locale.ts` | 149 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| connectedCallback | `frontend/src/views/app-content/index.ts` | 166 |
| connectedCallback | `frontend/src/views/app-nav/index.ts` | 190 |

### `menu:show`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| cmReBindContextMenu | `frontend/src/features/community/events.ts` | 200 |
| registerContextMenus | `frontend/src/features/context-menu/context-menus.ts` | 91 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| connectedCallback | `frontend/src/views/context-menu/index.ts` | 64 |

### `model:select`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| handleContainerClick | `frontend/src/features/oldest-models.ts` | 58 |
| onRecycleListClick | `frontend/src/features/recycle-bin.ts` | 187 |
| bindPreviewClicks | `frontend/src/views/app-content/diagnostics/dedup.ts` | 223 |
| showMorphPreview | `frontend/src/views/app-preview/detail-3d.ts` | 272 |
| showStagePreview | `frontend/src/views/app-preview/detail-3d.ts` | 353 |
| atTeClickRowFolder | `frontend/src/views/app-tree/events.ts` | 156 |
| atTeClickRowFile | `frontend/src/views/app-tree/events.ts` | 250 |
| _onKeyArrowNav | `frontend/src/views/app-tree/index.ts` | 441 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| connectedCallback | `frontend/src/views/app-preview/index.ts` | 161 |

### `nav:changed`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| connectedCallback | `frontend/src/views/app-content/index.ts` | 158 |
| _pageInitFailed | `frontend/src/views/app-content/index.ts` | 272 |
| cmBbBindEmptyLocalBtn | `frontend/src/views/app-content/site/events.ts` | 197 |
| anBindNavItems | `frontend/src/views/app-nav/index.ts` | 40 |
| connectedCallback | `frontend/src/views/app-nav/index.ts` | 200 |
| bindFooter | `frontend/src/views/app-sidebar/events.ts` | 243 |
| atTlBindRepoSwitch | `frontend/src/views/app-tree/toolbar-events.ts` | 117 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| registerPageStore | `frontend/src/core/page-store.ts` | 68 |
| connectedCallback | `frontend/src/views/app-content/index.ts` | 147 |
| connectedCallback | `frontend/src/views/app-nav/index.ts` | 175 |

### `package:selected`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| bindCardClickHandler | `frontend/src/views/app-sidebar/events.ts` | 77 |
| restoreSelectedCard | `frontend/src/views/app-sidebar/events.ts` | 229 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| initInstancesPage | `frontend/src/views/app-content/init-pages.ts` | 38 |

### `repo:rtype-changed`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| stgBindWebFsa | `frontend/src/views/app-content/settings/init.ts` | 285 |
| stgBindWebFsa | `frontend/src/views/app-content/settings/init.ts` | 307 |
| anBindDualSelects | `frontend/src/views/app-nav/index.ts` | 110 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| useCurrentResourceType | `frontend/src/features/repo-rtype.ts` | 33 |
| initRepositoryPage | `frontend/src/views/app-content/init-pages.ts` | 80 |
| initDedupTab | `frontend/src/views/app-content/init-pages.ts` | 258 |
| connectedCallback | `frontend/src/views/app-nav/index.ts` | 192 |
| connectedCallback | `frontend/src/views/app-sidebar/index.ts` | 491 |
| _init | `frontend/src/views/app-sync-manager/index.ts` | 204 |

### `repo:search-creator`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| cmCrBindOverlayEvents | `frontend/src/views/app-content/site/events.ts` | 168 |
| cmBbBindLocalBadges | `frontend/src/views/app-content/site/events.ts` | 297 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| connectedCallback | `frontend/src/views/app-content/index.ts` | 156 |

### `repo:subdir-changed`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| anBindDualSelects | `frontend/src/views/app-nav/index.ts` | 111 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| _init | `frontend/src/views/app-sync-manager/index.ts` | 227 |

### `stats:refresh`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| runDownloadMissing | `frontend/src/core/handlers/sync.ts` | 76 |
| runSyncToggleStatus | `frontend/src/core/handlers/sync.ts` | 182 |
| enqueueDownloads | `frontend/src/features/community/download-queue-store.ts` | 263 |
| cmDqCleanupProgressUI | `frontend/src/features/community/download-queue.ts` | 114 |
| refreshUI | `frontend/src/features/context-menu/context-menu-shared.ts` | 18 |
| (顶层) | `frontend/src/features/import-executor.ts` | 38 |
| (顶层) | `frontend/src/features/import-executor.ts` | 197 |
| handleInstanceDrop | `frontend/src/features/pack-dnd.ts` | 171 |
| registerInstanceOps | `frontend/src/features/pack-ops/instance-ops.ts` | 131 |
| registerAndroidEvents | `frontend/src/features/platform/android-events.ts` | 55 |
| setupRecycleActions | `frontend/src/features/recycle-bin.ts` | 106 |
| onRecycleEmptyClick | `frontend/src/features/recycle-bin.ts` | 171 |
| runExecDelete | `frontend/src/views/app-content/diagnostics/dedup.ts` | 367 |
| stgBindLinkMode | `frontend/src/views/app-content/settings/init.ts` | 148 |
| bindPathClick | `frontend/src/views/app-content/settings/path-cards.ts` | 75 |
| initMcDetect | `frontend/src/views/app-content/settings/path-cards.ts` | 333 |
| runPull | `frontend/src/views/app-sidebar/index.ts` | 358 |
| runMcSearch | `frontend/src/views/app-sidebar/launcher-detect.ts` | 84 |
| runLauncherDetect | `frontend/src/views/app-sidebar/launcher-detect.ts` | 157 |
| _init | `frontend/src/views/app-sync-manager/index.ts` | 155 |
| runBatchRename | `frontend/src/views/app-tree/bus-handlers.ts` | 82 |
| atBeHandleDirRename | `frontend/src/views/app-tree/bus-handlers.ts` | 117 |
| atBeHandleDirRecycle | `frontend/src/views/app-tree/bus-handlers.ts` | 184 |
| atTeBindSelCheckboxes | `frontend/src/views/app-tree/events.ts` | 100 |
| atTeBindRenameInput | `frontend/src/views/app-tree/events.ts` | 398 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| connectedCallback | `frontend/src/views/app-sidebar/index.ts` | 483 |
| _init | `frontend/src/views/app-sync-manager/index.ts` | 184 |

### `sync:download:done`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| handleSyncDownloadMissing | `frontend/src/core/handlers/sync.ts` | 96 |
| handleSyncDownloadMissing | `frontend/src/core/handlers/sync.ts` | 124 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| pushOne | `frontend/src/views/app-sidebar/index.ts` | 201 |
| waitBusQuiet | `frontend/src/views/app-sidebar/index.ts` | 222 |

### `sync:download:missing`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| pushOne | `frontend/src/views/app-sidebar/index.ts` | 215 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| registerSync | `frontend/src/core/handlers/sync.ts` | 219 |

### `sync:toggle:status`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| runBatchToggle | `frontend/src/views/app-tree/bus-handlers.ts` | 337 |
| atTeBindSelCheckboxes | `frontend/src/views/app-tree/events.ts` | 98 |
| toggleFolderBatch | `frontend/src/views/app-tree/events.ts` | 489 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| registerSync | `frontend/src/core/handlers/sync.ts` | 221 |

### `toast:show`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| runStartupSteps | `frontend/src/app-modules.ts` | 67 |
| (顶层) | `frontend/src/app-modules.ts` | 125 |
| toast | `frontend/src/core/feedback.ts` | 21 |
| enqueueDownloads | `frontend/src/features/community/download-queue-store.ts` | 252 |
| cmDqEnqueue | `frontend/src/features/community/download-queue.ts` | 279 |
| cmDqEnqueue | `frontend/src/features/community/download-queue.ts` | 306 |
| cmReBindDlSelected | `frontend/src/features/community/events.ts` | 144 |
| cmReBindDlSelected | `frontend/src/features/community/events.ts` | 156 |
| cmReHandleSingleDownload | `frontend/src/features/community/events.ts` | 226 |
| cmReBindRowClick | `frontend/src/features/community/events.ts` | 276 |
| cmReBindRowClick | `frontend/src/features/community/events.ts` | 310 |
| dgBrApplyReplace | `frontend/src/features/dialogs/batch-rename.ts` | 101 |
| dgBrBindApplyClick | `frontend/src/features/dialogs/batch-rename.ts` | 430 |
| dgBrBindApplyClick | `frontend/src/features/dialogs/batch-rename.ts` | 444 |
| dgBrBindApplyClick | `frontend/src/features/dialogs/batch-rename.ts` | 463 |
| handleTreeDrop | `frontend/src/features/import-dnd.ts` | 43 |
| handleTreeDrop | `frontend/src/features/import-dnd.ts` | 61 |
| handleTreeDrop | `frontend/src/features/import-dnd.ts` | 80 |
| handleTreeDrop | `frontend/src/features/import-dnd.ts` | 90 |
| handleTreeDrop | `frontend/src/features/import-dnd.ts` | 108 |
| bindTreeDnD | `frontend/src/features/import-dnd.ts` | 213 |
| (顶层) | `frontend/src/features/import-executor.ts` | 33 |
| (顶层) | `frontend/src/features/import-executor.ts` | 188 |
| (顶层) | `frontend/src/features/import-executor.ts` | 201 |
| (顶层) | `frontend/src/features/pack-dnd.ts` | 42 |
| initRecycleBin | `frontend/src/features/recycle-bin.ts` | 267 |
| promptUpdate | `frontend/src/features/version-updater.ts` | 142 |
| promptUpdate | `frontend/src/features/version-updater.ts` | 151 |
| checkUpdateSilent | `frontend/src/features/version-updater.ts` | 177 |
| checkUpdateSilent | `frontend/src/features/version-updater.ts` | 186 |
| initVersionUpdater | `frontend/src/features/version-updater.ts` | 207 |
| initVersionUpdater | `frontend/src/features/version-updater.ts` | 238 |
| initVersionUpdater | `frontend/src/features/version-updater.ts` | 248 |
| mount3D | `frontend/src/preview-3d/adapters/mount-preview-core.ts` | 571 |
| showLoadFailure | `frontend/src/preview-3d/adapters/preview-loading.ts` | 43 |
| beginSwitch | `frontend/src/preview-3d/adapters/switch-preview.ts` | 159 |
| resolveAndroidRepoDir | `frontend/src/utils/dom/directory-picker.ts` | 35 |
| resolveAndroidRepoDir | `frontend/src/utils/dom/directory-picker.ts` | 46 |
| resolveAndroidRepoDir | `frontend/src/utils/dom/directory-picker.ts` | 58 |
| (顶层) | `frontend/src/utils/module-loader.ts` | 19 |
| dgCfWebGate | `frontend/src/views/app-content/diagnostics/conflicts.ts` | 37 |
| dgCfSyncWebGate | `frontend/src/views/app-content/diagnostics/conflicts.ts` | 190 |
| dgInBindRefreshClear | `frontend/src/views/app-content/diagnostics/init.ts` | 40 |
| dgInBindRefreshClear | `frontend/src/views/app-content/diagnostics/init.ts` | 51 |
| dgInBindRefreshClear | `frontend/src/views/app-content/diagnostics/init.ts` | 57 |
| dgInBindCopyPanel | `frontend/src/views/app-content/diagnostics/init.ts` | 76 |
| dgInBindCopyPanel | `frontend/src/views/app-content/diagnostics/init.ts` | 88 |
| dgInCopyRowLog | `frontend/src/views/app-content/diagnostics/init.ts` | 103 |
| dgInCopyRowLog | `frontend/src/views/app-content/diagnostics/init.ts` | 111 |
| bindPerfCopyHandlers | `frontend/src/views/app-content/diagnostics/perf-cli.ts` | 89 |
| guiFlowWebModeCheck | `frontend/src/views/app-content/diagnostics/perf-cli.ts` | 371 |
| _pageInitFailed | `frontend/src/views/app-content/index.ts` | 263 |
| bindTabs | `frontend/src/views/app-content/init-pages.ts` | 164 |
| initSettingsPage | `frontend/src/views/app-content/init-pages.ts` | 287 |
| stgBindMirrorSelect | `frontend/src/views/app-content/settings/init.ts` | 52 |
| stgBindUpdateInterval | `frontend/src/views/app-content/settings/init.ts` | 90 |
| stgBindLinkMode | `frontend/src/views/app-content/settings/init.ts` | 130 |
| stgBindLinkMode | `frontend/src/views/app-content/settings/init.ts` | 150 |
| stgBindLinkMode | `frontend/src/views/app-content/settings/init.ts` | 158 |
| stgBindLinkMode | `frontend/src/views/app-content/settings/init.ts` | 167 |
| stgBindLinkMode | `frontend/src/views/app-content/settings/init.ts` | 195 |
| stgBindReleasesClick | `frontend/src/views/app-content/settings/init.ts` | 241 |
| tdRenderKeymap | `frontend/src/views/app-content/settings/keymap.ts` | 103 |
| tdRenderKeymap | `frontend/src/views/app-content/settings/keymap.ts` | 114 |
| initKeymap | `frontend/src/views/app-content/settings/keymap.ts` | 135 |
| bindPathClick | `frontend/src/views/app-content/settings/path-cards.ts` | 76 |
| initAdvancedGrid | `frontend/src/views/app-content/settings/path-cards.ts` | 253 |
| initAdvancedGrid | `frontend/src/views/app-content/settings/path-cards.ts` | 259 |
| initAdvancedGrid | `frontend/src/views/app-content/settings/path-cards.ts` | 280 |
| initAdvancedGrid | `frontend/src/views/app-content/settings/path-cards.ts` | 286 |
| initMcDetect | `frontend/src/views/app-content/settings/path-cards.ts` | 308 |
| initMcDetect | `frontend/src/views/app-content/settings/path-cards.ts` | 334 |
| initUiPrefs | `frontend/src/views/app-content/settings/ui-prefs.ts` | 123 |
| initUiPrefs | `frontend/src/views/app-content/settings/ui-prefs.ts` | 134 |
| initUiPrefs | `frontend/src/views/app-content/settings/ui-prefs.ts` | 145 |
| initUiPrefs | `frontend/src/views/app-content/settings/ui-prefs.ts` | 157 |
| initUiPrefs | `frontend/src/views/app-content/settings/ui-prefs.ts` | 167 |
| initWorkerPrefs | `frontend/src/views/app-content/settings/worker-prefs.ts` | 44 |
| bindDragEvents | `frontend/src/views/app-content/site/drag.ts` | 44 |
| bindDragEvents | `frontend/src/views/app-content/site/drag.ts` | 85 |
| bindDragEvents | `frontend/src/views/app-content/site/drag.ts` | 108 |
| bindDragEvents | `frontend/src/views/app-content/site/drag.ts` | 117 |
| eeBindToolbarBtns | `frontend/src/views/app-content/site/edit.ts` | 108 |
| eeBindToolbarBtns | `frontend/src/views/app-content/site/edit.ts` | 132 |
| eeBindToolbarBtns | `frontend/src/views/app-content/site/edit.ts` | 139 |
| eeBindFetchBtn | `frontend/src/views/app-content/site/edit.ts` | 225 |
| eeBindFetchBtn | `frontend/src/views/app-content/site/edit.ts` | 232 |
| eeBindFetchBtn | `frontend/src/views/app-content/site/edit.ts` | 248 |
| cmCrBindOverlayEvents | `frontend/src/views/app-content/site/events.ts` | 145 |
| cmBbBindStarBtns | `frontend/src/views/app-content/site/events.ts` | 264 |
| bindSiteEvents | `frontend/src/views/app-content/workshop-site-opener.ts` | 116 |
| bindSiteEvents | `frontend/src/views/app-content/workshop-site-opener.ts` | 126 |
| bindSiteEvents | `frontend/src/views/app-content/workshop-site-opener.ts` | 132 |
| bindSiteEvents | `frontend/src/views/app-content/workshop-site-opener.ts` | 142 |
| bindSiteEvents | `frontend/src/views/app-content/workshop-site-opener.ts` | 153 |
| bindSiteEvents | `frontend/src/views/app-content/workshop-site-opener.ts` | 159 |
| initWorkshopTabs | `frontend/src/views/app-content/workshop-tabs.ts` | 95 |
| initWorkshopTabs | `frontend/src/views/app-content/workshop-tabs.ts` | 144 |
| anBindViewerFab | `frontend/src/views/app-nav/index.ts` | 132 |
| showMorphPreview | `frontend/src/views/app-preview/detail-3d.ts` | 287 |
| showStagePreview | `frontend/src/views/app-preview/detail-3d.ts` | 367 |
| _showModelDetail | `frontend/src/views/app-preview/index.ts` | 296 |
| _showModelDetail | `frontend/src/views/app-preview/index.ts` | 320 |
| openModel3DFullscreen | `frontend/src/views/app-preview/preview-library.ts` | 90 |
| openModel3DFullscreen | `frontend/src/views/app-preview/preview-library.ts` | 129 |
| openModel3DFullscreen | `frontend/src/views/app-preview/preview-library.ts` | 163 |
| makeShotAction | `frontend/src/views/app-preview/shot-panel-shared.ts` | 48 |
| bindCardContextHandler | `frontend/src/views/app-sidebar/events.ts` | 115 |
| beginSync | `frontend/src/views/app-sidebar/index.ts` | 145 |
| runPush | `frontend/src/views/app-sidebar/index.ts` | 270 |
| runPush | `frontend/src/views/app-sidebar/index.ts` | 276 |
| runPush | `frontend/src/views/app-sidebar/index.ts` | 282 |
| runPull | `frontend/src/views/app-sidebar/index.ts` | 341 |
| runPull | `frontend/src/views/app-sidebar/index.ts` | 347 |
| runPull | `frontend/src/views/app-sidebar/index.ts` | 352 |
| runPull | `frontend/src/views/app-sidebar/index.ts` | 361 |
| (顶层) | `frontend/src/views/app-sidebar/launcher-detect.ts` | 37 |
| runMcSearch | `frontend/src/views/app-sidebar/launcher-detect.ts` | 66 |
| runMcSearch | `frontend/src/views/app-sidebar/launcher-detect.ts` | 85 |
| runLauncherDetect | `frontend/src/views/app-sidebar/launcher-detect.ts` | 136 |
| runLauncherDetect | `frontend/src/views/app-sidebar/launcher-detect.ts` | 158 |
| doLoadInstances | `frontend/src/views/app-sidebar/loader.ts` | 143 |
| _init | `frontend/src/views/app-sync-manager/index.ts` | 177 |
| performSingleOp | `frontend/src/views/app-sync-manager/network.ts` | 47 |
| performSingleOp | `frontend/src/views/app-sync-manager/network.ts` | 55 |
| loadTypeConfig | `frontend/src/views/app-sync-manager/store.ts` | 34 |
| loadData | `frontend/src/views/app-sync-manager/store.ts` | 90 |
| show | `frontend/src/views/app-toast/index.ts` | 134 |
| show | `frontend/src/views/app-toast/index.ts` | 153 |
| show | `frontend/src/views/app-toast/index.ts` | 162 |
| runBatchRename | `frontend/src/views/app-tree/bus-handlers.ts` | 83 |
| atBeHandleDirRename | `frontend/src/views/app-tree/bus-handlers.ts` | 119 |
| atBeHandleDirMkdir | `frontend/src/views/app-tree/bus-handlers.ts` | 143 |
| atBeHandleDirRecycle | `frontend/src/views/app-tree/bus-handlers.ts` | 188 |
| atBeHandleDirRecycle | `frontend/src/views/app-tree/bus-handlers.ts` | 194 |
| atBeHandleDirBatchRename | `frontend/src/views/app-tree/bus-handlers.ts` | 211 |
| atBeHandleDirBatchRename | `frontend/src/views/app-tree/bus-handlers.ts` | 224 |
| atBeHandleBatchRename | `frontend/src/views/app-tree/bus-handlers.ts` | 243 |
| reload | `frontend/src/views/app-tree/bus-handlers.ts` | 280 |
| runBatchToggle | `frontend/src/views/app-tree/bus-handlers.ts` | 296 |
| runBatchToggle | `frontend/src/views/app-tree/bus-handlers.ts` | 304 |
| runBatchToggle | `frontend/src/views/app-tree/bus-handlers.ts` | 340 |
| runBatchToggle | `frontend/src/views/app-tree/bus-handlers.ts` | 346 |
| atTeBindSelCheckboxes | `frontend/src/views/app-tree/events.ts` | 71 |
| atTeBindSelCheckboxes | `frontend/src/views/app-tree/events.ts` | 79 |
| atTeBindSelCheckboxes | `frontend/src/views/app-tree/events.ts` | 104 |
| atTeOpenAuthor | `frontend/src/views/app-tree/events.ts` | 131 |
| atTeClickRowPreview | `frontend/src/views/app-tree/events.ts` | 172 |
| atTeClickRowPreview | `frontend/src/views/app-tree/events.ts` | 181 |
| atTeClickRowCopy | `frontend/src/views/app-tree/events.ts` | 197 |
| atTeClickRowCopy | `frontend/src/views/app-tree/events.ts` | 204 |
| atTeBindRenameInput | `frontend/src/views/app-tree/events.ts` | 401 |
| toggleFolderBatch | `frontend/src/views/app-tree/events.ts` | 441 |
| toggleFolderBatch | `frontend/src/views/app-tree/events.ts` | 449 |
| toggleFolderBatch | `frontend/src/views/app-tree/events.ts` | 492 |
| toggleFolderBatch | `frontend/src/views/app-tree/events.ts` | 502 |
| toastThrottled | `frontend/src/views/app-tree/index.ts` | 71 |
| _attrChangeReloadAsync | `frontend/src/views/app-tree/index.ts` | 225 |
| _onKeyDelete | `frontend/src/views/app-tree/index.ts` | 366 |
| _onKeyDelete | `frontend/src/views/app-tree/index.ts` | 374 |
| _deleteSelected | `frontend/src/views/app-tree/index.ts` | 489 |
| _deleteSelected | `frontend/src/views/app-tree/index.ts` | 496 |
| toastLoadError | `frontend/src/views/app-tree/loader.ts` | 32 |
| maybePromptAndroidStorage | `frontend/src/views/app-tree/loader.ts` | 56 |
| atTlShowConfirm | `frontend/src/views/app-tree/toolbar-events.ts` | 49 |
| atTlShowConfirm | `frontend/src/views/app-tree/toolbar-events.ts` | 60 |
| atTlBindAdvFilter | `frontend/src/views/app-tree/toolbar-events.ts` | 162 |
| atTlBindMoreMenu | `frontend/src/views/app-tree/toolbar-events.ts` | 302 |
| atTlBindMoreMenu | `frontend/src/views/app-tree/toolbar-events.ts` | 320 |
| atTlBindMoreMenu | `frontend/src/views/app-tree/toolbar-events.ts` | 326 |
| atTlBindMoreMenu | `frontend/src/views/app-tree/toolbar-events.ts` | 337 |
| advFilterFetchTagPaths | `frontend/src/views/app-tree/toolbar-search.ts` | 159 |
| advFilterSearchModelPaths | `frontend/src/views/app-tree/toolbar-search.ts` | 178 |
| advFilterSearchModelPaths | `frontend/src/views/app-tree/toolbar-search.ts` | 208 |
| advFilterWarnWebDegraded | `frontend/src/views/app-tree/toolbar-search.ts` | 224 |
| advFilterToastAndRender | `frontend/src/views/app-tree/toolbar-search.ts` | 253 |
| advFilterToastAndRender | `frontend/src/views/app-tree/toolbar-search.ts` | 259 |
| pickWebFilesAndImport | `frontend/src/views/app-tree/toolbar-search.ts` | 322 |
| pickWebFilesAndImport | `frontend/src/views/app-tree/toolbar-search.ts` | 331 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| registerErrorDiary | `frontend/src/core/error-diary.ts` | 58 |
| connectedCallback | `frontend/src/views/app-toast/index.ts` | 69 |

### `tree:reload`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| handleSyncDownloadMissing | `frontend/src/core/handlers/sync.ts` | 116 |
| handleSyncToggleStatus | `frontend/src/core/handlers/sync.ts` | 207 |
| enqueueDownloads | `frontend/src/features/community/download-queue-store.ts` | 262 |
| cmDqCleanupProgressUI | `frontend/src/features/community/download-queue.ts` | 113 |
| refreshUI | `frontend/src/features/context-menu/context-menu-shared.ts` | 17 |
| (顶层) | `frontend/src/features/import-executor.ts` | 39 |
| (顶层) | `frontend/src/features/import-executor.ts` | 196 |
| handleInstanceDrop | `frontend/src/features/pack-dnd.ts` | 172 |
| registerAndroidEvents | `frontend/src/features/platform/android-events.ts` | 54 |
| setupRecycleActions | `frontend/src/features/recycle-bin.ts` | 107 |
| onRecycleEmptyClick | `frontend/src/features/recycle-bin.ts` | 172 |
| runExecDelete | `frontend/src/views/app-content/diagnostics/dedup.ts` | 368 |
| runPull | `frontend/src/views/app-sidebar/index.ts` | 359 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| bindBusEvents | `frontend/src/views/app-tree/bus-handlers.ts` | 52 |

### `tree:set-search`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| connectedCallback | `frontend/src/views/app-content/index.ts` | 160 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| connectedCallback | `frontend/src/views/app-tree/index.ts` | 152 |
