import { describe, it, expect, vi, afterEach } from "vitest";
import { TextDecoder as NodeTextDecoder } from "node:util";
import { stubFetch } from "@/test-utils/fetch.ts";
import { showProgress, tryFetchModels, FetchModelsFailureError, fetchModelsFailureKind } from "./data.ts";

// TextDecoder 保留带守卫的 globalThis 永久形态：用例内 afterEach 的
// unstubAllGlobals() 会撤销 vi.stubGlobal 设置，而 api 分支（data.ts L164）
// 依赖其全程可用（vitest-env-switch 模式 1 针对 getter-only 全局，此处可赋值）。
if (typeof globalThis.TextDecoder === "undefined")
  globalThis.TextDecoder = NodeTextDecoder as typeof TextDecoder;

// atob 走 vi.stubGlobal（模式 1）：happy-dom 原生 atob 兜底，撤销后行为等价；
// api 用例内另有显式 stub 双保险（防环境切换）。
vi.stubGlobal("atob", (b64: string) => Buffer.from(b64, "base64").toString("binary"));

describe("showProgress", () => {
  it("renders progress box with label", () => {
    const el = document.createElement("div");
    showProgress(el, 30, "⏳ 加载中…");
    expect(el.querySelector(".gh-progress-box")).not.toBeNull();
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

  it("label 结构：[spin, 空格 textNode, text] 序列（空格是唯一间距——A-2 回归护栏）", () => {
    const el = document.createElement("div");
    showProgress(el, 30, "加载中…");
    const label = el.querySelector(".gh-progress-label") as HTMLElement;
    expect(
      Array.from(label.childNodes).map((n) => n.nodeName),
    ).toEqual(["SPAN", "#text", "SPAN"]);
    expect((label.childNodes[1] as Text).data).toBe(" ");
    expect(label.children[0].className).toBe("gh-progress-spin");
    expect(label.children[1].className).toBe("gh-progress-text");
  });

  it("钳制越界/非法 pct（P3 修复：NaN/负值/超 100 → [0,100]）", () => {
    const el = document.createElement("div");
    showProgress(el, Number.NaN, "x");
    expect((el.querySelector(".gh-progress-fill") as HTMLElement).style.width).toBe("0%");
    showProgress(el, 150, "x");
    expect((el.querySelector(".gh-progress-fill") as HTMLElement).style.width).toBe("100%");
    showProgress(el, -5, "x");
    expect((el.querySelector(".gh-progress-fill") as HTMLElement).style.width).toBe("0%");
  });
});

type FetchResp = { ok: boolean; status: number; json: () => Promise<unknown> };
// init 可选：混合 404 用例需读 AbortSignal（监听 abort 验证在途请求未被误杀）
type FetchImpl = (url: string, init?: RequestInit) => Promise<FetchResp>;

const okJson = (data: unknown): FetchResp => ({ ok: true, status: 200, json: async () => data });
const errResp = (status: number): FetchResp => ({ ok: false, status, json: async () => ({}) });

function mockFetch(impl: FetchImpl) {
  // 夹具沉淀（刀三）：stub 全局 fetch 统一走 test-utils/fetch.ts 工厂
  return stubFetch(impl).fetchMock;
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
    expect(progress).toHaveBeenCalledWith(100, "加载完成");
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
    // happy-dom 已原生支持 atob（历史 jsdom 抛错，Mock Buffer 替代保留以防环境切换）
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

  it("api 源 base64 含 \\r\\n 换行也能解码（P2 修复：GitHub 实际返回可能带 CRLF）", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("atob", (b64: string) => Buffer.from(b64, "base64").toString("binary"));
    const models = [{ name: "crlf-model" }];
    const b64 = Buffer.from(JSON.stringify(models), "utf-8").toString("base64");
    // 模拟 GitHub API 返回带 \r\n 的 base64（原只去 \n，\r 残留令 atob 抛错 → AllFailed）
    const contentWithCRLF = b64.slice(0, 10) + "\r\n" + b64.slice(10);
    mockFetch(() =>
      Promise.resolve(okJson({ encoding: "base64", content: contentWithCRLF })),
    );
    const result = await tryFetchModels("owner/repo", "githubapi");
    expect(result.source).toBe("api");
    expect(result.models).toEqual(models);
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

  it("jsd 源 404 不误杀在途 raw（P2 修复：仅 raw 404 视为确定性证据）", async () => {
    vi.useFakeTimers();
    const models = [{ name: "raw-ok" }];
    // raw 慢速在途（受 abort 控制），jsd 快速 404
    let resolveRaw!: (r: FetchResp) => void;
    mockFetch((url, init) =>
      url.includes("jsdelivr.net")
        ? Promise.resolve(errResp(404))
        : new Promise<FetchResp>((resolve, reject) => {
            (init?.signal as AbortSignal | undefined)?.addEventListener(
              "abort",
              () => reject(new Error("Aborted")),
            );
            resolveRaw = resolve;
          }),
    );
    const promise = tryFetchModels("owner/repo", "");
    // 推进到 jsd 发出并 404；若旧逻辑（任一源 404 abort 全部）会杀掉在途 raw
    await vi.advanceTimersByTimeAsync(2500);
    resolveRaw(okJson(models));
    const result = await promise;
    expect(result.source).toBe("raw");
    expect(result.models).toEqual(models);
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

  it("非 raw 源 404（非确定性早退路径）→ 汇总 NoIndex", async () => {
    vi.useFakeTimers();
    // 真实 fetch 语义：HTTP 404 走 resp.ok=false（永不 reject）——raw 非 404（500）不触发
    // 早退 abort，jsd/api 的 404 在汇总期按 has404 归类 NoIndex（替代旧字符串消息嗅探）
    mockFetch((url) =>
      url.includes("raw.githubusercontent.com")
        ? Promise.resolve(errResp(500))
        : Promise.resolve(errResp(404)),
    );
    const promise = tryFetchModels("owner/repo", "");
    const assertion = expect(promise).rejects.toThrow("NoIndex");
    await vi.advanceTimersByTimeAsync(4500);
    await assertion;
  });
});

describe("fetchModelsFailureKind — 竞速失败判别口（kind 信道单一事实源）", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("FetchModelsFailureError → 直读 kind（message 保留 token 兼容旧断言形态）", () => {
    const err = new FetchModelsFailureError("NoIndex");
    expect(err).toBeInstanceOf(Error);
    expect(err.kind).toBe("NoIndex");
    expect(err.message).toBe("NoIndex");
    expect(fetchModelsFailureKind(err)).toBe("NoIndex");
  });

  it("纯 Error(message=token) → 兼容白名单命中（历史 throw 点不误断）", () => {
    expect(fetchModelsFailureKind(new Error("NetworkOffline"))).toBe("NetworkOffline");
    expect(fetchModelsFailureKind(new Error("RateLimited"))).toBe("RateLimited");
  });

  it("陌生错误/null → null（消费者落 friendlyError/通用文案兜底）", () => {
    expect(fetchModelsFailureKind(new Error("boom"))).toBeNull();
    expect(fetchModelsFailureKind(undefined)).toBeNull();
    expect(fetchModelsFailureKind(null)).toBeNull();
    // token 子串不算命中（精确白名单，防 "HTTP 403" 类消息误分类）
    expect(fetchModelsFailureKind(new Error("got NoIndex somehow"))).toBeNull();
  });

  it("tryFetchModels 全败 reject 值 = FetchModelsFailureError（生产端类型化坐实）", async () => {
    vi.useFakeTimers();
    mockFetch(() => Promise.resolve(errResp(403)));
    const promise = tryFetchModels("owner/repo", "");
    const assertion = expect(promise).rejects.toBeInstanceOf(FetchModelsFailureError);
    await vi.advanceTimersByTimeAsync(4500);
    await assertion;
    await promise.catch((e: unknown) => {
      expect(fetchModelsFailureKind(e)).toBe("RateLimited");
    });
  });
});

describe("tryFetchModels — body 读取阶段护栏（P2 收债：headers 后不拆护栏）", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /**
   * 真实 fetch 语义：headers 秒回，body(json) 读取受 signal 控制——abort 即拒绝。
   * 边界注记：夹具用 `new Error("AbortError")`，真实 fetch 拒的是 `DOMException{name:"AbortError"}`——
   * 生产分类看 `signal.aborted` 标志不看错误身份，故夹具形状安全；若日后改按 name/code 判别，
   * 本夹具须同步换 DOMException。
   */
  function hangBody(urlFilter: (url: string) => boolean): FetchImpl {
    return (url, init) =>
      urlFilter(url)
        ? Promise.resolve({
            ok: true,
            status: 200,
            json: () =>
              new Promise<unknown>((_, reject) => {
                (init?.signal as AbortSignal | undefined)?.addEventListener("abort", () =>
                  reject(new Error("AbortError")),
                );
              }),
          })
        : Promise.resolve(errResp(500));
  }

  it("源 headers 秒回但 body 永挂 → 8s 超时杀 body 流，记 timeout 落 NetworkOffline（旧实现 headers 后拆护栏 → 永不分类）", async () => {
    vi.useFakeTimers();
    mockFetch(hangBody((url) => url.includes("raw.githubusercontent.com")));
    const promise = tryFetchModels("owner/repo", "");
    const assertion = expect(promise).rejects.toThrow("NetworkOffline");
    // 三路：raw(0s) body 挂到 8s 超时、jsd(2s)/api(4s) 未 hang 走 500；汇总按 timeout 归网络类
    await vi.advanceTimersByTimeAsync(9000);
    await assertion;
  });

  it("胜出者 abort 时，败者 body 在途读取被连带终止（护栏仍在，不误记本源失败）", async () => {
    vi.useFakeTimers();
    const models = [{ name: "jsd-ok" }];
    let rawBodyRejected!: boolean;
    mockFetch((url, init) => {
      if (url.includes("jsdelivr.net")) return Promise.resolve(okJson(models));
      if (url.includes("raw.githubusercontent.com")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            new Promise<unknown>((_res, rej) => {
              (init?.signal as AbortSignal)?.addEventListener("abort", () => {
                rawBodyRejected = true;
                rej(new Error("AbortError"));
              });
            }),
        });
      }
      return Promise.resolve(errResp(500));
    });
    const promise = tryFetchModels("owner/repo", "");
    const assertion = expect(promise).resolves.toMatchObject({ source: "jsd" });
    await vi.advanceTimersByTimeAsync(2500); // jsd 2s 发射并胜出 → ctrl abort
    await assertion;
    expect(rawBodyRejected, "jsd 胜出的 abort 应穿透到 raw 在途 body 读取").toBe(true);
  });

  it("body 抛 SyntaxError（载荷坏损）→ 不记失败，汇总落 AllFailed（与 invalid payload 同口径）", async () => {
    vi.useFakeTimers();
    mockFetch((url) =>
      url.includes("raw.githubusercontent.com")
        ? Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.reject(new SyntaxError("bad json")),
          })
        : Promise.resolve(errResp(500)),
    );
    const promise = tryFetchModels("owner/repo", "");
    // 若回归把 SyntaxError 误记 timeout/network，这里会从 AllFailed 漂成 NetworkOffline 而全绿——本用例即防漂锁
    const assertion = expect(promise).rejects.toThrow("AllFailed");
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
  });

  it("body 中途断流（TypeError，非 AbortError）→ 记 network 落 NetworkOffline（与 headers 阶段同口径，子代理 P3-1 清偿锁）", async () => {
    vi.useFakeTimers();
    mockFetch((url) =>
      url.includes("raw.githubusercontent.com")
        ? Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.reject(new TypeError("network stream interrupted")),
          })
        : Promise.resolve(errResp(500)),
    );
    const promise = tryFetchModels("owner/repo", "");
    const assertion = expect(promise).rejects.toThrow("NetworkOffline");
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
  });

  it("raw404 确定性早退 + 败者 body 在途 abort → 汇总仍 NoIndex 不被漂成 NetworkOffline（败者不计入的交叉验证）", async () => {
    vi.useFakeTimers();
    mockFetch((url, init) => {
      if (url.includes("raw.githubusercontent.com")) {
        // 延迟 2.5s 回 404：确保 jsd（2s 发射）已在途 body
        return new Promise<FetchResp>((resolve) => {
          setTimeout(() => resolve(errResp(404)), 2500);
        });
      }
      if (url.includes("jsdelivr.net")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            new Promise<unknown>((_, reject) => {
              (init?.signal as AbortSignal)?.addEventListener("abort", () =>
                reject(new Error("AbortError")),
              );
            }),
        });
      }
      return Promise.resolve(errResp(500));
    });
    const promise = tryFetchModels("owner/repo", "");
    const assertion = expect(promise).rejects.toThrow("NoIndex");
    await vi.advanceTimersByTimeAsync(6000);
    await assertion;
  });
});

describe("tryFetchModels — 孤儿请求防护（ctrl abort 后延时源不再发射）", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("raw 成功胜出 → p2/p3 不再发射（fetch 恰好 1 次）", async () => {
    vi.useFakeTimers();
    const models = [{ name: "m" }];
    const fetchMock = mockFetch(() => Promise.resolve(okJson(models)));
    await tryFetchModels("owner/repo", "");
    // 推进越过 p2/p3 的计划发射点（2s/4s）：胜出后 ctrl abort，
    // delayUntil 提前唤醒 → aborted 检查拦截 → 迟到/孤儿请求零发射
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]![0])).toContain("raw.githubusercontent.com");
  });

  it("raw 404 确定性早退 → p2/p3 不再发射（fetch 恰好 1 次 + NoIndex）", async () => {
    vi.useFakeTimers();
    const fetchMock = mockFetch(() => Promise.resolve(errResp(404)));
    const promise = tryFetchModels("owner/repo", "");
    const assertion = expect(promise).rejects.toThrow("NoIndex");
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
    // raw 404 早退 abort 整体：jsd(2s)/api(4s) 唤醒即 "race settled" 拦截
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("jsd 404 不误杀在途 raw → raw 胜出后 p3 不再发射（fetch 恰好 2 次）", async () => {
    vi.useFakeTimers();
    const models = [{ name: "raw-ok" }];
    let resolveRaw!: (r: FetchResp) => void;
    const fetchMock = mockFetch((url, init) =>
      url.includes("jsdelivr.net")
        ? Promise.resolve(errResp(404))
        : new Promise<FetchResp>((resolve, reject) => {
            (init?.signal as AbortSignal | undefined)?.addEventListener(
              "abort",
              () => reject(new Error("Aborted")),
            );
            resolveRaw = resolve;
          }),
    );
    const promise = tryFetchModels("owner/repo", "");
    await vi.advanceTimersByTimeAsync(2500); // jsd 发射 → 404（非 raw 仅记录，不误杀在途 raw）
    resolveRaw(okJson(models));
    await promise;
    // raw 胜出 abort → p3（4s 计划点）提前唤醒被 "race settled" 拦截，无孤儿请求
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      fetchMock.mock.calls.map((c: unknown[]) => String(c[0])),
      "两次发射 = raw + jsd，无 api 孤儿",
    ).toEqual([
      "https://raw.githubusercontent.com/owner/repo/main/index.json",
      "https://cdn.jsdelivr.net/gh/owner/repo@main/index.json",
    ]);
  });
});

describe("tryFetchModels — 过滤回收站条目", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("index 含 .recycle 段条目 → 从返回 models 中剔除；普通子目录保留", async () => {
    vi.useFakeTimers();
    const models = [
      { name: "回收文件", path: ".recycle/[作者]/a.ysm" },
      { name: "回收根文件", path: ".recycle/[作者]b.ysm" },
      { name: "正常子目录", path: "[作者]【galgame】/c.ysm" },
      { name: "根文件", path: "d.ysm" },
    ];
    mockFetch(() => Promise.resolve(okJson(models)));
    const result = await tryFetchModels("owner/repo", "");
    expect(result.models).toEqual([
      { name: "正常子目录", path: "[作者]【galgame】/c.ysm" },
      { name: "根文件", path: "d.ysm" },
    ]);
  });
});
