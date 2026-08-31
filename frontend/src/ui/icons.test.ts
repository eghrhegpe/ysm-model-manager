// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { createIcon } from "./icons.ts";

// ===================================================================
// createIcon
// ===================================================================

describe("createIcon", () => {
  // ------------------------------------------------------------------
  // 1. 无效输入 → 返回 null
  // ------------------------------------------------------------------

  it("空字符串返回 null", () => {
    expect(createIcon("")).toBeNull();
  });

  it("iconify 风格名（含冒号）返回 null", () => {
    expect(createIcon("lucide:settings-2")).toBeNull();
  });

  it("任意含冒号的字符串都返回 null", () => {
    expect(createIcon("mdi:close")).toBeNull();
    expect(createIcon("tabler:check")).toBeNull();
    expect(createIcon("a:b:c")).toBeNull();
  });

  // ------------------------------------------------------------------
  // 2. 普通字形 → 返回 .cs-icon span
  // ------------------------------------------------------------------

  it("三角符号 ▶ 返回 span.cs-icon", () => {
    const el = createIcon("▶");
    expect(el).not.toBeNull();
    expect(el!.tagName.toLowerCase()).toBe("span");
    expect(el!.className).toBe("cs-icon");
  });

  it("✕ 符号返回 span.cs-icon", () => {
    const el = createIcon("✕");
    expect(el).not.toBeNull();
    expect(el!.tagName.toLowerCase()).toBe("span");
    expect(el!.className).toBe("cs-icon");
  });

  it("emoji 📁 返回 span.cs-icon", () => {
    const el = createIcon("📁");
    expect(el).not.toBeNull();
    expect(el!.tagName.toLowerCase()).toBe("span");
    expect(el!.className).toBe("cs-icon");
  });

  // ------------------------------------------------------------------
  // 3. span 内容验证
  // ------------------------------------------------------------------

  it("span 的 textContent 等于传入的图标字符串", () => {
    expect(createIcon("▶")!.textContent).toBe("▶");
    expect(createIcon("✕")!.textContent).toBe("✕");
    expect(createIcon("📁")!.textContent).toBe("📁");
    expect(createIcon("✓")!.textContent).toBe("✓");
  });

  // ------------------------------------------------------------------
  // 4. className 正确设置
  // ------------------------------------------------------------------

  it("className 严格等于 cs-icon", () => {
    const el = createIcon("▶");
    expect(el!.classList.contains("cs-icon")).toBe(true);
    expect(el!.className).toBe("cs-icon");
  });
});
