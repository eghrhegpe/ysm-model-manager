// ===== zh-CN 基准语言包（ADR-045）=====
// 唯一编辑入口。修改后执行 scripts/generate-locale-json.mjs 生成运行时 JSON。
// key 格式：扁平化命名空间，"." 分隔，如 "nav.repository"

export const zhCN: Record<string, string> = {
  // ── 导航栏 ──
  "nav.repository": "模型仓库",
  "nav.instances": "整合包管理",
  "nav.community": "创作者频道",
  "nav.workshop": "创意工坊",
  "nav.diagnostics": "诊断与冲突",
  "nav.settings": "设置",
  "nav.preview": "预告版",

  // ── 通用 ──
  "common.loading": "加载中…",
  "common.refresh": "刷新",
  "common.import": "导入",
  "common.export": "导出",
  "common.copy": "复制",
  "common.move": "移动到…",
  "common.rename": "重命名…",
  "common.delete": "移入回收站",
  "common.cancel": "取消",
  "common.confirm": "确认",
  "common.search": "搜索",
  "common.empty": "暂无数据",
  "common.back": "返回",
  "common.close": "关闭",
  "common.clear": "清空",

  // ── 右键菜单 ──
  "menu.openFolder": "打开文件夹",
  "menu.copyModelList": "复制模型清单",
  "menu.clearPack": "清空此整合包的模型",
  "menu.batchRename": "批量重命名…",
  "menu.moveTo": "移动到…",
  "menu.copyTo": "复制到…",
  "menu.recycle": "移入回收站",
  "menu.copyPaths": "复制文件路径列表",
  "menu.exportList": "导出文件名清单 (.txt)",
  "menu.rename": "重命名…",
  "menu.pushToPack": "推送到整合包…",
  "menu.editTags": "编辑标签",
  "menu.openFileLocation": "打开文件位置",
  "menu.copyFilePath": "复制文件路径",
  "menu.newSubfolder": "新建子文件夹…",

  // ── 设置页 ──
  "settings.title": "设置",
  "settings.basic": "基础设置",
  "settings.appearance": "界面与体验",
  "settings.about": "关于",
  "settings.credits": "鸣谢",
  "settings.language": "语言",
  "settings.languageDesc": "切换界面语言，需重新加载页面生效",

  // ── 设置 - 基础 ──
  "settings.paths.title": "路径配置",
  "settings.paths.gameRoot": "游戏根目录",
  "settings.paths.autoSearch": "自动搜索",
  "settings.paths.gameRootDesc": "用于整合包同步，不影响文件存储位置",
  "settings.links.title": "链接模式",
  "settings.links.reapply": "重新应用",
  "settings.links.copy": "复制",
  "settings.links.hardlink": "硬链接",
  "settings.links.symlink": "符号链接",
  "settings.mirror.title": "下载镜像源",
  "settings.storage.title": "文件存储路径",
  "settings.storage.expand": "展开",
  "settings.storage.desc": "所有资源文件统一存放于此，按类型分子目录",

  // ── 设置 - 外观 ──
  "settings.theme.title": "主题与外观",
  "settings.theme.select": "选择主题",
  "settings.font.title": "字体与布局",
  "settings.fontSize": "基准字号",
  "settings.density": "卡片密度",
  "settings.animation.title": "行为与动画",
  "settings.defaultPage": "启动默认页面",

  // ── 导入页 ──
  "import.renameGuide": "导入仓库前，先重命名一下吧：",
  "import.author": "作者",
  "import.brand": "品牌",
  "import.character": "角色名",
  "import.variant": "变体",
  "import.date": "年月",
  "import.preview": "最终命名",
  "import.importBtn": "导入",
  "import.queue": "队列",
  "import.imported": "已导入",
  "import.dropHint": "拖拽模型文件 … 或文件夹到此处，或点击选择文件",
  "import.tab": "导入",

  // ── 模型仓库（content tab 栏） ──
  "repo.tab.tree": "文件树",
  "repo.tab.dedup": "去重",
  "repo.tab.oldest": "资历最深",

  // ── 整合包实例 ──
  "instances.tab.versions": "版本列表",
  "instances.emptyHint": "点击左侧整合包查看模型",

  // ── 诊断页 ──
  "diagnostics.title": "诊断与冲突",
  "diagnostics.opsLog": "操作日志",
  "diagnostics.runtimeLog": "运行时日志",
  "diagnostics.conflict": "冲突检测",
  "diagnostics.all": "全部",
  "diagnostics.success": "成功",
  "diagnostics.failed": "失败",
  "diagnostics.skipped": "跳过",
  "diagnostics.noLogs": "暂无日志",
  "diagnostics.noRuntimeLogs": "暂无运行时日志",
  "diagnostics.startScan": "开始扫描",

  // ── 回收站 ──
  "recycle.title": "回收站",
  "recycle.empty": "清空回收站",
  "recycle.tab": "回收站",

  // ── 关于页 ──
  "about.title": "关于 YSM 模型管理器",
  "about.version": "当前版本",
  "about.checkUpdate": "检查更新",
  "about.releasePage": "发布页",
  "about.features": "这是什么？",
  "about.techStack": "技术栈",
  "about.links": "资源链接",
  "about.quickStart": "快速上手",

  // ── 鸣谢 ──
  "credits.inspiration": "灵感来源",
  "credits.special": "特别鸣谢",

  // ── 创意工坊 ──
  "workshop.exportSite": "导出站点",
  "workshop.importSite": "导入站点",
  "workshop.activeCreators": "活跃创作者",
  "workshop.noEmbed": "此站点不允许内嵌浏览",
  "workshop.openExternal": "在系统浏览器中打开",
  "workshop.github": "GitHub仓库",

  // ── 错误消息 ──
  "error.fallback": "操作失败",
  "error.unknown": "未知错误",
  "error.networkOffline": "🌐 无网络连接，请检查网络后重试",
  "error.noIndex": "📭 该仓库没有 index.json（尚未建立创意工坊索引）",
  "error.rateLimited": "⏱️ GitHub API 频率限制，请稍后重试或改用浏览器打开",
  "error.loadFailed": "❌ 加载失败，请检查网络或稍后重试",
  "error.fileLocked": "文件被其他程序占用，请关闭相关程序后重试",
  "error.permissionDenied": "权限不足，无法访问文件",
  "error.notFound": "文件或目录不存在",
  "error.cancelled": "请求已取消",
  "error.dataFormat": "数据格式异常",
  "error.dnsFailed": "域名解析失败，请检查网络连接",
  "error.connectionLost": "连接中断，请检查网络稳定性",
  "error.sslError": "SSL/TLS 连接错误，请检查系统时间或网络",
  "error.dirEmpty": "目录为空，没有可操作的文件",
  "error.timeout": "连接超时，请检查网络",
  "error.networkError": "网络连接异常",
  "error.invalidArg": "参数无效",
  "error.alreadyExists": "文件已存在",
  "error.diskFull": "磁盘空间不足",
  "error.unsupported": "不支持的格式或操作",
  "error.tooMany": "操作过于频繁，请稍后重试",
  "error.notADir": "路径不是目录",
  "error.isADir": "路径是目录，不是文件",
};
