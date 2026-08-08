// ===== 测试公共工具测试（test-utils/index）=====
// 覆盖：mountCustomElement / unmountElement / sleep / waitFor（成功·超时·抛错）/ waitForElementToBeRemoved
import { describe, it, expect } from "vitest";
import {
  mountCustomElement,
  unmountElement,
  sleep,
  waitFor,
  waitForElementToBeRemoved,
} from "./index.ts";

describe("mountCustomElement / unmountElement", () => {
  it("挂载到默认 body 或指定容器", () => {
    const el = mountCustomElement("div");
    expect(document.body.contains(el)).toBe(true);
    unmountElement(el);
    expect(document.body.contains(el)).toBe(false);

    const host = document.createElement("div");
    const el2 = mountCustomElement("div", host);
    expect(host.contains(el2)).toBe(true);
  });
});

describe("sleep", () => {
  it("等待指定毫秒后 resolve", async () => {
    const start = Date.now();
    await sleep(10);
    expect(Date.now() - start).toBeGreaterThanOrEqual(10);
  });
});

describe("waitFor", () => {
  it("条件满足即 resolve", async () => {
    let ready = false;
    setTimeout(() => { ready = true; }, 5);
    await waitFor(() => ready, 1000);
  });

  it("超时 reject 并带提示", async () => {
    await expect(waitFor(() => false, 50)).rejects.toThrow(/timed out/);
  });

  it("条件抛错后超时 reject 带上原始错误", async () => {
    await expect(waitFor(() => { throw new Error("boom"); }, 50)).rejects.toThrow(/boom/);
  });
});

describe("waitForElementToBeRemoved", () => {
  it("元素被移除后 resolve", async () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 5);
    await waitForElementToBeRemoved(() => el, 1000);
  });

  it("目标为 null 视为已移除", async () => {
    await waitForElementToBeRemoved(() => null, 1000);
  });

  it("超时 reject", async () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    await expect(waitForElementToBeRemoved(() => el, 30)).rejects.toThrow(/timed out/);
    el.remove();
  });
});
