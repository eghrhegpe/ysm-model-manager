// ===== app-preview 方法级补测 =====
// 覆盖：loadPreviewImage 缓存/WASM/Go 三级路径、_showModelDetail 类型分流、
// _showPackInfo 三态渲染、appendDebug、顶层 cacheSetEvictHandler blob 释放。
// 依赖：detail/litematic-meta/wasm 全 mock（分流断言用 spy），cache 用真实实现。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { DecodedYsm } from "./utils.ts";
import { RESOURCE_TYPES } from "../../utils/resource/types.ts";

// ── mock 链 ──────────────────────────────────────
const appObj = vi.hoisted(() => ({
  DetectResourceType: vi.fn(),
  FindPreviewImage: vi.fn(),
  ExtractPreviewTexture: vi.fn(),
  LoadResourceTypes: vi.fn(),
  GetPackInfo: vi.fn(),
}));

vi.mock("../../wails/app.ts", () => ({
  getApp: vi.fn(() => appObj),
}));

const decodeYsmViaWasm = vi.hoisted(() => vi.fn());
vi.mock("./wasm.ts", () => ({ decodeYsmViaWasm }));

const detailSpies = vi.hoisted(() => ({
  showModelDetail: vi.fn(),
  showResourcePack: vi.fn(),
  showSimplePreview: vi.fn(),
}));
vi.mock("./detail.ts", () => detailSpies);

const litematicSpies = vi.hoisted(() => ({
  showLitematic: vi.fn(),
  invalidateLitematicPreview: vi.fn(),
  cleanupLitematic3D: vi.fn(),
}));
vi.mock("./litematic-meta.ts", () => litematicSpies);

import { cacheSet, cacheGet } from "./cache.ts";
import "./index.ts"; // 触发 customElements.define + evict handler 注册
import { sleep, mountCustomElement, unmountElement } from "../../test-utils/index.ts";

/** 创建 app-preview 实例（connectedCallback 会调 _preloadTypeRegistry） */
function mountPreview() {
  return mountCustomElement("app-preview") as unknown as {
    root: ShadowRoot;
    loadPreviewImage(path: string): Promise<string | null>;
    decodeYsmViaWasm(path: string): Promise<DecodedYsm | null>;
    appendDebug(container: HTMLElement | null, msg: string): void;
    _showModelDetail(path: string): Promise<void>;
    _showPackInfo(dirPath: string): Promise<void>;
  } & Element;
}

beforeEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
  decodeYsmViaWasm.mockResolvedValue(null);
  appObj.DetectResourceType.mockResolvedValue("");
  appObj.FindPreviewImage.mockResolvedValue("");
  appObj.ExtractPreviewTexture.mockResolvedValue("");
  appObj.LoadResourceTypes.mockResolvedValue("{}");
  appObj.GetPackInfo.mockResolvedValue(null);
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("loadPreviewImage", () => {
  it("缓存命中 → 直接返回纹理，不触 Go/WASM", async () => {
    const el = mountPreview();
    cacheSet("/repo/cached.ysm", { texture: "blob:cache", _decodedBy: "" });
    expect(await el.loadPreviewImage("/repo/cached.ysm")).toBe("blob:cache");
    // connectedCallback 已调过 getApp（_preloadTypeRegistry），这里断言 Go 兜底未被触达
    expect(appObj.FindPreviewImage).not.toHaveBeenCalled();
    expect(decodeYsmViaWasm).not.toHaveBeenCalled();
    unmountElement(el);
  });

  it(".ysm 走 WASM 解码出纹理 → 缓存并返回（_decodedBy 标记）", async () => {
    const el = mountPreview();
    decodeYsmViaWasm.mockResolvedValue({ texture: "blob:wasm-tex" });
    expect(await el.loadPreviewImage("/repo/a.ysm")).toBe("blob:wasm-tex");
    expect(cacheGet("/repo/a.ysm")?._decodedBy).toBe("🧠 WASM 内置解码");
    unmountElement(el);
  });

  it("WASM 只有 geometry 无纹理 → 缓存 geometry 后走 Go 兜底", async () => {
    const el = mountPreview();
    decodeYsmViaWasm.mockResolvedValue({ geometry: { positions: [] } });
    appObj.FindPreviewImage.mockResolvedValue("blob:loose");
    expect(await el.loadPreviewImage("/repo/b.ysm")).toBe("blob:loose");
    expect(cacheGet("/repo/b.ysm")).toMatchObject({ texture: "blob:loose" });
    unmountElement(el);
  });

  it("WASM 完全失败 → ExtractPreviewTexture 兜底", async () => {
    const el = mountPreview();
    appObj.ExtractPreviewTexture.mockResolvedValue("blob:go-tex");
    expect(await el.loadPreviewImage("/repo/c.ysm")).toBe("blob:go-tex");
    // Go 兜底命中后落缓存
    expect(cacheGet("/repo/c.ysm")).toMatchObject({ texture: "blob:go-tex" });
    unmountElement(el);
  });

  it("Go 层抛错 → 返回 null（不炸）", async () => {
    const el = mountPreview();
    appObj.FindPreviewImage.mockRejectedValue(new Error("boom"));
    expect(await el.loadPreviewImage("/repo/d.ysm")).toBeNull();
    unmountElement(el);
  });
});

describe("_showModelDetail — 类型分流", () => {
  it("PACK → showResourcePack", async () => {
    const el = mountPreview();
    appObj.DetectResourceType.mockResolvedValue(RESOURCE_TYPES.PACK);
    await el._showModelDetail("/repo/pack");
    expect(detailSpies.showResourcePack).toHaveBeenCalledWith(el, "/repo/pack");
    unmountElement(el);
  });

  it("YSM / 空检测 → showModelDetail", async () => {
    const el = mountPreview();
    appObj.DetectResourceType.mockResolvedValue(RESOURCE_TYPES.YSM);
    await el._showModelDetail("/repo/m.ysm");
    appObj.DetectResourceType.mockResolvedValue("");
    await el._showModelDetail("/repo/unknown");
    expect(detailSpies.showModelDetail).toHaveBeenCalledTimes(2);
    unmountElement(el);
  });

  it("LITEMATIC / BLUEPRINT → showLitematic", async () => {
    const el = mountPreview();
    appObj.DetectResourceType.mockResolvedValue(RESOURCE_TYPES.LITEMATIC);
    await el._showModelDetail("/repo/a.litematic");
    appObj.DetectResourceType.mockResolvedValue(RESOURCE_TYPES.BLUEPRINT);
    await el._showModelDetail("/repo/b.blueprint");
    expect(litematicSpies.showLitematic).toHaveBeenCalledTimes(2);
    unmountElement(el);
  });

  it("其他已知类型（shaderpack）→ showSimplePreview", async () => {
    const el = mountPreview();
    appObj.DetectResourceType.mockResolvedValue(RESOURCE_TYPES.SHADER);
    await el._showModelDetail("/repo/s.zip");
    expect(detailSpies.showSimplePreview).toHaveBeenCalledWith(
      el,
      "/repo/s.zip",
      expect.objectContaining({ icon: "📦", label: "shaderpack" }),
    );
    unmountElement(el);
  });

  it("DetectResourceType 抛错 → 空类型回落 showModelDetail", async () => {
    const el = mountPreview();
    appObj.DetectResourceType.mockRejectedValue(new Error("no-detect"));
    await el._showModelDetail("/repo/e.ysm");
    expect(detailSpies.showModelDetail).toHaveBeenCalledWith(el, "/repo/e.ysm");
    unmountElement(el);
  });
});

describe("_showPackInfo", () => {
  it("有信息 → 渲染包名与描述", async () => {
    const el = mountPreview();
    appObj.GetPackInfo.mockResolvedValue({ name: "我的整合包", description: "desc" });
    await el._showPackInfo("/repo/pack");
    const text = el.root.querySelector("#preview-content")?.textContent || "";
    expect(text).toContain("我的整合包");
    expect(text).toContain("desc");
    unmountElement(el);
  });

  it("无信息 → 渲染文件夹名 + folderNoInfo", async () => {
    const el = mountPreview();
    await el._showPackInfo("/repo/pack-folder");
    const text = el.root.querySelector("#preview-content")?.textContent || "";
    expect(text).toContain("pack-folder");
    // test-setup 全局 t() mock 返回 zhCN 中文文案
    expect(text).toContain("该文件夹暂无整合包信息");
    unmountElement(el);
  });

  it("GetPackInfo 抛错 → packReadFailed", async () => {
    const el = mountPreview();
    appObj.GetPackInfo.mockRejectedValue(new Error("read-fail"));
    await el._showPackInfo("/repo/pack");
    const text = el.root.querySelector("#preview-content")?.textContent || "";
    expect(text).toContain("无法读取整合包信息");
    unmountElement(el);
  });
});

describe("appendDebug", () => {
  it("无容器 → 追加到 #preview-content；有容器 → 追加到容器", () => {
    const el = mountPreview();
    el.appendDebug(null, "dbg1");
    expect(el.root.querySelector(".ysm-debug")?.textContent).toBe("dbg1");
    const box = document.createElement("div");
    el.appendDebug(box, "dbg2");
    expect(box.querySelector(".ysm-debug")?.textContent).toBe("dbg2");
    unmountElement(el);
  });
});

describe("顶层 evict handler — blob URL 释放", () => {
  it("缓存淘汰时 revoke blob URL（geometry/authors/avatars 纹理去重）", async () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    try {
      const prefix = "/repo/evict/";
      // 前序测试的条目仍在模块级缓存里：先塞 55 个 fill 挤掉它们，
      // 缓存回落到 50 个 fill（fill-5..fill-54），fill-5 成为最老条目。
      for (let i = 0; i < 55; i++) cacheSet(`${prefix}${i}`, { texture: `blob:fill-${i}` });
      // 同 key 覆盖 fill-5 为复杂值：旧值 blob:fill-5 不再被引用 → evict 释放；
      // 此后 complex 成为最老条目，下一次超限淘汰会对其整体执行 evict handler。
      const complex = {
        texture: "blob:new-tex",
        geometry: { textures: ["blob:geo-tex", "blob:geo-tex"] }, // 重复 URL 只 revoke 一次
        authors: [{ name: "a", avatarUrl: "blob:author" }],
        avatars: { x: "blob:avatar" },
      };
      cacheSet(`${prefix}5`, complex);
      cacheSet(`${prefix}overflow`, { texture: "data:image/png;base64,x" }); // 第 51 条 → 淘汰 complex
      expect(revoke).toHaveBeenCalledWith("blob:fill-5"); // 覆盖时释放旧值
      expect(revoke).toHaveBeenCalledWith("blob:geo-tex");
      expect(revoke).toHaveBeenCalledWith("blob:author");
      expect(revoke).toHaveBeenCalledWith("blob:avatar");
      expect(revoke).toHaveBeenCalledWith("blob:new-tex");
      // Set 去重：geometry.textures 里的重复 URL 只 revoke 一次
      expect(revoke.mock.calls.filter((c) => c[0] === "blob:geo-tex")).toHaveLength(1);
      // 非 blob URL 不误伤
      expect(revoke).not.toHaveBeenCalledWith("data:image/png;base64,x");
    } finally {
      revoke.mockRestore();
    }
    await sleep(1);
  });
});
