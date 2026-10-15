// ===== dedup 面板模板测试（2026-10-15：首屏「未扫描」空闲态）=====
// 老锐评 P2 收口：结果区原先整块留白，与「扫描完成但无重复」视觉不可区分
// （同分区回收站/资历最深两面板三态齐备）。空闲态做成**初始内容**，扫描链整块覆写即可，
// 故这里锁两件事：① 首屏确实有它；② 它落在结果区挂载点内（覆写生效的必要前提）。
import { describe, expect, it } from "vitest";
import { t } from "@/core/i18n/t.ts";
import { dedupPanelHTML } from "./tpl-dedup.ts";

describe("dedupPanelHTML — 首屏空闲态", () => {
  it("结果区含「未扫描」文案（i18n 直取，改文案不碎测试）", () => {
    expect(dedupPanelHTML()).toContain(t("dedup.idleScanHint"));
  });

  it("空闲态位于 #dedup-result-list 内（扫描链 innerHTML 覆写的靶点，不需额外清理）", () => {
    const host = document.createElement("div");
    host.innerHTML = dedupPanelHTML();
    const list = host.querySelector("#dedup-result-list");
    expect(list).not.toBeNull();
    expect(list!.textContent).toContain(t("dedup.idleScanHint"));
    // 与「扫描完成无重复」区分：首屏不得出现 noDups 文案（那是扫描后的结论态）
    expect(list!.textContent).not.toContain(t("diagnostics.noDups"));
  });

  it("三个接线挂载点仍在（回归：加空闲态不得挤掉 start/config/result 契约）", () => {
    const host = document.createElement("div");
    host.innerHTML = dedupPanelHTML();
    for (const id of ["dedup-start-btn", "dedup-config-panel", "dedup-result-list"]) {
      expect(host.querySelector(`#${id}`), `缺挂载点 #${id}`).not.toBeNull();
    }
    // 结果区不得再被配置面板的初始内容污染（配置面板由 init 单独填充）
    const cfg = host.querySelector("#dedup-config-panel")!;
    expect(cfg.textContent).toBe("");
  });
});
