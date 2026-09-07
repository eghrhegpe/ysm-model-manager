// ===== 创作者频道浏览模式（external/embed/window）单元测试 =====
// 纯 localStorage 逻辑（safeGet/safeSet 包装）：默认值 / 新键往返 / 旧 boolean 键兼容。
// import 链只到 utils/dom/storage.ts（无 DOM 顶层副作用），默认 happy-dom 提供 localStorage。
import { describe, it, expect, beforeEach } from "vitest";
import {
  createBrowseModeRef,
  loadBrowseMode,
  saveBrowseMode,
  type BrowseMode,
} from "./workshop-browse-mode.ts";

describe("workshop-browse-mode", () => {
  beforeEach(() => {
    localStorage.removeItem("ysm-browse-mode");
    localStorage.removeItem("ysm-embed-mode");
  });

  it("createBrowseModeRef 建单源可变 ref（改 .v 处处生效，贯穿 ctx→render→openUrl）", () => {
    const ref = createBrowseModeRef("external");
    expect(ref.v).toBe("external");
    ref.v = "window";
    expect(ref.v).toBe("window");
  });

  it("无存储 → 默认 external", () => {
    expect(loadBrowseMode()).toBe("external");
  });

  it("load/save 往返：embed 与 window 均持久化到 ysm-browse-mode", () => {
    saveBrowseMode("embed");
    expect(localStorage.getItem("ysm-browse-mode")).toBe("embed");
    expect(loadBrowseMode()).toBe("embed");

    saveBrowseMode("window");
    expect(localStorage.getItem("ysm-browse-mode")).toBe("window");
    expect(loadBrowseMode()).toBe("window");
  });

  it("saveBrowseMode 同步维护旧键 ysm-embed-mode（embed=1，其余=0）", () => {
    saveBrowseMode("embed");
    expect(localStorage.getItem("ysm-embed-mode")).toBe("1");
    saveBrowseMode("external");
    expect(localStorage.getItem("ysm-embed-mode")).toBe("0");
    saveBrowseMode("window");
    expect(localStorage.getItem("ysm-embed-mode")).toBe("0");
  });

  it("兼容旧 boolean 存储：仅 ysm-embed-mode=1 → embed", () => {
    localStorage.setItem("ysm-embed-mode", "1");
    expect(loadBrowseMode()).toBe("embed");
  });

  it("兼容旧 boolean 存储：ysm-embed-mode=0 → external（不算 embed）", () => {
    localStorage.setItem("ysm-embed-mode", "0");
    expect(loadBrowseMode()).toBe("external");
  });

  it("ysm-browse-mode 存了非法值 → 忽略新键，回退旧键 / external 判定", () => {
    localStorage.setItem("ysm-browse-mode", "bogus");
    expect(loadBrowseMode()).toBe("external");
    // 新键非法但旧键为 1 → 仍判 embed
    localStorage.setItem("ysm-embed-mode", "1");
    expect(loadBrowseMode()).toBe("embed");
  });

  it("BrowseMode 类型三值完备：external / embed / window（编译期契约运行时钉住）", () => {
    const all: BrowseMode[] = ["external", "embed", "window"];
    for (const mode of all) {
      saveBrowseMode(mode);
      expect(loadBrowseMode()).toBe(mode);
    }
  });
});
