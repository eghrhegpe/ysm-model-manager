// ===== 网页版后端共享原语（ADR-040 拆分：browser-adapter.ts 职责切分产物）=====
// 本文件存放 web-fs / web-store / web-community 三者共用的极小原语（错误类 + 常量 +
// 编码函数），避免新文件间互相依赖对方或回引 browser-adapter.ts 造成循环引用
// （对齐 types.ts「独立文件避免循环引用」的既有做法）。
// browser-adapter.ts 从本文件 re-export，保持对外 API 导出名/签名不变。

/** 网页版专属错误：binding 浏览器端未实现（Phase 3 能力门控隐藏对应 UI） */
export class WebUnsupportedError extends Error {
  constructor(binding: string) {
    super(`[web] binding ${binding} 浏览器端未实现（ADR-049 Phase 3：能力门控隐藏对应 UI）`);
    this.name = "WebUnsupportedError";
  }
}

/** 网页版虚拟仓库根（路径语义与桌面一致：/web/<type>/<name>/<rel>） */
export const WEB_ROOT = "/web";

// ===== 虚拟仓库路径解析（Top 10 收敛：原 /web 正则散落 5 处——web-fs.ts:25/241/256/273 +
// browser-adapter.ts:140，统一为下方单点导出，新增/调整路径语义只改本文件）=====

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

/** 导入大小上限 100MB（对齐 import-dnd.ts MAX_FILE_SIZE，桌面 oversize 过滤同口径） */
export const MAX_IMPORT_BYTES = 100 * 1024 * 1024;

/** ArrayBuffer → base64（分块，大文件避免栈溢出） */
export function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** base64 → Uint8Array（arrayBufferToBase64 逆操作；非法输入返回 null） */
export function base64ToBytes(b64: string): Uint8Array | null {
  try {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/** Uint8Array → base64（先拷贝隔离 view 偏移共享 buffer，再对齐 arrayBufferToBase64 分块防栈溢出） */
export function u8ToBase64(bytes: Uint8Array): string {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return arrayBufferToBase64(copy.buffer);
}

// ===== 基础 binding 片段（Top 6 注册表驱动：browser-adapter.ts 只做 {...} 装配）=====
// 网页版无 Go 侧版本/3D 通道，这些 binding 为占位或常量实现；LoadResourceTypes
// 依赖 resource_types.json（vite 构建期内联，与 extensions.ts 同源），放本文件避免
// web-fs/web-store/web-community 各自引入 JSON import。
import resourceTypesJson from "../../../resource_types.json" with { type: "json" };

// __APP_VERSION__ 由 vite define 注入（vite.web.config.ts / vite.config.js：
// `process.env.WEB_VERSION || "web"`，索引 1.6 构建注入，与桌面 Go version.Version
// 同源通道——发版脚本传 WEB_VERSION 即与桌面版本号一致；未注入时回退 "web" 保持现状）。
declare const __APP_VERSION__: string;

export const webCommonBindings = {
  // 注册表驱动视图（recycle-bin/oldest-models/community/app-resource-manager）依赖
  // LoadResourceTypes；直接返回同形状 struct（ADR-143 P0：去 string-JSON 化），
  // 消除 registry.ts 静默降级为空
  LoadResourceTypes: () => Promise.resolve(resourceTypesJson),
  // P2 修复（审核）：网页版无 Go 侧 version.Version，补版本 binding 让导航/设置页
  // 不再触发 fail-fast（原缺失导致 app-nav catch 兜底硬编码 "v1.0.0"、设置页版本
  // 卡「加载中」）；版本号由构建注入（__APP_VERSION__，发版脚本传 WEB_VERSION），
  // 未注入时回退 "web" 语义版本，与桌面版本号区分
  GetAppVersion: () => Promise.resolve(__APP_VERSION__),
  CurrentVersion: () => Promise.resolve(__APP_VERSION__),
  // 网页版无 Go 侧 Node 解码通道：GetModel3DSpec 恒空让 model3d-loader 的 WASM 兜底
  // 守卫可达。P2-2 已闭环（2026-08-12）：网页版渲染走 model3d-loader web 分支的
  // buildSpecFromGeometryJSON（spec-builder.ts 纯 TS 移植，Go app_model.go 同契约），
  // 本 binding 桩仅供 Android 兜底通道形状占位（网页版不会调用到它）。
  GetModel3DSpec: () => Promise.resolve(null),
  Build3DSpecFromGeometryJSON: (_geo: string) => {
    // 占位：网页版不调此 binding（TS 移植替代，见 spec-builder.ts）；仅保持 Proxy
    // binding 形状完整，Android 路径仍走 Go 真实现
    return Promise.resolve(null);
  },
  // 网页版系统浏览器即当前浏览器：等价 Go Browser.OpenURL。
  // 不用 noopener 特性串（其下 window.open 恒返回 null 无法检测拦截）；
  // 成功后显式置 opener=null 保留 noopener 安全性
  OpenInBrowser: (url: string) => {
    const w = window.open(url, "_blank");
    if (w) {
      w.opener = null;
    } else {
      // 被弹窗拦截/iframe sandbox 无 allow-popups：留痕不静默
      console.warn("[web] OpenInBrowser 被浏览器拦截，无法打开:", url);
    }
    return Promise.resolve();
  },
} satisfies Record<string, (...args: never[]) => Promise<unknown>>;
