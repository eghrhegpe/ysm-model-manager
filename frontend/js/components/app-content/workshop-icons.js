// ===== 创意工坊 SVG 图标 =====
// 统一管理所有角色和平台的矢量图标
export const ICONS = {
  // --- 角色 (Roles) ---
  CREATOR: '<svg class="ws-icon" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
  OFFICIAL: '<svg class="ws-icon" viewBox="0 0 24 24"><path d="M12 2l1.8 5.5h5.7l-4.6 3.3 1.8 5.5-4.7-3.4-4.7 3.4 1.8-5.5-4.6-3.3h5.7z"/></svg>',
  VUP: '<svg class="ws-icon" viewBox="0 0 24 24"><path d="M12 1a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v1a7 7 0 0 1-6 6.92V20h3v2H8v-2h3v-2.08A7 7 0 0 1 5 11v-1"/></svg>',
  OC: '<svg class="ws-icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><circle cx="8.5" cy="9.5" r="1.5" fill="currentColor"/><circle cx="15.5" cy="9.5" r="1.5" fill="currentColor"/><path d="M8.5 14.5c.8.5 1.9.8 3 .8"/></svg>',
  REPO: '<svg class="ws-icon" viewBox="0 0 24 24"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>',

  // --- 平台 (Platforms) ---
  BILIBILI: '<svg class="ws-icon" viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>',
  AFDIAN: '<svg class="ws-icon" fill viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>',
  GITHUB: '<svg class="ws-icon" viewBox="0 0 24 24"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/></svg>',
  MZHOUSE: '<svg class="ws-icon" viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
  BOWLROLL: '<svg class="ws-icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg>',
  VROID: '<svg class="ws-icon" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2"/><circle cx="12" cy="7" r="3"/><circle cx="9" cy="7" r=".5" fill="currentColor"/><circle cx="15" cy="7" r=".5" fill="currentColor"/><line x1="9" y1="15" x2="15" y2="15"/></svg>',
  NICOVIDEO: '<svg class="ws-icon" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3" fill="currentColor" stroke="none"/></svg>',
  DEVIANTART: '<svg class="ws-icon" viewBox="0 0 24 24"><path d="M17 3a2.83 2.83 0 1 1 4 4L13.5 14.5a4 4 0 0 1-1.4.9L8 17l1.6-4.1a4 4 0 0 1 .9-1.4L18 4"/><path d="M7 14l-1 5 5-1"/></svg>',

  // --- 通用操作图标 ---
  DOWNLOAD: '<svg class="ws-icon" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
  CHECKMARK: '<svg class="ws-icon" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>',
  SEARCH: '<svg class="ws-icon" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
  SETTINGS: '<svg class="ws-icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  FOLDER: '<svg class="ws-icon" viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
  HOURGLASS: '<svg class="ws-icon" viewBox="0 0 24 24"><path d="M6 2v6l6 4-6 4v6"/><path d="M18 2v6l-6 4 6 4v6"/></svg>',
  WARNING: '<svg class="ws-icon" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  CROSS: '<svg class="ws-icon" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  CLOSE: '<svg class="ws-icon" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  PACKAGE: '<svg class="ws-icon" viewBox="0 0 24 24"><path d="M16.5 9.4l-9-5.19M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>',
  STOP: '<svg class="ws-icon" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
};

const SITE_ICON_MAP = {
  bilibili: ICONS.BILIBILI,
  afdian: ICONS.AFDIAN,
  github: ICONS.GITHUB,
  mzhouse: ICONS.MZHOUSE,
  bowlroll: ICONS.BOWLROLL,
  vroid: ICONS.VROID,
  nicovideo: ICONS.NICOVIDEO,
  deviantart: ICONS.DEVIANTART,
};

export function getSiteIcon(siteId) {
  return SITE_ICON_MAP[siteId] || ICONS.CREATOR;
}

export function getTagIconFromRole(role) {
  switch (role) {
    case "official": return ICONS.OFFICIAL;
    case "vup":     return ICONS.VUP;
    case "oc":      return ICONS.OC;
    case "repo":    return ICONS.REPO;
    default:        return ICONS.CREATOR;
  }
}
