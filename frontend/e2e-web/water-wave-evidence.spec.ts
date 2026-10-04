// ===== E2E：水面波场 ADR-319 落地后回归取证（2026-10-04 修复后）=====
// 目的：把数值探针（scripts/probe-water-wave.ts）在 D1/D2/D3b 后的结论落成**可人眼复核的截图**——
//   ① 波高可控：默认 6 cm 浪高、峰谷差 0.116 m，越壁 0.00% / 穿地 0.00%（原 ±2.7 m 风暴）；
//   ② 双向往钳制：浪高拉到上限 1 m 仍被钳到预算 min(level, poolHeight−level)=0.15 m，不越壁不穿地；
//   ③ 泡沫通道已删（D3b）：无 vFoam，choppiness 拖满也无白沫——这是「删除」而非「判据不触发」；
//   ④ 频谱锚定域宽（D2）：size=10 与 size=300 都有六波可呈现，不再出现「小水面无波纹 / 大水面只剩长涌」。
// 修复前的同场景取证在同一 spec 的 git 历史（commit 871874465）与 `_shots/water-wave/`（无前缀目录）保留，
// 本 spec 的截图进 `post319/` 子目录，两组并排可对照。
// 方法（对齐 e2e-visual-feedback.md）：真 3D 会话（swiftshader WebGL）+ 单变量对照——
//   每个场景只动一个开关，相机与其余参数保持默认；waveSpeed 置 0 冻结波相，
//   使各场景在同一波相下可比（波相本身随 rAF 起点漂移，但场景间恒同相）。
// 运行：npx playwright test --config playwright.web.config.ts water-wave-evidence
// 截图进仓：e2e-web/_shots/water-wave/post319/（证据可复查；本 spec 的断言守护「流程真的动了」，
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

const SHOTS = "e2e-web/_shots/water-wave/post319";

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

/** 打开 env 面板的水面组（dock-env → preview-env-cap-water → 开水 → chevron 展开） */
async function openWaterPanel(page: Page): Promise<void> {
  await page.locator('.mpc-overlay >> [data-testid="dock-env"]').click();
  const row = page.locator('.mpc-overlay >> [data-testid="preview-env-cap-water"]');
  await expect(row, "Environment 组应含水面行").toBeVisible({ timeout: 8000 });
  // 2026-10 收口把 waterEnabled 默认改成 false（治理「默认蓝膜压住地面承接面」），本 spec 取证的是
  // 「开了水之后长什么样」，故须显式开水并读回状态防假绿灯。开关不是参数页里的控件——它是
  // water-capability.ts|getMasterNodeId 的 master 节点，渲染在 env 列表行的 headerToggle 上，
  // 参数页经 envCapSubNodes 把 master 节点过滤掉了（在参数页里找 cap-water-enabled 必失败）。
  const box = row.locator("input");
  await expect(box, "水面行应含开关").toBeAttached({ timeout: 5000 });
  // checkbox input 被 `.toggle input` 样式隐藏（可见部分是 .slider），须点 label.toggle——
  // label 上的 handler 判 `target !== input` 即翻转 checked 并回调 onChange
  if (!(await box.isChecked())) {
    await row.locator("label.toggle").click();
  }
  expect(await box.isChecked(), "水面应已开启").toBe(true);
  await row.locator('[data-testid="row-chevron"]').click();
  await page.waitForTimeout(400);
  await expect(
    page.locator('.mpc-overlay >> [data-testid="cap-water-mode"]'),
    "水面组应含形态 select",
  ).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(1200);
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

test.describe("水面波场回归取证（ADR-319 落地后）", () => {
  test("六场景单变量对照截图", async ({ page }) => {
    test.slow(); // 单会话六场景 + 逐场景等待，远超 20s 默认上限
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);
    await start3D(page);
    await openWaterPanel(page);

    // 冻结波相：waveSpeed → 0（后续所有场景在同一波相下拍摄，场景间唯一变量是形态/尖度/尺寸/浪高）
    await setBarTo(page, "cap-water-wave-speed", "min");
    expect(await barValue(page, "cap-water-wave-speed"), "波速应跳到 min=0").toBe("0");
    await page.waitForTimeout(400);

    // ── S1 film 默认（size=80 / choppiness=0.5 / level=0.15 / waveHeight=0.06）：平静水面 ──
    // 探针实测峰谷差 0.116 m（原 ±2.7 m 风暴）；越壁 0.00%、穿地 0.00%。
    await page.screenshot({ path: `${SHOTS}/s1-film-default.png` });

    // ── S2 浪高拉到上限（唯一变量 = 浪高）：1 m → 被钳到预算 min(0.15, 0.3−0.15)=0.15 m ──
    await setBarTo(page, "cap-water-wave-height", "max");
    expect(await barValue(page, "cap-water-wave-height"), "浪高应到 max=1").toBe("1");
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOTS}/s2-waveheight-max-clamped.png` });

    // ── S3 choppiness 拖满（唯一变量 = 尖度）：泡沫通道已删（D3b），无白沫 ──
    await setBarTo(page, "cap-water-choppiness", "max");
    expect(await barValue(page, "cap-water-choppiness"), "尖度应到 max=1").toBe("1");
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/s3-choppiness-max-no-foam.png` });

    // ── S4 pool + size=10（变量 = 形态与尺寸）：10 m 池、壁顶 0.39 m，浪不越壁 ──
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
    await page.screenshot({ path: `${SHOTS}/s4-pool-size10-contained.png` });

    // ── S5 film + size=10（变量 = 尺寸）：D2 后 λ 锚定域宽，10 m 水面也有六波可呈现 ──
    await modeSel.selectOption("film");
    expect(await modeSel.inputValue(), "形态应切回 film").toBe("film");
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOTS}/s5-film-size10.png` });

    // ── S6 film + size=300（变量 = 尺寸）：300 m 水面同样六波可呈现，不再只剩长涌 ──
    await setBarTo(page, "cap-water-size", "max"); // uiRange max = 300
    expect(await barValue(page, "cap-water-size"), "尺寸应到展示域上限 300").toBe("300");
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOTS}/s6-film-size300.png` });

    // 反假绿灯汇总：六个场景的截图文件必须真实产出且非零字节
    for (const f of [
      "s1-film-default.png",
      "s2-waveheight-max-clamped.png",
      "s3-choppiness-max-no-foam.png",
      "s4-pool-size10-contained.png",
      "s5-film-size10.png",
      "s6-film-size300.png",
    ]) {
      const st = fs.statSync(`${SHOTS}/${f}`);
      expect(st.size, `${f} 应非空`).toBeGreaterThan(10_000);
    }
  });
});
