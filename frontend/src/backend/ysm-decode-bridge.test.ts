// ysm-decode-bridge 纯函数测试：payload 组装与 go/ysmwebview.parsePayload 镜像
// （gzip(JSON{files[data=base64]})→base64；改动须两侧同步）
import { describe, expect, it } from "vitest";
import { buildResultPayload, gzipBytes } from "./ysm-decode-bridge.ts";

describe("gzipBytes", () => {
  it("gzip 往返还原原文", async () => {
    const src = new TextEncoder().encode("ysm-decode-bridge 测试数据 ".repeat(100));
    const gz = await gzipBytes(src);
    const stream = new Blob([gz as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
    const out = new Uint8Array(await new Response(stream).arrayBuffer());
    expect(out).toEqual(src);
    // JSON 文本压缩率应有实际收益（重复文本 >2×）
    expect(gz.length).toBeLessThan(src.length / 2);
  });
});

describe("buildResultPayload", () => {
  it("产出可被 Go 侧解析的镜像结构：base64→gunzip→JSON{files[path,data=base64]}", async () => {
    const files = [
      { path: "ysm.json", data: new TextEncoder().encode('{"a":1}') },
      { path: "textures/default.png", data: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]) },
    ];
    const payload = await buildResultPayload(files);

    // Go 侧同构解析：base64 → gzip → JSON；data 字段为标准 base64
    const raw = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
    const stream = new Blob([raw as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
    const parsed = JSON.parse(await new Response(stream).text()) as {
      files: { path: string; data: string }[];
    };
    expect(parsed.files).toHaveLength(2);
    expect(parsed.files[0].path).toBe("ysm.json");
    expect(new TextDecoder().decode(Uint8Array.from(atob(parsed.files[0].data), (c) => c.charCodeAt(0)))).toBe(
      '{"a":1}',
    );
    expect(atob(parsed.files[1].data)).toBe("\u0089PNG\u0000ÿ");
  });
});
