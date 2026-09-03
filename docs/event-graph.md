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
| `toast:show` | 199 | 2 | 0 | 0 | ✅ |
| `tree:reload` | 13 | 1 | 0 | 0 | ✅ |
| `tree:set-search` | 1 | 1 | 0 | 0 | ✅ |

## 调用详情

### `avatar:refresh`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| eventArr | `frontend/src/features/community/download-queue-store.ts` | 380 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| initWorkshopPage | `frontend/src/views/app-content/init-workshop.ts` | 144 |

### `batch:disable-all`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| atTlBindBatchMenu | `frontend/src/views/app-tree/toolbar-events.ts` | 213 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| bindBusEvents | `frontend/src/views/app-tree/bus-handlers.ts` | 24 |

### `batch:enable-all`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| atTlBindBatchMenu | `frontend/src/views/app-tree/toolbar-events.ts` | 212 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| bindBusEvents | `frontend/src/views/app-tree/bus-handlers.ts` | 23 |

### `batch:rename`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| (顶层) | `frontend/src/core/context-menu-handlers.ts` | 189 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| bindBusEvents | `frontend/src/views/app-tree/bus-handlers.ts` | 29 |

### `community:clearCache`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| cmDqCleanupProgressUI | `frontend/src/features/community/download-queue.ts` | 107 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| (顶层) | `frontend/src/views/app-content/community-data.ts` | 81 |

### `ctx:show`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| bindCardContextHandler | `frontend/src/views/app-sidebar/events.ts` | 123 |
| atTeBindContextMenu | `frontend/src/views/app-tree/events.ts` | 297 |
| atTeBindContextMenu | `frontend/src/views/app-tree/events.ts` | 321 |
| atTeBindContextMenu | `frontend/src/views/app-tree/events.ts` | 332 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| registerContextMenus | `frontend/src/core/context-menus.ts` | 86 |

### `dir:batch-rename`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| (顶层) | `frontend/src/core/context-menu-dir-handlers.ts` | 13 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| bindBusEvents | `frontend/src/views/app-tree/bus-handlers.ts` | 28 |

### `dir:mkdir`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| (顶层) | `frontend/src/core/context-menu-dir-handlers.ts` | 50 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| bindBusEvents | `frontend/src/views/app-tree/bus-handlers.ts` | 26 |

### `dir:recycle`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| (顶层) | `frontend/src/core/context-menu-dir-handlers.ts` | 51 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| bindBusEvents | `frontend/src/views/app-tree/bus-handlers.ts` | 27 |

### `dir:rename`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| (顶层) | `frontend/src/core/context-menu-dir-handlers.ts` | 11 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| bindBusEvents | `frontend/src/views/app-tree/bus-handlers.ts` | 25 |

### `instance:clear`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| (顶层) | `frontend/src/core/context-menu-handlers.ts` | 182 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| registerInstanceOps | `frontend/src/core/handlers/instance-ops.ts` | 97 |

### `instance:export-list`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| (顶层) | `frontend/src/core/context-menu-handlers.ts` | 172 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| registerInstanceOps | `frontend/src/core/handlers/instance-ops.ts` | 15 |

### `lang:changed`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| setLang | `frontend/src/core/i18n/locale.ts` | 100 |
| initI18n | `frontend/src/core/i18n/locale.ts` | 151 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| connectedCallback | `frontend/src/views/app-content/index.ts` | 105 |
| connectedCallback | `frontend/src/views/app-nav/index.ts` | 165 |

### `menu:show`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| registerContextMenus | `frontend/src/core/context-menus.ts` | 87 |
| cmReBindContextMenu | `frontend/src/features/community/events.ts` | 198 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| connectedCallback | `frontend/src/views/context-menu/index.ts` | 32 |

### `model:select`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| handleContainerClick | `frontend/src/features/oldest-models.ts` | 57 |
| onRecycleListClick | `frontend/src/features/recycle-bin.ts` | 186 |
| bindPreviewClicks | `frontend/src/views/app-content/diagnostics/dedup.ts` | 217 |
| showMorphPreview | `frontend/src/views/app-preview/detail-3d.ts` | 273 |
| showStagePreview | `frontend/src/views/app-preview/detail-3d.ts` | 340 |
| atTeClickRowFolder | `frontend/src/views/app-tree/events.ts` | 156 |
| atTeClickRowFile | `frontend/src/views/app-tree/events.ts` | 253 |
| _onKeyArrowNav | `frontend/src/views/app-tree/index.ts` | 389 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| connectedCallback | `frontend/src/views/app-preview/index.ts` | 150 |

### `nav:changed`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| connectedCallback | `frontend/src/views/app-content/index.ts` | 99 |
| _pageInitFailed | `frontend/src/views/app-content/index.ts` | 202 |
| cmBbBindEmptyLocalBtn | `frontend/src/views/app-content/site/events.ts` | 201 |
| anBindNavItems | `frontend/src/views/app-nav/index.ts` | 34 |
| connectedCallback | `frontend/src/views/app-nav/index.ts` | 175 |
| bindFooter | `frontend/src/views/app-sidebar/events.ts` | 250 |
| atTlBindRepoSwitch | `frontend/src/views/app-tree/toolbar-events.ts` | 116 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| registerPageStore | `frontend/src/core/page-store.ts` | 63 |
| connectedCallback | `frontend/src/views/app-content/index.ts` | 90 |
| connectedCallback | `frontend/src/views/app-nav/index.ts` | 151 |

### `package:selected`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| bindCardClickHandler | `frontend/src/views/app-sidebar/events.ts` | 78 |
| restoreSelectedCard | `frontend/src/views/app-sidebar/events.ts` | 235 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| initInstancesPage | `frontend/src/views/app-content/init-pages.ts` | 37 |

### `repo:rtype-changed`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| stgBindWebFsa | `frontend/src/views/app-content/settings/init.ts` | 278 |
| stgBindWebFsa | `frontend/src/views/app-content/settings/init.ts` | 300 |
| anBindDualSelects | `frontend/src/views/app-nav/index.ts` | 95 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| useCurrentResourceType | `frontend/src/features/repo-rtype.ts` | 33 |
| initRepositoryPage | `frontend/src/views/app-content/init-pages.ts` | 79 |
| initDedupTab | `frontend/src/views/app-content/init-pages.ts` | 257 |
| connectedCallback | `frontend/src/views/app-nav/index.ts` | 167 |
| connectedCallback | `frontend/src/views/app-sidebar/index.ts` | 417 |
| _init | `frontend/src/views/app-sync-manager/index.ts` | 174 |

### `repo:search-creator`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| cmCrBindOverlayEvents | `frontend/src/views/app-content/site/events.ts` | 169 |
| cmBbBindLocalBadges | `frontend/src/views/app-content/site/events.ts` | 307 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| connectedCallback | `frontend/src/views/app-content/index.ts` | 97 |

### `repo:subdir-changed`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| anBindDualSelects | `frontend/src/views/app-nav/index.ts` | 96 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| _init | `frontend/src/views/app-sync-manager/index.ts` | 197 |

### `stats:refresh`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| refreshUI | `frontend/src/core/context-menu-shared.ts` | 20 |
| registerAndroidEvents | `frontend/src/core/handlers/android-events.ts` | 66 |
| registerInstanceOps | `frontend/src/core/handlers/instance-ops.ts` | 149 |
| runDownloadMissing | `frontend/src/core/handlers/sync.ts` | 86 |
| runSyncToggleStatus | `frontend/src/core/handlers/sync.ts` | 215 |
| enqueueDownloads | `frontend/src/features/community/download-queue-store.ts` | 258 |
| cmDqCleanupProgressUI | `frontend/src/features/community/download-queue.ts` | 114 |
| (顶层) | `frontend/src/features/import-executor.ts` | 33 |
| (顶层) | `frontend/src/features/import-executor.ts` | 186 |
| handleInstanceDrop | `frontend/src/features/pack-dnd.ts` | 159 |
| setupRecycleActions | `frontend/src/features/recycle-bin.ts` | 110 |
| onRecycleEmptyClick | `frontend/src/features/recycle-bin.ts` | 170 |
| runExecDelete | `frontend/src/views/app-content/diagnostics/dedup.ts` | 363 |
| stgBindLinkMode | `frontend/src/views/app-content/settings/init.ts` | 142 |
| bindPathClick | `frontend/src/views/app-content/settings/path-cards.ts` | 78 |
| initMcDetect | `frontend/src/views/app-content/settings/path-cards.ts` | 353 |
| runPull | `frontend/src/views/app-sidebar/index.ts` | 310 |
| runMcSearch | `frontend/src/views/app-sidebar/launcher-detect.ts` | 76 |
| runLauncherDetect | `frontend/src/views/app-sidebar/launcher-detect.ts` | 139 |
| _doRender | `frontend/src/views/app-sync-manager/index.ts` | 220 |
| runBatchRename | `frontend/src/views/app-tree/bus-handlers.ts` | 53 |
| atBeHandleDirRename | `frontend/src/views/app-tree/bus-handlers.ts` | 88 |
| atBeHandleDirRecycle | `frontend/src/views/app-tree/bus-handlers.ts` | 157 |
| atTeBindSelCheckboxes | `frontend/src/views/app-tree/events.ts` | 99 |
| atTeBindRenameInput | `frontend/src/views/app-tree/events.ts` | 380 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| connectedCallback | `frontend/src/views/app-sidebar/index.ts` | 409 |
| _init | `frontend/src/views/app-sync-manager/index.ts` | 154 |

### `sync:download:done`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| handleSyncDownloadMissing | `frontend/src/core/handlers/sync.ts` | 106 |
| handleSyncDownloadMissing | `frontend/src/core/handlers/sync.ts` | 142 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| pushOne | `frontend/src/views/app-sidebar/index.ts` | 185 |
| waitBusQuiet | `frontend/src/views/app-sidebar/index.ts` | 206 |

### `sync:download:missing`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| pushOne | `frontend/src/views/app-sidebar/index.ts` | 199 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| registerSync | `frontend/src/core/handlers/sync.ts` | 268 |

### `sync:toggle:status`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| runBatchToggle | `frontend/src/views/app-tree/bus-handlers.ts` | 303 |
| atTeBindSelCheckboxes | `frontend/src/views/app-tree/events.ts` | 97 |
| toggleFolderBatch | `frontend/src/views/app-tree/events.ts` | 474 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| registerSync | `frontend/src/core/handlers/sync.ts` | 274 |

### `toast:show`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| (顶层) | `frontend/src/app-modules.ts` | 60 |
| (顶层) | `frontend/src/app-modules.ts` | 70 |
| (顶层) | `frontend/src/app-modules.ts` | 80 |
| (顶层) | `frontend/src/app-modules.ts` | 111 |
| toast | `frontend/src/core/context-menu-shared.ts` | 25 |
| resolveDstDir | `frontend/src/core/context-menu-shared.ts` | 68 |
| resolveDstDir | `frontend/src/core/context-menu-shared.ts` | 78 |
| registerAndroidEvents | `frontend/src/core/handlers/android-events.ts` | 25 |
| registerAndroidEvents | `frontend/src/core/handlers/android-events.ts` | 42 |
| registerInstanceOps | `frontend/src/core/handlers/instance-ops.ts` | 35 |
| registerInstanceOps | `frontend/src/core/handlers/instance-ops.ts` | 74 |
| registerInstanceOps | `frontend/src/core/handlers/instance-ops.ts` | 84 |
| registerInstanceOps | `frontend/src/core/handlers/instance-ops.ts` | 124 |
| registerInstanceOps | `frontend/src/core/handlers/instance-ops.ts` | 140 |
| registerInstanceOps | `frontend/src/core/handlers/instance-ops.ts` | 150 |
| requireMcRoot | `frontend/src/core/handlers/require-mcroot.ts` | 18 |
| runDownloadMissing | `frontend/src/core/handlers/sync.ts` | 41 |
| runDownloadMissing | `frontend/src/core/handlers/sync.ts` | 87 |
| handleSyncDownloadMissing | `frontend/src/core/handlers/sync.ts` | 118 |
| handleSyncDownloadMissing | `frontend/src/core/handlers/sync.ts` | 135 |
| runSyncToggleStatus | `frontend/src/core/handlers/sync.ts` | 165 |
| runSyncToggleStatus | `frontend/src/core/handlers/sync.ts` | 174 |
| runSyncToggleStatus | `frontend/src/core/handlers/sync.ts` | 208 |
| handleSyncToggleStatus | `frontend/src/core/handlers/sync.ts` | 223 |
| handleSyncToggleStatus | `frontend/src/core/handlers/sync.ts` | 248 |
| enqueueDownloads | `frontend/src/features/community/download-queue-store.ts` | 247 |
| cmDqEnqueue | `frontend/src/features/community/download-queue.ts` | 272 |
| cmDqEnqueue | `frontend/src/features/community/download-queue.ts` | 298 |
| cmReBindDlSelected | `frontend/src/features/community/events.ts` | 143 |
| cmReBindDlSelected | `frontend/src/features/community/events.ts` | 155 |
| cmReHandleSingleDownload | `frontend/src/features/community/events.ts` | 224 |
| cmReBindRowClick | `frontend/src/features/community/events.ts` | 276 |
| cmReBindRowClick | `frontend/src/features/community/events.ts` | 313 |
| dgBrApplyReplace | `frontend/src/features/dialogs/batch-rename.ts` | 95 |
| dgBrBindApplyClick | `frontend/src/features/dialogs/batch-rename.ts` | 387 |
| dgBrBindApplyClick | `frontend/src/features/dialogs/batch-rename.ts` | 401 |
| dgBrBindApplyClick | `frontend/src/features/dialogs/batch-rename.ts` | 420 |
| handleTreeDrop | `frontend/src/features/import-dnd.ts` | 39 |
| handleTreeDrop | `frontend/src/features/import-dnd.ts` | 57 |
| handleTreeDrop | `frontend/src/features/import-dnd.ts` | 76 |
| handleTreeDrop | `frontend/src/features/import-dnd.ts` | 86 |
| handleTreeDrop | `frontend/src/features/import-dnd.ts` | 102 |
| bindTreeDnD | `frontend/src/features/import-dnd.ts` | 188 |
| (顶层) | `frontend/src/features/import-executor.ts` | 28 |
| (顶层) | `frontend/src/features/import-executor.ts` | 177 |
| (顶层) | `frontend/src/features/import-executor.ts` | 190 |
| (顶层) | `frontend/src/features/pack-dnd.ts` | 38 |
| initRecycleBin | `frontend/src/features/recycle-bin.ts` | 244 |
| promptUpdate | `frontend/src/features/version-updater.ts` | 149 |
| promptUpdate | `frontend/src/features/version-updater.ts` | 158 |
| checkUpdateSilent | `frontend/src/features/version-updater.ts` | 184 |
| checkUpdateSilent | `frontend/src/features/version-updater.ts` | 193 |
| initVersionUpdater | `frontend/src/features/version-updater.ts` | 216 |
| initVersionUpdater | `frontend/src/features/version-updater.ts` | 250 |
| initVersionUpdater | `frontend/src/features/version-updater.ts` | 260 |
| mount3D | `frontend/src/preview-3d/adapters/mount-preview-core.ts` | 447 |
| showLoadFailure | `frontend/src/preview-3d/adapters/preview-loading.ts` | 38 |
| beginSwitch | `frontend/src/preview-3d/adapters/switch-preview.ts` | 158 |
| resolveAndroidRepoDir | `frontend/src/utils/dom/directory-picker.ts` | 34 |
| resolveAndroidRepoDir | `frontend/src/utils/dom/directory-picker.ts` | 45 |
| resolveAndroidRepoDir | `frontend/src/utils/dom/directory-picker.ts` | 57 |
| (顶层) | `frontend/src/utils/module-loader.ts` | 17 |
| dgCfWebGate | `frontend/src/views/app-content/diagnostics/conflicts.ts` | 36 |
| dgCfSyncWebGate | `frontend/src/views/app-content/diagnostics/conflicts.ts` | 182 |
| dgInBindRefreshClear | `frontend/src/views/app-content/diagnostics/init.ts` | 41 |
| dgInBindRefreshClear | `frontend/src/views/app-content/diagnostics/init.ts` | 52 |
| dgInBindRefreshClear | `frontend/src/views/app-content/diagnostics/init.ts` | 58 |
| dgInBindCopyPanel | `frontend/src/views/app-content/diagnostics/init.ts` | 76 |
| dgInBindCopyPanel | `frontend/src/views/app-content/diagnostics/init.ts` | 88 |
| dgInCopyRowLog | `frontend/src/views/app-content/diagnostics/init.ts` | 103 |
| dgInCopyRowLog | `frontend/src/views/app-content/diagnostics/init.ts` | 111 |
| bindPerfCopyHandlers | `frontend/src/views/app-content/diagnostics/perf-cli.ts` | 88 |
| guiFlowWebModeCheck | `frontend/src/views/app-content/diagnostics/perf-cli.ts` | 354 |
| _pageInitFailed | `frontend/src/views/app-content/index.ts` | 193 |
| bindTabs | `frontend/src/views/app-content/init-pages.ts` | 168 |
| initSettingsPage | `frontend/src/views/app-content/init-pages.ts` | 283 |
| stgBindMirrorSelect | `frontend/src/views/app-content/settings/init.ts` | 48 |
| stgBindUpdateInterval | `frontend/src/views/app-content/settings/init.ts` | 84 |
| stgBindLinkMode | `frontend/src/views/app-content/settings/init.ts` | 128 |
| stgBindLinkMode | `frontend/src/views/app-content/settings/init.ts` | 144 |
| stgBindLinkMode | `frontend/src/views/app-content/settings/init.ts` | 151 |
| stgBindLinkMode | `frontend/src/views/app-content/settings/init.ts` | 159 |
| stgBindLinkMode | `frontend/src/views/app-content/settings/init.ts` | 187 |
| stgBindReleasesClick | `frontend/src/views/app-content/settings/init.ts` | 234 |
| tdRenderKeymap | `frontend/src/views/app-content/settings/keymap.ts` | 104 |
| tdRenderKeymap | `frontend/src/views/app-content/settings/keymap.ts` | 115 |
| initKeymap | `frontend/src/views/app-content/settings/keymap.ts` | 136 |
| bindPathClick | `frontend/src/views/app-content/settings/path-cards.ts` | 79 |
| initAdvancedGrid | `frontend/src/views/app-content/settings/path-cards.ts` | 273 |
| initAdvancedGrid | `frontend/src/views/app-content/settings/path-cards.ts` | 279 |
| initAdvancedGrid | `frontend/src/views/app-content/settings/path-cards.ts` | 300 |
| initAdvancedGrid | `frontend/src/views/app-content/settings/path-cards.ts` | 306 |
| initMcDetect | `frontend/src/views/app-content/settings/path-cards.ts` | 328 |
| initMcDetect | `frontend/src/views/app-content/settings/path-cards.ts` | 354 |
| initUiPrefs | `frontend/src/views/app-content/settings/ui-prefs.ts` | 123 |
| initUiPrefs | `frontend/src/views/app-content/settings/ui-prefs.ts` | 134 |
| initUiPrefs | `frontend/src/views/app-content/settings/ui-prefs.ts` | 145 |
| initUiPrefs | `frontend/src/views/app-content/settings/ui-prefs.ts` | 157 |
| initUiPrefs | `frontend/src/views/app-content/settings/ui-prefs.ts` | 167 |
| initWorkerPrefs | `frontend/src/views/app-content/settings/worker-prefs.ts` | 44 |
| bindDragEvents | `frontend/src/views/app-content/site/drag.ts` | 43 |
| bindDragEvents | `frontend/src/views/app-content/site/drag.ts` | 80 |
| bindDragEvents | `frontend/src/views/app-content/site/drag.ts` | 103 |
| bindDragEvents | `frontend/src/views/app-content/site/drag.ts` | 112 |
| eeBindToolbarBtns | `frontend/src/views/app-content/site/edit.ts` | 114 |
| eeBindToolbarBtns | `frontend/src/views/app-content/site/edit.ts` | 142 |
| eeBindToolbarBtns | `frontend/src/views/app-content/site/edit.ts` | 149 |
| eeBindFetchBtn | `frontend/src/views/app-content/site/edit.ts` | 225 |
| eeBindFetchBtn | `frontend/src/views/app-content/site/edit.ts` | 232 |
| eeBindFetchBtn | `frontend/src/views/app-content/site/edit.ts` | 247 |
| cmCrBindOverlayEvents | `frontend/src/views/app-content/site/events.ts` | 146 |
| cmBbBindStarBtns | `frontend/src/views/app-content/site/events.ts` | 271 |
| bindSiteEvents | `frontend/src/views/app-content/workshop-site-opener.ts` | 133 |
| bindSiteEvents | `frontend/src/views/app-content/workshop-site-opener.ts` | 143 |
| bindSiteEvents | `frontend/src/views/app-content/workshop-site-opener.ts` | 149 |
| bindSiteEvents | `frontend/src/views/app-content/workshop-site-opener.ts` | 161 |
| bindSiteEvents | `frontend/src/views/app-content/workshop-site-opener.ts` | 172 |
| bindSiteEvents | `frontend/src/views/app-content/workshop-site-opener.ts` | 178 |
| initWorkshopTabs | `frontend/src/views/app-content/workshop-tabs.ts` | 89 |
| initWorkshopTabs | `frontend/src/views/app-content/workshop-tabs.ts` | 137 |
| anBindViewerFab | `frontend/src/views/app-nav/index.ts` | 114 |
| showMorphPreview | `frontend/src/views/app-preview/detail-3d.ts` | 286 |
| showStagePreview | `frontend/src/views/app-preview/detail-3d.ts` | 352 |
| _showModelDetail | `frontend/src/views/app-preview/index.ts` | 273 |
| _showModelDetail | `frontend/src/views/app-preview/index.ts` | 295 |
| openModel3DFullscreen | `frontend/src/views/app-preview/preview-library.ts` | 98 |
| openModel3DFullscreen | `frontend/src/views/app-preview/preview-library.ts` | 130 |
| makeShotAction | `frontend/src/views/app-preview/shot-panel-shared.ts` | 48 |
| bindCardContextHandler | `frontend/src/views/app-sidebar/events.ts` | 120 |
| beginSync | `frontend/src/views/app-sidebar/index.ts` | 139 |
| runPush | `frontend/src/views/app-sidebar/index.ts` | 254 |
| runPush | `frontend/src/views/app-sidebar/index.ts` | 256 |
| runPush | `frontend/src/views/app-sidebar/index.ts` | 259 |
| runPull | `frontend/src/views/app-sidebar/index.ts` | 304 |
| runPull | `frontend/src/views/app-sidebar/index.ts` | 306 |
| runPull | `frontend/src/views/app-sidebar/index.ts` | 308 |
| runPull | `frontend/src/views/app-sidebar/index.ts` | 313 |
| (顶层) | `frontend/src/views/app-sidebar/launcher-detect.ts` | 37 |
| runMcSearch | `frontend/src/views/app-sidebar/launcher-detect.ts` | 62 |
| runMcSearch | `frontend/src/views/app-sidebar/launcher-detect.ts` | 77 |
| runLauncherDetect | `frontend/src/views/app-sidebar/launcher-detect.ts` | 122 |
| runLauncherDetect | `frontend/src/views/app-sidebar/launcher-detect.ts` | 140 |
| doLoadInstances | `frontend/src/views/app-sidebar/loader.ts` | 152 |
| _init | `frontend/src/views/app-sync-manager/index.ts` | 151 |
| performSingleOp | `frontend/src/views/app-sync-manager/network.ts` | 47 |
| performSingleOp | `frontend/src/views/app-sync-manager/network.ts` | 55 |
| loadTypeConfig | `frontend/src/views/app-sync-manager/store.ts` | 34 |
| loadData | `frontend/src/views/app-sync-manager/store.ts` | 80 |
| show | `frontend/src/views/app-toast/index.ts` | 133 |
| show | `frontend/src/views/app-toast/index.ts` | 152 |
| show | `frontend/src/views/app-toast/index.ts` | 161 |
| runBatchRename | `frontend/src/views/app-tree/bus-handlers.ts` | 54 |
| atBeHandleDirRename | `frontend/src/views/app-tree/bus-handlers.ts` | 90 |
| atBeHandleDirMkdir | `frontend/src/views/app-tree/bus-handlers.ts` | 116 |
| atBeHandleDirRecycle | `frontend/src/views/app-tree/bus-handlers.ts` | 161 |
| atBeHandleDirRecycle | `frontend/src/views/app-tree/bus-handlers.ts` | 167 |
| atBeHandleDirBatchRename | `frontend/src/views/app-tree/bus-handlers.ts` | 184 |
| atBeHandleDirBatchRename | `frontend/src/views/app-tree/bus-handlers.ts` | 197 |
| atBeHandleBatchRename | `frontend/src/views/app-tree/bus-handlers.ts` | 216 |
| reload | `frontend/src/views/app-tree/bus-handlers.ts` | 251 |
| runBatchToggle | `frontend/src/views/app-tree/bus-handlers.ts` | 263 |
| runBatchToggle | `frontend/src/views/app-tree/bus-handlers.ts` | 271 |
| runBatchToggle | `frontend/src/views/app-tree/bus-handlers.ts` | 306 |
| runBatchToggle | `frontend/src/views/app-tree/bus-handlers.ts` | 312 |
| atTeBindSelCheckboxes | `frontend/src/views/app-tree/events.ts` | 70 |
| atTeBindSelCheckboxes | `frontend/src/views/app-tree/events.ts` | 78 |
| atTeBindSelCheckboxes | `frontend/src/views/app-tree/events.ts` | 103 |
| atTeOpenAuthor | `frontend/src/views/app-tree/events.ts` | 131 |
| atTeClickRowPreview | `frontend/src/views/app-tree/events.ts` | 172 |
| atTeClickRowPreview | `frontend/src/views/app-tree/events.ts` | 181 |
| atTeClickRowCopy | `frontend/src/views/app-tree/events.ts` | 197 |
| atTeClickRowCopy | `frontend/src/views/app-tree/events.ts` | 204 |
| atTeBindRenameInput | `frontend/src/views/app-tree/events.ts` | 383 |
| toggleFolderBatch | `frontend/src/views/app-tree/events.ts` | 426 |
| toggleFolderBatch | `frontend/src/views/app-tree/events.ts` | 434 |
| toggleFolderBatch | `frontend/src/views/app-tree/events.ts` | 477 |
| toggleFolderBatch | `frontend/src/views/app-tree/events.ts` | 487 |
| _attrChangeReloadAsync | `frontend/src/views/app-tree/index.ts` | 189 |
| _onKeyDelete | `frontend/src/views/app-tree/index.ts` | 325 |
| _onKeyDelete | `frontend/src/views/app-tree/index.ts` | 333 |
| _deleteSelected | `frontend/src/views/app-tree/index.ts` | 434 |
| _deleteSelected | `frontend/src/views/app-tree/index.ts` | 441 |
| toastLoadError | `frontend/src/views/app-tree/loader.ts` | 31 |
| maybePromptAndroidStorage | `frontend/src/views/app-tree/loader.ts` | 55 |
| atTlShowConfirm | `frontend/src/views/app-tree/toolbar-events.ts` | 43 |
| atTlShowConfirm | `frontend/src/views/app-tree/toolbar-events.ts` | 54 |
| atTlBindAdvFilter | `frontend/src/views/app-tree/toolbar-events.ts` | 161 |
| atTlBindMoreMenu | `frontend/src/views/app-tree/toolbar-events.ts` | 312 |
| atTlBindMoreMenu | `frontend/src/views/app-tree/toolbar-events.ts` | 330 |
| atTlBindMoreMenu | `frontend/src/views/app-tree/toolbar-events.ts` | 336 |
| atTlBindMoreMenu | `frontend/src/views/app-tree/toolbar-events.ts` | 347 |
| advFilterFetchTagPaths | `frontend/src/views/app-tree/toolbar-search.ts` | 143 |
| advFilterSearchModelPaths | `frontend/src/views/app-tree/toolbar-search.ts` | 162 |
| advFilterSearchModelPaths | `frontend/src/views/app-tree/toolbar-search.ts` | 192 |
| advFilterWarnWebDegraded | `frontend/src/views/app-tree/toolbar-search.ts` | 208 |
| advFilterToastAndRender | `frontend/src/views/app-tree/toolbar-search.ts` | 237 |
| advFilterToastAndRender | `frontend/src/views/app-tree/toolbar-search.ts` | 243 |
| pickWebFilesAndImport | `frontend/src/views/app-tree/toolbar-search.ts` | 305 |
| pickWebFilesAndImport | `frontend/src/views/app-tree/toolbar-search.ts` | 314 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| registerErrorDiary | `frontend/src/core/error-diary.ts` | 55 |
| connectedCallback | `frontend/src/views/app-toast/index.ts` | 69 |

### `tree:reload`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| refreshUI | `frontend/src/core/context-menu-shared.ts` | 19 |
| registerAndroidEvents | `frontend/src/core/handlers/android-events.ts` | 65 |
| handleSyncDownloadMissing | `frontend/src/core/handlers/sync.ts` | 130 |
| handleSyncToggleStatus | `frontend/src/core/handlers/sync.ts` | 255 |
| enqueueDownloads | `frontend/src/features/community/download-queue-store.ts` | 257 |
| cmDqCleanupProgressUI | `frontend/src/features/community/download-queue.ts` | 113 |
| (顶层) | `frontend/src/features/import-executor.ts` | 34 |
| (顶层) | `frontend/src/features/import-executor.ts` | 185 |
| handleInstanceDrop | `frontend/src/features/pack-dnd.ts` | 160 |
| setupRecycleActions | `frontend/src/features/recycle-bin.ts` | 111 |
| onRecycleEmptyClick | `frontend/src/features/recycle-bin.ts` | 171 |
| runExecDelete | `frontend/src/views/app-content/diagnostics/dedup.ts` | 364 |
| runPull | `frontend/src/views/app-sidebar/index.ts` | 311 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| bindBusEvents | `frontend/src/views/app-tree/bus-handlers.ts` | 30 |

### `tree:set-search`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| connectedCallback | `frontend/src/views/app-content/index.ts` | 101 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| connectedCallback | `frontend/src/views/app-tree/index.ts` | 125 |
