// @vitest-environment node
// ===== context-menu-shared 纯函数单测（锐评 P2 #9：文件夹名校验收紧）=====
// isUnsafeFolderName：UX 预检层（终审在 Go fsutil.ContainsIllegalNameChar，
// 2026-09-06 扩展保留名 + 尾随空格点）——此处只保证前端在弹窗提交前就拦住
// Windows 非法/易错名，错误提示即时可读，不迟至 Go 侧 os 层报错。
import { describe, expect, it, vi } from "vitest";

// 隔离模块图：isUnsafeFolderName 是纯函数，但 shared.ts 顶层链到
// backend/app.ts（contextMenuGetApp）——stub 掉依赖层，测试不碰绑定图
vi.mock("./context-menu-deps.ts", () => ({ contextMenuGetApp: vi.fn() }));

import { isUnsafeFolderName } from "./context-menu-shared.ts";

describe("isUnsafeFolderName（安全过滤：逃逸段 + 平台非法字符 + 保留名 + 尾随空格点）", () => {
  it("空/纯空白 → 不安全", () => {
    expect(isUnsafeFolderName("")).toBe(true);
    expect(isUnsafeFolderName("   ")).toBe(true);
  });

  it("逃逸段：绝对路径 / 盘符 / . / .. → 不安全（原有语义不变）", () => {
    expect(isUnsafeFolderName("/abs/path")).toBe(true);
    expect(isUnsafeFolderName("C:evil")).toBe(true);
    expect(isUnsafeFolderName("./rel")).toBe(true);
    expect(isUnsafeFolderName("a/../b")).toBe(true);
    expect(isUnsafeFolderName("..")).toBe(true);
  });

  it("Windows 非法字符 <>:*?\"| 出现在任一段 → 不安全（原仅 Go 侧拦截）", () => {
    expect(isUnsafeFolderName("a<b")).toBe(true);
    expect(isUnsafeFolderName("a>b")).toBe(true);
    expect(isUnsafeFolderName("a:b")).toBe(true);
    expect(isUnsafeFolderName('a"b')).toBe(true);
    expect(isUnsafeFolderName("控制*符")).toBe(true);
    expect(isUnsafeFolderName("a?b")).toBe(true);
    expect(isUnsafeFolderName("a|b")).toBe(true);
  });

  it("Windows 保留名（大小写不敏感，含带扩展名变体）→ 不安全", () => {
    for (const reserved of ["CON", "PRN", "AUX", "NUL", "COM1", "COM9", "LPT1", "LPT9"]) {
      expect(isUnsafeFolderName(reserved.toLowerCase())).toBe(true);
      expect(isUnsafeFolderName(`${reserved}.txt`)).toBe(true);
    }
    // 首点前整段 = CON → 保留（code_review 04449b48 #1：原断言误放「合法名放行」
    // 块内与标题矛盾，移回本块——防保留名扩展的前端回归防护被按标题误删）
    expect(isUnsafeFolderName("con.tents")).toBe(true);
  });

  it("尾随点/空格（Windows 静默剥离 → 落点漂移）→ 不安全", () => {
    expect(isUnsafeFolderName("author.")).toBe(true);
    expect(isUnsafeFolderName("author ")).toBe(true);
    expect(isUnsafeFolderName("a/b.")).toBe(true);
  });

  it("合法名放行：普通名 / 中文 / 嵌套段 / 中间含点 → 安全", () => {
    expect(isUnsafeFolderName("[author]")).toBe(false);
    expect(isUnsafeFolderName("测试作者")).toBe(false);
    expect(isUnsafeFolderName("a/b")).toBe(false); // 嵌套语义：dstDir 拼接按 / 逐段落盘
    expect(isUnsafeFolderName("v1.2备份")).toBe(false);
  });
});
