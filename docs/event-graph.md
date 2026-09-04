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
| `toast:show` | 197 | 2 | 0 | 0 | ✅ |
| `tree:reload` | 13 | 1 | 0 | 0 | ✅ |
| `tree:set-search` | 1 | 1 | 0 | 0 | ✅ |

## 调用详情

### `avatar:refresh`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| eventArr | `frontend/src/features/community/download-queue-store.ts` | 382 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| initWorkshopPage | `frontend/src/views/app-content/init-workshop.ts` | 149 |

### `batch:disable-all`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| atTlBindBatchMenu | `frontend/src/views/app-tree/toolbar-events.ts` | 200 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| bindBusEvents | `frontend/src/views/app-tree/bus-handlers.ts` | 25 |

### `batch:enable-all`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| atTlBindBatchMenu | `frontend/src/views/app-tree/toolbar-events.ts` | 199 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| bindBusEvents | `frontend/src/views/app-tree/bus-handlers.ts` | 24 |

### `batch:rename`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| (顶层) | `frontend/src/core/context-menu-handlers.ts` | 205 |

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
| bindCardContextHandler | `frontend/src/views/app-sidebar/events.ts` | 121 |
| atTeBindContextMenu | `frontend/src/views/app-tree/events.ts` | 294 |
| atTeBindContextMenu | `frontend/src/views/app-tree/events.ts` | 318 |
| atTeBindContextMenu | `frontend/src/views/app-tree/events.ts` | 329 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| registerContextMenus | `frontend/src/core/context-menus.ts` | 90 |

### `dir:batch-rename`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| (顶层) | `frontend/src/core/context-menu-dir-handlers.ts` | 13 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| bindBusEvents | `frontend/src/views/app-tree/bus-handlers.ts` | 42 |

### `dir:mkdir`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| (顶层) | `frontend/src/core/context-menu-dir-handlers.ts` | 56 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| bindBusEvents | `frontend/src/views/app-tree/bus-handlers.ts` | 32 |

### `dir:recycle`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| (顶层) | `frontend/src/core/context-menu-dir-handlers.ts` | 57 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| bindBusEvents | `frontend/src/views/app-tree/bus-handlers.ts` | 37 |

### `dir:rename`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| (顶层) | `frontend/src/core/context-menu-dir-handlers.ts` | 12 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| bindBusEvents | `frontend/src/views/app-tree/bus-handlers.ts` | 27 |

### `instance:clear`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| (顶层) | `frontend/src/core/context-menu-handlers.ts` | 198 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| registerInstanceOps | `frontend/src/core/handlers/instance-ops.ts` | 95 |

### `instance:export-list`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| (顶层) | `frontend/src/core/context-menu-handlers.ts` | 188 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| registerInstanceOps | `frontend/src/core/handlers/instance-ops.ts` | 16 |

### `lang:changed`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| setLang | `frontend/src/core/i18n/locale.ts` | 100 |
| initI18n | `frontend/src/core/i18n/locale.ts` | 149 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| connectedCallback | `frontend/src/views/app-content/index.ts` | 163 |
| connectedCallback | `frontend/src/views/app-nav/index.ts` | 187 |

### `menu:show`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| registerContextMenus | `frontend/src/core/context-menus.ts` | 91 |
| cmReBindContextMenu | `frontend/src/features/community/events.ts` | 199 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| connectedCallback | `frontend/src/views/context-menu/index.ts` | 29 |

### `model:select`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| handleContainerClick | `frontend/src/features/oldest-models.ts` | 58 |
| onRecycleListClick | `frontend/src/features/recycle-bin.ts` | 187 |
| bindPreviewClicks | `frontend/src/views/app-content/diagnostics/dedup.ts` | 223 |
| showMorphPreview | `frontend/src/views/app-preview/detail-3d.ts` | 272 |
| showStagePreview | `frontend/src/views/app-preview/detail-3d.ts` | 349 |
| atTeClickRowFolder | `frontend/src/views/app-tree/events.ts` | 156 |
| atTeClickRowFile | `frontend/src/views/app-tree/events.ts` | 250 |
| _onKeyArrowNav | `frontend/src/views/app-tree/index.ts` | 407 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| connectedCallback | `frontend/src/views/app-preview/index.ts` | 159 |

### `nav:changed`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| connectedCallback | `frontend/src/views/app-content/index.ts` | 155 |
| _pageInitFailed | `frontend/src/views/app-content/index.ts` | 261 |
| cmBbBindEmptyLocalBtn | `frontend/src/views/app-content/site/events.ts` | 197 |
| anBindNavItems | `frontend/src/views/app-nav/index.ts` | 40 |
| connectedCallback | `frontend/src/views/app-nav/index.ts` | 197 |
| bindFooter | `frontend/src/views/app-sidebar/events.ts` | 241 |
| atTlBindRepoSwitch | `frontend/src/views/app-tree/toolbar-events.ts` | 112 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| registerPageStore | `frontend/src/core/page-store.ts` | 68 |
| connectedCallback | `frontend/src/views/app-content/index.ts` | 144 |
| connectedCallback | `frontend/src/views/app-nav/index.ts` | 173 |

### `package:selected`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| bindCardClickHandler | `frontend/src/views/app-sidebar/events.ts` | 76 |
| restoreSelectedCard | `frontend/src/views/app-sidebar/events.ts` | 227 |

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
| connectedCallback | `frontend/src/views/app-nav/index.ts` | 189 |
| connectedCallback | `frontend/src/views/app-sidebar/index.ts` | 487 |
| _init | `frontend/src/views/app-sync-manager/index.ts` | 186 |

### `repo:search-creator`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| cmCrBindOverlayEvents | `frontend/src/views/app-content/site/events.ts` | 168 |
| cmBbBindLocalBadges | `frontend/src/views/app-content/site/events.ts` | 297 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| connectedCallback | `frontend/src/views/app-content/index.ts` | 153 |

### `repo:subdir-changed`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| anBindDualSelects | `frontend/src/views/app-nav/index.ts` | 111 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| _init | `frontend/src/views/app-sync-manager/index.ts` | 209 |

### `stats:refresh`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| refreshUI | `frontend/src/core/context-menu-shared.ts` | 21 |
| registerAndroidEvents | `frontend/src/core/handlers/android-events.ts` | 67 |
| registerInstanceOps | `frontend/src/core/handlers/instance-ops.ts` | 144 |
| runDownloadMissing | `frontend/src/core/handlers/sync.ts` | 79 |
| runSyncToggleStatus | `frontend/src/core/handlers/sync.ts` | 203 |
| enqueueDownloads | `frontend/src/features/community/download-queue-store.ts` | 261 |
| cmDqCleanupProgressUI | `frontend/src/features/community/download-queue.ts` | 114 |
| (顶层) | `frontend/src/features/import-executor.ts` | 38 |
| (顶层) | `frontend/src/features/import-executor.ts` | 197 |
| handleInstanceDrop | `frontend/src/features/pack-dnd.ts` | 171 |
| setupRecycleActions | `frontend/src/features/recycle-bin.ts` | 106 |
| onRecycleEmptyClick | `frontend/src/features/recycle-bin.ts` | 171 |
| runExecDelete | `frontend/src/views/app-content/diagnostics/dedup.ts` | 367 |
| stgBindLinkMode | `frontend/src/views/app-content/settings/init.ts` | 148 |
| bindPathClick | `frontend/src/views/app-content/settings/path-cards.ts` | 94 |
| initMcDetect | `frontend/src/views/app-content/settings/path-cards.ts` | 376 |
| runPull | `frontend/src/views/app-sidebar/index.ts` | 355 |
| runMcSearch | `frontend/src/views/app-sidebar/launcher-detect.ts` | 84 |
| runLauncherDetect | `frontend/src/views/app-sidebar/launcher-detect.ts` | 157 |
| _doRender | `frontend/src/views/app-sync-manager/index.ts` | 231 |
| runBatchRename | `frontend/src/views/app-tree/bus-handlers.ts` | 82 |
| atBeHandleDirRename | `frontend/src/views/app-tree/bus-handlers.ts` | 117 |
| atBeHandleDirRecycle | `frontend/src/views/app-tree/bus-handlers.ts` | 184 |
| atTeBindSelCheckboxes | `frontend/src/views/app-tree/events.ts` | 100 |
| atTeBindRenameInput | `frontend/src/views/app-tree/events.ts` | 380 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| connectedCallback | `frontend/src/views/app-sidebar/index.ts` | 479 |
| _init | `frontend/src/views/app-sync-manager/index.ts` | 166 |

### `sync:download:done`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| handleSyncDownloadMissing | `frontend/src/core/handlers/sync.ts` | 99 |
| handleSyncDownloadMissing | `frontend/src/core/handlers/sync.ts` | 135 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| pushOne | `frontend/src/views/app-sidebar/index.ts` | 198 |
| waitBusQuiet | `frontend/src/views/app-sidebar/index.ts` | 219 |

### `sync:download:missing`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| pushOne | `frontend/src/views/app-sidebar/index.ts` | 212 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| registerSync | `frontend/src/core/handlers/sync.ts` | 248 |

### `sync:toggle:status`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| runBatchToggle | `frontend/src/views/app-tree/bus-handlers.ts` | 337 |
| atTeBindSelCheckboxes | `frontend/src/views/app-tree/events.ts` | 98 |
| toggleFolderBatch | `frontend/src/views/app-tree/events.ts` | 471 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| registerSync | `frontend/src/core/handlers/sync.ts` | 250 |

### `toast:show`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| runStartupSteps | `frontend/src/app-modules.ts` | 67 |
| (顶层) | `frontend/src/app-modules.ts` | 125 |
| toast | `frontend/src/core/context-menu-shared.ts` | 30 |
| resolveDstDir | `frontend/src/core/context-menu-shared.ts` | 80 |
| resolveDstDir | `frontend/src/core/context-menu-shared.ts` | 90 |
| registerAndroidEvents | `frontend/src/core/handlers/android-events.ts` | 26 |
| registerAndroidEvents | `frontend/src/core/handlers/android-events.ts` | 43 |
| registerInstanceOps | `frontend/src/core/handlers/instance-ops.ts` | 33 |
| registerInstanceOps | `frontend/src/core/handlers/instance-ops.ts` | 72 |
| registerInstanceOps | `frontend/src/core/handlers/instance-ops.ts` | 82 |
| registerInstanceOps | `frontend/src/core/handlers/instance-ops.ts` | 119 |
| registerInstanceOps | `frontend/src/core/handlers/instance-ops.ts` | 135 |
| registerInstanceOps | `frontend/src/core/handlers/instance-ops.ts` | 145 |
| requireMcRoot | `frontend/src/core/handlers/require-mcroot.ts` | 19 |
| runDownloadMissing | `frontend/src/core/handlers/sync.ts` | 42 |
| runDownloadMissing | `frontend/src/core/handlers/sync.ts` | 80 |
| handleSyncDownloadMissing | `frontend/src/core/handlers/sync.ts` | 111 |
| handleSyncDownloadMissing | `frontend/src/core/handlers/sync.ts` | 128 |
| runSyncToggleStatus | `frontend/src/core/handlers/sync.ts` | 153 |
| runSyncToggleStatus | `frontend/src/core/handlers/sync.ts` | 162 |
| runSyncToggleStatus | `frontend/src/core/handlers/sync.ts` | 196 |
| handleSyncToggleStatus | `frontend/src/core/handlers/sync.ts` | 211 |
| handleSyncToggleStatus | `frontend/src/core/handlers/sync.ts` | 229 |
| enqueueDownloads | `frontend/src/features/community/download-queue-store.ts` | 250 |
| cmDqEnqueue | `frontend/src/features/community/download-queue.ts` | 278 |
| cmDqEnqueue | `frontend/src/features/community/download-queue.ts` | 304 |
| cmReBindDlSelected | `frontend/src/features/community/events.ts` | 144 |
| cmReBindDlSelected | `frontend/src/features/community/events.ts` | 156 |
| cmReHandleSingleDownload | `frontend/src/features/community/events.ts` | 225 |
| cmReBindRowClick | `frontend/src/features/community/events.ts` | 275 |
| cmReBindRowClick | `frontend/src/features/community/events.ts` | 309 |
| dgBrApplyReplace | `frontend/src/features/dialogs/batch-rename.ts` | 101 |
| dgBrBindApplyClick | `frontend/src/features/dialogs/batch-rename.ts` | 425 |
| dgBrBindApplyClick | `frontend/src/features/dialogs/batch-rename.ts` | 439 |
| dgBrBindApplyClick | `frontend/src/features/dialogs/batch-rename.ts` | 458 |
| handleTreeDrop | `frontend/src/features/import-dnd.ts` | 47 |
| handleTreeDrop | `frontend/src/features/import-dnd.ts` | 65 |
| handleTreeDrop | `frontend/src/features/import-dnd.ts` | 84 |
| handleTreeDrop | `frontend/src/features/import-dnd.ts` | 94 |
| handleTreeDrop | `frontend/src/features/import-dnd.ts` | 112 |
| bindTreeDnD | `frontend/src/features/import-dnd.ts` | 217 |
| (顶层) | `frontend/src/features/import-executor.ts` | 33 |
| (顶层) | `frontend/src/features/import-executor.ts` | 188 |
| (顶层) | `frontend/src/features/import-executor.ts` | 201 |
| (顶层) | `frontend/src/features/pack-dnd.ts` | 42 |
| initRecycleBin | `frontend/src/features/recycle-bin.ts` | 267 |
| promptUpdate | `frontend/src/features/version-updater.ts` | 144 |
| promptUpdate | `frontend/src/features/version-updater.ts` | 153 |
| checkUpdateSilent | `frontend/src/features/version-updater.ts` | 179 |
| checkUpdateSilent | `frontend/src/features/version-updater.ts` | 188 |
| initVersionUpdater | `frontend/src/features/version-updater.ts` | 209 |
| initVersionUpdater | `frontend/src/features/version-updater.ts` | 240 |
| initVersionUpdater | `frontend/src/features/version-updater.ts` | 250 |
| mount3D | `frontend/src/preview-3d/adapters/mount-preview-core.ts` | 518 |
| showLoadFailure | `frontend/src/preview-3d/adapters/preview-loading.ts` | 43 |
| beginSwitch | `frontend/src/preview-3d/adapters/switch-preview.ts` | 160 |
| resolveAndroidRepoDir | `frontend/src/utils/dom/directory-picker.ts` | 35 |
| resolveAndroidRepoDir | `frontend/src/utils/dom/directory-picker.ts` | 46 |
| resolveAndroidRepoDir | `frontend/src/utils/dom/directory-picker.ts` | 58 |
| (顶层) | `frontend/src/utils/module-loader.ts` | 19 |
| dgCfWebGate | `frontend/src/views/app-content/diagnostics/conflicts.ts` | 37 |
| dgCfSyncWebGate | `frontend/src/views/app-content/diagnostics/conflicts.ts` | 190 |
| dgInBindRefreshClear | `frontend/src/views/app-content/diagnostics/init.ts` | 40 |
| dgInBindRefreshClear | `frontend/src/views/app-content/diagnostics/init.ts` | 51 |
| dgInBindRefreshClear | `frontend/src/views/app-content/diagnostics/init.ts` | 57 |
| dgInBindCopyPanel | `frontend/src/views/app-content/diagnostics/init.ts` | 75 |
| dgInBindCopyPanel | `frontend/src/views/app-content/diagnostics/init.ts` | 87 |
| dgInCopyRowLog | `frontend/src/views/app-content/diagnostics/init.ts` | 102 |
| dgInCopyRowLog | `frontend/src/views/app-content/diagnostics/init.ts` | 110 |
| bindPerfCopyHandlers | `frontend/src/views/app-content/diagnostics/perf-cli.ts` | 84 |
| guiFlowWebModeCheck | `frontend/src/views/app-content/diagnostics/perf-cli.ts` | 365 |
| _pageInitFailed | `frontend/src/views/app-content/index.ts` | 252 |
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
| bindPathClick | `frontend/src/views/app-content/settings/path-cards.ts` | 95 |
| initAdvancedGrid | `frontend/src/views/app-content/settings/path-cards.ts` | 297 |
| initAdvancedGrid | `frontend/src/views/app-content/settings/path-cards.ts` | 303 |
| initAdvancedGrid | `frontend/src/views/app-content/settings/path-cards.ts` | 323 |
| initAdvancedGrid | `frontend/src/views/app-content/settings/path-cards.ts` | 329 |
| initMcDetect | `frontend/src/views/app-content/settings/path-cards.ts` | 351 |
| initMcDetect | `frontend/src/views/app-content/settings/path-cards.ts` | 377 |
| initUiPrefs | `frontend/src/views/app-content/settings/ui-prefs.ts` | 117 |
| initUiPrefs | `frontend/src/views/app-content/settings/ui-prefs.ts` | 128 |
| initUiPrefs | `frontend/src/views/app-content/settings/ui-prefs.ts` | 139 |
| initUiPrefs | `frontend/src/views/app-content/settings/ui-prefs.ts` | 151 |
| initUiPrefs | `frontend/src/views/app-content/settings/ui-prefs.ts` | 161 |
| initWorkerPrefs | `frontend/src/views/app-content/settings/worker-prefs.ts` | 44 |
| bindDragEvents | `frontend/src/views/app-content/site/drag.ts` | 44 |
| bindDragEvents | `frontend/src/views/app-content/site/drag.ts` | 85 |
| bindDragEvents | `frontend/src/views/app-content/site/drag.ts` | 109 |
| bindDragEvents | `frontend/src/views/app-content/site/drag.ts` | 118 |
| eeBindToolbarBtns | `frontend/src/views/app-content/site/edit.ts` | 108 |
| eeBindToolbarBtns | `frontend/src/views/app-content/site/edit.ts` | 134 |
| eeBindToolbarBtns | `frontend/src/views/app-content/site/edit.ts` | 141 |
| eeBindFetchBtn | `frontend/src/views/app-content/site/edit.ts` | 222 |
| eeBindFetchBtn | `frontend/src/views/app-content/site/edit.ts` | 229 |
| eeBindFetchBtn | `frontend/src/views/app-content/site/edit.ts` | 245 |
| cmCrBindOverlayEvents | `frontend/src/views/app-content/site/events.ts` | 145 |
| cmBbBindStarBtns | `frontend/src/views/app-content/site/events.ts` | 264 |
| bindSiteEvents | `frontend/src/views/app-content/workshop-site-opener.ts` | 116 |
| bindSiteEvents | `frontend/src/views/app-content/workshop-site-opener.ts` | 126 |
| bindSiteEvents | `frontend/src/views/app-content/workshop-site-opener.ts` | 132 |
| bindSiteEvents | `frontend/src/views/app-content/workshop-site-opener.ts` | 142 |
| bindSiteEvents | `frontend/src/views/app-content/workshop-site-opener.ts` | 153 |
| bindSiteEvents | `frontend/src/views/app-content/workshop-site-opener.ts` | 159 |
| initWorkshopTabs | `frontend/src/views/app-content/workshop-tabs.ts` | 94 |
| initWorkshopTabs | `frontend/src/views/app-content/workshop-tabs.ts` | 143 |
| anBindViewerFab | `frontend/src/views/app-nav/index.ts` | 132 |
| showMorphPreview | `frontend/src/views/app-preview/detail-3d.ts` | 287 |
| showStagePreview | `frontend/src/views/app-preview/detail-3d.ts` | 363 |
| _showModelDetail | `frontend/src/views/app-preview/index.ts` | 288 |
| _showModelDetail | `frontend/src/views/app-preview/index.ts` | 312 |
| openModel3DFullscreen | `frontend/src/views/app-preview/preview-library.ts` | 114 |
| openModel3DFullscreen | `frontend/src/views/app-preview/preview-library.ts` | 148 |
| makeShotAction | `frontend/src/views/app-preview/shot-panel-shared.ts` | 48 |
| bindCardContextHandler | `frontend/src/views/app-sidebar/events.ts` | 114 |
| beginSync | `frontend/src/views/app-sidebar/index.ts` | 142 |
| runPush | `frontend/src/views/app-sidebar/index.ts` | 267 |
| runPush | `frontend/src/views/app-sidebar/index.ts` | 273 |
| runPush | `frontend/src/views/app-sidebar/index.ts` | 279 |
| runPull | `frontend/src/views/app-sidebar/index.ts` | 338 |
| runPull | `frontend/src/views/app-sidebar/index.ts` | 344 |
| runPull | `frontend/src/views/app-sidebar/index.ts` | 349 |
| runPull | `frontend/src/views/app-sidebar/index.ts` | 358 |
| (顶层) | `frontend/src/views/app-sidebar/launcher-detect.ts` | 37 |
| runMcSearch | `frontend/src/views/app-sidebar/launcher-detect.ts` | 66 |
| runMcSearch | `frontend/src/views/app-sidebar/launcher-detect.ts` | 85 |
| runLauncherDetect | `frontend/src/views/app-sidebar/launcher-detect.ts` | 136 |
| runLauncherDetect | `frontend/src/views/app-sidebar/launcher-detect.ts` | 158 |
| doLoadInstances | `frontend/src/views/app-sidebar/loader.ts` | 143 |
| _init | `frontend/src/views/app-sync-manager/index.ts` | 159 |
| performSingleOp | `frontend/src/views/app-sync-manager/network.ts` | 47 |
| performSingleOp | `frontend/src/views/app-sync-manager/network.ts` | 55 |
| loadTypeConfig | `frontend/src/views/app-sync-manager/store.ts` | 34 |
| loadData | `frontend/src/views/app-sync-manager/store.ts` | 90 |
| show | `frontend/src/views/app-toast/index.ts` | 132 |
| show | `frontend/src/views/app-toast/index.ts` | 151 |
| show | `frontend/src/views/app-toast/index.ts` | 160 |
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
| atTeBindRenameInput | `frontend/src/views/app-tree/events.ts` | 383 |
| toggleFolderBatch | `frontend/src/views/app-tree/events.ts` | 423 |
| toggleFolderBatch | `frontend/src/views/app-tree/events.ts` | 431 |
| toggleFolderBatch | `frontend/src/views/app-tree/events.ts` | 474 |
| toggleFolderBatch | `frontend/src/views/app-tree/events.ts` | 484 |
| _attrChangeReloadAsync | `frontend/src/views/app-tree/index.ts` | 196 |
| _onKeyDelete | `frontend/src/views/app-tree/index.ts` | 335 |
| _onKeyDelete | `frontend/src/views/app-tree/index.ts` | 343 |
| _deleteSelected | `frontend/src/views/app-tree/index.ts` | 455 |
| _deleteSelected | `frontend/src/views/app-tree/index.ts` | 462 |
| toastLoadError | `frontend/src/views/app-tree/loader.ts` | 32 |
| maybePromptAndroidStorage | `frontend/src/views/app-tree/loader.ts` | 56 |
| atTlShowConfirm | `frontend/src/views/app-tree/toolbar-events.ts` | 44 |
| atTlShowConfirm | `frontend/src/views/app-tree/toolbar-events.ts` | 55 |
| atTlBindAdvFilter | `frontend/src/views/app-tree/toolbar-events.ts` | 157 |
| atTlBindMoreMenu | `frontend/src/views/app-tree/toolbar-events.ts` | 297 |
| atTlBindMoreMenu | `frontend/src/views/app-tree/toolbar-events.ts` | 315 |
| atTlBindMoreMenu | `frontend/src/views/app-tree/toolbar-events.ts` | 321 |
| atTlBindMoreMenu | `frontend/src/views/app-tree/toolbar-events.ts` | 332 |
| advFilterFetchTagPaths | `frontend/src/views/app-tree/toolbar-search.ts` | 159 |
| advFilterSearchModelPaths | `frontend/src/views/app-tree/toolbar-search.ts` | 178 |
| advFilterSearchModelPaths | `frontend/src/views/app-tree/toolbar-search.ts` | 208 |
| advFilterWarnWebDegraded | `frontend/src/views/app-tree/toolbar-search.ts` | 224 |
| advFilterToastAndRender | `frontend/src/views/app-tree/toolbar-search.ts` | 253 |
| advFilterToastAndRender | `frontend/src/views/app-tree/toolbar-search.ts` | 259 |
| pickWebFilesAndImport | `frontend/src/views/app-tree/toolbar-search.ts` | 321 |
| pickWebFilesAndImport | `frontend/src/views/app-tree/toolbar-search.ts` | 330 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| registerErrorDiary | `frontend/src/core/error-diary.ts` | 57 |
| connectedCallback | `frontend/src/views/app-toast/index.ts` | 68 |

### `tree:reload`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| refreshUI | `frontend/src/core/context-menu-shared.ts` | 20 |
| registerAndroidEvents | `frontend/src/core/handlers/android-events.ts` | 66 |
| handleSyncDownloadMissing | `frontend/src/core/handlers/sync.ts` | 123 |
| handleSyncToggleStatus | `frontend/src/core/handlers/sync.ts` | 236 |
| enqueueDownloads | `frontend/src/features/community/download-queue-store.ts` | 260 |
| cmDqCleanupProgressUI | `frontend/src/features/community/download-queue.ts` | 113 |
| (顶层) | `frontend/src/features/import-executor.ts` | 39 |
| (顶层) | `frontend/src/features/import-executor.ts` | 196 |
| handleInstanceDrop | `frontend/src/features/pack-dnd.ts` | 172 |
| setupRecycleActions | `frontend/src/features/recycle-bin.ts` | 107 |
| onRecycleEmptyClick | `frontend/src/features/recycle-bin.ts` | 172 |
| runExecDelete | `frontend/src/views/app-content/diagnostics/dedup.ts` | 368 |
| runPull | `frontend/src/views/app-sidebar/index.ts` | 356 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| bindBusEvents | `frontend/src/views/app-tree/bus-handlers.ts` | 52 |

### `tree:set-search`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| connectedCallback | `frontend/src/views/app-content/index.ts` | 157 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| connectedCallback | `frontend/src/views/app-tree/index.ts` | 135 |
