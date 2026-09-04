// ===== 测试工具：URL blob spy 工厂（2026 锐评整改：mock 复印机收敛）=====
// happy-dom 无真实 blob URL；各 3D 适配器测试曾各自手写
//   vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:xxx")
//   vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {})
// 全仓 50+ 处同构。收敛为单一工厂：默认 create 固定返回 "blob:mock-url"，
// 可传自定义实现（如序列化 blob:t${++counter}）；返回 create/revoke 两个 spy
// 供断言调用次数 / 回收次数（如 dispose 后 blob 全回收）。
// 清理由测试 afterEach 的 vi.restoreAllMocks() 统一承担（工厂不接管 restore）。
import { vi } from "vitest";

export interface BlobUrlStubs {
  /** createObjectURL spy（默认 mockImplementation 返回 "blob:mock-url"） */
  createURL: ReturnType<typeof vi.fn>;
  /** revokeObjectURL spy（默认 no-op） */
  revokeURL: ReturnType<typeof vi.fn>;
}

/**
 * 成对 stub URL.createObjectURL / URL.revokeObjectURL。
 * @param createImpl 自定义 createObjectURL 实现（缺省 `() => "blob:mock-url"`）
 */
export function stubBlobUrls(createImpl?: () => string): BlobUrlStubs {
  const createURL = vi
    .spyOn(URL, "createObjectURL")
    .mockImplementation(createImpl ?? (() => "blob:mock-url"));
  const revokeURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  return { createURL, revokeURL };
}
