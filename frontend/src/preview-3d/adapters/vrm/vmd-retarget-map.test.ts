// @vitest-environment node
// ===== vmd-retarget-map.ts 契约测试（ADR-243 §2.3）=====
// 覆盖：VRM 全量 humanoid 骨的覆盖性（映射表 ∪ 不映射表 = VRMHumanBoneList）、
// 无陈旧键、候选名全局唯一（防两骨抢同一 MMD 骨）、丢弃策略（扭骨/IK 骨不入表）、
// 关键行抽查。
import { VRMHumanBoneList } from "@pixiv/three-vrm-core";
import { describe, expect, it } from "vitest";
import {
  VMD_POSITION_SCALE_DEFAULT,
  VMD_REFERENCE_HEIGHT,
  VMD_RETARGET_CANDIDATES,
  VMD_RETARGET_UNMAPPED,
  VMD_ROOT_TRANSLATION_CANDIDATES,
} from "./vmd-retarget-map.ts";

const ALL_VRM_BONES = [...VRMHumanBoneList] as string[];

describe("覆盖性：VRMHumanBoneList 全 55 骨无盲区", () => {
  it("权威清单为 55 项（VRM 1.0；项目文档惯称的「52」是 0.x 旧数）", () => {
    expect(ALL_VRM_BONES).toHaveLength(55);
  });

  it("每项要么在映射表、要么在不映射表——防 VRM 侧新增骨时静默漏映射", () => {
    const missing = ALL_VRM_BONES.filter(
      (name) =>
        !(VMD_RETARGET_CANDIDATES as Record<string, unknown>)[name] &&
        !(VMD_RETARGET_UNMAPPED as Record<string, unknown>)[name],
    );
    expect(missing).toEqual([]);
  });

  it("两表互斥：同一骨不得既映射又不映射", () => {
    const both = ALL_VRM_BONES.filter(
      (name) =>
        (VMD_RETARGET_CANDIDATES as Record<string, unknown>)[name] &&
        (VMD_RETARGET_UNMAPPED as Record<string, unknown>)[name],
    );
    expect(both).toEqual([]);
  });

  it("无陈旧键：两表键必须是真实 VRM 骨名", () => {
    const stale = [
      ...Object.keys(VMD_RETARGET_CANDIDATES),
      ...Object.keys(VMD_RETARGET_UNMAPPED),
    ].filter((k) => !ALL_VRM_BONES.includes(k));
    expect(stale).toEqual([]);
  });

  it("映射 53 骨 / 显式不映射 2 骨（spine、jaw）", () => {
    expect(Object.keys(VMD_RETARGET_CANDIDATES)).toHaveLength(53);
    expect(Object.keys(VMD_RETARGET_UNMAPPED).sort()).toEqual(["jaw", "spine"]);
  });

  it("不映射表带原因文案（不是空值占位）", () => {
    for (const reason of Object.values(VMD_RETARGET_UNMAPPED)) {
      expect(typeof reason).toBe("string");
      expect((reason as string).length).toBeGreaterThan(8);
    }
  });
});

describe("候选表健全性", () => {
  it("候选名全局唯一——同一 MMD 骨被两处认领会造成静默错绑", () => {
    const owner = new Map<string, string>();
    const dupes: string[] = [];
    for (const [vrm, cands] of Object.entries(VMD_RETARGET_CANDIDATES)) {
      for (const c of cands as readonly string[]) {
        const prev = owner.get(c);
        if (prev !== undefined && prev !== vrm) dupes.push(`${c}: ${prev} ↔ ${vrm}`);
        owner.set(c, vrm);
      }
    }
    expect(dupes).toEqual([]);
  });

  it("每条候选列表非空，且候选名无空白", () => {
    for (const [vrm, cands] of Object.entries(VMD_RETARGET_CANDIDATES)) {
      expect(cands.length, vrm).toBeGreaterThan(0);
      for (const c of cands as readonly string[]) expect(c.trim(), `${vrm}:${c}`).toBe(c);
    }
  });

  it("丢弃策略：扭骨（捩）与 IK 骨（ＩＫ/IK）一律不入候选表", () => {
    const offenders: string[] = [];
    for (const [vrm, cands] of Object.entries(VMD_RETARGET_CANDIDATES)) {
      for (const c of cands as readonly string[]) {
        if (/捩|ＩＫ|IK/.test(c)) offenders.push(`${vrm} → ${c}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("位移源候选以 センター 优先，且不含旋转专有骨", () => {
    expect(VMD_ROOT_TRANSLATION_CANDIDATES[0]).toBe("センター");
    expect(VMD_ROOT_TRANSLATION_CANDIDATES).not.toContain("腰");
  });
});

describe("关键行抽查", () => {
  it("hips 主候选为 腰，下半身 兜底（MMD 两种主流派系）", () => {
    expect(VMD_RETARGET_CANDIDATES.hips?.slice(0, 2)).toEqual(["腰", "下半身"]);
  });

  it("upperChest 独占 上半身2（与 chest 的 上半身 不冲突）", () => {
    expect(VMD_RETARGET_CANDIDATES.upperChest).toContain("上半身2");
    expect(VMD_RETARGET_CANDIDATES.upperChest).toContain("上半身２");
    expect(VMD_RETARGET_CANDIDATES.chest).not.toContain("上半身2");
  });

  it("肩保留 P/C 兜底，但不含 捩", () => {
    expect(VMD_RETARGET_CANDIDATES.leftShoulder).toEqual(
      expect.arrayContaining(["左肩", "左肩P", "左肩C"]),
    );
    expect(VMD_RETARGET_CANDIDATES.leftShoulder).not.toContain("左肩捩");
  });

  it("手指覆盖全角/半角数字变体（MMD 标准全角，导出工具常半角）", () => {
    expect(VMD_RETARGET_CANDIDATES.leftThumbMetacarpal).toEqual(
      expect.arrayContaining(["左親指０", "左親指0"]),
    );
    expect(VMD_RETARGET_CANDIDATES.rightLittleDistal).toEqual(
      expect.arrayContaining(["右小指３", "右小指3"]),
    );
  });

  it("缩放常量与 ADR-243 §2.5 一致（0.08 m/unit、基准 1.6 m）", () => {
    expect(VMD_POSITION_SCALE_DEFAULT).toBeCloseTo(0.08, 10);
    expect(VMD_REFERENCE_HEIGHT).toBeCloseTo(1.6, 10);
  });
});
