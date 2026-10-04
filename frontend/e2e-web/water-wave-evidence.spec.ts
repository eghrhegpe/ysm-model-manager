// ===== E2E：水面波场缺陷视觉取证（ADR-319 数据溯源配图，2026-10-04）=====
// 目的：把数值探针（scripts/probe-water-wave.ts）的三条命题落成**可人眼复核的截图**——
//   ① 波高失控：默认参数水面峰谷差 5.3 m（越池壁 33.17% / 穿地面 49.14%）；
//   ② 泡沫死通道：choppiness 拖满仍无任何白沫（vFoam ≡ 0）；
//   ③ 频谱尺度错配：小水面（size=10）无波纹 / 大水面（size=300）只剩长涌。
// 方法（对齐 e2e-visual-feedback.md）：真 3D 会话（swiftshader WebGL）+ 单变量对照——
//   每个场景只动一个开关，相机与其余参数保持默认；waveSpeed 置 0 冻结波相，
//   使各场景在同一波相下可比（波相本身随 rAF 起点漂移，但场景间恒同相）。
// 运行：npx playwright test --config playwright.web.config.ts water-wave-evidence
// 截图进仓：e2e-web/_shots/water-wave/（证据可复查；本 spec 的断言守护「流程真的动了」，
//   防假绿灯：每步读回 aria-valuenow / select 值，而非只点了一下）。
import fs from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { findLocalChromium } from "../e2e/browser-path.ts";

const CHROME =
  findLocalChromium() ??
  `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium-1228\\chrome-win64\\chrome.exe`;

// 软渲染（SwiftShader）：headless 下 WebGL2 可用（与 postprocessing.spec.ts 同款）
test.use({
  launchOptions: {
    executablePath: CHROME,
    args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"],
  },
});

const SHOTS = "e2e-web/_shots/water-wave";

/** 起真 3D 会话（空场景：sky + ground + light caps，water 默认 film 开启） */
async function start3D(page: Page): Promise<void> {
  const err = await page.evaluate(async () => {
    try {
      const mod = await import("/src/views/app-preview/empty-3d.ts");
      await mod.openEmpty3DFullscreen();
      return null;
    } catch (e) {
      return String(e).slice(0, 300);
    }
  });
  expect(err, "openEmpty3DFullscreen 应成功").toBeNull();
  await expect(page.locator(".mpc-overlay"), "3D overlay 应挂载").toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(2500);
}

/** 打开 env 面板的水面组（dock-env → preview-env-cap-water → chevron 展开） */
async function openWaterPanel(page: Page): Promise<void> {
  await page.locator('.mpc-overlay >> [data-testid="dock-env"]').click();
  await expect(
    page.locator('.mpc-overlay >> [data-testid="preview-env-cap-water"]'),
    "Environment 组应含水面行",
  ).toBeVisible({ timeout: 8000 });
  await page
    .locator('.mpc-overlay >> [data-testid="preview-env-cap-water"]')
    .locator('[data-testid="row-chevron"]')
    .click();
  await page.waitForTimeout(400);
  await expect(
    page.locator('.mpc-overlay >> [data-testid="cap-water-mode"]'),
    "水面组应含形态 select",
  ).toBeVisible({ timeout: 5000 });
}

/** 读 cs-bar 滑块的 aria-valuenow（渲染器把当前值烘在属性上——改没改得逞看这里，不看「点开了」） */
async function barValue(page: Page, id: string): Promise<string> {
  return page
    .locator(`.mpc-overlay >> [data-testid="${id}"] .cs-bar`)
    .getAttribute("aria-valuenow");
}
/** 键盘精确置位（cs-bar 支持 Home/End：min/max，无像素换算误差） */
async function setBarTo(page: Page, id: string, which: "min" | "max"): Promise<void> {
  const bar = page.locator(`.mpc-overlay >> [data-testid="${id}"] .cs-bar`);
  await bar.scrollIntoViewIfNeeded();
  await bar.focus();
  await page.keyboard.press(which === "min" ? "Home" : "End");
  await page.waitForTimeout(250);
}

test.describe("水面波场视觉取证（ADR-319）", () => {
  test("五场景单变量对照截图", async ({ page }) => {
    test.slow(); // 单会话五场景 + 逐场景等待，远超 20s 默认上限
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);
    await start3D(page);
    await openWaterPanel(page);

    // 冻结波相：waveSpeed → 0（后续所有场景在同一波相下拍摄，场景间唯一变量是形态/尖度/尺寸）
    await setBarTo(page, "cap-water-wave-speed", "min");
    expect(await barValue(page, "cap-water-wave-speed"), "波速应跳到 min=0").toBe("0");
    await page.waitForTimeout(400);

    // ── S1 film 默认（size=80 / choppiness=0.5 / level=0.01）：默认即 5.3 m 峰谷差的「风暴」 ──
    await page.screenshot({ path: `${SHOTS}/s1-film-default.png` });

    // ── S2 choppiness 拖满（唯一变量 = 尖度）：防自交钳制下泡沫判据永不可达 → 无白沫 ──
    await setBarTo(page, "cap-water-choppiness", "max");
    expect(await barValue(page, "cap-water-choppiness"), "尖度应到 max=1").toBe("1");
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/s2-choppiness-max-no-foam.png` });

    // ── S3 pool + size=10（变量 = 形态与尺寸）：10 m 池、壁高 0.3 m vs 波浪 ±2.6 m ──
    const modeSel = page.locator('.mpc-overlay >> [data-testid="cap-water-mode"] select');
    await modeSel.selectOption("pool");
    expect(await modeSel.inputValue(), "形态应切到 pool").toBe("pool");
    await setBarTo(page, "cap-water-size", "min"); // uiRange min = 10
    expect(await barValue(page, "cap-water-size"), "尺寸应到展示域下限 10").toBe("10");
    await expect(
      page.locator('.mpc-overlay >> [data-testid="cap-water-pool-height"]'),
      "pool 模式应解锁水池组（单变量门控）",
    ).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOTS}/s3-pool-size10-overflow.png` });

    // ── S4 film + size=10（变量 = 尺寸）：λ 10.5–25 m > 域宽，无波纹可呈现 ──
    await modeSel.selectOption("film");
    expect(await modeSel.inputValue(), "形态应切回 film").toBe("film");
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOTS}/s4-film-size10.png` });

    // ── S5 film + size=300（变量 = 尺寸）：高频全被 aa 淡出，只剩长涌 ──
    await setBarTo(page, "cap-water-size", "max"); // uiRange max = 300
    expect(await barValue(page, "cap-water-size"), "尺寸应到展示域上限 300").toBe("300");
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOTS}/s5-film-size300.png` });

    // 反假绿灯汇总：五个场景的截图文件必须真实产出且非零字节
    for (const f of [
      "s1-film-default.png",
      "s2-choppiness-max-no-foam.png",
      "s3-pool-size10-overflow.png",
      "s4-film-size10.png",
      "s5-film-size300.png",
    ]) {
      const st = fs.statSync(`${SHOTS}/${f}`);
      expect(st.size, `${f} 应非空`).toBeGreaterThan(10_000);
    }
  });
});
