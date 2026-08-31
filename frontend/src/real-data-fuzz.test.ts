// @vitest-environment node
// ===== 真实数据轰击测试（ADR-044 数据驱动补强）=====
// 数据源：tests/fixtures/ysm/（git 跟踪的最小真实模型解码样本：顶层 3 个代表目录
// 01_taisho_maid / 博丽灵梦Hakurei_Reimu / lucia，40 个 JSON）
// 覆盖：真实世界数据形态——负 size cube、UV 对象形态、Molang 动画值、特殊字符元数据。
// 纯函数解析入口不崩溃、数值有限；曾用临时脚本轰 tests/ysm-reference/（git 忽略）
// 发现负 size 误判为缺陷，实为 Bedrock 合法特性（见 geometry.test.ts 回归）。
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "node:url";
import { parseBedrockGeometryFromJSON } from "./features/preview-3d/decoder/geometry.ts";
import { parseYsmJsonDirect } from "./features/preview-3d/decoder/parse-ysm-json.ts";
import { parseBedrockAnimationJSON } from "./utils/animation/animation.ts";

// 基于本文件位置解析（src/ 上三级 = 仓库根），与 cwd 解耦。
// 注：不用 `new URL(rel, import.meta.url)`——happy-dom 的 URL polyfill 对相对
// 解析返回非 file scheme，fileURLToPath 会抛错（实测探针）。
const FIXTURES = join(
  dirname(dirname(dirname(fileURLToPath(import.meta.url)))),
  "tests/fixtures/ysm",
);

function collectJson(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const ent of readdirSync(dir)) {
    const p = join(dir, ent);
    if (statSync(p).isDirectory()) collectJson(p, out);
    else if (ent.endsWith(".json")) out.push(p);
  }
  return out;
}

const files = collectJson(FIXTURES).map((f) => f.split("\\").join("/"));
// 结构 A：models/main.json（shen-fengling/xigelika）；结构 B：根级 arm.json/main.json（lucia）
const models = files.filter(
  (f) => /\/models\/.+\.json$/.test(f) || /(^|\/)(arm|main)\.json$/.test(f),
);
// 动画同理双路径：animations/ 子目录（A）+ 根级 *.animation.json（lucia 扁平结构）
const anims = files.filter(
  (f) => f.includes("animations/") || /(^|\/)[^/]+\.animation\.json$/.test(f),
);
const ysms = files.filter((f) => f.endsWith("ysm.json"));

describe("真实数据轰击 — 样本齐备", () => {
  it("3 个模型样本已就位（git 跟踪，13 个 JSON）", () => {
    expect(files.length).toBeGreaterThanOrEqual(12);
    expect(models.length).toBeGreaterThanOrEqual(4);
    expect(anims.length).toBeGreaterThanOrEqual(6);
    expect(ysms.length).toBeGreaterThanOrEqual(2);
  });
});

describe("真实数据轰击 — parseBedrockGeometryFromJSON", () => {
  it.each(models.map((f) => [f.replace(/\\/g, "/"), readFileSync(f, "utf8")] as const))(
    "%s 解析不崩溃、数值有限",
    (_f, jsonStr) => {
      expect(() => parseBedrockGeometryFromJSON(jsonStr)).not.toThrow();
      const parsed = parseBedrockGeometryFromJSON(jsonStr);
      if (parsed && parsed.bones) {
        expect(parsed.bones.length).toBeGreaterThan(0);
        for (const b of parsed.bones) {
          for (const c of b.cubes) {
            for (const n of [...c.origin, ...c.size, ...c.pivot, ...c.rotation]) {
              expect(Number.isFinite(n)).toBe(true);
            }
          }
        }
      }
    },
  );
});

describe("真实数据轰击 — parseYsmJsonDirect", () => {
  it.each(ysms.map((f) => [f, JSON.parse(readFileSync(f, "utf8"))] as const))(
    "%s 解析不崩溃",
    (_f, raw) => {
      expect(() => parseYsmJsonDirect(raw)).not.toThrow();
    },
  );
});

describe("真实数据轰击 — parseBedrockAnimationJSON", () => {
  it.each(anims.map((f) => [f, readFileSync(f, "utf8")] as const))(
    "%s 解析不崩溃、clip 数值有限",
    (_f, jsonStr) => {
      let result: ReturnType<typeof parseBedrockAnimationJSON>;
      expect(() => {
        result = parseBedrockAnimationJSON(jsonStr);
      }).not.toThrow();
      const clips = result!.clips;
      for (const clip of clips) {
        for (const ch of Object.values(clip.bones ?? {})) {
          const channels = ch as Record<string, unknown[]>;
          for (const list of Object.values(channels)) {
            for (const kf of list as { time: number; post: number[]; pre: number[] }[]) {
              expect(Number.isFinite(kf.time)).toBe(true);
              for (const n of [...kf.post, ...kf.pre]) expect(Number.isFinite(n)).toBe(true);
            }
          }
        }
      }
    },
  );
});
