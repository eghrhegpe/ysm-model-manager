import { describe, it, expect } from "vitest";
import { fileIcon, isYsmName } from "./icon.js";

describe("fileIcon", () => {
  it("ysm file returns 💎", () => expect(fileIcon("model.ysm")).toBe("💎"));
  it("zip returns 📦", () => expect(fileIcon("pack.zip")).toBe("📦"));
  it("rar returns 📦", () => expect(fileIcon("pack.rar")).toBe("📦"));
  it("7z returns 📦", () => expect(fileIcon("pack.7z")).toBe("📦"));
  it("pmx returns 🎭", () => expect(fileIcon("model.pmx")).toBe("🎭"));
  it("pmd returns 🎭", () => expect(fileIcon("model.pmd")).toBe("🎭"));
  it("vrca returns 🥽", () => expect(fileIcon("avatar.vrca")).toBe("🥽"));
  it("litematic returns 📐", () => expect(fileIcon("build.litematic")).toBe("📐"));
  it("schematic returns ⚙️", () => expect(fileIcon("build.schematic")).toBe("⚙️"));
  it("png returns 🖼️", () => expect(fileIcon("image.png")).toBe("🖼️"));
  it("md returns 📄", () => expect(fileIcon("doc.md")).toBe("📄"));
  it("unknown ext returns 🧊", () => expect(fileIcon("file.xyz")).toBe("🧊"));
  it("no ext returns 🧊", () => expect(fileIcon("README")).toBe("🧊"));
  it("case insensitive", () => expect(fileIcon("MODEL.YSM")).toBe("💎"));
});

describe("isYsmName", () => {
  it("returns true for .ysm", () => expect(isYsmName("model.ysm")).toBe(true));
  it("returns false for .zip", () => expect(isYsmName("pack.zip")).toBe(false));
  it("returns false for no ext", () => expect(isYsmName("README")).toBe(false));
});
