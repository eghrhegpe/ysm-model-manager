// ===== 设置键台账（settings-keys.ts）结构锁 =====
// 台账是唯一事实源（键/权威/owner/note）：本测试钉 ① 键唯一性 ② note 字段 i18n 安全形态
// （禁 <占位> 尖括号——HTML 信号通道，i18n-ui-check 会判漂移；历史 2 条中文 note 曾因此中招）。
import { describe, it, expect } from "vitest";
import { SETTINGS_KEYS, findSettingsKey, migratingSettingsKeys } from "./settings-keys.ts";

describe("settings-keys 台账结构锁", () => {
  it("key 全局唯一（台账不得出现双条目）", () => {
    const keys = SETTINGS_KEYS.map((e) => e.key);
    const dup = keys.filter((k, i) => keys.indexOf(k) !== i);
    expect(dup).toEqual([]);
  });

  it("migrating 条目必有 goField 或 setting（迁移面可寻址）", () => {
    for (const e of migratingSettingsKeys()) {
      expect(e.goField || e.setting, `${e.key} 迁移条目无可寻址字段`).toBeTruthy();
    }
  });

  it("note 字段无尖括号占位（i18n 通道一 HTML 信号防回归）", () => {
    for (const e of SETTINGS_KEYS) {
      if (!e.note) continue;
      expect(e.note, `${e.key} note 含尖括号占位` as string).not.toMatch(/<[A-Za-z]/);
    }
  });

  it("findSettingsKey 命中与未命中形态", () => {
    expect(findSettingsKey("ysm-ws-search-kw")?.key).toBe("ysm-ws-search-kw");
    expect(findSettingsKey("不存在的键-xyz")).toBeUndefined();
  });
});
