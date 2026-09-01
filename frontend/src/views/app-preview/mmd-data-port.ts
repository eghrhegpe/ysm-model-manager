// ===== MMD 数据端口共享实现（mmd-3d.ts 与 scene-3d.ts 共用）=====
// 视图层保留 getApp（ADR-072 边界：适配器 0 backend import）；
// 绑定签名已由 Wails 生成的 app.ts 全量类型化，直接消费，不再用 `as unknown as` 绕类型。
import { getApp } from "../../backend/app.ts";
import type { MmdDataPort } from "../../preview-3d/adapters/mmd-adapter.ts";

/**
 * 构建一个接入 Go RPC 的 MMD 数据端口；scope 仅用于 AddOpLog 的运行时环打标
 * （角色预览用 "mmd-preview"，场景预览用 "mmd-scene"）。
 */
export async function makeMmdDataPort(scope: string): Promise<MmdDataPort> {
  const App = await getApp();
  return {
    readFileBytes: async (p) => await App.ReadFileBytes(p),
    readFileBytesBatch: async (paths) => {
      try {
        const r = await App.ReadFileBytesBatch(paths);
        const out: Record<string, string | null> = {};
        if (r) for (const k of Object.keys(r)) out[k] = r[k] ?? null;
        return out;
      } catch {
        return {};
      }
    },
    // KTX2 缓存管线依赖 hash：一次 RPC 拿回数据+hash，缺失则 blobUrlToHash 恒空 → 编码/替换全短路
    readFileBytesBatchWithMeta: async (paths) => {
      try {
        const r = await App.ReadFileBytesBatchWithMeta(paths);
        const out: Record<string, { data: string | null; hash: string } | null> = {};
        if (r) for (const k of Object.keys(r)) out[k] = r[k] ?? null;
        return out;
      } catch {
        return {};
      }
    },
    listAllFilePaths: async (d) => await App.ListAllFilePaths(d),
    addOpLog: async (op, msg, status, err) => {
      try {
        await App.AddOpLog(scope, op, msg, "", 0, status, err ?? "");
      } catch {
        /* 诊断不阻断 */
      }
    },
    getCachedTexture: async (p) => {
      try {
        const result = await App.GetCachedTexture(p);
        return result ?? null;
      } catch {
        return null;
      }
    },
    // KTX2 缓存按 hash 直取（ADR-072：适配器经 port 调用，壳层注入 Go RPC）
    getCachedTextureByHash: async (hash) => {
      try {
        return (await App.GetCachedTextureByHash(hash)) || null;
      } catch {
        return null; // 桥不可用/绑定缺失 → null（保留原 fn 守卫语义）
      }
    },
    // 批量查缓存命中（缓存优化跳过守卫，与 getCachedTextureByHash 同 gate）
    hasCachedTextures: async (hashes): Promise<Record<string, boolean>> => {
      try {
        const r = await App.HasCachedTextures(hashes);
        // bindings 生成类型为 boolean | undefined——归一为布尔（undefined → false）
        const out: Record<string, boolean> = {};
        if (r) for (const k of Object.keys(r)) out[k] = !!r[k];
        return out;
      } catch {
        return {};
      }
    },
  };
}