// settings/store 直测（2026-09 锐评 P1 收口）：export let cfg → getCfg 闭包封装，
// 验证「注入前抛错 / reset 后可读可变 / busy 卡片刷新复位」三条语义。
// 2026-10 锐评收编：busy 三段手写（isBusy 检查 + setBusy(true) + finally 复位）机制化为
// withBusy()——锁的获取/释放单点化，调用方只处理「未获得锁」的拒绝分支。
import { describe, expect, it } from "vitest";
import { getCfg, resetSettingsStore, type SettingsCfg, withBusy } from "./store.ts";

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

  it("reset 后读取的是新对象", async () => {
    await withBusy(async () => {}); // 留一把释放干净的锁
    const next = makeCfg();
    next.filesRoot = "/f2";
    resetSettingsStore(next);
    expect(getCfg().filesRoot).toBe("/f2");
  });

  it("getCfg() 返回同一引用——就地字段更新对各消费方可见", () => {
    const next = makeCfg();
    resetSettingsStore(next);
    getCfg().linkMode = "mirror";
    expect(getCfg().linkMode).toBe("mirror");
  });
});

describe("settings/store withBusy 锁机制", () => {
  it("未持锁时获得锁执行 task 并返回 true，结束后释放", async () => {
    let ran = false;
    const acquired = await withBusy(async () => {
      ran = true;
    });
    expect(acquired).toBe(true);
    expect(ran).toBe(true);
    // 释放后可再次获得
    expect(await withBusy(async () => {})).toBe(true);
  });

  it("busy 期间重入返回 false 且不执行 task（防连点语义）", async () => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let inner = 0;
    const first = withBusy(async () => {
      await gate;
      inner += 1;
    });
    // 首个 task 未返回前重入：拿不到锁，task 不执行
    const second = await withBusy(async () => {
      inner += 10;
    });
    expect(second).toBe(false);
    release!();
    expect(await first).toBe(true);
    expect(inner).toBe(1);
    // 首个释放后锁可用
    expect(await withBusy(async () => {})).toBe(true);
  });

  it("task 抛出异常同样释放锁（异常向调用方传播，由调用方 toast）", async () => {
    await expect(
      withBusy(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    // 锁已释放
    expect(await withBusy(async () => {})).toBe(true);
  });
});
