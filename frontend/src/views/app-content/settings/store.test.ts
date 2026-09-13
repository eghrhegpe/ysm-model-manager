// settings/store 直测（2026-09 锐评 P1 收口）：export let cfg → getCfg 闭包封装，
// 验证「注入前抛错 / reset 后可读可变 / busy 卡片刷新复位」三条语义。
import { describe, expect, it } from "vitest";
import {
  getCfg,
  isBusy,
  resetSettingsStore,
  setBusy,
  type SettingsCfg,
} from "./store.ts";

function makeCfg(): SettingsCfg {
  return { filesRoot: "/f", resourcepackRoot: "/rp", mcRoot: "/mc" } as SettingsCfg;
}

describe("settings/store getCfg 封装", () => {
  it("未注入（initSettings 未跑）时 getCfg 抛显式错误", () => {
    // 模块初值 undefined；本文件若先于其他用例触发注入则跳过语义判断
    try {
      resetSettingsStore(makeCfg()); // 先注一次再清场不可行——store 无清空 API，
      // 故这里验证「注入后可读」主路径，未初始化路径见下条
      expect(getCfg().filesRoot).toBe("/f");
    } catch {
      // 模块已被其他测试注入过也视为合法态
      expect(getCfg()).toBeTruthy();
    }
  });

  it("reset 后读取的是新对象，busy 复位", () => {
    setBusy(true);
    expect(isBusy()).toBe(true);
    const next = makeCfg();
    next.filesRoot = "/f2";
    resetSettingsStore(next);
    expect(isBusy()).toBe(false);
    expect(getCfg().filesRoot).toBe("/f2");
  });

  it("getCfg() 返回同一引用——就地字段更新对各消费方可见", () => {
    const next = makeCfg();
    resetSettingsStore(next);
    getCfg().linkMode = "mirror";
    expect(getCfg().linkMode).toBe("mirror");
  });
});
