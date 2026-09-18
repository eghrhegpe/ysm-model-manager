// ===== E2E 测试：诊断页（diagnostics，ADR-037 覆盖深化 / ADR-258 顶部 repo-tab 范式）=====
// ADR-258 把诊断页左栏分段收敛为顶部统一 repo-tab，旧选择器 `.diag-btn[data-diag]` 已随之废弃，
// 本 spec 同步改写（原版仍在等 `.diag-btn` 渲染，10s 必然超时——已失效）。
//
// 常驻回归防线（2026-09-17 事故）：diagnosticsHTML() 曾漏一个 </div>，`#diag-tab-log` 把后续
// 7 个面板全吞进自己内部；bindTabs 切页时把 `#diag-tab-log` 置 display:none，嵌在里面的面板
// 一并消失 —— 切任何 tab 都只剩空白。单元层的子串断言对此失明（面板 id 仍在字符串里，
// toContain 恒真），**只有真实浏览器的可见性/布局判定能抓**，故「切到每个 tab 后该面板真实可见」
// 列为常驻用例。
// diagnostics 组件在 app-content shadowRoot 内渲染，用 evaluate 穿透。

import { expect, type Page, test } from "./fixture.ts";
import { gotoApp, navItem } from "./helpers.ts";
import {
  CONC_BENCH_REAL,
  SINGLE_BENCH_BASELINE_MISSING,
  SINGLE_BENCH_SAVED,
} from "./perf-fixtures.ts";

/** 顶部 repo-tab 的 data-tab 全集（与 tpl.ts diagnosticsHTML 一一对应） */
const DIAG_TABS = [
  "log",
  "single",
  "gui",
  // ADR-262 D5：并发基准（串行 vs 并行加速比）
  "conc",
  "hist",
  "trace",
  "conflict",
  "health",
  "sync-conflict",
] as const;

/** 面板**真实可见**：display 非 none **且**占据布局尺寸（嵌套吞并时尺寸会塌成 0） */
function panelMeasuredVisible(page: Page, id: string): Promise<boolean> {
  return page.evaluate((n: string) => {
    const root = document.querySelector("app-content")?.shadowRoot;
    const panel = root?.querySelector(`#diag-tab-${n}`) as HTMLElement | null;
    if (!panel) return false;
    const rect = panel.getBoundingClientRect();
    return getComputedStyle(panel).display !== "none" && rect.width > 0 && rect.height > 0;
  }, id);
}

/** 面板 id → 是否显示（仅 display 口径，用于互斥可见性断言） */
function panelDisplay(page: Page): Promise<Record<string, boolean>> {
  return page.evaluate(() => {
    const root = document.querySelector("app-content")?.shadowRoot;
    const read = (testid: string): boolean => {
      const el = root?.querySelector(`[data-testid="${testid}"]`) as HTMLElement | null;
      return !!el && getComputedStyle(el).display !== "none";
    };
    return { op: read("diag-log-list"), runtime: read("diag-runtime") };
  });
}

async function clickBySelector(page: Page, selector: string): Promise<void> {
  await page.evaluate((sel: string) => {
    const root = document.querySelector("app-content")?.shadowRoot;
    (root?.querySelector(sel) as HTMLElement | null)?.click();
  }, selector);
}

test.describe("诊断页", () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
    // 语义定位（原 nth(4)：viewer 模式 instances 不渲染 → nth(4) 变 settings 页，静默跑错页）
    await navItem(page, "diagnostics").click();
    // 等待顶部 repo-tab 就绪（ADR-258 后不再是 .diag-btn）
    await page.waitForFunction(
      () => {
        const root = document.querySelector("app-content")?.shadowRoot;
        return (root?.querySelectorAll(".repo-tab").length ?? 0) >= 8;
      },
      undefined,
      { timeout: 10000, polling: 200 },
    );
  });

  test("顶部 8 个 repo-tab 渲染，默认激活「日志」", async ({ page }) => {
    const info = await page.evaluate(() => {
      const root = document.querySelector("app-content")?.shadowRoot;
      const tabs = [...(root?.querySelectorAll(".repo-tab") ?? [])] as HTMLElement[];
      return {
        ids: tabs.map((t) => t.dataset.tab ?? ""),
        active: tabs.filter((t) => t.classList.contains("active")).map((t) => t.dataset.tab ?? ""),
      };
    });
    expect(info.ids).toEqual([...DIAG_TABS]);
    expect(info.active).toEqual(["log"]);
  });

  test("切到每个 tab → 该面板真实可见（空白页回归防线）", async ({ page }) => {
    for (const id of DIAG_TABS) {
      await clickBySelector(page, `.repo-tab[data-tab="${id}"]`);
      await expect
        .poll(() => panelMeasuredVisible(page, id), {
          timeout: 5000,
          message: `切到「${id}」后该面板不可见（疑被前一面板嵌套吞并）`,
        })
        .toBe(true);
    }
  });

  test("日志工具栏两行语义分组：行1=子tab+动作，行2=筛选+搜索", async ({ page }) => {
    // 2026-09-17 版面收口（方案 A）：9 按钮 + 1 输入框挤单行时分组语义错乱（清空与筛选同组、
    // 刷新/复制被 spacer 推远），且 spacer 随 flex-wrap 折行挤散动作组。本用例锁两行结构与归属。
    const layout = await page.evaluate(() => {
      const root = document.querySelector("app-content")?.shadowRoot;
      const rect = (
        sel: string,
      ): { top: number; bottom: number; left: number; right: number } | null => {
        const el = root?.querySelector(sel) as HTMLElement | null;
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
      };
      const rows = [
        ...(root?.querySelectorAll(".diag-log-bar .diag-log-row") ?? []),
      ] as HTMLElement[];
      return {
        rows: rows.map((el) => {
          const r = el.getBoundingClientRect();
          return { top: r.top, bottom: r.bottom };
        }),
        subTabs: rect(".diag-log-subtabs"),
        refresh: rect("#diag-refresh"),
        copy: rect("#diag-copy"),
        clear: rect("#diag-clear"),
        filter: rect("#diag-log-filter"),
        search: rect("#diag-log-search"),
      };
    });
    expect(layout.rows).toHaveLength(2);
    // 显式守卫收窄类型（biome 禁非空断言）：单行旧范式下 rows 为空，此处先炸即抓到回归
    const [row1, row2] = layout.rows;
    if (!row1 || !row2) throw new Error("日志工具栏不是两行");
    /** 取出元素盒模型，缺失即判失败（避免 `!` 断言） */
    const box = (
      name: string,
      r: { top: number; bottom: number; left: number; right: number } | null,
    ): { top: number; bottom: number; left: number; right: number } => {
      if (!r) throw new Error(`日志工具栏缺少元素：${name}`);
      return r;
    };
    // 行1 严格位于行2 上方（互不重叠）
    expect(row1.bottom).toBeLessThanOrEqual(row2.top);
    // 行1 归属：子 tab + 三个动作按钮
    const subTabs = box("subTabs", layout.subTabs);
    const refresh = box("refresh", layout.refresh);
    const copy = box("copy", layout.copy);
    const clear = box("clear", layout.clear);
    for (const r of [subTabs, refresh, copy, clear]) {
      expect(r.top).toBeGreaterThanOrEqual(row1.top);
      expect(r.bottom).toBeLessThanOrEqual(row1.bottom);
    }
    // 行1 语义次序：导航靠左、动作被 spacer 顶到右侧，且破坏性「清空」殿后
    expect(subTabs.right).toBeLessThan(refresh.left);
    expect(refresh.left).toBeLessThan(copy.left);
    expect(copy.left).toBeLessThan(clear.left);
    // 行2 归属：筛选 chips 容器 + 搜索框（清空不得混入筛选行）
    for (const r of [box("filter", layout.filter), box("search", layout.search)]) {
      expect(r.top).toBeGreaterThanOrEqual(row2.top);
      expect(r.bottom).toBeLessThanOrEqual(row2.bottom);
    }
  });

  test("单模型 tab：类型选择器选项来自 registry（前端不写死类型表）", async ({ page }) => {
    // ADR-262 D3：矩阵的类型选项必须来自 Go/registry（resource_types.json 单一事实源），
    // 前端只读不判。选择器除固定的「单模型」「全部类型」外，应出现 mock 注册表里的类型。
    await clickBySelector(page, '.repo-tab[data-tab="single"]');
    const info = await page.evaluate(() => {
      const root = document.querySelector("app-content")?.shadowRoot;
      const select = root?.querySelector(
        '[data-testid="diag-perf-rtype"]',
      ) as HTMLSelectElement | null;
      if (!select) return null;
      return {
        values: [...select.options].map((o) => o.value),
        text: select.textContent ?? "",
      };
    });
    // 显式守卫收窄类型（biome 禁非空断言）
    if (!info) throw new Error("未找到类型选择器 #diag-perf-rtype");
    // 首项 = 单模型（空值）；其后应有「全部类型」哨兵与 registry 类型
    expect(info.values[0]).toBe("");
    expect(info.values).toContain("__all__");
    expect(info.values).toContain("ysm");
    expect(info.values).toContain("resourcepack");
    expect(info.text).toContain("YSM 模型");
  });

  test("单模型 tab：基准三件套就位，且切到矩阵模式即禁用（ADR-262 D8）", async ({ page }) => {
    // 背景缺陷「永远没有好还是坏的判定」的最后一环：退化门禁早已实现、ParamSpec 也已登记，
    // 但 GUI 从未传过 --baseline/--save-baseline，用户看不到「比上次好还是坏」。
    // 这里断言入口真实可交互，且与矩阵模式互斥（Go 侧对矩阵模式的基准参数是明确拒绝的）。
    await clickBySelector(page, '.repo-tab[data-tab="single"]');
    const probe = async () =>
      page.evaluate(() => {
        const root = document.querySelector("app-content")?.shadowRoot;
        const pick = (id: string) =>
          root?.querySelector(`[data-testid="${id}"]`) as HTMLInputElement | null;
        const save = pick("diag-perf-baseline-save");
        const compare = pick("diag-perf-baseline-compare");
        const th = pick("diag-perf-baseline-th");
        const select = root?.querySelector(
          '[data-testid="diag-perf-rtype"]',
        ) as HTMLSelectElement | null;
        return {
          present: Boolean(save && compare && th),
          disabledAtStart: Boolean(save?.disabled || compare?.disabled || th?.disabled),
          threshold: th?.value ?? "",
          rtype: select?.value ?? "",
        };
      });

    const before = await probe();
    if (!before.present) throw new Error("未找到基准三件套（diag-perf-baseline-*）");
    expect(before.disabledAtStart).toBe(false);
    expect(before.threshold).toBe("50");

    // 切到全类型矩阵 → 三件套禁用（「被禁用」比「勾了却没生效」诚实）。
    // ⚠️ 先等 `__all__` 选项真的出现：类型选项由 populatePerfRtypeOptions 异步走桥填充，
    // 未到位时给 select.value 赋「不存在的 option」会**静默变空**，用例随即假红。
    await page.waitForFunction(() => {
      const root = document.querySelector("app-content")?.shadowRoot;
      const select = root?.querySelector(
        '[data-testid="diag-perf-rtype"]',
      ) as HTMLSelectElement | null;
      return Boolean(select && [...select.options].some((o) => o.value === "__all__"));
    });
    await page.evaluate(() => {
      const root = document.querySelector("app-content")?.shadowRoot;
      const select = root?.querySelector(
        '[data-testid="diag-perf-rtype"]',
      ) as HTMLSelectElement | null;
      if (!select) return;
      select.value = "__all__";
      select.dispatchEvent(new Event("change"));
    });
    const after = await probe();
    expect(after.rtype).toBe("__all__");
    expect(after.disabledAtStart).toBe(true);
  });

  test("并发基准 tab：入口就位（并发度 / 每类上限 / 运行）（ADR-262 D5）", async ({ page }) => {
    // 背景缺陷：concurrent-bench 此前**只有文本**，GUI 里连入口都没有——
    // 「串行 vs 并行的实测加速比」是主动压测的第一手数据，必须能从界面取到。
    await clickBySelector(page, '.repo-tab[data-tab="conc"]');
    const probe = await page.evaluate(() => {
      const root = document.querySelector("app-content")?.shadowRoot;
      const pick = (id: string) =>
        root?.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
      const run = pick("diag-perf-conc-run");
      const workers = pick("diag-perf-conc-workers") as HTMLInputElement | null;
      const max = pick("diag-perf-conc-max") as HTMLInputElement | null;
      const out = pick("diag-perf-conc-out");
      const visible = (el: Element | null) =>
        Boolean(el && (el as HTMLElement).offsetParent !== null);
      return {
        present: Boolean(run && workers && max),
        runVisible: visible(run),
        workers: workers?.value ?? "",
        max: max?.value ?? "",
        outVisible: visible(out),
      };
    });
    if (!probe.present) throw new Error("未找到并发基准入口（diag-perf-conc-*）");
    // tab 真的切过去了（面板可见，不是被吞进别的 tab）
    expect(probe.runVisible).toBe(true);
    expect(probe.workers).toBe("4");
    expect(probe.max).toBe("20");
    // 尚未运行时结果区为空容器（不预置假数据）
    expect(probe.outVisible).toBe(true);
    expect(
      await page.evaluate(() => {
        const root = document.querySelector("app-content")?.shadowRoot;
        return (root?.querySelector('[data-testid="diag-perf-conc-out"]')?.textContent ?? "").trim()
          .length;
      }),
    ).toBe(0);
  });

  test("日志子 tab：操作日志与运行时日志互斥可见", async ({ page }) => {
    // 默认：操作日志可见、运行时隐藏
    expect(await panelDisplay(page)).toEqual({ op: true, runtime: false });
    await clickBySelector(page, '.diag-sub-tab[data-log="runtime"]');
    await expect
      .poll(() => panelDisplay(page), { timeout: 5000 })
      .toEqual({ op: false, runtime: true });
  });

  test("日志空态提示（mock GetImportLogs=[] → No logs yet）", async ({ page }) => {
    const listText = await page.evaluate(() => {
      const root = document.querySelector("app-content")?.shadowRoot;
      return root?.querySelector('[data-testid="diag-log-list"]')?.textContent ?? "";
    });
    expect(listText).toContain("No logs yet");
  });
});

// ===== 性能面板 · 真实载荷渲染（ADR-262 D5）=====
// 立因：性能面板的渲染断言此前只在 vitest（jsdom + mock executeCLI）——jsdom 不跑布局/CSS，
// 抓不到「元素被 display:none 吞掉」「i18n 占位符原样上屏」这类只在真实浏览器暴露的缺陷。
// 载荷取自真实 CLI 输出（perf-fixtures.ts），数值原样，不手编数字。

/**
 * 注入 CLI 分发器：按命令名返回**完整 CLI 响应信封**（`{status, command, data}`）。
 * ⚠️ 两条真实浏览器才暴露的坑（本用例第一版都踩了）：
 *   ① 必须**页面加载后**注入（page.evaluate）——fixture 的 mock bridge 脚本整体重建
 *      window.go.main.App，若后加的 init script 先执行就被覆盖，ExecuteCLI 退回 undefined，
 *      parseCLIResponse 拿 undefined 去 .slice 抛 TypeError（面板只显示一句无信息量的报错）。
 *   ② 必须给**信封**而不是裸 data：桥侧契约是 status/command/data，裸载荷会被判
 *      「CLI 响应 status 非字符串」——载荷正确但被信封挡在门外，界面同样空白。
 */
async function installCliMock(
  page: Page,
  table: Record<string, { data: unknown; status?: "success" | "error" }>,
): Promise<void> {
  await page.evaluate(
    (payloads: Record<string, { data: unknown; status?: "success" | "error" }>) => {
      const app = (window as unknown as { go: { main: { App: Record<string, unknown> } } }).go.main
        .App;
      app.ExecuteCLI = async (cmd: string) => {
        const entry = payloads[cmd];
        if (!entry) {
          return JSON.stringify({
            status: "error",
            command: cmd,
            error: { code: "runtime_error", message: `e2e 未准备 ${cmd} 的载荷` },
          });
        }
        return JSON.stringify({
          status: entry.status ?? "success",
          command: cmd,
          data: entry.data,
        });
      };
    },
    table,
  );
}

/** 在 shadowRoot 内设置输入值并派发 input/change（原生 setter，绕过 React 类受控拦截不适用，此处仅原生控件） */
async function setShadowValue(page: Page, testid: string, value: string): Promise<void> {
  await page.evaluate(
    ({ id, v }: { id: string; v: string }) => {
      const root = document.querySelector("app-content")?.shadowRoot;
      const el = root?.querySelector(`[data-testid="${id}"]`) as HTMLInputElement | null;
      if (!el) return;
      el.value = v;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    },
    { id: testid, v: value },
  );
}

/** 等结果容器内出现期望数量的选择器命中（真实渲染完成） */
async function waitForCount(page: Page, selector: string, count: number): Promise<void> {
  await page.waitForFunction(
    ({ sel, n }: { sel: string; n: number }) => {
      const root = document.querySelector("app-content")?.shadowRoot;
      return root?.querySelectorAll(sel).length === n;
    },
    { sel: selector, n: count },
    { timeout: 10000, polling: 100 },
  );
}

/** 结果容器可见文本 + 标题属性 + 选择器命中数（一次 evaluate 取全，避免多次穿透） */
function readSingleOut(page: Page) {
  return page.evaluate(() => {
    const root = document.querySelector("app-content")?.shadowRoot;
    const out = root?.querySelector('[data-testid="diag-perf-single"]') as HTMLElement | null;
    const q = (sel: string): HTMLElement[] =>
      [...(out?.querySelectorAll(sel) ?? [])] as HTMLElement[];
    return {
      text: out?.textContent ?? "",
      barRows: q(".perf-bar-row").length,
      dangerBars: q(".perf-bar-danger").length,
      blRows: q(".perf-bl-row").length,
      titles: q("[title]").map((n) => n.getAttribute("title") ?? ""),
      bannerText: (q(".diag-stat-error")[0]?.textContent ?? "").trim(),
    };
  });
}

const PLACEHOLDER_LEAK = /\{[a-zA-Z_][a-zA-Z0-9_]*\}/;

test.describe("诊断页 · 性能面板真实载荷渲染（ADR-262 D5）", () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
    await navItem(page, "diagnostics").click();
    await page.waitForFunction(
      () => {
        const root = document.querySelector("app-content")?.shadowRoot;
        return (root?.querySelectorAll(".repo-tab").length ?? 0) >= 8;
      },
      undefined,
      { timeout: 10000, polling: 200 },
    );
    await clickBySelector(page, '.repo-tab[data-tab="single"]');
  });

  test("单模型 tab：阶段条 + 基准判决行按载荷渲染，无 i18n 占位符残留", async ({ page }) => {
    await installCliMock(page, { "single-bench": { data: SINGLE_BENCH_SAVED } });
    await setShadowValue(page, "diag-perf-model", "./ysm/player.ysm");
    await clickBySelector(page, '[data-testid="diag-perf-run"]');

    await waitForCount(page, ".perf-bar-row", SINGLE_BENCH_SAVED.stages.length);
    const got = await readSingleOut(page);

    // ① 每个阶段一行（真实布局下可见）
    expect(got.barRows).toBe(SINGLE_BENCH_SAVED.stages.length);
    // ② 基准判决逐阶段成行，行数与 Go 载荷一致
    expect(got.blRows).toBe(SINGLE_BENCH_SAVED.baseline.diff.stages.length);
    // ③ 红条数 = 载荷里 status 判失败/瓶颈的阶段数（映射一致，不在前端重算阈值）
    // 注：真实夹具太小，Go 侧没把任何阶段标成 bottleneck（时间全在噪声区内）→ 期望 0；
    // 红条**渲染**由下一条「退化判决」用例以合成超阈值样本覆盖。
    const expectedDanger = SINGLE_BENCH_SAVED.stages.filter(
      (s) => s.status === "bottleneck" || s.status === "failed",
    ).length;
    expect(got.dangerBars).toBe(expectedDanger);
    // Go 标出的最慢阶段必须真实出现在条形里（名字来自载荷，不是前端猜的）
    expect(got.text).toContain(SINGLE_BENCH_SAVED.bottleneck);
    // ④ 实测总耗时按 Go 给的数字渲染（不四舍五入成别的量级）
    expect(got.text).toContain(`${SINGLE_BENCH_SAVED.total_ms.toFixed(2)}ms`);
    // ⑤ 判决标题带对比对象与噪声下限（用户在 GUI 里能看到「跟谁比、怎么判」）
    expect(got.titles.some((t) => t.includes(SINGLE_BENCH_SAVED.baseline.diff.path))).toBe(true);
    expect(
      got.titles.some((t) => t.includes(String(SINGLE_BENCH_SAVED.baseline.diff.noise_floor_ms))),
    ).toBe(true);
    // ⑥ 反回退：i18n 占位符 / Go 的中文建议散文都不得原样上屏
    expect(PLACEHOLDER_LEAK.test(got.text)).toBe(false);
    for (const hint of SINGLE_BENCH_SAVED.hints) expect(got.text).not.toContain(hint);
  });

  test("单模型 tab：退化判决在真实浏览器里渲染红条与逐阶段明细", async ({ page }) => {
    // 合成退化样本：结构取自真实载荷，数字为构造的「超阈值退化」（真实夹具太小，落在噪声下限内）
    const regressed = {
      ...SINGLE_BENCH_SAVED,
      total_ms: 47,
      per_iteration_ms: 47,
      stages: SINGLE_BENCH_SAVED.stages.map((s) =>
        s.name === "② JSON 解析" ? { ...s, ms: 40, status: "bottleneck", bottleneck: true } : s,
      ),
      baseline: {
        diff: {
          ...SINGLE_BENCH_SAVED.baseline.diff,
          verdict: "regressed",
          degraded: 1,
          stages: SINGLE_BENCH_SAVED.baseline.diff.stages.map((s) =>
            s.name === "② JSON 解析"
              ? { ...s, base_ms: 1, now_ms: 40, delta_pct: 3900, verdict: "regressed" }
              : s,
          ),
        },
      },
    };
    await installCliMock(page, { "single-bench": { data: regressed } });
    await setShadowValue(page, "diag-perf-model", "./ysm/player.ysm");
    await clickBySelector(page, '[data-testid="diag-perf-run"]');

    await waitForCount(page, ".perf-bl-row", regressed.baseline.diff.stages.length);
    const got = await readSingleOut(page);
    // 退化判决摘要行（含退化阶段数与阈值）与红条
    expect(got.text).toContain("1");
    expect(got.text).toContain(String(regressed.baseline.diff.threshold_pct));
    expect(got.dangerBars).toBeGreaterThan(0);
    expect(got.text).toContain("+3900.0%");
    expect(PLACEHOLDER_LEAK.test(got.text)).toBe(false);
  });

  test("并发基准 tab：档位表与判决徽标按载荷渲染，Go 中文建议不上屏", async ({ page }) => {
    await installCliMock(page, { "concurrent-bench": { data: CONC_BENCH_REAL } });
    await clickBySelector(page, '.repo-tab[data-tab="conc"]');
    await clickBySelector(page, '[data-testid="diag-perf-conc-run"]');

    await waitForCount(page, ".perf-conc-verdict", CONC_BENCH_REAL.parallel.length);
    const got = await page.evaluate(() => {
      const root = document.querySelector("app-content")?.shadowRoot;
      const out = root?.querySelector('[data-testid="diag-perf-conc-out"]') as HTMLElement | null;
      return {
        text: out?.textContent ?? "",
        verdicts: [...(out?.querySelectorAll(".perf-conc-verdict") ?? [])].map((n) =>
          (n.textContent ?? "").trim(),
        ),
        detailRows: out?.querySelectorAll(".perf-conc-row").length ?? 0,
      };
    });
    // ① 每个并发档位一行 + 判决徽标，数字取 Go：加速比与档位数
    expect(got.verdicts.length).toBe(CONC_BENCH_REAL.parallel.length);
    for (const tier of CONC_BENCH_REAL.parallel) {
      expect(got.text).toContain(`${tier.speedup.toFixed(2)}x`);
      expect(got.text).toContain(`${tier.workers}`);
    }
    // ② 串行基准 + 文件读取块（真给了就必须渲染）
    expect(got.detailRows).toBeGreaterThanOrEqual(CONC_BENCH_REAL.parallel.length + 1);
    expect(got.text).toContain(String(CONC_BENCH_REAL.file_read.file_count));
    // ③ 反回退：Go 的中文建议（hints）与占位符都不得上屏
    for (const hint of CONC_BENCH_REAL.hints) expect(got.text).not.toContain(hint);
    expect(PLACEHOLDER_LEAK.test(got.text)).toBe(false);
  });

  test("D-7：基准不可用 → 本地化横幅，中文细节与绝对路径只进 title", async ({ page }) => {
    await installCliMock(page, {
      "single-bench": { data: SINGLE_BENCH_BASELINE_MISSING, status: "error" },
    });
    await setShadowValue(page, "diag-perf-model", "./ysm/player.ysm");
    await clickBySelector(page, '[data-testid="diag-perf-run"]');

    await waitForCount(page, ".perf-bar-row", SINGLE_BENCH_BASELINE_MISSING.stages.length);
    const got = await readSingleOut(page);
    // ① 横幅按**界面当前语言**说人话（e2e 默认英文界面；三条文案都列上，防语种漂移后静默漏断言）
    const lang = await page.evaluate(() => document.documentElement.lang || "en");
    const EXPECTED_BY_LANG: Record<string, string> = {
      en: "No baseline recorded yet",
      "zh-CN": "还没有记录过基准",
      ja: "基準がまだ記録されていません",
    };
    expect(EXPECTED_BY_LANG[lang] ?? EXPECTED_BY_LANG.en).toBeTruthy();
    expect(got.bannerText).toContain(EXPECTED_BY_LANG[lang] ?? EXPECTED_BY_LANG.en);
    expect(PLACEHOLDER_LEAK.test(got.bannerText)).toBe(false);
    // ② Go 的中文散文与机器路径不上屏，但细节没丢（进 title）
    expect(got.text).not.toContain("未找到基准文件");
    expect(got.text).not.toContain("--save-baseline");
    expect(got.titles.some((t) => t.includes("未找到基准文件"))).toBe(true);
    // ③ 基准缺失不吞结果：阶段条照旧
    expect(got.barRows).toBe(SINGLE_BENCH_BASELINE_MISSING.stages.length);
  });
});
