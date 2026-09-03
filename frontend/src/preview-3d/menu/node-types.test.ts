// preview-menu-node-types.test.ts — [doc:adr-093-ysm] 声明式节点类型契约测试
// 断言：
//   1. folder 递归：collectPreviewLeafNodes 展平嵌套，isPreviewFolderNode 判 folder
//   2. id 唯一性：collectPreviewNodeIds 供全局唯一契约
//   3. 迁移样例：一个「声明式 YSM 详情树」样例能被正确展平、字段合法（声明式形状的活样本）
import { describe, it, expect } from "vitest";
import {
  isPreviewFolderNode,
  collectPreviewLeafNodes,
  collectPreviewNodeIds,
  type PreviewMenuNode,
} from "./node-types.ts";

/** 迁移样例：YSM 角色详情（未来目标态——详情=模型信息面板本体 + 动作折叠区） */
const ysmDetailTree: PreviewMenuNode[] = [
  {
    id: "detail",
    kind: "folder",
    labelKey: "preview.roleDetail",
    fallback: "角色详情",
    children: [
      {
        id: "model-section",
        kind: "folder",
        labelKey: "preview.roleModelSection",
        fallback: "模型",
        defaultOpen: true,
        dockGroup: "model",
        children: [
          {
            id: "model",
            kind: "panel",
            labelKey: "preview.modelInfo",
            fallback: "模型信息",
            icon: "🧍",
            dockGroup: "model",
            // 逃生舱：现有 fillModelPanel 命令式渲染过渡
            renderCustom: (list: HTMLElement): void => {
              list.textContent = "fillModelPanel placeholder";
            },
          },
          {
            id: "shot",
            kind: "action",
            labelKey: "preview.screenshot",
            fallback: "截图",
            icon: "📷",
            dockGroup: "model",
            action: (): void => {
              /* screenshot */
            },
          },
          {
            id: "bones",
            kind: "panel",
            labelKey: "preview.section.bones",
            fallback: "骨骼",
            icon: "🦴",
            dockGroup: "model",
            renderCustom: (): void => {
              /* 3D bone panel */
            },
          },
        ],
      },
      {
        id: "motion-section",
        kind: "folder",
        labelKey: "preview.roleMotionSection",
        fallback: "动作",
        dockGroup: "motion",
        children: [
          {
            id: "ysm-play",
            kind: "action",
            labelKey: "preview.play",
            fallback: "播放",
            icon: "▶️",
            dockGroup: "motion",
            action: (): void => {
              /* play */
            },
          },
        ],
      },
    ],
  },
];

describe("PreviewMenuNode 类型契约", () => {
  it("folder 判定：kind==='folder' 或有 children 均视为可下钻", () => {
    expect(isPreviewFolderNode(ysmDetailTree[0])).toBe(true);
    const leaf: PreviewMenuNode = { id: "l", kind: "panel" };
    expect(isPreviewFolderNode(leaf)).toBe(false);
  });

  it("leaf 展平：嵌套 folder 递归收集全部叶节点", () => {
    const leaves = collectPreviewLeafNodes(ysmDetailTree);
    const ids = leaves.map((l) => l.id);
    expect(ids).toEqual(["model", "shot", "bones", "ysm-play"]);
    // 叶节点都不该是 folder
    for (const l of leaves) expect(isPreviewFolderNode(l)).toBe(false);
  });

  it("id 唯一性：递归收集全部 id 供全局唯一契约", () => {
    const ids = collectPreviewNodeIds(ysmDetailTree);
    expect(ids).toContain("detail");
    expect(ids).toContain("model-section");
    expect(ids).toContain("ysm-play");
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("迁移样例：声明式树字段齐全、dockGroup 归属合法", () => {
    const leaves = collectPreviewLeafNodes(ysmDetailTree);
    for (const l of leaves) {
      // 叶节点：非 folder 必有 id
      expect(typeof l.id).toBe("string");
      expect(l.id.length).toBeGreaterThan(0);
      // dockGroup 若声明必须在合法集合内
      if (l.dockGroup) {
        expect(["model", "motion", "env", "scene", "settings"]).toContain(l.dockGroup);
      }
      // panel 型须有逃生舱（renderCustom）；action 型须有 action 回调
      if (l.kind === "panel") expect(typeof l.renderCustom).toBe("function");
      if (l.kind === "action") expect(typeof l.action).toBe("function");
    }
  });

  it("逃生舱与 action 语义：renderCustom 返回 dispose 可选，action 可异步", () => {
    const withDispose: PreviewMenuNode = {
      id: "custom",
      kind: "custom",
      renderCustom: (): (() => void) => {
        return () => {
          /* cleanup */
        };
      },
    };
    const fn = withDispose.renderCustom!;
    const ret = fn(document.createElement("div"));
    expect(typeof ret).toBe("function");
    const asyncAction: PreviewMenuNode = {
      id: "async-act",
      kind: "action",
      action: async (): Promise<void> => {
        await Promise.resolve();
      },
    };
    expect(typeof asyncAction.action).toBe("function");
  });
});
