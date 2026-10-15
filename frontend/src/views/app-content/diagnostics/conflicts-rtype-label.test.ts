// @vitest-environment happy-dom
// ===== 诊断页：同步冲突「资源类型下拉」的 i18n 出口锁（conflicts.ts）=====
// 为什么单开一个文件：`vi.mock` 是**文件级**的——本组要覆写 `@/core/i18n/t.ts` 的 t/tOf
// 以观察「译文命中 / 回落」两条分支，若写进 `conflicts.test.ts`，会把那 16 条依赖
// test-setup 全局 zhCN 查表的中文断言一起打翻。兄弟文件是仓内既有惯例
// （`app-tree/index.extra.test.ts` / `app-sync-manager/index.branches.test.ts`）。
//
// 立因（2026-10-15 锐评改进）：`initSyncConflictPanel` 的类型下拉原直取
// `RESOURCE_TYPE_LABELS[id]`（派生自 resource_types.json 的**中文** name），en/ja 界面
// 中文裸奔。改走 `types.ts|rtypeLabelOf` 后必须能证「真的走了出口」——而 `conflicts.test.ts`
// 那条 `toContain("YSM 模型")` 在改前改后**同值**（全局 mock 下出口也返回中文），
// 属零区分度断言；本文件用受控 tOf 把它变成可变异验证的锁（同 app-nav「切换器 i18n」范式）。
//
// ⚠️ 回退链口径：`tOf` 生产是 `当前包 → FALLBACK_LANG(en) → 裸 key` 三层，故本文件
// 一律用 `test-utils/i18n-chain.ts` 的共享替身（含 zh 缺而 en 命中的真实分支），
// 不在测试里另写一份简化回退链——那会把「回落注册表中文」的触发概率高估一层。
import { describe, it, expect, beforeEach, vi } from "vitest";

const { tOfMock, getApp, isWebPlatform } = vi.hoisted(() => ({
  tOfMock: vi.fn<(k: string, p?: Record<string, string>) => string>(() => ""),
  getApp: vi.fn(),
  isWebPlatform: vi.fn(() => false),
}));

vi.mock("@/core/i18n/t.ts", async () => {
  const actual = await vi.importActual<typeof import("@/core/i18n/t.ts")>("@/core/i18n/t.ts");
  return { ...actual, t: tOfMock, tOf: tOfMock };
});
vi.mock("@/backend/app.ts", () => ({ getApp }));
vi.mock("@/backend/platform-web.ts", () => ({ isWebPlatform }));
vi.mock("@/bus", () => ({ bus: { emit: vi.fn(), on: vi.fn(() => () => {}), off: vi.fn() } }));

import { escUnknown as esc } from "@/utils/html/html.ts";
import { CJK_HAN_RE, tOfChain } from "@/test-utils/i18n-chain.ts";
import { ALL_RESOURCE_TYPES } from "@/utils/resource/types.ts";
import { RESOURCE_TYPE_LABELS } from "@/utils/resource/types.ts";
import { initSyncConflictPanel } from "./conflicts.ts";

function makePanel(): { bar: HTMLElement; list: HTMLElement } {
  const root = document.createElement("div");
  root.innerHTML = `
    <div class="diag-bar" id="diag-sync-bar">
      <div class="diag-bar-row">
        <select id="sync-rtype"></select>
        <select id="sync-instance"></select>
        <button id="diag-scan-sync-conflict">扫描同步冲突</button>
      </div>
    </div>
    <div id="diag-sync-conflict-list"><span class="sentinel">占位</span></div>
  `;
  // 挂进 document：isConnected 是真浏览器语义（面板缓存/复扫守卫按它判「是否还在页面里」）
  document.body.appendChild(root);
  return {
    bar: root.querySelector("#diag-sync-bar") as HTMLElement,
    list: root.querySelector("#diag-sync-conflict-list") as HTMLElement,
  };
}

/** 当前下拉的 {value,label} 对（value 是扫描语义，label 是显示文案） */
function rtypeOptions(bar: HTMLElement): { value: string; label: string }[] {
  const sel = bar.querySelector("#sync-rtype") as HTMLSelectElement;
  return [...sel.options].map((o) => ({ value: o.value, label: o.textContent ?? "" }));
}

async function panel(): Promise<ReturnType<typeof rtypeOptions>> {
  getApp.mockResolvedValue({
    LoadAppConfig: vi.fn(() => ({ mcRoot: "/mc" })),
    ListVersionInstances: vi.fn(() => []),
    DetectConflicts: vi.fn(() => ({ conflicts: [], totalConflicts: 0 })),
  });
  const { bar, list } = makePanel();
  await initSyncConflictPanel(bar, list, esc);
  return rtypeOptions(bar);
}

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = "";
  isWebPlatform.mockReturnValue(false);
  // ⚠️ 实现必须每用例前显式装（mock 工厂只在模块求值时跑一次，resetAllMocks 会清空实现）
  tOfMock.mockImplementation(tOfChain({ mode: "real" }));
});

describe("同步冲突类型下拉 · 走 rtypeLabelOf i18n 出口", () => {
  it("译文命中 → 全部 label 用译文，绝不吐注册表中文（变异：改回直取 RESOURCE_TYPE_LABELS 即红）", async () => {
    tOfMock.mockImplementation(tOfChain({ mode: "translated" }));
    const opts = await panel();
    expect(opts.map((o) => o.value)).toEqual([...ALL_RESOURCE_TYPES]);
    expect(opts.every((o) => o.label.startsWith("EN::rtype.label."))).toBe(true);
    expect(opts.filter((o) => CJK_HAN_RE.test(o.label))).toEqual([]);
  });

  it("zh 缺而 en 命中（生产第②层）→ 显示英文，不是裸 key、也不是中文", async () => {
    // 真实链：FALLBACK_LANG=en 先兜一层。此分支证明出口识别的是「裸 key」而非
    // 「任何非中文值」——若把 en 值误判成缺失，界面会无谓地退回中文。
    tOfMock.mockImplementation(tOfChain({ mode: "zhMissingEnHit", family: "rtype.label.maid" }));
    const opts = await panel();
    const maid = opts.find((o) => o.value === "maid-model");
    expect(maid?.label).toBe("Maid Model");
    expect(maid?.label).not.toContain(RESOURCE_TYPE_LABELS["maid-model"]);
  });

  it("两层皆缺 → 回落注册表中文名，绝不把 'rtype.label.*' 原文印进界面", async () => {
    tOfMock.mockImplementation(tOfChain({ mode: "allMissing" }));
    const labels = (await panel()).map((o) => o.label);
    expect(labels.some((s) => s.includes("rtype."))).toBe(false);
    // 回落值来自注册表：至少含中文（单一事实源覆盖全部类型，故不会产出空标签选项）
    expect(labels.some((s) => CJK_HAN_RE.test(s))).toBe(true);
    expect(labels.every((s) => s.trim().length > 0)).toBe(true);
  });

  it("派生键逐类型查（不给某类型塞第二个键族）", async () => {
    const seen: string[] = [];
    tOfMock.mockImplementation((k: string, p?: Record<string, string>) => {
      seen.push(k);
      return tOfChain({ mode: "translated" })(k, p);
    });
    await panel();
    const rtypeKeys = seen.filter((k) => k.startsWith("rtype."));
    expect(rtypeKeys.length).toBeGreaterThanOrEqual(ALL_RESOURCE_TYPES.length);
    // 键族封闭：只有 label 一族（本面板没有分组下拉，出现 rtype.group.* 即越界）
    expect(rtypeKeys.every((k) => /^rtype\.label\.[a-z][A-Za-z0-9]*$/.test(k))).toBe(true);
    // 每类各查一次且键名 = id 的 camel 形态（首字母小写，P0 归一契约的消费侧证据）
    expect(rtypeKeys).toContain("rtype.label.entityPlayer");
    expect(rtypeKeys).toContain("rtype.label.maidModel");
  });
});
