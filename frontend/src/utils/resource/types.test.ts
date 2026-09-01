// @vitest-environment node
// ===== 资源类型映射测试（ADR-021 扩展）=====
// TS 常量（RESOURCE_TYPES/LABELS/ALL）与 resource_types.json（单一事实来源）对账。
import { describe, it, expect } from "vitest";
import {
  RESOURCE_TYPES,
  RESOURCE_TYPE_LABELS,
  ALL_RESOURCE_TYPES,
  NO_3D_TYPES,
  AMBIGUOUS_EXTS,
  resolveTypeSafe,
  VOXEL_RPC_BY_EXT,
  GROUP_META,
  GROUP_OF,
  GROUP_TYPE_OPTIONS,
  groupLabelOf,
  groupStorageRootOf,
  getPreviewableTypeTabs,
} from "./types.ts";
import resourceTypesJson from "#root/resource_types.json";

/** JSON 中全部资源类型 ID */
const jsonIds = resourceTypesJson.resourceTypes.map((r) => r.id);

describe("RESOURCE_TYPES 标签映射", () => {
  it("各标签映射到预期内部 ID", () => {
    expect(RESOURCE_TYPES).toEqual({
      YSM: "ysm",
      MMD: "EntityPlayer",
      SCENE: "SceneModel",
      CUSTOM_ANIM: "CustomAnim",
      CUSTOM_MORPH: "CustomMorph",
      STAGE: "StageAnim",
      MMD_SHADER: "mmd-shader",
      DEFAULT_ANIM: "DefaultAnim",
      DEFAULT_MORPH: "DefaultMorph",
      PACK: "resourcepack",
      SHADER: "shaderpack",
      BLUEPRINT: "blueprint",
      LITEMATIC: "litematic",
      MAID: "maid-model",
      FBX: "fbx",
    });
  });
});

describe("RESOURCE_TYPE_LABELS 显示标签", () => {
  it("每个内部 ID 都有中文显示名", () => {
    for (const id of ALL_RESOURCE_TYPES) {
      expect(RESOURCE_TYPE_LABELS[id], `缺少标签: ${id}`).toBeTruthy();
    }
  });

  it("关键 ID 的中文名正确", () => {
    expect(RESOURCE_TYPE_LABELS["ysm"]).toBe("YSM 模型");
    expect(RESOURCE_TYPE_LABELS["resourcepack"]).toBe("资源包");
    expect(RESOURCE_TYPE_LABELS["shaderpack"]).toBe("光影包");
    expect(RESOURCE_TYPE_LABELS["EntityPlayer"]).toBe("角色模型");
  });
});

describe("与 resource_types.json 对账（单一事实来源）", () => {
  it("ALL_RESOURCE_TYPES 与 JSON 的 id 集合一致", () => {
    expect([...ALL_RESOURCE_TYPES].sort()).toEqual([...jsonIds].sort());
  });

  it("RESOURCE_TYPES 的值全部在 JSON 中存在", () => {
    for (const id of Object.values(RESOURCE_TYPES)) {
      expect(jsonIds, `JSON 缺少资源类型: ${id}`).toContain(id);
    }
  });

  it("无重复 ID", () => {
    expect(new Set(ALL_RESOURCE_TYPES).size).toBe(ALL_RESOURCE_TYPES.length);
  });
});

describe("AMBIGUOUS_EXTS 歧义扩展名集合", () => {
  it("容器扩展名 .zip 恒歧义（归属 ≥2 类型）", () => {
    expect(AMBIGUOUS_EXTS.has(".zip")).toBe(true);
  });

  it(".7z 多归属（resourcepack/shaderpack/ysm 均声明）→ 歧义", () => {
    expect(AMBIGUOUS_EXTS.has(".7z")).toBe(true);
  });

  it("单归属扩展名不歧义", () => {
    expect(AMBIGUOUS_EXTS.has(".ysm")).toBe(false);
    // .pmx 被 EntityPlayer 和 SceneModel 共享（扁平化后 MMD 类型共享扩展名）
    expect(AMBIGUOUS_EXTS.has(".pmx")).toBe(true);
    expect(AMBIGUOUS_EXTS.has(".vrca")).toBe(false);
    expect(AMBIGUOUS_EXTS.has(".nbt")).toBe(false);
    expect(AMBIGUOUS_EXTS.has(".schematic")).toBe(false);
  });

  it("与 resource_types.json 派生一致（新增类型自动纳入）", () => {
    const counts: Record<string, number> = {};
    for (const rt of resourceTypesJson.resourceTypes) {
      for (const e of rt.extensions || []) {
        counts[e.toLowerCase()] = (counts[e.toLowerCase()] || 0) + 1;
      }
    }
    const expected = new Set(
      Object.keys(counts).filter((e) => counts[e] > 1),
    );
    expect([...AMBIGUOUS_EXTS].sort()).toEqual([...expected].sort());
  });
});

describe("resolveTypeSafe 安全解析", () => {
  it("单归属扩展名直接命中", () => {
    expect(resolveTypeSafe("model.ysm")).toBe("ysm");
    expect(resolveTypeSafe("build.nbt")).toBe("blueprint");
    expect(resolveTypeSafe("proj.litematic")).toBe("litematic");
    expect(resolveTypeSafe("old.schematic")).toBe("blueprint");
  });

  it("歧义扩展名返回 null（强制回退 Go 内容检测）", () => {
    expect(resolveTypeSafe("pack.zip")).toBeNull();
    expect(resolveTypeSafe("pack.7z")).toBeNull();
    // .pmx 被 EntityPlayer/SceneModel 共享（扁平化后 MMD 类型共享扩展名）
    expect(resolveTypeSafe("avatar.pmx")).toBeNull();
  });

  it("未知/无扩展名返回 null", () => {
    expect(resolveTypeSafe("readme.txt")).toBeNull();
    expect(resolveTypeSafe("noext")).toBeNull();
  });

  it("大小写不敏感（与注册表口径一致）", () => {
    expect(resolveTypeSafe("MODEL.YSM")).toBe("ysm");
  });
});

describe("VOXEL_RPC_BY_EXT voxelFn 映射", () => {
  const voxelTypeIds = ["blueprint", "litematic"];
  const voxelExts = new Set<string>();
  for (const rt of resourceTypesJson.resourceTypes) {
    if (voxelTypeIds.includes(rt.id)) {
      for (const e of rt.extensions || []) voxelExts.add(e.toLowerCase());
    }
  }

  it("体素类扩展名（.nbt/.schematic/.litematic）全部有 RPC 映射", () => {
    for (const ext of voxelExts) {
      if (ext === ".zip" || ext === ".7z") continue;
      expect(VOXEL_RPC_BY_EXT[ext], `缺少 voxelFn 映射: ${ext}`).toBeTruthy();
    }
  });

  it("映射 key 全部是体素类扩展名（无漂移）", () => {
    for (const ext of Object.keys(VOXEL_RPC_BY_EXT)) {
      expect(voxelExts, `非体素扩展名 ${ext} 不应出现在 VOXEL_RPC_BY_EXT`).toContain(ext);
    }
  });

  it("RPC 名称指向 Get*VoxelData 形态", () => {
    for (const fn of Object.values(VOXEL_RPC_BY_EXT)) {
      expect(fn).toMatch(/^Get\w*VoxelData$/);
    }
  });
});

describe("GROUP_META 分组元数据", () => {
  it("关键分组存在且 icon/name 正确", () => {
    expect(GROUP_META["minecraft"]).toMatchObject({ name: "Minecraft 原版" });
    expect(GROUP_META["minecraft-mod"]).toMatchObject({ name: "Minecraft 模组" });
    expect(GROUP_META["mmd"]).toMatchObject({ name: "MMD" });
  });

  it("分组按首次出现顺序排列", () => {
    const groups = Object.values(GROUP_META).sort((a, b) => a.order - b.order);
    expect(groups.map((g) => g.order)).toEqual([0, 1, 2]);
  });

  it("无类型使用的分组不出现（other 组无类型，不展示）", () => {
    expect(GROUP_META["other"]).toBeUndefined();
  });

  it("每个分组 name/icon 非空（从注册表 groupLabel/groupIcon 派生）", () => {
    for (const [gid, meta] of Object.entries(GROUP_META)) {
      expect(meta.name).toBeTruthy();
      expect(meta.icon).toBeTruthy();
    }
  });
});

describe("GROUP_OF 类型→分组映射", () => {
  it("原版资源归 minecraft", () => {
    expect(GROUP_OF["resourcepack"]).toBe("minecraft");
    expect(GROUP_OF["shaderpack"]).toBe("minecraft");
  });

  it("模组资源归 minecraft-mod", () => {
    expect(GROUP_OF["ysm"]).toBe("minecraft-mod");
    expect(GROUP_OF["blueprint"]).toBe("minecraft-mod");
    expect(GROUP_OF["litematic"]).toBe("minecraft-mod");
  });

  it("MMD 生态归 mmd", () => {
    expect(GROUP_OF["EntityPlayer"]).toBe("mmd");
    expect(GROUP_OF["SceneModel"]).toBe("mmd");
  });
});

describe("GROUP_TYPE_OPTIONS — 平铺展示各类型", () => {
  it("minecraft 组：资源包/光影包平铺", () => {
    const mc = GROUP_TYPE_OPTIONS["minecraft"] || [];
    const rtypes = mc.map((o) => o.rtype);
    expect(rtypes).toContain("resourcepack");
    expect(rtypes).toContain("shaderpack");
    expect(mc[0].subdir).toBe("");
  });

  it("minecraft-mod 组：ysm/blueprint/litematic/maid-model 平铺", () => {
    const mod = GROUP_TYPE_OPTIONS["minecraft-mod"] || [];
    const rtypes = mod.map((o) => o.rtype);
    expect(rtypes).toContain("ysm");
    expect(rtypes).toContain("blueprint");
    expect(rtypes).toContain("litematic");
    expect(rtypes).toContain("maid-model");
  });

  it("mmd 组：9 个独立 MMD 类型（含 fbx）", () => {
    const mmd = GROUP_TYPE_OPTIONS["mmd"] || [];
    expect(mmd.length).toBe(9); // EntityPlayer/SceneModel/CustomAnim/CustomMorph/StageAnim/mmd-shader/DefaultAnim/DefaultMorph/fbx
    const rtypes = mmd.map((o) => o.rtype);
    expect(rtypes).toContain("EntityPlayer");
    expect(rtypes).toContain("SceneModel");
    expect(rtypes).toContain("CustomAnim");
    expect(rtypes).toContain("CustomMorph");
    expect(rtypes).toContain("StageAnim");
    expect(rtypes).toContain("mmd-shader");
    expect(rtypes).toContain("DefaultAnim");
    expect(rtypes).toContain("DefaultMorph");
    expect(rtypes).toContain("fbx");
  });

  it("所有选项 subdir 为空（平铺，无子目录展开）", () => {
    for (const opts of Object.values(GROUP_TYPE_OPTIONS)) {
      for (const o of opts) {
        expect(o.subdir).toBe("");
      }
    }
  });
});

describe("groupStorageRootOf 两层路由（从 JSON 动态派生，防快照漂移）", () => {
  // 从 resource_types.json 动态计算期望值，避免手写快照导致 21 次推倒重来
  const rts = resourceTypesJson.resourceTypes as Array<{
    id: string;
    group?: string;
    storageSubDir?: string;
  }>;

  it("所有类型：groupStorageRootOf 与 JSON 派生一致", () => {
    for (const rt of rts) {
      const group = rt.group || "";
      const sub = rt.storageSubDir || rt.id;
      const expected = group ? `${group}/${sub}` : sub;
      expect(groupStorageRootOf(rt.id), `${rt.id} 路径漂移`).toBe(expected);
    }
  });

  it("锚点哨兵：已知类型存储根硬编码钉死（防 JSON 数值漂移）", () => {
    // 派生化只防结构漂移；storageSubDir/group 值被改错时派生循环自证通过，锚点兜底
    const anchors: Array<[string, string]> = [
      ["resourcepack", "minecraft/resourcepacks"],
      ["shaderpack", "minecraft/shaderpacks"],
      ["ysm", "minecraft-mod/ysm"],
      ["maid-model", "minecraft-mod/maid-model"],
      ["EntityPlayer", "mmd/PMX"],
    ];
    for (const [typeId, want] of anchors) {
      expect(groupStorageRootOf(typeId), `${typeId} 锚点`).toBe(want);
    }
  });

  it("未知 typeId 回退到 typeId 自身", () => {
    expect(groupStorageRootOf("nonexistent")).toBe("nonexistent");
  });

  it("防快照守卫：无废弃壳层前缀", () => {
    // 3d-skin 是 MMD 合法 instanceDir（ADR-094 资源树根），不在此列
    const deprecated = ["mmd-skin/", "{instance}", "{installDir}"];
    for (const rt of rts) {
      const root = groupStorageRootOf(rt.id);
      for (const prefix of deprecated) {
        expect(root.startsWith(prefix), `${rt.id} 不应含废弃前缀 ${prefix}`).toBe(false);
      }
    }
  });
});

describe("groupLabelOf 分组显示名", () => {
  it("已知分组返回中文名", () => {
    expect(groupLabelOf("minecraft")).toBe("Minecraft 原版");
    expect(groupLabelOf("mmd")).toBe("MMD");
  });

  it("未知分组返回空串", () => {
    expect(groupLabelOf("nonexistent")).toBe("");
    expect(groupLabelOf("")).toBe("");
  });
});

// ===== resolvePreviewKey（ADR-111：variants 解耦）=====
import { resolvePreviewKey, extOf } from "./types.ts";

describe("resolvePreviewKey 按 variants 分发预览器", () => {
  it("EntityPlayer .pmx → mmd", () => {
    expect(resolvePreviewKey("/repo/model.pmx", "EntityPlayer")).toBe("mmd");
  });

  it("EntityPlayer .vrm → vrm", () => {
    expect(resolvePreviewKey("/repo/avatar.vrm", "EntityPlayer")).toBe("vrm");
  });

  it("SceneModel .pmx → mmd-scene", () => {
    expect(resolvePreviewKey("/repo/scene.pmx", "SceneModel")).toBe("mmd-scene");
  });

  it("无 variants 的类型回退 rtype 自身", () => {
    expect(resolvePreviewKey("/repo/pack.zip", "resourcepack")).toBe("resourcepack");
  });

  it("variants 未命中扩展名回退 rtype", () => {
    // .vrca 不在 EntityPlayer variants 里，回退 "EntityPlayer"
    expect(resolvePreviewKey("/repo/avatar.vrca", "EntityPlayer")).toBe("EntityPlayer");
  });

  it("未知 rtype 回退 rtype 自身", () => {
    expect(resolvePreviewKey("/repo/unknown.xyz", "unknown-type")).toBe("unknown-type");
  });

  it("无扩展名文件（如 Makefile）回退 rtype——不入 variants 误匹配", () => {
    // 根因：extOf 对无点路径返回空串（旧实现 split('.').pop() 会产出整段路径垃圾值）；
    // 空串与任一 variant.ext（.pmx/.pmd/.vrm）不匹配 → 回退 rtype
    expect(extOf("/repo/Makefile")).toBe("");
    expect(extOf("Makefile")).toBe("");
    expect(resolvePreviewKey("/repo/Makefile", "EntityPlayer")).toBe("EntityPlayer");
  });
});

// ===== resolvePreviewKeyByExt（ADR-111 兜底层：歧义扩展名预览路由兜底）=====
import { resolvePreviewKeyByExt } from "./types.ts";

describe("resolvePreviewKeyByExt 按扩展名兜底解析预览器", () => {
  it(".pmx 歧义扩展名 → mmd（EntityPlayer 首个声明者，跨类型浏览 PMX 的兜底路由）", () => {
    expect(resolvePreviewKeyByExt("/repo/model.pmx")).toBe("mmd");
  });

  it(".vrm → vrm（与 resolvePreviewKey 的 EntityPlayer 变体口径一致）", () => {
    expect(resolvePreviewKeyByExt("/repo/avatar.vrm")).toBe("vrm");
  });

  it(".pmd → mmd（EntityPlayer/SceneModel 双声明歧义，取首个声明者）", () => {
    expect(resolvePreviewKeyByExt("/repo/model.pmd")).toBe("mmd");
  });

  it("无 variants 声明扩展名 → 空串（不误判，保持原 toast 兜底路径）", () => {
    expect(resolvePreviewKeyByExt("/repo/unknown.xyz")).toBe("");
  });

  it("无扩展名文件 → 空串", () => {
    expect(resolvePreviewKeyByExt("/repo/Makefile")).toBe("");
  });

  it("大小写不敏感（.PMX 与 .pmx 同命中）", () => {
    expect(resolvePreviewKeyByExt("/repo/MODEL.PMX")).toBe("mmd");
  });
});

// ===== resolvePreviewKeyToRtype（ADR-111 逆向，批次6 P3 补测）=====
import { resolvePreviewKeyToRtype } from "./types.ts";

describe("resolvePreviewKeyToRtype 预览键反解资源类型 ID", () => {
  it("mmd → EntityPlayer（角色面板 tab → 真实 rtype 白名单过滤）", () => {
    expect(resolvePreviewKeyToRtype("mmd")).toBe("EntityPlayer");
  });

  it("vrm → EntityPlayer（与 mmd 同归 EntityPlayer，正向/反向一致）", () => {
    expect(resolvePreviewKeyToRtype("vrm")).toBe("EntityPlayer");
  });

  it("mmd-scene → SceneModel", () => {
    expect(resolvePreviewKeyToRtype("mmd-scene")).toBe("SceneModel");
  });

  it("正向→反向 round-trip：resolvePreviewKey → resolvePreviewKeyToRtype 还原", () => {
    // 从 JSON 取一条真实 variant 断言正反一致（防 JSON 漂移）
    const entity = resourceTypesJson.resourceTypes.find((t: any) => t.id === "EntityPlayer");
    expect(entity?.variants?.length ?? 0).toBeGreaterThan(0);
    for (const v of entity?.variants || []) {
      expect(resolvePreviewKeyToRtype(v.preview)).toBe(entity!.id);
    }
  });

  it("已是资源类型 ID 的键回退自身（fbx / ysm）", () => {
    expect(resolvePreviewKeyToRtype("fbx")).toBe("fbx");
    expect(resolvePreviewKeyToRtype("ysm")).toBe("ysm");
  });

  it("未知键回退自身（不抛错，静默降级为原键）", () => {
    expect(resolvePreviewKeyToRtype("totally-unknown-key")).toBe("totally-unknown-key");
    expect(resolvePreviewKeyToRtype("")).toBe("");
  });
});

// ===== getPreviewableTypeTabs（ADR-111 收口：3D 切换面板 tab 单一事实来源）=====
describe("getPreviewableTypeTabs 3D 切换面板 tab 派生", () => {
  const tabs = getPreviewableTypeTabs();
  const keys = tabs.map((t) => t.key);

  it("仅含 preview='3d' 的类型，排除 thumbnail/none 类型", () => {
    const allowed = new Set(ALL_RESOURCE_TYPES.filter((id) => !NO_3D_TYPES.has(id)));
    const previewKeys = new Set<string>();
    for (const rt of resourceTypesJson.resourceTypes) {
      if (rt.variants) for (const v of rt.variants) previewKeys.add(v.preview);
    }
    for (const t of tabs) {
      const isRealRtype = allowed.has(t.key);
      const isPreviewKey = previewKeys.has(t.key);
      expect(isRealRtype || isPreviewKey, `tab key 既非 3d 类型也非 preview key: ${t.key}`).toBe(true);
    }
  });

  it("EntityPlayer 的 variants 展开为 mmd + vrm tab（.pmx/.pmd 同映射 mmd 已去重）", () => {
    const mmdTabs = tabs.filter((t) => t.key === "mmd");
    const vrmTabs = tabs.filter((t) => t.key === "vrm");
    expect(mmdTabs.length).toBe(1);
    // vrm 是 EntityPlayer 与 SceneModel 共享预览格式，按 key 去重后只保留首个命中（EntityPlayer），
    // 故 vrm 恰好 1 个 tab、且标签归属「角色模型」（而非 SceneModel 的「场景模型」）。
    expect(vrmTabs.length).toBe(1);
    expect(vrmTabs[0].label).toBe("角色模型");
    expect(mmdTabs[0].label).toBe("角色模型");
  });

  it("tab 的 preview key 全局唯一（共享 preview key 跨类型去重，不出现重复 tab）", () => {
    const keyCounts = new Map<string, number>();
    for (const t of tabs) keyCounts.set(t.key, (keyCounts.get(t.key) ?? 0) + 1);
    for (const [key, count] of keyCounts) {
      expect(count, `preview key "${key}" 出现 ${count} 次，应唯一`).toBe(1);
    }
  });

  it("无 variants 的 3d 类型用自己的 id 作 key（ysm / fbx / blueprint / maid-model …）", () => {
    for (const id of ["ysm", "fbx", "blueprint", "litematic", "maid-model"]) {
      expect(keys).toContain(id);
    }
  });

  it("preview≠3d 的类型不出现（如 mmd-shader / CustomAnim 等纯动作/着色器类型）", () => {
    for (const excluded of ["CustomAnim", "CustomMorph", "StageAnim", "mmd-shader", "DefaultAnim"]) {
      expect(keys).not.toContain(excluded);
    }
  });

  it("resourcepack 已标 preview='3d' 且有 3D opener，派生纳入对应 tab", () => {
    // ADR-111 收口修正：resourcepack 有 pack-3d.ts opener，JSON 标注已从 thumbnail 升为 3d，
    // 派生结果应纳入，消除旧面板 resourcepack tab 回归。
    expect(keys).toContain("resourcepack");
  });

  it("shaderpack 仍标 preview='thumbnail'（无 3D opener），派生不纳入", () => {
    // shaderpack 实际无 3D 预览能力（pack-3d.ts 仅注册 resourcepack），维持 thumbnail 标注，
    // 派生结果不应含 shaderpack——防止无 opener 的类型混入 3D 切换面板。
    expect(keys).not.toContain("shaderpack");
  });

  it("每个 tab 都有非空标签", () => {
    expect(tabs.every((t) => t.label.length > 0)).toBe(true);
  });
});