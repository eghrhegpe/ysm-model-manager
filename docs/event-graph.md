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
| `ctx:show` | 5 | 1 | 0 | 0 | ✅ |
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
| `toast:show` | 178 | 2 | 0 | 0 | ✅ |
| `tree:reload` | 13 | 1 | 0 | 0 | ✅ |
| `tree:set-search` | 1 | 1 | 0 | 0 | ✅ |

## 调用详情

### `avatar:refresh`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| eventArr | `frontend/src/features/community/download-queue-store.ts` | 406 |

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
| bindBusEvents | `frontend/src/views/app-tree/bus-handlers.ts` | 27 |

### `batch:enable-all`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| atTlBindBatchMenu | `frontend/src/views/app-tree/toolbar-events.ts` | 204 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| bindBusEvents | `frontend/src/views/app-tree/bus-handlers.ts` | 26 |

### `batch:rename`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| (顶层) | `frontend/src/features/context-menu/context-menu-handlers.ts` | 181 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| bindBusEvents | `frontend/src/views/app-tree/bus-handlers.ts` | 49 |

### `community:clearCache`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| cmDqCleanupProgressUI | `frontend/src/features/community/download-queue.ts` | 107 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| (顶层) | `frontend/src/views/app-content/community-data.ts` | 86 |

### `ctx:show`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| showMenu | `frontend/src/features/context-menu/context-menus.setup.ts` | 144 |
| bindCardContextHandler | `frontend/src/views/app-sidebar/events.ts` | 127 |
| atTeBindContextMenu | `frontend/src/views/app-tree/events.ts` | 287 |
| atTeBindContextMenu | `frontend/src/views/app-tree/events.ts` | 311 |
| atTeBindContextMenu | `frontend/src/views/app-tree/events.ts` | 323 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| registerContextMenus | `frontend/src/features/context-menu/context-menus.ts` | 91 |

### `dir:batch-rename`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| (顶层) | `frontend/src/features/context-menu/context-menu-dir-handlers.ts` | 11 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| bindBusEvents | `frontend/src/views/app-tree/bus-handlers.ts` | 44 |

### `dir:mkdir`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| (顶层) | `frontend/src/features/context-menu/context-menu-dir-handlers.ts` | 22 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| bindBusEvents | `frontend/src/views/app-tree/bus-handlers.ts` | 34 |

### `dir:recycle`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| (顶层) | `frontend/src/features/context-menu/context-menu-dir-handlers.ts` | 23 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| bindBusEvents | `frontend/src/views/app-tree/bus-handlers.ts` | 39 |

### `dir:rename`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| (顶层) | `frontend/src/features/context-menu/context-menu-dir-handlers.ts` | 10 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| bindBusEvents | `frontend/src/views/app-tree/bus-handlers.ts` | 29 |

### `instance:clear`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| (顶层) | `frontend/src/features/context-menu/context-menu-handlers.ts` | 174 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| registerInstanceOps | `frontend/src/features/pack-ops/instance-ops.ts` | 90 |

### `instance:export-list`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| (顶层) | `frontend/src/features/context-menu/context-menu-handlers.ts` | 164 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| registerInstanceOps | `frontend/src/features/pack-ops/instance-ops.ts` | 17 |

### `lang:changed`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| setLang | `frontend/src/core/i18n/locale.ts` | 135 |
| initI18n | `frontend/src/core/i18n/locale.ts` | 186 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| connectedCallback | `frontend/src/views/app-content/index.ts` | 167 |
| connectedCallback | `frontend/src/views/app-nav/index.ts` | 192 |

### `menu:show`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| cmReBindContextMenu | `frontend/src/features/community/events.ts` | 200 |
| registerContextMenus | `frontend/src/features/context-menu/context-menus.ts` | 92 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| connectedCallback | `frontend/src/views/context-menu/index.ts` | 67 |

### `model:select`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| handleContainerClick | `frontend/src/features/maintenance/oldest-models.ts` | 42 |
| onRecycleListClick | `frontend/src/features/maintenance/recycle-bin.ts` | 191 |
| bindPreviewClicks | `frontend/src/views/app-content/diagnostics/dedup.ts` | 223 |
| showMorphPreview | `frontend/src/views/app-preview/detail-3d.ts` | 275 |
| showStagePreview | `frontend/src/views/app-preview/detail-3d.ts` | 356 |
| atTeClickRowFolder | `frontend/src/views/app-tree/events.ts` | 160 |
| atTeClickRowFile | `frontend/src/views/app-tree/events.ts` | 245 |
| _onKeyArrowNav | `frontend/src/views/app-tree/index.ts` | 450 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| connectedCallback | `frontend/src/views/app-preview/index.ts` | 164 |

### `nav:changed`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| connectedCallback | `frontend/src/views/app-content/index.ts` | 159 |
| _pageInitFailed | `frontend/src/views/app-content/index.ts` | 275 |
| cmBbBindEmptyLocalBtn | `frontend/src/views/app-content/site/events.ts` | 196 |
| anBindNavItems | `frontend/src/views/app-nav/index.ts` | 41 |
| connectedCallback | `frontend/src/views/app-nav/index.ts` | 202 |
| bindFooter | `frontend/src/views/app-sidebar/events.ts` | 255 |
| atTlBindRepoSwitch | `frontend/src/views/app-tree/toolbar-events.ts` | 117 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| registerPageStore | `frontend/src/core/page-store.ts` | 86 |
| connectedCallback | `frontend/src/views/app-content/index.ts` | 148 |
| connectedCallback | `frontend/src/views/app-nav/index.ts` | 176 |

### `package:selected`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| bindCardClickHandler | `frontend/src/views/app-sidebar/events.ts` | 82 |
| restoreSelectedCard | `frontend/src/views/app-sidebar/events.ts` | 241 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| initInstancesPage | `frontend/src/views/app-content/init-pages.ts` | 36 |

### `repo:rtype-changed`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| stgBindWebFsa | `frontend/src/views/app-content/settings/init.ts` | 285 |
| stgBindWebFsa | `frontend/src/views/app-content/settings/init.ts` | 307 |
| anBindDualSelects | `frontend/src/views/app-nav/index.ts` | 111 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| useCurrentResourceType | `frontend/src/features/repo/repo-rtype.ts` | 21 |
| initRepositoryPage | `frontend/src/views/app-content/init-pages.ts` | 78 |
| initDedupTab | `frontend/src/views/app-content/init-pages.ts` | 257 |
| connectedCallback | `frontend/src/views/app-nav/index.ts` | 194 |
| connectedCallback | `frontend/src/views/app-sidebar/index.ts` | 127 |
| _init | `frontend/src/views/app-sync-manager/index.ts` | 205 |

### `repo:search-creator`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| cmCrBindOverlayEvents | `frontend/src/views/app-content/site/events.ts` | 167 |
| cmBbBindLocalBadges | `frontend/src/views/app-content/site/events.ts` | 296 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| connectedCallback | `frontend/src/views/app-content/index.ts` | 157 |

### `repo:subdir-changed`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| anBindDualSelects | `frontend/src/views/app-nav/index.ts` | 112 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| _init | `frontend/src/views/app-sync-manager/index.ts` | 228 |

### `stats:refresh`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| enqueueDownloads | `frontend/src/features/community/download-queue-store.ts` | 285 |
| cmDqCleanupProgressUI | `frontend/src/features/community/download-queue.ts` | 114 |
| refreshUI | `frontend/src/features/context-menu/context-menu-shared.ts` | 18 |
| handleInstanceDrop | `frontend/src/features/dnd/pack-dnd.ts` | 168 |
| (顶层) | `frontend/src/features/import/executor.ts` | 35 |
| (顶层) | `frontend/src/features/import/executor.ts` | 191 |
| setupRecycleActions | `frontend/src/features/maintenance/recycle-bin.ts` | 109 |
| onRecycleEmptyClick | `frontend/src/features/maintenance/recycle-bin.ts` | 175 |
| registerInstanceOps | `frontend/src/features/pack-ops/instance-ops.ts` | 131 |
| registerAndroidEvents | `frontend/src/features/platform/android-events.ts` | 55 |
| runDownloadMissing | `frontend/src/features/sync.ts` | 75 |
| runSyncToggleStatus | `frontend/src/features/sync.ts` | 185 |
| runExecDelete | `frontend/src/views/app-content/diagnostics/dedup.ts` | 366 |
| stgBindLinkMode | `frontend/src/views/app-content/settings/init.ts` | 148 |
| bindPathClick | `frontend/src/views/app-content/settings/path-cards.ts` | 76 |
| initMcDetect | `frontend/src/views/app-content/settings/path-cards.ts` | 334 |
| runMcSearch | `frontend/src/views/app-sidebar/launcher-detect.ts` | 88 |
| runLauncherDetect | `frontend/src/views/app-sidebar/launcher-detect.ts` | 161 |
| runPull | `frontend/src/views/app-sidebar/sync-flow.ts` | 325 |
| _init | `frontend/src/views/app-sync-manager/index.ts` | 156 |
| runBatchRename | `frontend/src/views/app-tree/bus-handlers.ts` | 84 |
| atBeHandleDirRename | `frontend/src/views/app-tree/bus-handlers.ts` | 119 |
| atBeHandleDirRecycle | `frontend/src/views/app-tree/bus-handlers.ts` | 186 |
| atTeBindSelCheckboxes | `frontend/src/views/app-tree/events.ts` | 104 |
| atTeBindRenameInput | `frontend/src/views/app-tree/events.ts` | 389 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| connectedCallback | `frontend/src/views/app-sidebar/index.ts` | 119 |
| _init | `frontend/src/views/app-sync-manager/index.ts` | 185 |

### `sync:download:done`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| handleSyncDownloadMissing | `frontend/src/features/sync.ts` | 119 |
| handleSyncDownloadMissing | `frontend/src/features/sync.ts` | 122 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| pushOne | `frontend/src/views/app-sidebar/sync-flow.ts` | 168 |
| waitBusQuiet | `frontend/src/views/app-sidebar/sync-flow.ts` | 189 |

### `sync:download:missing`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| pushOne | `frontend/src/views/app-sidebar/sync-flow.ts` | 182 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| registerSync | `frontend/src/features/sync.ts` | 222 |

### `sync:toggle:status`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| runBatchToggle | `frontend/src/views/app-tree/bus-handlers.ts` | 348 |
| atTeBindSelCheckboxes | `frontend/src/views/app-tree/events.ts` | 102 |
| toggleFolderBatch | `frontend/src/views/app-tree/events.ts` | 497 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| registerSync | `frontend/src/features/sync.ts` | 224 |

### `toast:show`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| (顶层) | `frontend/src/app-modules.ts` | 27 |
| runStartupSteps | `frontend/src/app-modules.ts` | 86 |
| (顶层) | `frontend/src/app-modules.ts` | 148 |
| enqueueDownloads | `frontend/src/features/community/download-queue-store.ts` | 274 |
| cmDqEnqueue | `frontend/src/features/community/download-queue.ts` | 279 |
| cmDqEnqueue | `frontend/src/features/community/download-queue.ts` | 305 |
| cmReBindDlSelected | `frontend/src/features/community/events.ts` | 144 |
| cmReBindDlSelected | `frontend/src/features/community/events.ts` | 156 |
| cmReHandleSingleDownload | `frontend/src/features/community/events.ts` | 226 |
| cmReBindRowClick | `frontend/src/features/community/events.ts` | 276 |
| cmReBindRowClick | `frontend/src/features/community/events.ts` | 310 |
| dgBrApplyReplace | `frontend/src/features/dialogs/batch-rename.ts` | 101 |
| dgBrBindApplyClick | `frontend/src/features/dialogs/batch-rename.ts` | 430 |
| dgBrBindApplyClick | `frontend/src/features/dialogs/batch-rename.ts` | 444 |
| dgBrBindApplyClick | `frontend/src/features/dialogs/batch-rename.ts` | 463 |
| handleTreeDrop | `frontend/src/features/dnd/import-dnd.ts` | 45 |
| handleTreeDrop | `frontend/src/features/dnd/import-dnd.ts` | 63 |
| handleTreeDrop | `frontend/src/features/dnd/import-dnd.ts` | 82 |
| handleTreeDrop | `frontend/src/features/dnd/import-dnd.ts` | 92 |
| handleTreeDrop | `frontend/src/features/dnd/import-dnd.ts` | 110 |
| bindTreeDnD | `frontend/src/features/dnd/import-dnd.ts` | 215 |
| (顶层) | `frontend/src/features/dnd/pack-dnd.ts` | 37 |
| (顶层) | `frontend/src/features/import/executor.ts` | 30 |
| (顶层) | `frontend/src/features/import/executor.ts` | 182 |
| (顶层) | `frontend/src/features/import/executor.ts` | 195 |
| initRecycleBin | `frontend/src/features/maintenance/recycle-bin.ts` | 266 |
| promptUpdate | `frontend/src/features/maintenance/version-updater.ts` | 144 |
| promptUpdate | `frontend/src/features/maintenance/version-updater.ts` | 153 |
| checkUpdateSilent | `frontend/src/features/maintenance/version-updater.ts` | 179 |
| checkUpdateSilent | `frontend/src/features/maintenance/version-updater.ts` | 188 |
| initVersionUpdater | `frontend/src/features/maintenance/version-updater.ts` | 209 |
| initVersionUpdater | `frontend/src/features/maintenance/version-updater.ts` | 240 |
| initVersionUpdater | `frontend/src/features/maintenance/version-updater.ts` | 250 |
| assembleShell | `frontend/src/preview-3d/adapters/mount-preview-core.ts` | 656 |
| showLoadFailure | `frontend/src/preview-3d/adapters/preview-loading.ts` | 43 |
| beginSwitch | `frontend/src/preview-3d/adapters/switch-preview.ts` | 160 |
| resolveAndroidRepoDir | `frontend/src/utils/dom/directory-picker.ts` | 35 |
| resolveAndroidRepoDir | `frontend/src/utils/dom/directory-picker.ts` | 46 |
| resolveAndroidRepoDir | `frontend/src/utils/dom/directory-picker.ts` | 58 |
| toast | `frontend/src/utils/dom/toast.ts` | 20 |
| dgCfWebGate | `frontend/src/views/app-content/diagnostics/conflicts.ts` | 37 |
| dgCfSyncWebGate | `frontend/src/views/app-content/diagnostics/conflicts.ts` | 189 |
| dgInBindRefreshClear | `frontend/src/views/app-content/diagnostics/init.ts` | 40 |
| dgInBindRefreshClear | `frontend/src/views/app-content/diagnostics/init.ts` | 51 |
| dgInBindRefreshClear | `frontend/src/views/app-content/diagnostics/init.ts` | 57 |
| dgInBindCopyPanel | `frontend/src/views/app-content/diagnostics/init.ts` | 76 |
| dgInBindCopyPanel | `frontend/src/views/app-content/diagnostics/init.ts` | 88 |
| dgInCopyRowLog | `frontend/src/views/app-content/diagnostics/init.ts` | 103 |
| dgInCopyRowLog | `frontend/src/views/app-content/diagnostics/init.ts` | 111 |
| bindPerfCopyHandlers | `frontend/src/views/app-content/diagnostics/perf-common.ts` | 73 |
| guiFlowWebModeCheck | `frontend/src/views/app-content/diagnostics/perf-gui-flow.ts` | 32 |
| _pageInitFailed | `frontend/src/views/app-content/index.ts` | 266 |
| bindTabs | `frontend/src/views/app-content/init-pages.ts` | 162 |
| initSettingsPage | `frontend/src/views/app-content/init-pages.ts` | 290 |
| stgBindMirrorSelect | `frontend/src/views/app-content/settings/init.ts` | 49 |
| stgBindUpdateInterval | `frontend/src/views/app-content/settings/init.ts` | 87 |
| stgBindLinkMode | `frontend/src/views/app-content/settings/init.ts` | 127 |
| stgBindLinkMode | `frontend/src/views/app-content/settings/init.ts` | 150 |
| stgBindLinkMode | `frontend/src/views/app-content/settings/init.ts` | 158 |
| stgBindLinkMode | `frontend/src/views/app-content/settings/init.ts` | 167 |
| stgBindLinkMode | `frontend/src/views/app-content/settings/init.ts` | 195 |
| stgBindReleasesClick | `frontend/src/views/app-content/settings/init.ts` | 241 |
| tdRenderKeymap | `frontend/src/views/app-content/settings/keymap.ts` | 103 |
| tdRenderKeymap | `frontend/src/views/app-content/settings/keymap.ts` | 114 |
| initKeymap | `frontend/src/views/app-content/settings/keymap.ts` | 135 |
| bindPathClick | `frontend/src/views/app-content/settings/path-cards.ts` | 77 |
| initAdvancedGrid | `frontend/src/views/app-content/settings/path-cards.ts` | 254 |
| initAdvancedGrid | `frontend/src/views/app-content/settings/path-cards.ts` | 260 |
| initAdvancedGrid | `frontend/src/views/app-content/settings/path-cards.ts` | 281 |
| initAdvancedGrid | `frontend/src/views/app-content/settings/path-cards.ts` | 287 |
| initMcDetect | `frontend/src/views/app-content/settings/path-cards.ts` | 309 |
| initMcDetect | `frontend/src/views/app-content/settings/path-cards.ts` | 335 |
| initUiPrefs | `frontend/src/views/app-content/settings/ui-prefs.ts` | 123 |
| initUiPrefs | `frontend/src/views/app-content/settings/ui-prefs.ts` | 134 |
| initUiPrefs | `frontend/src/views/app-content/settings/ui-prefs.ts` | 145 |
| initUiPrefs | `frontend/src/views/app-content/settings/ui-prefs.ts` | 157 |
| initUiPrefs | `frontend/src/views/app-content/settings/ui-prefs.ts` | 167 |
| initWorkerPrefs | `frontend/src/views/app-content/settings/worker-prefs.ts` | 44 |
| bindDragEvents | `frontend/src/views/app-content/site/drag.ts` | 59 |
| bindDragEvents | `frontend/src/views/app-content/site/drag.ts` | 93 |
| bindDragEvents | `frontend/src/views/app-content/site/drag.ts` | 115 |
| bindDragEvents | `frontend/src/views/app-content/site/drag.ts` | 124 |
| eeBindToolbarBtns | `frontend/src/views/app-content/site/edit.ts` | 109 |
| eeBindToolbarBtns | `frontend/src/views/app-content/site/edit.ts` | 133 |
| eeBindToolbarBtns | `frontend/src/views/app-content/site/edit.ts` | 140 |
| eeBindFetchBtn | `frontend/src/views/app-content/site/edit.ts` | 226 |
| eeBindFetchBtn | `frontend/src/views/app-content/site/edit.ts` | 233 |
| eeBindFetchBtn | `frontend/src/views/app-content/site/edit.ts` | 249 |
| cmCrBindOverlayEvents | `frontend/src/views/app-content/site/events.ts` | 144 |
| cmBbBindStarBtns | `frontend/src/views/app-content/site/events.ts` | 263 |
| bindSiteEvents | `frontend/src/views/app-content/workshop-site-opener.ts` | 127 |
| bindSiteEvents | `frontend/src/views/app-content/workshop-site-opener.ts` | 137 |
| bindSiteEvents | `frontend/src/views/app-content/workshop-site-opener.ts` | 143 |
| bindSiteEvents | `frontend/src/views/app-content/workshop-site-opener.ts` | 153 |
| bindSiteEvents | `frontend/src/views/app-content/workshop-site-opener.ts` | 164 |
| bindSiteEvents | `frontend/src/views/app-content/workshop-site-opener.ts` | 170 |
| initWorkshopTabs | `frontend/src/views/app-content/workshop-tabs.ts` | 95 |
| initWorkshopTabs | `frontend/src/views/app-content/workshop-tabs.ts` | 144 |
| anBindViewerFab | `frontend/src/views/app-nav/index.ts` | 133 |
| showMorphPreview | `frontend/src/views/app-preview/detail-3d.ts` | 290 |
| showStagePreview | `frontend/src/views/app-preview/detail-3d.ts` | 370 |
| _showModelDetail | `frontend/src/views/app-preview/index.ts` | 299 |
| _showModelDetail | `frontend/src/views/app-preview/index.ts` | 323 |
| openModel3DFullscreen | `frontend/src/views/app-preview/preview-library.ts` | 91 |
| openModel3DFullscreen | `frontend/src/views/app-preview/preview-library.ts` | 130 |
| openModel3DFullscreen | `frontend/src/views/app-preview/preview-library.ts` | 164 |
| makeShotAction | `frontend/src/views/app-preview/shot-panel-shared.ts` | 49 |
| bindCardContextHandler | `frontend/src/views/app-sidebar/events.ts` | 120 |
| (顶层) | `frontend/src/views/app-sidebar/launcher-detect.ts` | 41 |
| runMcSearch | `frontend/src/views/app-sidebar/launcher-detect.ts` | 70 |
| runMcSearch | `frontend/src/views/app-sidebar/launcher-detect.ts` | 89 |
| runLauncherDetect | `frontend/src/views/app-sidebar/launcher-detect.ts` | 140 |
| runLauncherDetect | `frontend/src/views/app-sidebar/launcher-detect.ts` | 162 |
| doLoadInstances | `frontend/src/views/app-sidebar/loader.ts` | 157 |
| beginSync | `frontend/src/views/app-sidebar/sync-flow.ts` | 112 |
| runPush | `frontend/src/views/app-sidebar/sync-flow.ts` | 237 |
| runPush | `frontend/src/views/app-sidebar/sync-flow.ts` | 243 |
| runPush | `frontend/src/views/app-sidebar/sync-flow.ts` | 249 |
| runPull | `frontend/src/views/app-sidebar/sync-flow.ts` | 308 |
| runPull | `frontend/src/views/app-sidebar/sync-flow.ts` | 314 |
| runPull | `frontend/src/views/app-sidebar/sync-flow.ts` | 319 |
| runPull | `frontend/src/views/app-sidebar/sync-flow.ts` | 328 |
| _init | `frontend/src/views/app-sync-manager/index.ts` | 178 |
| performSingleOp | `frontend/src/views/app-sync-manager/network.ts` | 50 |
| performSingleOp | `frontend/src/views/app-sync-manager/network.ts` | 58 |
| loadTypeConfig | `frontend/src/views/app-sync-manager/store.ts` | 35 |
| loadData | `frontend/src/views/app-sync-manager/store.ts` | 91 |
| show | `frontend/src/views/app-toast/index.ts` | 135 |
| show | `frontend/src/views/app-toast/index.ts` | 154 |
| show | `frontend/src/views/app-toast/index.ts` | 163 |
| runBatchRename | `frontend/src/views/app-tree/bus-handlers.ts` | 85 |
| atBeHandleDirRename | `frontend/src/views/app-tree/bus-handlers.ts` | 121 |
| atBeHandleDirMkdir | `frontend/src/views/app-tree/bus-handlers.ts` | 145 |
| atBeHandleDirRecycle | `frontend/src/views/app-tree/bus-handlers.ts` | 190 |
| atBeHandleDirRecycle | `frontend/src/views/app-tree/bus-handlers.ts` | 196 |
| atBeHandleDirBatchRename | `frontend/src/views/app-tree/bus-handlers.ts` | 213 |
| atBeHandleDirBatchRename | `frontend/src/views/app-tree/bus-handlers.ts` | 226 |
| atBeHandleBatchRename | `frontend/src/views/app-tree/bus-handlers.ts` | 245 |
| reload | `frontend/src/views/app-tree/bus-handlers.ts` | 282 |
| runBatchToggle | `frontend/src/views/app-tree/bus-handlers.ts` | 298 |
| runBatchToggle | `frontend/src/views/app-tree/bus-handlers.ts` | 306 |
| runBatchToggle | `frontend/src/views/app-tree/bus-handlers.ts` | 351 |
| runBatchToggle | `frontend/src/views/app-tree/bus-handlers.ts` | 357 |
| atTeBindSelCheckboxes | `frontend/src/views/app-tree/events.ts` | 75 |
| atTeBindSelCheckboxes | `frontend/src/views/app-tree/events.ts` | 83 |
| atTeBindSelCheckboxes | `frontend/src/views/app-tree/events.ts` | 108 |
| atTeOpenAuthor | `frontend/src/views/app-tree/events.ts` | 135 |
| atTeClickRowPreview | `frontend/src/views/app-tree/events.ts` | 176 |
| atTeClickRowCopy | `frontend/src/views/app-tree/events.ts` | 192 |
| atTeClickRowCopy | `frontend/src/views/app-tree/events.ts` | 199 |
| atTeBindRenameInput | `frontend/src/views/app-tree/events.ts` | 392 |
| toggleFolderBatch | `frontend/src/views/app-tree/events.ts` | 432 |
| toggleFolderBatch | `frontend/src/views/app-tree/events.ts` | 440 |
| toggleFolderBatch | `frontend/src/views/app-tree/events.ts` | 500 |
| toggleFolderBatch | `frontend/src/views/app-tree/events.ts` | 510 |
| toastThrottled | `frontend/src/views/app-tree/index.ts` | 74 |
| _attrChangeReloadAsync | `frontend/src/views/app-tree/index.ts` | 233 |
| _onKeyDelete | `frontend/src/views/app-tree/index.ts` | 375 |
| _onKeyDelete | `frontend/src/views/app-tree/index.ts` | 383 |
| _deleteSelected | `frontend/src/views/app-tree/index.ts` | 502 |
| _deleteSelected | `frontend/src/views/app-tree/index.ts` | 509 |
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
| registerErrorDiaryInner | `frontend/src/core/error-diary.ts` | 96 |
| connectedCallback | `frontend/src/views/app-toast/index.ts` | 70 |

### `tree:reload`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| enqueueDownloads | `frontend/src/features/community/download-queue-store.ts` | 284 |
| cmDqCleanupProgressUI | `frontend/src/features/community/download-queue.ts` | 113 |
| refreshUI | `frontend/src/features/context-menu/context-menu-shared.ts` | 17 |
| handleInstanceDrop | `frontend/src/features/dnd/pack-dnd.ts` | 169 |
| (顶层) | `frontend/src/features/import/executor.ts` | 36 |
| (顶层) | `frontend/src/features/import/executor.ts` | 190 |
| setupRecycleActions | `frontend/src/features/maintenance/recycle-bin.ts` | 110 |
| onRecycleEmptyClick | `frontend/src/features/maintenance/recycle-bin.ts` | 176 |
| registerAndroidEvents | `frontend/src/features/platform/android-events.ts` | 54 |
| handleSyncDownloadMissing | `frontend/src/features/sync.ts` | 106 |
| handleSyncToggleStatus | `frontend/src/features/sync.ts` | 211 |
| runExecDelete | `frontend/src/views/app-content/diagnostics/dedup.ts` | 367 |
| runPull | `frontend/src/views/app-sidebar/sync-flow.ts` | 326 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| bindBusEvents | `frontend/src/views/app-tree/bus-handlers.ts` | 54 |

### `tree:set-search`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| connectedCallback | `frontend/src/views/app-content/index.ts` | 161 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| connectedCallback | `frontend/src/views/app-tree/index.ts` | 160 |
