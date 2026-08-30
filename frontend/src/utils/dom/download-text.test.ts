// @vitest-environment node
// ===== downloadTextFile 测试（DOM 职责下沉）=====
// 验证 Blob/anchor/revoke 调用链；与 clipboard.test.ts 同形——把核心层原本散落的
// document.createElement / URL.createObjectURL 收敛到 utils/dom。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { downloadTextFile } from "./download-text.ts";

const createElementMock = vi.fn((tag: string) => {
  if (tag === "a") {
    return { download: "", href: "", click: vi.fn() };
  }
  return {};
});
const documentMock = {
  createElement: createElementMock,
  body: { appendChild: vi.fn(), removeChild: vi.fn() },
};
const createObjectURL = vi.fn((_blob: unknown) => "blob:mock");
const revokeObjectURL = vi.fn();

beforeEach(() => {
  vi.stubGlobal("document", documentMock);
  vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
  createElementMock.mockClear();
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
  (documentMock.body.appendChild as ReturnType<typeof vi.fn>).mockClear();
  (documentMock.body.removeChild as ReturnType<typeof vi.fn>).mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("downloadTextFile", () => {
  it("生成 Blob 并触发 anchor 点击", () => {
    const a = downloadTextFile("hello\nworld", "list.txt");
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blobArg = createObjectURL.mock.calls[0][0] as unknown as Blob;
    expect(blobArg).toBeInstanceOf(Blob);
    expect(blobArg.type).toBe("text/plain;charset=utf-8");
    expect(a.download).toBe("list.txt");
    expect((a as unknown as { click: ReturnType<typeof vi.fn> }).click).toHaveBeenCalled();
  });

  it("anchor 挂到 document.body 后又移除（不留 DOM 残留）", () => {
    downloadTextFile("x", "a.txt");
    expect(documentMock.body.appendChild).toHaveBeenCalledTimes(1);
    expect(documentMock.body.removeChild).toHaveBeenCalledTimes(1);
  });

  it("revoke ObjectURL 避免泄漏", () => {
    downloadTextFile("x", "a.txt");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock");
  });
});