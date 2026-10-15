// ===== 设置键台账（settings-keys.ts）结构锁 =====
// 台账是唯一事实源（键/权威/owner/note）：本测试钉 ① 键唯一性 ② note 字段 i18n 安全形态
// （禁 <占位> 尖括号——HTML 信号通道，i18n-ui-check 会判漂移；历史 2 条中文 note 曾因此中招）。
import { describe, it, expect } from "vitest";
import {
  SETTINGS_KEYS,
  exportableSettingsKeys,
  findSettingsKey,
  migratingSettingsKeys,
  nonMigratingSettingsKeys,
  unbackupableSettingsKeys,
} from "./settings-keys.ts";

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

  it("三口径集合关系：exportable ⊆ nonMigrating，且 unbackupable = 差集（锐评 2026-10-16 语义拆分）", () => {
    const migrating = new Set(migratingSettingsKeys().map((e) => e.key));
    const exportable = exportableSettingsKeys();
    const nonMigrating = new Set(nonMigratingSettingsKeys().map((e) => e.key));
    // 导出口径只可能覆盖「不随复制配置文件走」的那一档
    for (const e of exportable) {
      expect(nonMigrating.has(e.key), `${e.key} 可导出却不在 nonMigrating`).toBe(true);
      expect(migrating.has(e.key), `${e.key} 可导出却随配置文件迁移（双口径矛盾）`).toBe(false);
      // 导出判定 = tier/authority 口径，不再依赖 migrates 字段（它表"随复制走"，另一维度）
      expect(e.tier, `${e.key} 可导出但 tier 非 local-storage`).toBe("local-storage");
      expect(e.authority, `${e.key} 可导出但 authority 非 browser-authority`).toBe(
        "browser-authority",
      );
    }
    // 「真正要重设/重算」= nonMigrating 减 exportable
    const unbackupable = new Set(unbackupableSettingsKeys().map((e) => e.key));
    for (const e of nonMigratingSettingsKeys()) {
      const should = !exportable.some((x) => x.key === e.key);
      expect(unbackupable.has(e.key), `${e.key} 差集归属不符`).toBe(should);
    }
    // 派生集合非空（若台账全被导出覆盖，差集口径失去存在意义要报警）
    expect(unbackupable.size).toBeGreaterThan(0);
  });

  it("keyPattern 登记名必须与通配前缀一致（占位符即键名形态）", () => {
    for (const e of SETTINGS_KEYS) {
      if (!e.keyPattern) continue;
      expect(e.keyPattern.includes("*"), `${e.key} keyPattern 必须含通配`).toBe(true);
      if (!e.keyPattern.endsWith("*")) {
        expect(e.key, `${e.key} keyPattern 与登记名不一致`).toBe(e.keyPattern);
      } else {
        // 尾通配：登记名以 * 结尾或与 pattern 同形（如 ysm-scene-cap-* 登记名也带 *）
        expect(e.key.startsWith(e.keyPattern.slice(0, -1)), `${e.key} 登记名与 pattern 前缀分叉`).toBe(
          true,
        );
      }
    }
  });
});
