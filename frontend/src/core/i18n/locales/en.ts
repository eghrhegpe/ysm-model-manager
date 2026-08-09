// ===== en 语言包占位（ADR-045）=====
// 最小集：确保语言切换不 404。后续按需补全。

export const en: Record<string, string> = {
  // ── 导航 ──
  "nav.repository": "Repository",
  "nav.instances": "Modpacks",
  "nav.community": "Creators",
  "nav.workshop": "Workshop",
  "nav.diagnostics": "Diagnostics",
  "nav.settings": "Settings",
  "nav.preview": "Preview",

  // ── 通用 ──
  "common.loading": "Loading…",
  "common.refresh": "Refresh",
  "common.import": "Import",
  "common.export": "Export",
  "common.copy": "Copy",
  "common.back": "Back",
  "common.close": "Close",
  "common.clear": "Clear",

  // ── 设置 ──
  "settings.title": "Settings",
  "settings.basic": "General",
  "settings.appearance": "Appearance",
  "settings.about": "About",
  "settings.credits": "Credits",
  "settings.language": "Language",
  "settings.languageDesc": "Switch UI language. Page will reload.",

  // ── 错误 ──
  "error.fallback": "Operation failed",
  "error.unknown": "Unknown error",
  "error.networkOffline": "🌐 No network connection",
  "error.loadFailed": "❌ Load failed",
  "error.rateLimited": "GitHub API rate limited, please try again later",
  "error.permissionDenied": "Permission denied",
  "error.notFound": "File or directory not found",
  "error.fileLocked": "File is locked by another program",
  "error.timeout": "Connection timed out",
  "error.networkError": "Network error",
};
