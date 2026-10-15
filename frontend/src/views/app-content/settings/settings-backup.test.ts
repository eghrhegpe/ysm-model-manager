// ===== 设置导出/导入 逻辑层白名单锁（ADR-344-d1）=====
// 钉两件事：① 采集面=台账里 tier local-storage + authority browser-authority 的键（不多不少）；
// ② 回写面=同一集合（导出文件里未登记的键一律忽略）。台账是唯一事实源，这里只锁
// 「读/写面与台账口径一致」——若有人新增偏好却漏登记台账，契约测试 A 只防死键、不防漏收，
// 本测试以台账为基准再兜一层（采集漏掉某浏览器偏好 = 换机照样丢，正是 b1116645c 的病根）。
import { describe, it, expect, vi, beforeEach } from "vitest";
import { nonMigratingSettingsKeys } from "../../../settings-keys.ts";

const storageMock = vi.hoisted(() => ({
  isStorageAccessible: vi.fn((): boolean => true),
  safeGet: vi.fn((_key: string): string | null => null),
  safeSet: vi.fn(() => {}),
}));

vi.mock("@/utils/base/primitives/storage.ts", () => storageMock);

import {
  collectExportableLocalStorage,
  applyImportedLocalStorage,
} from "./settings-backup.ts";

/** 台账中「随导出带走」的键集合（与 isExportable 同口径） */
const exportableKeys = new Set(
  nonMigratingSettingsKeys()
    .filter((e) => e.tier === "local-storage" && e.authority === "browser-authority")
    .map((e) => e.key),
);

beforeEach(() => {
  storageMock.isStorageAccessible.mockReturnValue(true);
  storageMock.safeGet.mockReturnValue(null);
  storageMock.safeSet.mockReset();
});

describe("collectExportableLocalStorage 采集面", () => {
  it("只采 tier=local-storage 且 authority=browser-authority 的键（口径=台账）", () => {
    storageMock.safeGet.mockImplementation((key: string) => `v:${key}`);
    const collected = new Set(Object.keys(collectExportableLocalStorage()));
    expect([...collected].sort()).toEqual([...exportableKeys].sort());
  });

  it("值缺失（safeGet 返回 null）的键跳过", () => {
    const k = [...exportableKeys][0];
    storageMock.safeGet.mockImplementation((key: string) =>
      key === k ? null : `v:${key}`,
    );
    const out = collectExportableLocalStorage();
    expect(k in out).toBe(false);
    expect(Object.keys(out).length).toBe(exportableKeys.size - 1);
  });

  it("存储不可用时静默返回空对象（ADR-044 隐私模式）", () => {
    storageMock.isStorageAccessible.mockReturnValue(false);
    expect(collectExportableLocalStorage()).toEqual({});
    expect(storageMock.safeGet).not.toHaveBeenCalled();
  });
});

describe("applyImportedLocalStorage 回写面", () => {
  it("只回写台账可导出键；导出文件里未登记的键一律忽略", () => {
    const k = [...exportableKeys][0];
    const applied = applyImportedLocalStorage({
      [k]: "v1",
      "not-a-ledger-key": "x",
    });
    expect(applied).toBe(1);
    expect(storageMock.safeSet).toHaveBeenCalledWith(k, "v1");
    expect(storageMock.safeSet).toHaveBeenCalledTimes(1);
  });

  it("跳过非字符串值与 null（防导入文件里塞入对象/数组键）", () => {
    const k = [...exportableKeys][0];
    const applied = applyImportedLocalStorage({
      [k]: null as unknown as string,
    });
    expect(applied).toBe(0);
    expect(storageMock.safeSet).not.toHaveBeenCalled();
  });

  it("存储不可用时一律不写并返回 0", () => {
    storageMock.isStorageAccessible.mockReturnValue(false);
    const k = [...exportableKeys][0];
    expect(applyImportedLocalStorage({ [k]: "v" })).toBe(0);
    expect(storageMock.safeSet).not.toHaveBeenCalled();
  });
});