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

// ADR-217 环 B：虚拟仓库路径解析下沉 utils/base/pure/web-path.ts（中性纯函数层），
// 本模块仅 re-export 保持 web-fs 等消费方命名兼容，消除 workers→web-common 反向环。
export {
  isWebPath,
  parseWebDirPath,
  parseWebPath,
  webDirType,
} from "@/utils/base/pure/web-path.ts";

/** 导入大小上限 100MB（对齐 import-dnd.ts MAX_FILE_SIZE，桌面 oversize 过滤同口径） */
export const MAX_IMPORT_BYTES = 100 * 1024 * 1024;

// ===== base64 原语（ADR-170 二段收口 2026-09：实现下沉 utils/base/primitives/base64.ts）=====
// parsers/（叶子层）消费 base64ToBytes/u8ToBase64 不再反向依赖本文件；
// backend 系既有 import 经此 re-export 保持导出名/签名不变（来源数=1，非聚合桶）。
export { arrayBufferToBase64, base64ToBytes, u8ToBase64 } from "@/utils/base/primitives/base64.ts";

// ===== 基础 binding 片段（Top 6 注册表驱动：browser-adapter.ts 只做 {...} 装配）=====
// 网页版无 Go 侧版本/3D 通道，这些 binding 为占位或常量实现；LoadResourceTypes
// 返回与桌面 Go 同形状 struct，数据同步读单一解析点 schema.ts（ADR-269 D3⑥：
// 废本模块对 resource_types.json 的重复内联 import）。
import { allResourceTypes } from "@/utils/resource/schema.ts";

// __APP_VERSION__ 由 vite define 注入（vite.web.config.ts / vite.config.js：
// `process.env.WEB_VERSION || "web"`，索引 1.6 构建注入，与桌面 Go version.Version
// 同源通道——发版脚本传 WEB_VERSION 即与桌面版本号一致；未注入时回退 "web" 保持现状）。
declare const __APP_VERSION__: string;

export const webCommonBindings = {
  // 注册表驱动视图 binding（与桌面 Go LoadResourceTypes 同形状 struct，ADR-143 P0：
  // 去 string-JSON 化）；数据同步源自 schema.ts 单一解析点，无空表窗口
  LoadResourceTypes: () => Promise.resolve({ resourceTypes: allResourceTypes }),
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
