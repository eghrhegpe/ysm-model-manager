// ===== initResourcePacks 测试：写入 app-resource-manager 元素 =====
// 覆盖：默认 rtype=pack、透传 rtype、返回清理函数
import { describe, it, expect, beforeEach } from "vitest";

describe("initResourcePacks", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("默认 rtype=resourcepack 写入容器", async () => {
    const container = document.createElement("div");
    const { initResourcePacks } = await import("./resource-packs.ts");

    const cleanup = await initResourcePacks(container, {});

    const el = container.querySelector("app-resource-manager");
    expect(el).not.toBeNull();
    expect(el?.getAttribute("rtype")).toBe("resourcepack");
    expect(typeof cleanup).toBe("function");
  });

  it("透传 rtype 属性", async () => {
    const container = document.createElement("div");
    const { initResourcePacks } = await import("./resource-packs.ts");

    await initResourcePacks(container, {}, "shaderpack");

    expect(container.querySelector("app-resource-manager")?.getAttribute("rtype")).toBe(
      "shaderpack",
    );
  });

  it("清理函数可调用且无副作用", async () => {
    const container = document.createElement("div");
    const { initResourcePacks } = await import("./resource-packs.ts");

    const cleanup = await initResourcePacks(container, {});
    expect(() => cleanup()).not.toThrow();
  });
});
