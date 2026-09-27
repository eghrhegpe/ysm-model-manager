// ===== ADR-317：Android WebView 桥解码前端侧 =====
// Android 无 wazero optimizing compiler（interpreter 同样本 33s，见
// docs/knowledge/ysm-wasi.md 三路基准），Go 侧把 .ysm 解码委托给本 WebView 的
// YSMParser wasm（V8 JIT，同源预览资产，桌面 spike 实测 1.1s）。
//
// 协议（与 go/ysmwebview/bridge.go 镜像，改动须两侧同步）：
//   Go  →前端  Event "ysm-decode-request"  data=[id, base64(.ysm)]
//   前端→Go    绑定 ResolveYsmDecode(id, gzip(JSON{files})→base64, errMsg)
//
// 本文件属 backend 装配层（可引 bindings/runtime/wasm）；桌面 getAndroidBridge()
// 为 null 直接 no-op，零行为漂移。产物回传用 gzip（JSON 文本压缩比高，对冲
// 绑定方向 160ms/MB 的 JSON 双转换成本）；wasm 单例 MEMFS 非并发安全 → 请求串行。

import { base64ToBytes, u8ToBase64 } from "@/utils/base/primitives/base64.ts";
import type { YsmDecodedFile } from "@/wasm/parser-shared.ts";
import { decodeYsmFileFromMemory } from "@/wasm/ysm-parser.ts";
import {
  MarkYsmDecodeBridgeReady,
  ResolveYsmDecode,
} from "../../bindings/ysm-model-manager/internal/app/app.js";
import { getAndroidBridge } from "./platform.ts";
import { Events } from "./runtime.ts";

/** 解码请求串行队列（wasm 单例 MEMFS /output 目录非并发安全） */
let decodeChain: Promise<void> = Promise.resolve();

/** 桌面联调逃生阀：localStorage["ysm-force-decode-bridge"]=1 时桌面也启用桥
 * （验证 Go↔前端协议全链路用；生产用户无入口，默认关闭） */
function isBridgeDebugEnabled(): boolean {
  try {
    return localStorage.getItem("ysm-force-decode-bridge") === "1";
  } catch {
    return false;
  }
}

/** gzip 压缩（WebView/Node 均内置 CompressionStream） */
export async function gzipBytes(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** 组装回传 payload：JSON{files} → gzip → base64（与 go/ysmwebview.parsePayload 镜像） */
export async function buildResultPayload(files: YsmDecodedFile[]): Promise<string> {
  const json = JSON.stringify({
    files: files.map((f) => ({ path: f.path, data: u8ToBase64(f.data) })),
  });
  const gz = await gzipBytes(new TextEncoder().encode(json));
  return u8ToBase64(gz);
}

/** 安装桥解码 listener。非 Android（无 Java 桥）no-op；成功后向 Go 报就绪。 */
export function installYsmDecodeBridge(): void {
  if (getAndroidBridge() === null && !isBridgeDebugEnabled()) return;

  Events.On("ysm-decode-request", (e: unknown) => {
    // v3 事件 payload：多参 emit 下 e.data 为参数数组 [id, base64]
    const data = (e as { data?: unknown }).data;
    const arr = Array.isArray(data) ? data : [data];
    const id = typeof arr[0] === "number" ? arr[0] : Number(arr[0]);
    const b64 = typeof arr[1] === "string" ? arr[1] : "";
    if (!Number.isFinite(id) || !b64) {
      void ResolveYsmDecode(id ?? -1, "", "ysm-decode-bridge: 请求 payload 不合法");
      return;
    }
    // 串行化：接上先前 promise，保证任意时刻只有一个解码占用 wasm MEMFS
    decodeChain = decodeChain
      .then(async () => {
        const bytes = base64ToBytes(b64);
        if (!bytes) throw new Error("输入 base64 解码失败");
        const files = (await decodeYsmFileFromMemory(bytes)) ?? [];
        await ResolveYsmDecode(id, await buildResultPayload(files), "");
      })
      .catch(async (err: unknown) => {
        await ResolveYsmDecode(id, "", err instanceof Error ? err.message : String(err));
      });
  });

  // listener 挂好即报就绪（Go 侧此后 decodeYSMBest 才走桥）
  void MarkYsmDecodeBridgeReady();
}
