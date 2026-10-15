// @vitest-environment happy-dom
// ===== 诊断页：同步冲突「资源类型下拉」的 i18n 出口锁（conflicts.ts）=====
// 为什么单开一个文件：`vi.mock` 是**文件级**的——本组要覆写 `@/core/i18n/t.ts` 的 t/tOf
// 以观察「译文命中 / 缺键回落」两条分支，若写进 `conflicts.test.ts`，会把那 16 条依赖
// test-setup 全局 zhCN 查表的中文断言一起打翻。兄弟文件是仓内既有惯例
// （`app-tree/index.extra.test.ts` / `app-sync-manager/index.branches.test.ts`）。
//
// 立因（2026-10-15 锐评改进）：`initSyncConflictPanel` 的类型下拉原直取
// `RESOURCE_TYPE_LABELS[id]`（派生自 resource_types.json 的**中文** name），en/ja 界面
// 中文裸奔。改走 `types.ts|rtypeLabelOf` 后必须能证「真的走了出口」——而 `conflicts.test.ts`
// 那条 `toContain("YSM 模型")` 在改前改后**同值**（全局 mock 下出口也返回中文），
// 属零区分度断言；本文件用受控 tOf 把它变成可变异验证的锁（同 app-nav「切换器 i18n」三例范式）。
import { describe, it, expect, vi, beforeEach } from "vitest";

const { tOfMock, getApp, isWebPlatform } = vi.hoisted(() => ({
  // 默认「缺键」语义：tOf 原样返回 key（生产语义），各用例自行覆写
  tOfMock: vi.fn<(k: string) => string>((k: string) => k),
  getApp: vi.fn(),
  isWebPlatform: vi.fn(() => false),
}));

// 覆盖 test-setup.ts 的全局 zhCN 查表（不覆写则「切语言」在组件层不可观测）
vi.mock("@/core/i18n/t.ts", async () => {
  const actual = await vi.importActual<typeof import("@/core/i18n/t.ts")>("@/core/i18n/t.ts");
  return { ...actual, t: tOfMock, tOf: tOfMock };
});
vi.mock("@/backend/app.ts", () => ({ getApp }));
vi.mock("@/backend/platform-web.ts", () => ({ isWebPlatform }));
vi.mock("@/bus", () => ({ bus: { emit: vi.fn(), on: vi.fn(() => () => {}) } }));

import { escUnknown as esc } from "@/utils/html/html.ts";
import { ALL_RESOURCE_TYPES } from "@/utils/resource/types.ts";
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

function mockApp(): void {
  getApp.mockResolvedValue({
    LoadAppConfig: vi.fn(() => ({ mcRoot: "/mc" })),
    ListVersionInstances: vi.fn(() => []),
    DetectConflicts: vi.fn(() => ({ conflicts: [], totalConflicts: 0 })),
  });
}

/** 当前下拉的 {value,label} 对（value 是扫描语义，label 是显示文案） */
function rtypeOptions(bar: HTMLElement): { value: string; label: string }[] {
  const sel = bar.querySelector("#sync-rtype") as HTMLSelectElement;
  return [...sel.options].map((o) => ({ value: o.value, label: o.textContent ?? "" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = "";
  isWebPlatform.mockReturnValue(false);
  mockApp();
});

describe("同步冲突类型下拉 · 走 rtypeLabelOf i18n 出口", () => {
  it("译文命中 → 全部 label 用译文，绝不吐注册表中文（变异：改回直取 RESOURCE_TYPE_LABELS 即红）", async () => {
    tOfMock.mockImplementation((k: string) => (k.startsWith("rtype.") ? `EN::${k}` : k));
    const { bar, list } = makePanel();
    await initSyncConflictPanel(bar, list, esc);

    const opts = rtypeOptions(bar);
    // 覆盖面 = 全注册表（顺序与条目数不受本次改动影响）
    expect(opts.map((o) => o.value)).toEqual([...ALL_RESOURCE_TYPES]);
    expect(opts.every((o) => o.label.startsWith("EN::rtype.label."))).toBe(true);
    // 中文裸奔判据：label 里不得有汉字（带 `u` 旗标按码点判——本文件 label 无 emoji，
    // 但同一判据若被复制到带图标的选择器（如 perf-matrix 目标集）时，无 u 旗标会把
    // emoji 的 UTF-16 代理半区误判成 CJK，见 e2e/diagnostics.spec.ts 同条注）
    expect(opts.filter((o) => /[㐀-鿿]/u.test(o.label))).toEqual([]);
  });

  it("译文缺失 → 回落注册表中文名，绝不把 'rtype.label.*' 原文印进界面", async () => {
    tOfMock.mockImplementation((k: string) => k); // 生产缺键语义：原样返回 key
    const { bar, list } = makePanel();
    await initSyncConflictPanel(bar, list, esc);

    const labels = rtypeOptions(bar).map((o) => o.label);
    expect(labels.some((s) => s.includes("rtype."))).toBe(false);
    // 回落值来自注册表：至少含中文（单一事实源覆盖全部类型，故不会产出空标签选项）
    expect(labels.some((s) => /[㐀-鿿]/u.test(s))).toBe(true);
    expect(labels.every((s) => s.trim().length > 0)).toBe(true);
  });

  it("派生键逐类型查（不给某类型塞第二个键族）", async () => {
    const seen: string[] = [];
    tOfMock.mockImplementation((k: string) => {
      seen.push(k);
      return k.startsWith("rtype.") ? "X" : k;
    });
    const { bar, list } = makePanel();
    await initSyncConflictPanel(bar, list, esc);

    const rtypeKeys = seen.filter((k) => k.startsWith("rtype."));
    expect(rtypeKeys.length).toBeGreaterThanOrEqual(ALL_RESOURCE_TYPES.length);
    // 键族封闭：只有 label 一族（本面板没有分组下拉，出现 rtype.group.* 即越界）
    expect(rtypeKeys.every((k) => /^rtype\.label\.[a-z][A-Za-z0-9]*$/.test(k))).toBe(true);
    // 每类各查一次且键名 = id 的 camel 形态（首字母小写，P0 归一契约的消费侧证据）
    expect(rtypeKeys).toContain("rtype.label.entityPlayer");
    expect(rtypeKeys).toContain("rtype.label.maidModel");
  });
});
