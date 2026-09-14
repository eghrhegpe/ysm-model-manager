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
| `ctx:show` | 6 | 1 | 0 | 0 | ✅ |
| `dir:batch-rename` | 1 | 1 | 0 | 0 | ✅ |
| `dir:mkdir` | 1 | 1 | 0 | 0 | ✅ |
| `dir:recycle` | 1 | 1 | 0 | 0 | ✅ |
| `dir:rename` | 1 | 1 | 0 | 0 | ✅ |
| `instance:clear` | 1 | 1 | 0 | 0 | ✅ |
| `instance:export-list` | 1 | 1 | 0 | 0 | ✅ |
| `lang:changed` | 2 | 2 | 0 | 0 | ✅ |
| `menu:show` | 1 | 1 | 0 | 0 | ✅ |
| `model:select` | 8 | 1 | 0 | 0 | ✅ |
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
| `toast:show` | 180 | 2 | 0 | 0 | ✅ |
| `tree:reload` | 13 | 1 | 0 | 0 | ✅ |
| `tree:set-search` | 1 | 1 | 0 | 0 | ✅ |

## 调用详情

### `avatar:refresh`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| cancelDownloads | `frontend/src/features/community/download-queue-store.ts` | 354 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| initWorkshopPage | `frontend/src/views/app-content/init-workshop.ts` | 156 |

### `batch:disable-all`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| atTlBindBatchMenu | `frontend/src/views/app-tree/toolbar-events.ts` | 203 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| bindBusEvents | `frontend/src/views/app-tree/bus-handlers.ts` | 28 |

### `batch:enable-all`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| atTlBindBatchMenu | `frontend/src/views/app-tree/toolbar-events.ts` | 202 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| bindBusEvents | `frontend/src/views/app-tree/bus-handlers.ts` | 27 |

### `batch:rename`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| runBatchFileOp | `frontend/src/features/context-menu/context-menu-handlers.ts` | 198 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| bindBusEvents | `frontend/src/views/app-tree/bus-handlers.ts` | 50 |

### `community:clearCache`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| cmDqCleanupProgressUI | `frontend/src/features/community/download-queue.ts` | 115 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| connectedCallback | `frontend/src/views/app-content/index.ts` | 91 |

### `ctx:show`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| cmReBindContextMenu | `frontend/src/features/community/repo-events-bindings.ts` | 131 |
| showMenu | `frontend/src/features/context-menu/context-menus.setup.ts` | 152 |
| bindCardContextHandler | `frontend/src/views/app-sidebar/events.ts` | 126 |
| atTeBindContextMenu | `frontend/src/views/app-tree/events.ts` | 283 |
| atTeBindContextMenu | `frontend/src/views/app-tree/events.ts` | 307 |
| atTeBindContextMenu | `frontend/src/views/app-tree/events.ts` | 319 |

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
| runBatchFileOp | `frontend/src/features/context-menu/context-menu-handlers.ts` | 191 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| registerInstanceOps | `frontend/src/features/pack-ops/instance-ops.ts` | 90 |

### `instance:export-list`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| runBatchFileOp | `frontend/src/features/context-menu/context-menu-handlers.ts` | 181 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| registerInstanceOps | `frontend/src/features/pack-ops/instance-ops.ts` | 17 |

### `lang:changed`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| setLang | `frontend/src/core/i18n/locale.ts` | 168 |
| initI18n | `frontend/src/core/i18n/locale.ts` | 223 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| connectedCallback | `frontend/src/views/app-content/index.ts` | 82 |
| connectedCallback | `frontend/src/views/app-nav/index.ts` | 205 |

### `menu:show`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| registerContextMenus | `frontend/src/features/context-menu/context-menus.ts` | 92 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| connectedCallback | `frontend/src/views/context-menu/index.ts` | 69 |

### `model:select`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| handleContainerClick | `frontend/src/features/maintenance/oldest-models.ts` | 42 |
| onRecycleListClick | `frontend/src/features/maintenance/recycle-bin.ts` | 193 |
| bindPreviewClicks | `frontend/src/views/app-content/diagnostics/dedup-render.ts` | 105 |
| showMorphPreview | `frontend/src/views/app-preview/detail-3d.ts` | 373 |
| showStagePreview | `frontend/src/views/app-preview/detail-3d.ts` | 471 |
| atTeClickRowFolder | `frontend/src/views/app-tree/events.ts` | 153 |
| atTeClickRowFile | `frontend/src/views/app-tree/events.ts` | 239 |
| _onKeyArrowNav | `frontend/src/views/app-tree/index.ts` | 553 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| connectedCallback | `frontend/src/views/app-preview/index.ts` | 94 |

### `nav:changed`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| connectedCallback | `frontend/src/views/app-content/index.ts` | 74 |
| _pageInitFailed | `frontend/src/views/app-content/index.ts` | 192 |
| cmBbBindEmptyLocalBtn | `frontend/src/views/app-content/site/events.ts` | 222 |
| anBindNavItems | `frontend/src/views/app-nav/index.ts` | 44 |
| connectedCallback | `frontend/src/views/app-nav/index.ts` | 215 |
| bindFooter | `frontend/src/views/app-sidebar/events.ts` | 256 |
| atTlBindRepoSwitch | `frontend/src/views/app-tree/toolbar-events.ts` | 116 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| connectedCallback | `frontend/src/views/app-content/index.ts` | 61 |
| connectedCallback | `frontend/src/views/app-nav/index.ts` | 185 |

### `package:selected`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| bindCardClickHandler | `frontend/src/views/app-sidebar/events.ts` | 81 |
| restoreSelectedCard | `frontend/src/views/app-sidebar/events.ts` | 242 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| initInstancesPage | `frontend/src/views/app-content/init-pages.ts` | 38 |

### `repo:focus-search`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| anBindNavItems | `frontend/src/views/app-nav/index.ts` | 50 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| bindBusEvents | `frontend/src/views/app-tree/bus-handlers.ts` | 61 |

### `repo:rtype-changed`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| stgBindWebFsa | `frontend/src/views/app-content/settings/init.ts` | 287 |
| stgBindWebFsa | `frontend/src/views/app-content/settings/init.ts` | 309 |
| anBindDualSelects | `frontend/src/views/app-nav/index.ts` | 120 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| useCurrentResourceType | `frontend/src/features/repo/repo-rtype.ts` | 21 |
| initRepositoryPage | `frontend/src/views/app-content/init-pages.ts` | 80 |
| initDedupTab | `frontend/src/views/app-content/init-pages.ts` | 269 |
| connectedCallback | `frontend/src/views/app-nav/index.ts` | 207 |
| connectedCallback | `frontend/src/views/app-sidebar/index.ts` | 127 |
| _init | `frontend/src/views/app-sync-manager/index.ts` | 233 |

### `repo:search-creator`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| cmCrBindOverlayEvents | `frontend/src/views/app-content/site/events.ts` | 169 |
| cmBbBindLocalBadges | `frontend/src/views/app-content/site/events.ts` | 322 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| connectedCallback | `frontend/src/views/app-content/index.ts` | 72 |

### `repo:subdir-changed`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| anBindDualSelects | `frontend/src/views/app-nav/index.ts` | 121 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| _init | `frontend/src/views/app-sync-manager/index.ts` | 256 |

### `stats:refresh`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| runWebEnqueue | `frontend/src/features/community/download-queue-web.ts` | 107 |
| cmDqCleanupProgressUI | `frontend/src/features/community/download-queue.ts` | 122 |
| refreshUI | `frontend/src/features/context-menu/context-menu-shared.ts` | 18 |
| handleInstanceDrop | `frontend/src/features/dnd/pack-dnd.ts` | 171 |
| (顶层) | `frontend/src/features/import/executor.ts` | 56 |
| importWebFilesWithToast | `frontend/src/features/import/executor.ts` | 185 |
| setupRecycleActions | `frontend/src/features/maintenance/recycle-bin.ts` | 111 |
| onRecycleEmptyClick | `frontend/src/features/maintenance/recycle-bin.ts` | 177 |
| registerInstanceOps | `frontend/src/features/pack-ops/instance-ops.ts` | 131 |
| registerAndroidEvents | `frontend/src/features/platform/android-events.ts` | 55 |
| runDownloadMissing | `frontend/src/features/sync/sync.ts` | 75 |
| runSyncToggleStatus | `frontend/src/features/sync/sync.ts` | 185 |
| runExecDelete | `frontend/src/views/app-content/diagnostics/dedup.ts` | 110 |
| stgBindLinkMode | `frontend/src/views/app-content/settings/init.ts` | 150 |
| bindPathClick | `frontend/src/views/app-content/settings/path-cards.ts` | 77 |
| initMcDetect | `frontend/src/views/app-content/settings/path-cards.ts` | 340 |
| runMcSearch | `frontend/src/views/app-sidebar/launcher-detect.ts` | 92 |
| runLauncherDetect | `frontend/src/views/app-sidebar/launcher-detect.ts` | 165 |
| runPull | `frontend/src/views/app-sidebar/sync-flow.ts` | 316 |
| _init | `frontend/src/views/app-sync-manager/index.ts` | 158 |
| _init | `frontend/src/views/app-sync-manager/index.ts` | 172 |
| runBatchRename | `frontend/src/views/app-tree/bus-handlers.ts` | 92 |
| atBeHandleDirRename | `frontend/src/views/app-tree/bus-handlers.ts` | 127 |
| atBeHandleDirRecycle | `frontend/src/views/app-tree/bus-handlers.ts` | 194 |
| atTeBindSelCheckboxes | `frontend/src/views/app-tree/events.ts` | 105 |
| atTeBindRenameInput | `frontend/src/views/app-tree/events.ts` | 386 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| connectedCallback | `frontend/src/views/app-sidebar/index.ts` | 119 |
| _init | `frontend/src/views/app-sync-manager/index.ts` | 213 |

### `sync:download:done`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| handleSyncDownloadMissing | `frontend/src/features/sync/sync.ts` | 119 |
| handleSyncDownloadMissing | `frontend/src/features/sync/sync.ts` | 122 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| pushOne | `frontend/src/views/app-sidebar/sync-flow.ts` | 142 |
| waitBusQuiet | `frontend/src/views/app-sidebar/sync-flow.ts` | 163 |

### `sync:download:missing`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| pushOne | `frontend/src/views/app-sidebar/sync-flow.ts` | 156 |

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
| runStartupSteps | `frontend/src/app-modules.ts` | 88 |
| (顶层) | `frontend/src/app-modules.ts` | 161 |
| resolveAndroidRepoDir | `frontend/src/backend/directory-picker.ts` | 37 |
| resolveAndroidRepoDir | `frontend/src/backend/directory-picker.ts` | 48 |
| resolveAndroidRepoDir | `frontend/src/backend/directory-picker.ts` | 60 |
| runWebEnqueue | `frontend/src/features/community/download-queue-web.ts` | 96 |
| cmDqEnqueue | `frontend/src/features/community/download-queue.ts` | 303 |
| cmDqEnqueue | `frontend/src/features/community/download-queue.ts` | 327 |
| cmReBindDlSelected | `frontend/src/features/community/repo-events-bindings.ts` | 67 |
| cmReBindDlSelected | `frontend/src/features/community/repo-events-bindings.ts` | 79 |
| cmReHandleSingleDownload | `frontend/src/features/community/repo-events-bindings.ts` | 153 |
| cmReBindRowClick | `frontend/src/features/community/repo-events-bindings.ts` | 203 |
| cmReBindRowClick | `frontend/src/features/community/repo-events-bindings.ts` | 237 |
| dgBrApplyReplace | `frontend/src/features/dialogs/batch-rename-form.ts` | 50 |
| dgBrBindApplyClick | `frontend/src/features/dialogs/batch-rename-form.ts` | 265 |
| dgBrBindApplyClick | `frontend/src/features/dialogs/batch-rename-form.ts` | 279 |
| dgBrBindApplyClick | `frontend/src/features/dialogs/batch-rename-form.ts` | 298 |
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
| initRecycleBin | `frontend/src/features/maintenance/recycle-bin.ts` | 268 |
| promptUpdate | `frontend/src/features/maintenance/version-updater.ts` | 144 |
| promptUpdate | `frontend/src/features/maintenance/version-updater.ts` | 153 |
| checkUpdateSilent | `frontend/src/features/maintenance/version-updater.ts` | 179 |
| checkUpdateSilent | `frontend/src/features/maintenance/version-updater.ts` | 188 |
| initVersionUpdater | `frontend/src/features/maintenance/version-updater.ts` | 209 |
| initVersionUpdater | `frontend/src/features/maintenance/version-updater.ts` | 240 |
| initVersionUpdater | `frontend/src/features/maintenance/version-updater.ts` | 250 |
| mountRootMenu | `frontend/src/preview-3d/adapters/mount-preview-core.ts` | 668 |
| beginSwitch | `frontend/src/preview-3d/adapters/switch-preview.ts` | 166 |
| guardGpuBudget | `frontend/src/preview-3d/infra/gpu-budget.ts` | 54 |
| warnLargeModelIfNeeded | `frontend/src/preview-3d/infra/large-model.ts` | 65 |
| showLoadFailure | `frontend/src/preview-3d/infra/preview-loading.ts` | 44 |
| toast | `frontend/src/utils/dom/toast.ts` | 18 |
| dgCfWebGate | `frontend/src/views/app-content/diagnostics/conflicts.ts` | 39 |
| dgCfSyncWebGate | `frontend/src/views/app-content/diagnostics/conflicts.ts` | 193 |
| dgInBindRefreshClear | `frontend/src/views/app-content/diagnostics/init.ts` | 40 |
| dgInBindRefreshClear | `frontend/src/views/app-content/diagnostics/init.ts` | 51 |
| dgInBindRefreshClear | `frontend/src/views/app-content/diagnostics/init.ts` | 57 |
| dgInBindCopyPanel | `frontend/src/views/app-content/diagnostics/init.ts` | 77 |
| dgInBindCopyPanel | `frontend/src/views/app-content/diagnostics/init.ts` | 89 |
| dgInCopyRowLog | `frontend/src/views/app-content/diagnostics/init.ts` | 104 |
| dgInCopyRowLog | `frontend/src/views/app-content/diagnostics/init.ts` | 112 |
| bindPerfCopyHandlers | `frontend/src/views/app-content/diagnostics/perf-common.ts` | 74 |
| guiFlowWebModeCheck | `frontend/src/views/app-content/diagnostics/perf-gui-flow.ts` | 33 |
| _pageInitFailed | `frontend/src/views/app-content/index.ts` | 183 |
| bindTabs | `frontend/src/views/app-content/init-pages.ts` | 167 |
| initSettingsPage | `frontend/src/views/app-content/init-pages.ts` | 304 |
| stgBindMirrorSelect | `frontend/src/views/app-content/settings/init.ts` | 50 |
| stgBindUpdateInterval | `frontend/src/views/app-content/settings/init.ts` | 88 |
| stgBindLinkMode | `frontend/src/views/app-content/settings/init.ts` | 129 |
| stgBindLinkMode | `frontend/src/views/app-content/settings/init.ts` | 152 |
| stgBindLinkMode | `frontend/src/views/app-content/settings/init.ts` | 160 |
| stgBindLinkMode | `frontend/src/views/app-content/settings/init.ts` | 169 |
| stgBindLinkMode | `frontend/src/views/app-content/settings/init.ts` | 197 |
| stgBindReleasesClick | `frontend/src/views/app-content/settings/init.ts` | 243 |
| tdRenderKeymap | `frontend/src/views/app-content/settings/keymap.ts` | 107 |
| tdRenderKeymap | `frontend/src/views/app-content/settings/keymap.ts` | 118 |
| initKeymap | `frontend/src/views/app-content/settings/keymap.ts` | 139 |
| bindPathClick | `frontend/src/views/app-content/settings/path-cards.ts` | 78 |
| initAdvancedGrid | `frontend/src/views/app-content/settings/path-cards.ts` | 259 |
| initAdvancedGrid | `frontend/src/views/app-content/settings/path-cards.ts` | 265 |
| initAdvancedGrid | `frontend/src/views/app-content/settings/path-cards.ts` | 287 |
| initAdvancedGrid | `frontend/src/views/app-content/settings/path-cards.ts` | 293 |
| initMcDetect | `frontend/src/views/app-content/settings/path-cards.ts` | 315 |
| initMcDetect | `frontend/src/views/app-content/settings/path-cards.ts` | 341 |
| initUiPrefs | `frontend/src/views/app-content/settings/ui-prefs.ts` | 113 |
| initUiPrefs | `frontend/src/views/app-content/settings/ui-prefs.ts` | 124 |
| initUiPrefs | `frontend/src/views/app-content/settings/ui-prefs.ts` | 135 |
| initUiPrefs | `frontend/src/views/app-content/settings/ui-prefs.ts` | 147 |
| initUiPrefs | `frontend/src/views/app-content/settings/ui-prefs.ts` | 157 |
| initWorkerPrefs | `frontend/src/views/app-content/settings/worker-prefs.ts` | 44 |
| bindDragEvents | `frontend/src/views/app-content/site/drag.ts` | 60 |
| bindDragEvents | `frontend/src/views/app-content/site/drag.ts` | 96 |
| bindDragEvents | `frontend/src/views/app-content/site/drag.ts` | 118 |
| bindDragEvents | `frontend/src/views/app-content/site/drag.ts` | 127 |
| eeBindToolbarBtns | `frontend/src/views/app-content/site/edit.ts` | 113 |
| eeBindToolbarBtns | `frontend/src/views/app-content/site/edit.ts` | 138 |
| eeBindToolbarBtns | `frontend/src/views/app-content/site/edit.ts` | 145 |
| eeBindFetchBtn | `frontend/src/views/app-content/site/edit.ts` | 231 |
| eeBindFetchBtn | `frontend/src/views/app-content/site/edit.ts` | 238 |
| eeBindFetchBtn | `frontend/src/views/app-content/site/edit.ts` | 254 |
| cmCrBindOverlayEvents | `frontend/src/views/app-content/site/events.ts` | 146 |
| cmBbBindStarBtns | `frontend/src/views/app-content/site/events.ts` | 289 |
| bindSiteEvents | `frontend/src/views/app-content/site/workshop-site-opener.ts` | 131 |
| bindSiteEvents | `frontend/src/views/app-content/site/workshop-site-opener.ts` | 141 |
| bindSiteEvents | `frontend/src/views/app-content/site/workshop-site-opener.ts` | 147 |
| bindSiteEvents | `frontend/src/views/app-content/site/workshop-site-opener.ts` | 157 |
| bindSiteEvents | `frontend/src/views/app-content/site/workshop-site-opener.ts` | 168 |
| bindSiteEvents | `frontend/src/views/app-content/site/workshop-site-opener.ts` | 174 |
| initWorkshopTabs | `frontend/src/views/app-content/site/workshop-tabs.ts` | 96 |
| initWorkshopTabs | `frontend/src/views/app-content/site/workshop-tabs.ts` | 143 |
| anBindViewerFab | `frontend/src/views/app-nav/index.ts` | 142 |
| showMorphPreview | `frontend/src/views/app-preview/detail-3d.ts` | 341 |
| showStagePreview | `frontend/src/views/app-preview/detail-3d.ts` | 421 |
| openModel3DFullscreen | `frontend/src/views/app-preview/preview-library.ts` | 91 |
| openModel3DFullscreen | `frontend/src/views/app-preview/preview-library.ts` | 130 |
| openModel3DFullscreen | `frontend/src/views/app-preview/preview-library.ts` | 164 |
| routeModelPreview | `frontend/src/views/app-preview/preview-router.ts` | 35 |
| routeModelPreview | `frontend/src/views/app-preview/preview-router.ts` | 60 |
| makeShotAction | `frontend/src/views/app-preview/shot-panel-shared.ts` | 49 |
| bindCardContextHandler | `frontend/src/views/app-sidebar/events.ts` | 119 |
| (顶层) | `frontend/src/views/app-sidebar/launcher-detect.ts` | 42 |
| runMcSearch | `frontend/src/views/app-sidebar/launcher-detect.ts` | 74 |
| runMcSearch | `frontend/src/views/app-sidebar/launcher-detect.ts` | 93 |
| runLauncherDetect | `frontend/src/views/app-sidebar/launcher-detect.ts` | 144 |
| runLauncherDetect | `frontend/src/views/app-sidebar/launcher-detect.ts` | 166 |
| doLoadInstances | `frontend/src/views/app-sidebar/loader.ts` | 157 |
| beginSync | `frontend/src/views/app-sidebar/sync-flow.ts` | 112 |
| runPush | `frontend/src/views/app-sidebar/sync-flow.ts` | 255 |
| runPush | `frontend/src/views/app-sidebar/sync-flow.ts` | 261 |
| runPush | `frontend/src/views/app-sidebar/sync-flow.ts` | 267 |
| runPull | `frontend/src/views/app-sidebar/sync-flow.ts` | 299 |
| runPull | `frontend/src/views/app-sidebar/sync-flow.ts` | 305 |
| runPull | `frontend/src/views/app-sidebar/sync-flow.ts` | 310 |
| runPull | `frontend/src/views/app-sidebar/sync-flow.ts` | 319 |
| _init | `frontend/src/views/app-sync-manager/index.ts` | 206 |
| performSingleOp | `frontend/src/views/app-sync-manager/network.ts` | 50 |
| performSingleOp | `frontend/src/views/app-sync-manager/network.ts` | 58 |
| loadTypeConfig | `frontend/src/views/app-sync-manager/store.ts` | 35 |
| loadData | `frontend/src/views/app-sync-manager/store.ts` | 91 |
| show | `frontend/src/views/app-toast/index.ts` | 139 |
| show | `frontend/src/views/app-toast/index.ts` | 158 |
| show | `frontend/src/views/app-toast/index.ts` | 167 |
| runBatchRename | `frontend/src/views/app-tree/bus-handlers.ts` | 93 |
| atBeHandleDirRename | `frontend/src/views/app-tree/bus-handlers.ts` | 129 |
| atBeHandleDirMkdir | `frontend/src/views/app-tree/bus-handlers.ts` | 153 |
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
| toastThrottled | `frontend/src/views/app-tree/index.ts` | 76 |
| _attrChangeReloadAsync | `frontend/src/views/app-tree/index.ts` | 323 |
| _onKeyDelete | `frontend/src/views/app-tree/index.ts` | 477 |
| _onKeyDelete | `frontend/src/views/app-tree/index.ts` | 485 |
| _deleteSelected | `frontend/src/views/app-tree/index.ts` | 605 |
| _deleteSelected | `frontend/src/views/app-tree/index.ts` | 612 |
| toastLoadError | `frontend/src/views/app-tree/loader.ts` | 32 |
| maybePromptAndroidStorage | `frontend/src/views/app-tree/loader.ts` | 56 |
| atTlShowConfirm | `frontend/src/views/app-tree/toolbar-events.ts` | 48 |
| atTlShowConfirm | `frontend/src/views/app-tree/toolbar-events.ts` | 59 |
| atTlBindAdvFilter | `frontend/src/views/app-tree/toolbar-events.ts` | 160 |
| atTlBindMoreMenu | `frontend/src/views/app-tree/toolbar-events.ts` | 300 |
| atTlBindMoreMenu | `frontend/src/views/app-tree/toolbar-events.ts` | 318 |
| atTlBindMoreMenu | `frontend/src/views/app-tree/toolbar-events.ts` | 324 |
| atTlBindMoreMenu | `frontend/src/views/app-tree/toolbar-events.ts` | 335 |
| advFilterFetchTagPaths | `frontend/src/views/app-tree/toolbar-search.ts` | 162 |
| advFilterSearchModelPaths | `frontend/src/views/app-tree/toolbar-search.ts` | 181 |
| advFilterSearchModelPaths | `frontend/src/views/app-tree/toolbar-search.ts` | 211 |
| advFilterWarnWebDegraded | `frontend/src/views/app-tree/toolbar-search.ts` | 227 |
| advFilterToastAndRender | `frontend/src/views/app-tree/toolbar-search.ts` | 256 |
| advFilterToastAndRender | `frontend/src/views/app-tree/toolbar-search.ts` | 262 |
| pickWebFilesAndImport | `frontend/src/views/app-tree/toolbar-search.ts` | 324 |
| pickWebFilesAndImport | `frontend/src/views/app-tree/toolbar-search.ts` | 333 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| registerErrorDiary | `frontend/src/core/error-diary.ts` | 136 |
| connectedCallback | `frontend/src/views/app-toast/index.ts` | 75 |

### `tree:reload`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| runWebEnqueue | `frontend/src/features/community/download-queue-web.ts` | 106 |
| cmDqCleanupProgressUI | `frontend/src/features/community/download-queue.ts` | 121 |
| refreshUI | `frontend/src/features/context-menu/context-menu-shared.ts` | 17 |
| handleInstanceDrop | `frontend/src/features/dnd/pack-dnd.ts` | 172 |
| (顶层) | `frontend/src/features/import/executor.ts` | 57 |
| importWebFilesWithToast | `frontend/src/features/import/executor.ts` | 184 |
| setupRecycleActions | `frontend/src/features/maintenance/recycle-bin.ts` | 112 |
| onRecycleEmptyClick | `frontend/src/features/maintenance/recycle-bin.ts` | 178 |
| registerAndroidEvents | `frontend/src/features/platform/android-events.ts` | 54 |
| handleSyncDownloadMissing | `frontend/src/features/sync/sync.ts` | 106 |
| handleSyncToggleStatus | `frontend/src/features/sync/sync.ts` | 211 |
| runExecDelete | `frontend/src/views/app-content/diagnostics/dedup.ts` | 111 |
| runPull | `frontend/src/views/app-sidebar/sync-flow.ts` | 317 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| bindBusEvents | `frontend/src/views/app-tree/bus-handlers.ts` | 55 |

### `tree:set-search`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| connectedCallback | `frontend/src/views/app-content/index.ts` | 76 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| connectedCallback | `frontend/src/views/app-tree/index.ts` | 250 |
