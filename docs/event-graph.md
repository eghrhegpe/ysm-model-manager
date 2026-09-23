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
| `toast:show` | 173 | 2 | 0 | 0 | ✅ |
| `tree:reload` | 13 | 1 | 0 | 0 | ✅ |
| `tree:set-search` | 1 | 1 | 0 | 0 | ✅ |
| `ui:card-density` | 1 | 1 | 0 | 0 | ✅ |

## 调用详情

### `avatar:refresh`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| cancelDownloads | `frontend/src/features/community/download-queue-store.ts` | 354 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| initWorkshopPage | `frontend/src/views/app-content/init-workshop.ts` | 189 |

### `batch:disable-all`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| atTlBindBatchMenu | `frontend/src/views/app-tree/toolbar-events.ts` | 191 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| bindBusEvents | `frontend/src/views/app-tree/bus-handlers.ts` | 28 |

### `batch:enable-all`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| atTlBindBatchMenu | `frontend/src/views/app-tree/toolbar-events.ts` | 190 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| bindBusEvents | `frontend/src/views/app-tree/bus-handlers.ts` | 27 |

### `batch:rename`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| runBatchFileOp | `frontend/src/features/context-menu/context-menu-handlers.ts` | 199 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| bindBusEvents | `frontend/src/views/app-tree/bus-handlers.ts` | 50 |

### `community:clearCache`

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
| bindCardContextHandler | `frontend/src/views/app-sidebar/events.ts` | 128 |
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
| runBatchFileOp | `frontend/src/features/context-menu/context-menu-handlers.ts` | 192 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| registerInstanceOps | `frontend/src/features/pack-ops/instance-ops.ts` | 90 |

### `instance:export-list`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| runBatchFileOp | `frontend/src/features/context-menu/context-menu-handlers.ts` | 182 |

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
| connectedCallback | `frontend/src/views/app-nav/index.ts` | 213 |

### `menu:show`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| registerContextMenus | `frontend/src/features/context-menu/context-menus.ts` | 92 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| connectedCallback | `frontend/src/views/context-menu/index.ts` | 71 |

### `model:select`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| handleContainerClick | `frontend/src/features/maintenance/oldest-models.ts` | 56 |
| onRecycleListClick | `frontend/src/features/maintenance/recycle-bin.ts` | 191 |
| bindPreviewClicks | `frontend/src/views/app-content/diagnostics/dedup-render.ts` | 107 |
| showMorphPreview | `frontend/src/views/app-preview/detail-3d.ts` | 247 |
| showStagePreview | `frontend/src/views/app-preview/detail-3d.ts` | 334 |
| atTeClickRowFolder | `frontend/src/views/app-tree/events.ts` | 153 |
| atTeClickRowFile | `frontend/src/views/app-tree/events.ts` | 239 |
| _onKeyArrowNav | `frontend/src/views/app-tree/index.ts` | 551 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| initPerfPanel | `frontend/src/views/app-content/diagnostics/perf.ts` | 212 |
| connectedCallback | `frontend/src/views/app-preview/index.ts` | 83 |

### `nav:changed`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| connectedCallback | `frontend/src/views/app-content/index.ts` | 65 |
| _pageInitFailed | `frontend/src/views/app-content/index.ts` | 179 |
| cmBbBindEmptyLocalBtn | `frontend/src/views/app-content/site/events.ts` | 229 |
| anBindNavItems | `frontend/src/views/app-nav/index.ts` | 52 |
| connectedCallback | `frontend/src/views/app-nav/index.ts` | 223 |
| bindFooter | `frontend/src/views/app-sidebar/events.ts` | 258 |
| atTlBindRepoSwitch | `frontend/src/views/app-tree/toolbar-events.ts` | 117 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| connectedCallback | `frontend/src/views/app-content/index.ts` | 52 |
| connectedCallback | `frontend/src/views/app-nav/index.ts` | 193 |

### `package:selected`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| bindCardClickHandler | `frontend/src/views/app-sidebar/events.ts` | 83 |
| restoreSelectedCard | `frontend/src/views/app-sidebar/events.ts` | 244 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| initInstancesPage | `frontend/src/views/app-content/init-pages.ts` | 45 |

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
| applyFsaState | `frontend/src/views/app-content/settings/init.ts` | 382 |
| onWebRepoAuthClick | `frontend/src/views/app-content/settings/init.ts` | 409 |
| anBindDualSelects | `frontend/src/views/app-nav/index.ts` | 128 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| useCurrentResourceType | `frontend/src/features/repo/repo-rtype.ts` | 21 |
| initRepositoryPage | `frontend/src/views/app-content/init-pages.ts` | 87 |
| initDedupTab | `frontend/src/views/app-content/init-pages.ts` | 317 |
| connectedCallback | `frontend/src/views/app-nav/index.ts` | 215 |
| connectedCallback | `frontend/src/views/app-sidebar/index.ts` | 121 |
| _subscribeBus | `frontend/src/views/app-sync-manager/index.ts` | 274 |

### `repo:search-creator`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| cmCrBindOverlayEvents | `frontend/src/views/app-content/site/events.ts` | 168 |
| cmBbBindLocalBadges | `frontend/src/views/app-content/site/events.ts` | 314 |

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
| _subscribeBus | `frontend/src/views/app-sync-manager/index.ts` | 297 |

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
| setupRecycleActions | `frontend/src/features/maintenance/recycle-bin.ts` | 109 |
| onRecycleEmptyClick | `frontend/src/features/maintenance/recycle-bin.ts` | 175 |
| registerInstanceOps | `frontend/src/features/pack-ops/instance-ops.ts` | 131 |
| registerAndroidEvents | `frontend/src/features/platform/android-events.ts` | 55 |
| runDownloadMissing | `frontend/src/features/sync/sync.ts` | 75 |
| runSyncToggleStatus | `frontend/src/features/sync/sync.ts` | 185 |
| runExecDelete | `frontend/src/views/app-content/diagnostics/dedup.ts` | 111 |
| relinkAllInstancesInner | `frontend/src/views/app-content/settings/init.ts` | 212 |
| bindPathClick | `frontend/src/views/app-content/settings/path-cards.ts` | 79 |
| initMcDetect | `frontend/src/views/app-content/settings/path-cards.ts` | 343 |
| runMcSearch | `frontend/src/views/app-sidebar/launcher-detect.ts` | 93 |
| runLauncherDetect | `frontend/src/views/app-sidebar/launcher-detect.ts` | 166 |
| runPull | `frontend/src/views/app-sidebar/sync-flow.ts` | 317 |
| _bindDelegate | `frontend/src/views/app-sync-manager/index.ts` | 203 |
| _bindDelegate | `frontend/src/views/app-sync-manager/index.ts` | 222 |
| runBatchRename | `frontend/src/views/app-tree/bus-handlers.ts` | 98 |
| atBeHandleDirRename | `frontend/src/views/app-tree/bus-handlers.ts` | 133 |
| atBeHandleDirRecycle | `frontend/src/views/app-tree/bus-handlers.ts` | 200 |
| atTeBindSelCheckboxes | `frontend/src/views/app-tree/events.ts` | 105 |
| atTeBindRenameInput | `frontend/src/views/app-tree/events.ts` | 386 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| connectedCallback | `frontend/src/views/app-sidebar/index.ts` | 113 |
| _subscribeBus | `frontend/src/views/app-sync-manager/index.ts` | 254 |

### `sync:download:done`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| handleSyncDownloadMissing | `frontend/src/features/sync/sync.ts` | 119 |
| handleSyncDownloadMissing | `frontend/src/features/sync/sync.ts` | 122 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| pushOne | `frontend/src/views/app-sidebar/sync-flow.ts` | 143 |
| waitBusQuiet | `frontend/src/views/app-sidebar/sync-flow.ts` | 164 |

### `sync:download:missing`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| pushOne | `frontend/src/views/app-sidebar/sync-flow.ts` | 157 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| registerSync | `frontend/src/features/sync/sync.ts` | 222 |

### `sync:toggle:status`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| runBatchToggle | `frontend/src/views/app-tree/bus-handlers.ts` | 368 |
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
| (顶层) | `frontend/src/app-modules.ts` | 166 |
| resolveAndroidRepoDir | `frontend/src/backend/directory-picker.ts` | 37 |
| resolveAndroidRepoDir | `frontend/src/backend/directory-picker.ts` | 48 |
| resolveAndroidRepoDir | `frontend/src/backend/directory-picker.ts` | 60 |
| runWebEnqueue | `frontend/src/features/community/download-queue-web.ts` | 96 |
| cmDqEnqueue | `frontend/src/features/community/download-queue.ts` | 304 |
| cmDqEnqueue | `frontend/src/features/community/download-queue.ts` | 328 |
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
| initRecycleBin | `frontend/src/features/maintenance/recycle-bin.ts` | 290 |
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
| dgInCopyActiveLog | `frontend/src/views/app-content/diagnostics/init.ts` | 93 |
| webGate | `frontend/src/views/app-content/diagnostics/web-gate.ts` | 29 |
| _pageInitFailed | `frontend/src/views/app-content/index.ts` | 170 |
| bindTabs | `frontend/src/views/app-content/init-pages.ts` | 214 |
| initSettingsPage | `frontend/src/views/app-content/init-pages.ts` | 352 |
| initDefaultPagePrefs | `frontend/src/views/app-content/settings/default-page.ts` | 56 |
| initDefaultPagePrefs | `frontend/src/views/app-content/settings/default-page.ts` | 67 |
| onMirrorChange | `frontend/src/views/app-content/settings/init.ts` | 76 |
| stgBindUpdateInterval | `frontend/src/views/app-content/settings/init.ts` | 117 |
| emitRelinkToast | `frontend/src/views/app-content/settings/init.ts` | 154 |
| emitRelinkToast | `frontend/src/views/app-content/settings/init.ts` | 161 |
| relinkAllInstancesInner | `frontend/src/views/app-content/settings/init.ts` | 184 |
| relinkAllInstancesInner | `frontend/src/views/app-content/settings/init.ts` | 205 |
| relinkAllInstances | `frontend/src/views/app-content/settings/init.ts` | 229 |
| stgBindLinkMode | `frontend/src/views/app-content/settings/init.ts` | 311 |
| tdRenderKeymap | `frontend/src/views/app-content/settings/keymap.ts` | 109 |
| tdRenderKeymap | `frontend/src/views/app-content/settings/keymap.ts` | 120 |
| initKeymap | `frontend/src/views/app-content/settings/keymap.ts` | 139 |
| bindPathClick | `frontend/src/views/app-content/settings/path-cards.ts` | 80 |
| initAdvancedGrid | `frontend/src/views/app-content/settings/path-cards.ts` | 261 |
| initAdvancedGrid | `frontend/src/views/app-content/settings/path-cards.ts` | 267 |
| initAdvancedGrid | `frontend/src/views/app-content/settings/path-cards.ts` | 289 |
| initAdvancedGrid | `frontend/src/views/app-content/settings/path-cards.ts` | 295 |
| initMcDetect | `frontend/src/views/app-content/settings/path-cards.ts` | 317 |
| initMcDetect | `frontend/src/views/app-content/settings/path-cards.ts` | 344 |
| initUiPrefs | `frontend/src/views/app-content/settings/ui-prefs.ts` | 147 |
| initUiPrefs | `frontend/src/views/app-content/settings/ui-prefs.ts` | 158 |
| initUiPrefs | `frontend/src/views/app-content/settings/ui-prefs.ts` | 173 |
| initUiPrefs | `frontend/src/views/app-content/settings/ui-prefs.ts` | 185 |
| initWorkerPrefs | `frontend/src/views/app-content/settings/worker-prefs.ts` | 44 |
| bindDragEvents | `frontend/src/views/app-content/site/drag.ts` | 60 |
| bindDragEvents | `frontend/src/views/app-content/site/drag.ts` | 96 |
| bindDragEvents | `frontend/src/views/app-content/site/drag.ts` | 118 |
| bindDragEvents | `frontend/src/views/app-content/site/drag.ts` | 127 |
| eeBindToolbarBtns | `frontend/src/views/app-content/site/edit.ts` | 114 |
| eeBindToolbarBtns | `frontend/src/views/app-content/site/edit.ts` | 139 |
| eeBindToolbarBtns | `frontend/src/views/app-content/site/edit.ts` | 146 |
| eeBindFetchBtn | `frontend/src/views/app-content/site/edit.ts` | 219 |
| eeBindFetchBtn | `frontend/src/views/app-content/site/edit.ts` | 226 |
| eeBindFetchBtn | `frontend/src/views/app-content/site/edit.ts` | 242 |
| cmCrBindOverlayEvents | `frontend/src/views/app-content/site/events.ts` | 145 |
| cmBbBindStarBtns | `frontend/src/views/app-content/site/events.ts` | 281 |
| bindSiteEvents | `frontend/src/views/app-content/site/workshop-site-opener.ts` | 129 |
| bindSiteEvents | `frontend/src/views/app-content/site/workshop-site-opener.ts` | 139 |
| bindSiteEvents | `frontend/src/views/app-content/site/workshop-site-opener.ts` | 145 |
| bindSiteEvents | `frontend/src/views/app-content/site/workshop-site-opener.ts` | 155 |
| bindSiteEvents | `frontend/src/views/app-content/site/workshop-site-opener.ts` | 166 |
| bindSiteEvents | `frontend/src/views/app-content/site/workshop-site-opener.ts` | 172 |
| initWorkshopTabs | `frontend/src/views/app-content/site/workshop-tabs.ts` | 100 |
| initWorkshopTabs | `frontend/src/views/app-content/site/workshop-tabs.ts` | 152 |
| anBindViewerFab | `frontend/src/views/app-nav/index.ts` | 150 |
| openModel3DFullscreen | `frontend/src/views/app-preview/preview-library.ts` | 110 |
| openModel3DFullscreen | `frontend/src/views/app-preview/preview-library.ts` | 149 |
| openModel3DFullscreen | `frontend/src/views/app-preview/preview-library.ts` | 200 |
| routeModelPreview | `frontend/src/views/app-preview/preview-router.ts` | 41 |
| routeModelPreview | `frontend/src/views/app-preview/preview-router.ts` | 66 |
| makeShotAction | `frontend/src/views/app-preview/shot-panel-shared.ts` | 49 |
| bindCardContextHandler | `frontend/src/views/app-sidebar/events.ts` | 121 |
| (顶层) | `frontend/src/views/app-sidebar/launcher-detect.ts` | 42 |
| runMcSearch | `frontend/src/views/app-sidebar/launcher-detect.ts` | 75 |
| runMcSearch | `frontend/src/views/app-sidebar/launcher-detect.ts` | 94 |
| runLauncherDetect | `frontend/src/views/app-sidebar/launcher-detect.ts` | 145 |
| runLauncherDetect | `frontend/src/views/app-sidebar/launcher-detect.ts` | 167 |
| doLoadInstances | `frontend/src/views/app-sidebar/loader.ts` | 157 |
| beginSync | `frontend/src/views/app-sidebar/sync-flow.ts` | 113 |
| runPush | `frontend/src/views/app-sidebar/sync-flow.ts` | 256 |
| runPush | `frontend/src/views/app-sidebar/sync-flow.ts` | 262 |
| runPush | `frontend/src/views/app-sidebar/sync-flow.ts` | 268 |
| runPull | `frontend/src/views/app-sidebar/sync-flow.ts` | 300 |
| runPull | `frontend/src/views/app-sidebar/sync-flow.ts` | 306 |
| runPull | `frontend/src/views/app-sidebar/sync-flow.ts` | 311 |
| runPull | `frontend/src/views/app-sidebar/sync-flow.ts` | 320 |
| _renderWithErrorFeedback | `frontend/src/views/app-sync-manager/index.ts` | 244 |
| performSingleOp | `frontend/src/views/app-sync-manager/network.ts` | 50 |
| performSingleOp | `frontend/src/views/app-sync-manager/network.ts` | 58 |
| loadData | `frontend/src/views/app-sync-manager/store.ts` | 77 |
| show | `frontend/src/views/app-toast/index.ts` | 163 |
| show | `frontend/src/views/app-toast/index.ts` | 182 |
| show | `frontend/src/views/app-toast/index.ts` | 191 |
| runBatchRename | `frontend/src/views/app-tree/bus-handlers.ts` | 99 |
| atBeHandleDirRename | `frontend/src/views/app-tree/bus-handlers.ts` | 135 |
| atBeHandleDirMkdir | `frontend/src/views/app-tree/bus-handlers.ts` | 159 |
| atBeHandleDirRecycle | `frontend/src/views/app-tree/bus-handlers.ts` | 204 |
| atBeHandleDirRecycle | `frontend/src/views/app-tree/bus-handlers.ts` | 210 |
| atBeHandleDirBatchRename | `frontend/src/views/app-tree/bus-handlers.ts` | 227 |
| atBeHandleDirBatchRename | `frontend/src/views/app-tree/bus-handlers.ts` | 241 |
| atBeHandleBatchRename | `frontend/src/views/app-tree/bus-handlers.ts` | 263 |
| reload | `frontend/src/views/app-tree/bus-handlers.ts` | 302 |
| runBatchToggle | `frontend/src/views/app-tree/bus-handlers.ts` | 318 |
| runBatchToggle | `frontend/src/views/app-tree/bus-handlers.ts` | 326 |
| runBatchToggle | `frontend/src/views/app-tree/bus-handlers.ts` | 371 |
| runBatchToggle | `frontend/src/views/app-tree/bus-handlers.ts` | 377 |
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
| _attrChangeReloadAsync | `frontend/src/views/app-tree/index.ts` | 321 |
| _onKeyDelete | `frontend/src/views/app-tree/index.ts` | 475 |
| _onKeyDelete | `frontend/src/views/app-tree/index.ts` | 483 |
| _deleteSelected | `frontend/src/views/app-tree/index.ts` | 604 |
| _deleteSelected | `frontend/src/views/app-tree/index.ts` | 611 |
| toastLoadError | `frontend/src/views/app-tree/loader.ts` | 32 |
| maybePromptAndroidStorage | `frontend/src/views/app-tree/loader.ts` | 56 |
| atTlShowConfirm | `frontend/src/views/app-tree/toolbar-events.ts` | 49 |
| atTlShowConfirm | `frontend/src/views/app-tree/toolbar-events.ts` | 60 |
| atTlBindAdvFilter | `frontend/src/views/app-tree/toolbar-events.ts` | 161 |
| atTlBindMoreMenu | `frontend/src/views/app-tree/toolbar-events.ts` | 288 |
| atTlBindMoreMenu | `frontend/src/views/app-tree/toolbar-events.ts` | 306 |
| atTlBindMoreMenu | `frontend/src/views/app-tree/toolbar-events.ts` | 312 |
| atTlBindMoreMenu | `frontend/src/views/app-tree/toolbar-events.ts` | 323 |
| advFilterFetchTagPaths | `frontend/src/views/app-tree/toolbar-search.ts` | 181 |
| advFilterSearchModelPaths | `frontend/src/views/app-tree/toolbar-search.ts` | 200 |
| advFilterSearchModelPaths | `frontend/src/views/app-tree/toolbar-search.ts` | 230 |
| advFilterWarnWebDegraded | `frontend/src/views/app-tree/toolbar-search.ts` | 246 |
| advFilterToastAndRender | `frontend/src/views/app-tree/toolbar-search.ts` | 275 |
| advFilterToastAndRender | `frontend/src/views/app-tree/toolbar-search.ts` | 281 |
| pickWebFilesAndImport | `frontend/src/views/app-tree/toolbar-search.ts` | 348 |
| pickWebFilesAndImport | `frontend/src/views/app-tree/toolbar-search.ts` | 357 |

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
| setupRecycleActions | `frontend/src/features/maintenance/recycle-bin.ts` | 110 |
| onRecycleEmptyClick | `frontend/src/features/maintenance/recycle-bin.ts` | 176 |
| registerAndroidEvents | `frontend/src/features/platform/android-events.ts` | 54 |
| handleSyncDownloadMissing | `frontend/src/features/sync/sync.ts` | 106 |
| handleSyncToggleStatus | `frontend/src/features/sync/sync.ts` | 211 |
| runExecDelete | `frontend/src/views/app-content/diagnostics/dedup.ts` | 112 |
| runPull | `frontend/src/views/app-sidebar/sync-flow.ts` | 318 |

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
| connectedCallback | `frontend/src/views/app-tree/index.ts` | 248 |

### `ui:card-density`

**发射方：**
| 函数 | 文件 | 行 |
|------|------|----|
| initUiPrefs | `frontend/src/views/app-content/settings/ui-prefs.ts` | 172 |

**订阅方（on）：**
| 函数 | 文件 | 行 |
|------|------|----|
| bindBusEvents | `frontend/src/views/app-tree/bus-handlers.ts` | 68 |
