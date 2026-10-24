// ===== E2E 视觉基线（防「假绿」零依赖落点）=====
// 知识卡 e2e-visual-feedback.md 记载的真实事故：临时 spec 两张截图 SHA256 完全相同 =
// 下钻根本没发生，却报 1 passed。本 helper 把「截图当证据」做成默认姿态：
// 每次截图都与上一轮基线做**字节级**比对（PNG 无损，字节相同 ⇒ 画面相同），
// 字节相同即断言失败——直接抓出「点了没反应」这类假绿。
//
// 零依赖：不引 pixelmatch/pngjs/sharp（package 未装），只用 Node 原生 Buffer 相等 +
// Playwright page.screenshot。适用范围：纯 DOM 层（e2e/），确定性渲染下两次正确运行
// 必字节相同。WebGL 层（e2e-web/）受 preserveDrawingBuffer 限制读不回像素，不在此列
// （真 3D 像素比对需引解码库或改生产渲染参数，知识卡明确不可擅动）。
//
// 基线文件落在 e2e/_baselines/（建议 git 跟踪，与 .gitignore 排除的 _shots/ 分轨）。
// 首跑带 { update: true } 生成基线；之后每轮自动比对。
import fs from "node:fs";
import path from "node:path";
import { expect, type Page } from "./fixture.ts";

const BASELINE_DIR = path.join("e2e", "_baselines");

export interface VisualBaselineOpts {
  /** 基线/产物目录，默认 e2e/_baselines */
  dir?: string;
  /** 无基线时是否就地生成基线（首跑用） */
  update?: boolean;
}

/**
 * 截图并与基线比对；返回本次截图路径。
 * 字节相同 ⇒ 画面完全相同 ⇒ 交互大概率没发生 ⇒ 断言失败。
 */
export async function screenshotWithBaseline(
  page: Page,
  name: string,
  opts: VisualBaselineOpts = {},
): Promise<string> {
  const dir = opts.dir ?? BASELINE_DIR;
  fs.mkdirSync(dir, { recursive: true });
  const shotPath = path.join(dir, `${name}.png`);
  const basePath = path.join(dir, `${name}.baseline.png`);

  await page.screenshot({ path: shotPath });

  if (fs.existsSync(basePath)) {
    const cur = fs.readFileSync(shotPath);
    const base = fs.readFileSync(basePath);
    // 字节完全相同 = 画面完全相同 = 交互大概率没发生（假绿信号）
    expect(
      !(cur.length === base.length && cur.equals(base)),
      `截图「${name}」与基线字节完全相同——交互可能未生效（假绿信号，参考 e2e-visual-feedback.md）`,
    ).toBe(true);
  } else if (opts.update) {
    fs.copyFileSync(shotPath, basePath);
    console.log(`[visual-baseline] 已为「${name}」生成基线（后续轮次自动比对）`);
  } else {
    console.log(`[visual-baseline] 「${name}」无基线，跳过比对（首跑可加 { update: true } 生成）`);
  }
  return shotPath;
}
