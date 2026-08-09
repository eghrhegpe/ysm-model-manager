import { describe, expect, it } from "vitest";
import { zhCN } from "./zh-CN";

describe("zh-CN 基准语言包（ADR-045）", () => {
  it("关键命名空间存在且条目齐全", () => {
    const namespaces = [
      "nav.",
      "common.",
      "dialog.",
      "menu.",
      "settings.",
      "import.",
      "repo.",
      "instances.",
      "diagnostics.",
      "recycle.",
      "about.",
      "update.",
      "credits.",
      "content.",
      "workshop.",
      "sidebar.",
      "resource.",
      "sync.",
      "error.",
      "tree.",
    ];
    for (const ns of namespaces) {
      const entries = Object.entries(zhCN).filter(([k]) => k.startsWith(ns));
      expect(entries.length, `命名空间 ${ns} 不应为空`).toBeGreaterThan(0);
      for (const [key, value] of entries) {
        expect(typeof value, `${key} 应为字符串`).toBe("string");
        expect(value.length, `${key} 不应为空字符串`).toBeGreaterThan(0);
      }
    }
  });

  it("关键业务 key 存在（导航/错误/同步）", () => {
    const keys = [
      "nav.repository",
      "nav.instances",
      "nav.community",
      "nav.settings",
      "error.fallback",
      "error.unknown",
      "sync.noInstance",
      "tree.loadFailed",
      "import.success",
      "workshop.downloadStarted",
    ];
    for (const key of keys) {
      expect(zhCN[key], `缺少 key: ${key}`).toBeDefined();
    }
  });

  it("所有 key 采用点号分隔的扁平命名空间格式", () => {
    for (const key of Object.keys(zhCN)) {
      expect(key).toMatch(/^[a-z][a-zA-Z0-9]+(\.[a-z][a-zA-Z0-9]+)*$/);
    }
  });
});
