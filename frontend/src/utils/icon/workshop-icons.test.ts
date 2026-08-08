// ===== 创意工坊 SVG 图标测试：平台映射 + 角色映射 =====
// 覆盖：getSiteIcon / getTagIconFromRole 各分支（含未知回退）
import { describe, it, expect } from "vitest";
import { getSiteIcon, getTagIconFromRole, ICONS } from "./workshop-icons.ts";

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
  });

  it("未知平台回退 CREATOR 图标", () => {
    expect(getSiteIcon("unknown-site")).toBe(ICONS.CREATOR);
    expect(getSiteIcon("")).toBe(ICONS.CREATOR);
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
