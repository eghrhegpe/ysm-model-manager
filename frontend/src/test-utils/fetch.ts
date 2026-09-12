// ===== 全局 fetch stub 工厂（测试税刀三夹具沉淀，对齐 stubBlobUrls 模式）=====
// 同构 mock ≥3 处即值得抽（test_tax_reduction 刀三）：data.test.ts /
// download-queue*.test.ts / community-data.integration.test.ts 四处「stub 全局
// fetch 防触网」骨架收敛于此。
// - stubFetch()              → 默认返回 { ok: true, status: 200, json: async () => [] }
// - stubFetch(impl)          → 自定义实现（返回 spy，供 mock.calls / toHaveBeenCalled 断言）
// - stubFetch(existingMock)  → 复用 hoisted 单例（download-queue* 系列传 vi.fn）
// 清理：调用方 afterEach vi.unstubAllGlobals()（工厂不接管 restore，与 stubBlobUrls 一致）。
import { vi } from "vitest";

export type FetchImpl = (url: string, init?: RequestInit) => Promise<unknown>;

export function stubFetch(impl?: FetchImpl | ReturnType<typeof vi.fn>): {
  fetchMock: ReturnType<typeof vi.fn>;
} {
  const fetchMock =
    impl && vi.isMockFunction(impl)
      ? impl
      : vi.fn(impl ?? (() => Promise.resolve({ ok: true, status: 200, json: async () => [] })));
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock };
}
