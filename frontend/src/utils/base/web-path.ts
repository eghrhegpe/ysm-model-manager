// ===== 网页版虚拟仓库路径解析（中性纯函数层，零依赖；ADR-217 环 B 从 backend/web-common.ts 下沉）=====
// 解析 /web/<type>/<rest> 形态的网页版虚拟仓库路径。本模块不依赖 backend，
// 供 web-fs / web-store / workers/stats.worker 等共享单一事实源，避免正则散落多文件。

/** /web/<type>/<rest> 两段式（type 不含 /，rest 可含 /） */
const WEB_DIR_RE = /^\/web\/([^/]+)\/(.+)$/;
/** 目录形态 /web/<type>/<name>（name 可含多段路径，末尾可选 /） */
const WEB_NAME_RE = /^\/web\/([^/]+)\/(.+?)\/?$/;

/** 校验是否为 /web/ 虚拟仓库路径（含 type 段与至少一个后续段） */
export function isWebPath(p: string): boolean {
  return WEB_DIR_RE.test(p);
}

/** /web/<type>/<rest> → {type, rest}；非 /web/ 前缀或无 rest 返回 null */
export function parseWebPath(p: string): { type: string; rest: string } | null {
  const m = p.match(WEB_DIR_RE);
  if (!m) return null;
  return { type: m[1], rest: m[2] };
}

/** 目录形态 /web/<type>/<name> → {type, name}（name 可含多段路径）；非 /web/ 前缀返回 null */
export function parseWebDirPath(p: string): { type: string; name: string } | null {
  const m = p.match(WEB_NAME_RE);
  if (!m) return null;
  return { type: m[1], name: m[2] };
}

/** /web/ 之后的类型段（/web/ysm/xxx → "ysm"）；非 /web/ 前缀返回 null */
export function webDirType(dir: string): string | null {
  const m = dir.match(/^\/web\/([^/]+)/);
  return m ? m[1] : null;
}
