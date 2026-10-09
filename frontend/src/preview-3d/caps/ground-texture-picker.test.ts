// @vitest-environment happy-dom
// ===== ground-texture-picker 测试（2026-10-09 锐评：openTexturePicker 移出 cap 后补模块测试）=====
// 覆盖 pickGroundTexture 三条出口：未选文件早退 / 成功回 sink / 失败 toast（i18n 键 + {name} 插值，
// 与 ground-capability.test.ts [G-9] 文案契约同源）。TextureLoader / 文件对话框以桩替真。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as THREE from "three";
import { pickGroundTexture, type GroundTextureSink } from "./ground-texture-picker.ts";
import { t } from "@/core/i18n/t.ts";
import { TOAST_MS } from "@/utils/dom/toast-ms.ts";
import { toast } from "@/utils/dom/toast.ts";

// toast 换桩：断言「失败可感」的文案/级别契约（真 toast 只落 UI，单测层不可观测）
vi.mock("@/utils/dom/toast.ts", () => ({ toast: vi.fn() }));

/** picker 内部的 input 桩：模块只碰 type/accept/files/onchange/click 五个成员。 */
interface PickerInputStub {
  type: string;
  accept: string;
  files: File[] | null;
  onchange: (() => void) | null;
  click: ReturnType<typeof vi.fn>;
}

function makeInput(): PickerInputStub {
  return { type: "", accept: "", files: null, onchange: null, click: vi.fn() };
}

describe("pickGroundTexture", () => {
  let input: PickerInputStub;
  let sinkSpy: ReturnType<typeof vi.fn>;
  let toastSpy: ReturnType<typeof vi.fn>;
  const createURLOrig = URL.createObjectURL;
  const revokeURLOrig = URL.revokeObjectURL;

  beforeEach(() => {
    input = makeInput();
    vi.spyOn(document, "createElement").mockImplementation(
      (tag: string) => {
        expect(tag).toBe("input");
        return input as unknown as HTMLElement;
      },
    );
    vi.spyOn(THREE.TextureLoader.prototype, "loadAsync");
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fake");
    vi.spyOn(URL, "revokeObjectURL");
    sinkSpy = vi.fn();
    const sink: GroundTextureSink = { acceptLoadedTexture: sinkSpy };
    toastSpy = vi.mocked(toast) as unknown as ReturnType<typeof vi.fn>;
    pickGroundTexture(sink);
    // 模块把 sink 闭包进 onchange，测试经 input.onchange 触发三条出口
    expect(input.type).toBe("file");
    expect(input.accept).toBe("image/*");
    expect(input.click).toHaveBeenCalledTimes(1);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    URL.createObjectURL = createURLOrig;
    URL.revokeObjectURL = revokeURLOrig;
  });

  it("未选文件（files 为空）→ 早退：不碰 TextureLoader、不发 toast、不回调 sink", () => {
    input.files = [];
    (THREE.TextureLoader.prototype.loadAsync as ReturnType<typeof vi.fn>).mockResolvedValue(new THREE.Texture());
    input.onchange!();
    expect(sinkSpy).not.toHaveBeenCalled();
    expect(toastSpy).not.toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("加载成功 → sink.acceptLoadedTexture(tex, 文件名) 且 blob URL 必回收", async () => {
    const tex = new THREE.Texture();
    input.files = [new File(["px"], "a.png", { type: "image/png" })];
    (THREE.TextureLoader.prototype.loadAsync as ReturnType<typeof vi.fn>).mockResolvedValue(tex);
    input.onchange!();
    await vi.waitFor(() => expect(sinkSpy).toHaveBeenCalledTimes(1));
    expect(sinkSpy).toHaveBeenCalledWith(tex, "a.png");
    expect(toastSpy).not.toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:fake");
  });

  it("加载失败 → toast 走 i18n 键 preview.groundMatLoadFailed（{name} 插值、error 级）且 blob URL 仍回收", async () => {
    input.files = [new File(["px"], "b.png", { type: "image/png" })];
    (THREE.TextureLoader.prototype.loadAsync as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("decode fail"));
    input.onchange!();
    await vi.waitFor(() => expect(toastSpy).toHaveBeenCalledTimes(1));
    expect(toastSpy).toHaveBeenCalledWith(t("preview.groundMatLoadFailed", { name: "b.png" }), TOAST_MS.normal, "error");
    expect(sinkSpy).not.toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:fake");
  });
});
