// @vitest-environment node
// ===== community-fetch 远程拉取测试 =====
// 锁定 GitHub API 路的 UTF-8 解码契约：api 分支返回 base64(UTF-8 字节)，须按 UTF-8
// 还原为真实码位。历史坑：用 atob 直接 JSON.parse，atob 产 Latin-1 串（UTF-8 字节被逐字节
// 当码位），非 ASCII 创作者名变双重编码乱码落盘（2026-09-21 污染事件，197 条）。
import { describe, it, expect, vi, afterEach } from "vitest";
import { stubFetch } from "@/test-utils/fetch.ts";
import { fetchCommunityCreators, DEFAULT_COMMUNITY_URL } from "./community-fetch.ts";

const CJK = "[{\"name\":\"雾雨波波沙\",\"desc\":\"车万/暮色森林二创\",\"type\":\"bilibili\"}]";

// 把 UTF-8 字节编码为 base64（模拟 GitHub API contents.content，带换行）
function base64OfUtf8(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  // node 环境有 btoa；分块避免超长栈
  return btoa(bin);
}

afterEach(() => vi.unstubAllGlobals());

describe("fetchCommunityCreators api 路", () => {
  it("api 兜底：base64(UTF-8) 解码为真实码位，非 ASCII 名不乱码", async () => {
    const b64 = base64OfUtf8(CJK);
    stubFetch((url: string) => {
      if (url.includes("api.github.com")) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ content: b64 }) });
      }
      // raw + jsdelivr 失败 → 逼出 api 路
      return Promise.resolve({ ok: false, status: 500, json: async () => ({}) });
    });
    const list = await fetchCommunityCreators(DEFAULT_COMMUNITY_URL);
    expect(list).toHaveLength(1);
    // 核心断言：非 ASCII 名须是「雾雨波波沙」，而非 Latin-1 乱码 é¾¾é¨...
    expect(list[0]!.name).toBe("雾雨波波沙");
    expect(list[0]!.desc).toBe("车万/暮色森林二创");
  });

  it("api 路 content 含空白（换行）仍能解码（回归 replace(/\\s/g,'') 保留）", async () => {
    const b64WithWs = base64OfUtf8(CJK).replace(/(.{40})/g, "$1\n");
    stubFetch((url: string) => {
      if (url.includes("api.github.com")) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ content: b64WithWs }) });
      }
      return Promise.resolve({ ok: false, status: 500, json: async () => ({}) });
    });
    const list = await fetchCommunityCreators(DEFAULT_COMMUNITY_URL);
    expect(list[0]?.name).toBe("雾雨波波沙");
  });

  it("raw 路优先成功即返回，不走 api", async () => {
    const { fetchMock } = stubFetch((url: string) => {
      if (url === DEFAULT_COMMUNITY_URL) {
        return Promise.resolve({ ok: true, status: 200, json: async () => JSON.parse(CJK) });
      }
      return Promise.resolve({ ok: false, status: 500, json: async () => ({}) });
    });
    const list = await fetchCommunityCreators(DEFAULT_COMMUNITY_URL);
    expect(list[0]?.name).toBe("雾雨波波沙");
    // api.github.com 未被请求（raw 命中即短路）
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("api.github.com"))).toBe(false);
  });
});
