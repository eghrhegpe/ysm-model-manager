import { describe, it, expect, vi, afterEach } from "vitest";
import { TextDecoder as NodeTextDecoder } from "node:util";
import { showProgress, tryFetchModels } from "./data.ts";

if (typeof globalThis.TextDecoder === "undefined")
  globalThis.TextDecoder = NodeTextDecoder;

globalThis.atob = (b64) => Buffer.from(b64, "base64").toString("binary");

describe("showProgress", () => {
  it("renders progress box with label", () => {
    const el = document.createElement("div");
    showProgress(el, 30, "⏳ 加载中…");
    expect(el.querySelector(".gh-progress-box")).toBeTruthy();
    expect(el.querySelector(".gh-progress-text")!.textContent).toBe(
      "⏳ 加载中…",
    );
  });

  it("sets progress width", () => {
    const el = document.createElement("div");
    showProgress(el, 50, "test");
    const fill = el.querySelector(".gh-progress-fill") as HTMLElement | null;
    expect(fill!.style.width).toBe("50%");
  });

  it("adds striped class when < 100", () => {
    const el = document.createElement("div");
    showProgress(el, 50, "test");
    expect(
      el.querySelector(".gh-progress-fill")!.classList.contains("gh-striped"),
    ).toBe(true);
  });

  it("removes striped when at 100", () => {
    const el = document.createElement("div");
    showProgress(el, 100, "done");
    expect(
      el.querySelector(".gh-progress-fill")!.classList.contains("gh-striped"),
    ).toBe(false);
  });
});

type FetchResp = { ok: boolean; status: number; json: () => Promise<unknown> };
type FetchImpl = (url: string) => Promise<FetchResp>;

const okJson = (data: unknown): FetchResp => ({ ok: true, status: 200, json: async () => data });
const errResp = (status: number): FetchResp => ({ ok: false, status, json: async () => ({}) });

function mockFetch(impl: FetchImpl) {
  const fn = vi.fn(impl);
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("tryFetchModels 成功路径（并发竞速取最快）", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("默认 mirror=''：raw 源成功，返回 models 并回调 100%", async () => {
    vi.useFakeTimers();
    const models = [{ name: "m1" }];
    const fetchMock = mockFetch(() => Promise.resolve(okJson(models)));
    const progress = vi.fn();
    const result = await tryFetchModels("owner/repo", "", progress);
    expect(result).toEqual({ models, source: "raw" });
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://raw.githubusercontent.com/owner/repo/main/index.json",
    );
    expect(progress).toHaveBeenCalledWith(100, "✅ 加载完成");
  });

  it("mirror='jsdelivr'：jsd 源作为首个请求", async () => {
    vi.useFakeTimers();
    const models = [{ name: "m2" }];
    const fetchMock = mockFetch(() => Promise.resolve(okJson(models)));
    const result = await tryFetchModels("owner/repo", "jsdelivr");
    expect(result.source).toBe("jsd");
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://cdn.jsdelivr.net/gh/owner/repo@main/index.json",
    );
  });

  it("mirror='githubapi'：api 源 base64 内容被解码", async () => {
    vi.useFakeTimers();
    // jsdom 的 atob 对合法 base64 抛错，用 Buffer 实现替代以驱动源码解码路径
    vi.stubGlobal("atob", (b64: string) => Buffer.from(b64, "base64").toString("binary"));
    const models = [{ name: "api-model" }];
    const b64 = Buffer.from(JSON.stringify(models), "utf-8").toString("base64");
    const fetchMock = mockFetch(() =>
      Promise.resolve(okJson({ encoding: "base64", content: b64 })),
    );
    const result = await tryFetchModels("owner/repo", "githubapi");
    expect(result.source).toBe("api");
    expect(result.models).toEqual(models);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.github.com/repos/owner/repo/contents/index.json",
    );
  });

  it("首个请求返回非数组 → 竞速继续到下一源成功", async () => {
    vi.useFakeTimers();
    const models = [{ name: "ok" }];
    mockFetch((url) =>
      url.includes("raw.githubusercontent.com")
        ? Promise.resolve(okJson({ not: "array" }))
        : Promise.resolve(okJson(models)),
    );
    const promise = tryFetchModels("owner/repo", "");
    await vi.advanceTimersByTimeAsync(2500);
    const result = await promise;
    expect(result.models).toEqual(models);
    expect(result.source).toBe("jsd");
  });
});

describe("tryFetchModels 失败路径（全部源失败时的根因诊断）", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("任一源 404 → NoIndex（提前终止）", async () => {
    vi.useFakeTimers();
    mockFetch(() => Promise.resolve(errResp(404)));
    const promise = tryFetchModels("owner/repo", "");
    const assertion = expect(promise).rejects.toThrow("NoIndex");
    await vi.advanceTimersByTimeAsync(300);
    await assertion;
  });

  it("全部 403 → RateLimited", async () => {
    vi.useFakeTimers();
    mockFetch(() => Promise.resolve(errResp(403)));
    const promise = tryFetchModels("owner/repo", "");
    const assertion = expect(promise).rejects.toThrow("RateLimited");
    await vi.advanceTimersByTimeAsync(4500);
    await assertion;
  });

  it("全部网络错误 → NetworkOffline", async () => {
    vi.useFakeTimers();
    mockFetch(() =>
      Promise.reject(new TypeError("NetworkError when attempting to fetch")),
    );
    const promise = tryFetchModels("owner/repo", "");
    const assertion = expect(promise).rejects.toThrow("NetworkOffline");
    await vi.advanceTimersByTimeAsync(4500);
    await assertion;
  });

  it("全部 HTTP 500 → AllFailed", async () => {
    vi.useFakeTimers();
    mockFetch(() => Promise.resolve(errResp(500)));
    const promise = tryFetchModels("owner/repo", "");
    const assertion = expect(promise).rejects.toThrow("AllFailed");
    await vi.advanceTimersByTimeAsync(4500);
    await assertion;
  });

  it("fetch 抛出含 HTTP 404 的错误（非提前退出路径）→ NoIndex", async () => {
    vi.useFakeTimers();
    mockFetch(() => Promise.reject(new Error("HTTP 404")));
    const promise = tryFetchModels("owner/repo", "");
    const assertion = expect(promise).rejects.toThrow("NoIndex");
    await vi.advanceTimersByTimeAsync(4500);
    await assertion;
  });
});
