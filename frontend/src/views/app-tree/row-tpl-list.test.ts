// ===== 紧凑列表行模板测试（row-tpl-list）=====
// 覆盖：文件行（类型图标/禁用/缩进）、文件夹行（锁定/展开/半选）
import { describe, it, expect } from "vitest";
import { listFileRowHTML, listFolderRowHTML } from "./row-tpl-list.ts";
import type { TreeEntry } from "./loader.ts";

function entry(over: Partial<TreeEntry>): TreeEntry {
  return {
    name: "a.ysm",
    path: "/repo/a.ysm",
    fullPath: "/repo/a.ysm",
    size: 1024,
    modTime: 0,
    banned: false,
    type: "ysm",
    ...over,
  };
}

describe("listFileRowHTML", () => {
  it("普通 YSM 文件行：勾选 on + 💎 图标 + 格式化大小", () => {
    const html = listFileRowHTML(entry({}), "a.ysm", "📄", "");
    expect(html).toContain('class="fl-list"');
    expect(html).toContain('class="ck on"');
    expect(html).toContain("💎");
    expect(html).toContain("1.0 KB");
    expect(html).toContain('data-path="/repo/a.ysm"');
  });

  it("被禁用的文件行：ban class + 空勾选", () => {
    const html = listFileRowHTML(entry({ banned: true }), "a.ysm", "📄", "");
    expect(html).toContain("fl-list ban");
    expect(html).toContain('class="ck"');
  });

  it("pack 类型用 🎨 图标，fullPath 缺省回退 path", () => {
    const html = listFileRowHTML(
      entry({ type: "resourcepack", fullPath: "" }),
      "a.zip",
      "📄",
      "",
    );
    expect(html).toContain("🎨");
    expect(html).toContain('data-fullpath="/repo/a.ysm"');
  });

  it("缩进参数渲染 padding 样式", () => {
    const html = listFileRowHTML(entry({}), "a.ysm", "📄", "", 20);
    expect(html).toContain('style="padding-left:20px"');
  });

  it("自定义行 class 拼接", () => {
    const html = listFileRowHTML(entry({}), "a.ysm", "📄", " dim", 0, " extra");
    expect(html).toContain("fl-list extra");
    expect(html).toContain('class="nm dim"');
  });
});

describe("listFolderRowHTML", () => {
  it("普通文件夹：展开箭头 + 📁 + 无锁定", () => {
    const html = listFolderRowHTML("主题", "/repo/主题", true, false, true, false, 0);
    expect(html).toContain("▾");
    expect(html).toContain("📁");
    expect(html).not.toContain("locked");
    expect(html).toContain("ck on");
    // esc 仅 HTML 转义，中文原样保留（非 URL 编码）
    expect(html).toContain('data-dir="/repo/主题"');
  });

  it("锁定文件夹：🔒 + muted + locked class", () => {
    const html = listFolderRowHTML("mods", "/repo/mods", false, true, false, false, 10);
    expect(html).toContain("🔒");
    expect(html).toContain("fh-list locked");
    expect(html).toContain("▸");
    expect(html).toContain("var(--muted)");
    expect(html).toContain('style="padding-left:10px"');
  });

  it("部分选中：on partial", () => {
    const html = listFolderRowHTML("mix", "/repo/mix", false, false, true, true, null);
    expect(html).toContain("ck on partial");
  });

  it("全禁用：无 ck class", () => {
    const html = listFolderRowHTML("off", "/repo/off", false, false, false, false, null);
    expect(html).toContain('class="ck"');
  });
});
