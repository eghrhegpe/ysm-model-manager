// @vitest-environment happy-dom
// ===== 诊断页：去重扫描「类型标签」的 i18n 出口锁（dedup.ts / dedup-scan.ts）=====
// 单开文件的原因同 `conflicts-rtype-label.test.ts`：`vi.mock` 是文件级的，本组要覆写
// `@/core/i18n/t.ts` 的 t/tOf 以观察「译文命中 / 缺键回落」，写进 `dedup.test.ts` 会把
// 那批依赖 test-setup 全局 zhCN 查表的中文断言一起打翻。
//
// 立因（2026-10-15 锐评改进）：`deriveDedupTypeMeta` 的**函数注释自称「标签走 i18n」**，
// 实现却直取注册表中文 `entry.name`；`collectTargets` 的「全类型」分支同样逐行直取
// `rt.name`——属「声明跑在实现前面」的现场（P0 键族失配一并拆净的第 3、4 处）。
// 此前两处**零测试覆盖**：回退成直取中文不会有任何用例转红，故本文件是新增的区分性锁。
import { describe, it, expect, vi, beforeEach } from "vitest";
import { waitFor } from "@/test-utils/index.ts";

const { busEmit, getApp, tMock } = vi.hoisted(() => ({
  busEmit: vi.fn(),
  getApp: vi.fn(),
  tMock: vi.fn<(k: string, params?: Record<string, string>) => string>(() => ""),
}));

vi.mock("@/core/i18n/t.ts", async () => {
  const actual = await vi.importActual<typeof import("@/core/i18n/t.ts")>("@/core/i18n/t.ts");
  return { ...actual, t: tMock, tOf: tMock };
});
vi.mock("@/bus", () => ({ bus: { emit: busEmit, on: vi.fn(() => () => {}), off: vi.fn() } }));
vi.mock("@/backend/app.ts", () => ({ getApp }));

import { escUnknown as esc } from "@/utils/html/html.ts";
import { zhCN } from "@/locales/zh-CN.ts";
import { RESOURCE_TYPE_LABELS } from "@/utils/resource/types.ts";
import { createDedupSession } from "./dedup.ts";

/** 非 rtype 键走真实 zh-CN 模板 + 插值（否则连 scanHash 外壳文案都是裸 key，断言失去意义） */
function zhTpl(k: string, params?: Record<string, string>): string {
  const tpl = zhCN[k as keyof typeof zhCN] ?? k;
  return String(tpl).replace(/\{(\w+)\}/g, (_m, p: string) => params?.[p] ?? `{${p}}`);
}

/** EntityPlayer / maid-model 的注册表中文全名（回落值，用于「不得上屏」的反向判据） */
const PLAYER_CN = RESOURCE_TYPE_LABELS["EntityPlayer"];
const MAID_CN = RESOURCE_TYPE_LABELS["maid-model"];

const groupJson = [
  {
    files: [
      { path: "/a/1.ysm", name: "1.ysm", size: 100, modTime: 1000 },
      { path: "/b/2.ysm", name: "2.ysm", size: 200, modTime: 2000 },
    ],
  },
];

function mockApp(root = "/repo") {
  getApp.mockResolvedValue({
    GetRepoRoot: vi.fn(() => root),
    FindDuplicateFiles: vi.fn(() => groupJson),
    MoveToRecycle: vi.fn(async () => {}),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  document.body.innerHTML = "";
  localStorage.clear();
  // ⚠️ resetAllMocks 会清掉 mock 实现（tMock 变返回 undefined）——实现必须在每用例前
  // **显式重装**，写进 mock 工厂只在模块求值时跑一次（首版即踩：图标在、标签全空）。
  tMock.mockImplementation((k: string, params?: Record<string, string>) =>
    k.startsWith("rtype.") ? `EN::${k}` : zhTpl(k, params),
  );
});

describe("去重扫描 · 类型标签走 rtypeLabelOf i18n 出口", () => {
  it("单类型扫描：扫描中提示行用译文标签，绝不直取注册表中文（变异：改回 entry.name 即红）", async () => {
    mockApp();
    const dedup = createDedupSession();
    const list = document.createElement("div");
    document.body.appendChild(list);

    await dedup.start(list, esc, "EntityPlayer");

    const text = list.textContent ?? "";
    expect(text).toContain("EN::rtype.label.entityPlayer");
    expect(text).not.toContain(PLAYER_CN);
  });

  it("全类型扫描：逐组标题同样走出口（collectTargets 的 all 分支曾是第二处直取）", async () => {
    mockApp();
    const dedup = createDedupSession();
    const list = document.createElement("div");
    document.body.appendChild(list);

    await dedup.start(list, esc, "all");
    await waitFor(() => list.querySelector(".diag-dedup-rt"), 4000);

    const text = list.textContent ?? "";
    expect(text).toContain("EN::rtype.label.ysm");
    expect(text).toContain("EN::rtype.label.maidModel");
    expect(text).not.toContain(MAID_CN);
    expect(text).not.toContain(PLAYER_CN);
  });

  it("缺译文 → 回落注册表中文名，绝不把 'rtype.label.*' 原文印进界面", async () => {
    // tOf 生产语义：缺键原样返回 key。出口须识别该形态并回落，否则界面吐裸 key（更坏）。
    tMock.mockImplementation((k: string, params?: Record<string, string>) =>
      k.startsWith("rtype.") ? k : zhTpl(k, params),
    );
    mockApp();
    const dedup = createDedupSession();
    const list = document.createElement("div");
    document.body.appendChild(list);

    await dedup.start(list, esc, "EntityPlayer");

    const text = list.textContent ?? "";
    expect(text).not.toContain("rtype.label.");
    expect(text).toContain(PLAYER_CN); // 回落来自注册表（单一事实源覆盖全部类型）
  });
});
