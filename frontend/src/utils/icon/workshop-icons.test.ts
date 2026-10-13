// @vitest-environment node
// ===== 创意工坊 SVG 图标测试：平台映射 + 角色映射 =====
// 覆盖：getSiteIcon / getTagIconFromRole 各分支（含未知回退）+ **站点表交叉校验**
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { getSiteIcon, getTagIconFromRole, ICONS } from "./workshop-icons.ts";

/** 仓库根站点表。⚠️ 走 fs 而非 `#root/` import：越 src 界的 import 有棘轮基线（只减不增，
 *  见 check-path-hygiene 的 r4_cross_boundary），而测试文件本就不进打包图。 */
const SITE_TABLE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  "workshop_sites.json",
);

describe("getSiteIcon", () => {
  it("已知平台返回对应图标", () => {
    expect(getSiteIcon("bilibili")).toBe(ICONS.BILIBILI);
    expect(getSiteIcon("afdian")).toBe(ICONS.AFDIAN);
    expect(getSiteIcon("github")).toBe(ICONS.GITHUB);
    expect(getSiteIcon("mzhouse")).toBe(ICONS.MZHOUSE);
    expect(getSiteIcon("bowlroll")).toBe(ICONS.BOWLROLL);
    expect(getSiteIcon("vroid")).toBe(ICONS.VROID);
    expect(getSiteIcon("nicovideo")).toBe(ICONS.NICOVIDEO);
    expect(getSiteIcon("deviantart")).toBe(ICONS.DEVIANTART);
    expect(getSiteIcon("booth")).toBe(ICONS.BOOTH);
    expect(getSiteIcon("cms-blueprint")).toBe(ICONS.CMS);
  });

  it("站点表里的每个平台都有专属图标（防新增站点静默落到兜底图标）", () => {
    // 历史缺口：booth 在 creators.json 里有 17 位创作者，却从未加入 SITE_ICON_MAP，
    // 这 17 张卡片的平台徽章一直显示兜底图标；而本文件原有断言只枚举当时手写的 8 个平台，
    // **从不与实际站点表对照**，缺口因此长期无人发现。本用例把两个清单钉在一起。
    const table = JSON.parse(fs.readFileSync(SITE_TABLE_PATH, "utf8")) as Array<{ id: string }>;
    const missing = table.map((s) => s.id).filter((id) => getSiteIcon(id) === ICONS.SITE);
    expect(missing, "以下站点 id 没有专属图标（落到兜底），请在 SITE_ICON_MAP 补映射").toEqual([]);
  });

  it("未知平台回退 SITE 图标（不是 CREATOR——未知站点不该冒充创作者身份）", () => {
    expect(getSiteIcon("unknown-site")).toBe(ICONS.SITE);
    expect(getSiteIcon("")).toBe(ICONS.SITE);
  });

  it("原型链键（toString/constructor/__proto__）回退 SITE，不穿透", () => {
    expect(getSiteIcon("toString")).toBe(ICONS.SITE);
    expect(getSiteIcon("constructor")).toBe(ICONS.SITE);
    expect(getSiteIcon("__proto__")).toBe(ICONS.SITE);
  });
});

describe("getTagIconFromRole", () => {
  it("各角色映射到对应图标", () => {
    expect(getTagIconFromRole("official")).toBe(ICONS.OFFICIAL);
    expect(getTagIconFromRole("vup")).toBe(ICONS.VUP);
    expect(getTagIconFromRole("oc")).toBe(ICONS.OC);
    expect(getTagIconFromRole("repo")).toBe(ICONS.REPO);
  });

  it("未知名/未传回退 CREATOR 图标", () => {
    expect(getTagIconFromRole(undefined)).toBe(ICONS.CREATOR);
    expect(getTagIconFromRole("custom-role")).toBe(ICONS.CREATOR);
  });
});
