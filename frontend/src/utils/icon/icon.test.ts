// @vitest-environment node
import { describe, it, expect } from "vitest";
import { fileIcon } from "./icon.ts";
import { RESOURCE_EXTS } from "@/utils/resource/extensions.ts";
import { typeIconOf } from "@/utils/resource/types.ts";

describe("fileIcon", () => {
  // 数据驱动：从 REGISTRY_EXT_ICONS 计算期望值，杜绝硬编码 emoji 漂移
  // 注册表扩展名 → 图标由 RESOURCE_EXTS + typeIconOf 派生（单一事实来源）
  // 用 Map 模拟 icon.ts 的 REGISTRY_EXT_ICONS 构建逻辑：后遍历的类型覆盖同名扩展名
  // （如 EntityPlayer 和 SceneModel 都拥有 .pmx/.pmd，最后胜出者决定图标）
  const registryExpectations = new Map<string, string>();
  for (const [rtype, exts] of Object.entries(RESOURCE_EXTS)) {
    const icon = typeIconOf(rtype);
    for (const e of exts) {
      const key = e.replace(/^\./, "");
      if (key !== "zip" && key !== "7z") {
        // ysm 的 .zip/.json 容器语义特殊，不走注册表图标（与 icon.ts 内部逻辑一致）
        if (rtype === "ysm" && key !== "ysm") continue;
        registryExpectations.set(key, icon);
      }
    }
  }

  it.each([...registryExpectations.entries()])("注册表扩展名 %s → %s", (ext, expectedIcon) => {
    // 构造任意合法文件名
    const filename = `model.${ext}`;
    expect(fileIcon(filename), `fileIcon("${filename}") should be ${expectedIcon}`).toBe(expectedIcon);
  });

  // 超集分支（非注册表兜底规则）
  it("zip/rar/7z/tar/gz 返回 📦", () => {
    expect(fileIcon("pack.zip")).toBe("📦");
    expect(fileIcon("pack.rar")).toBe("📦");
    expect(fileIcon("pack.7z")).toBe("📦");
  });
  it("vrcw 返回 🥽", () => expect(fileIcon("world.vrcw")).toBe("🥽"));
  it("schem 返回 ⚙️", () => expect(fileIcon("build.schem")).toBe("⚙️"));
  it("图片扩展名返回 🖼️", () => {
    expect(fileIcon("img.png")).toBe("🖼️");
    expect(fileIcon("img.jpg")).toBe("🖼️");
  });
  it("文本扩展名返回 📄", () => {
    expect(fileIcon("doc.md")).toBe("📄");
    expect(fileIcon("config.json")).toBe("📄");
  });
  it("未知扩展名返回 🧊", () => expect(fileIcon("file.xyz")).toBe("🧊"));
  it("无扩展名返回 🧊", () => expect(fileIcon("README")).toBe("🧊"));
  it("大小写不敏感", () => expect(fileIcon("MODEL.YSM")).toBe("💎"));

  // 禁用后缀（.disabled/.ban）不改变图标判定——禁用文件仍是原名命名的真类型文件
  it("禁用后缀剥除后按原扩展名判定图标", () => {
    expect(fileIcon("pack.zip.disabled")).toBe("📦"); // 资源包禁用态
    expect(fileIcon("model.ysm.disabled")).toBe("💎"); // ysm 禁用态
    expect(fileIcon("pack.zip.ban")).toBe("📦"); // 历史 .ban 兼容
    expect(fileIcon("model.ysm.ban")).toBe("💎");
  });
  it("禁用后缀结合大小写不敏感", () => {
    expect(fileIcon("PACK.ZIP.DISABLED")).toBe("📦");
  });
});


