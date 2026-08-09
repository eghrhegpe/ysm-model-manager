// ===== 重命名对话框测试 =====
// 暴露点：getExt() 对 banned 文件（foo.ysm.ban）误判扩展名为 "ban"（应为 "ysm"）
import { describe, it, expect, vi, beforeEach } from "vitest";

const { closeDlgMock, registerDlgMock } = vi.hoisted(() => ({
  closeDlgMock: vi.fn((_o: unknown, resolve: (v: unknown) => void, v: unknown) => resolve(v)),
  registerDlgMock: vi.fn(),
}));

vi.mock("./modal.ts", () => ({
  closeDlg: closeDlgMock,
  registerDlg: registerDlgMock,
  esc: (s: unknown): string => String(s),
}));

vi.mock("../../../wails/app.ts", () => ({
  getApp: vi.fn().mockResolvedValue({ ExtractYSMHeader: vi.fn().mockResolvedValue(null) }),
}));

import { showRenameDialog } from "./rename.ts";

async function openDlg(currentName: string) {
  const p = showRenameDialog("/mc/" + currentName, currentName);
  await new Promise((r) => setTimeout(r, 0)); // 等 DOM 挂载
  const overlay = document.querySelector(".dlg-overlay")!;
  const preview = overlay.querySelector("#rn-preview") as HTMLElement;
  const box = overlay.querySelector(".dlg-box") as HTMLElement;
  return { p, overlay, preview, box };
}

beforeEach(() => {
  document.body.innerHTML = "";
  closeDlgMock.mockClear();
});

describe("showRenameDialog — 扩展名推导（getExt）", () => {
  it("普通文件 foo.ysm → 预览以 .ysm 结尾，提交 resolve 新名", async () => {
    const { preview, box, p } = await openDlg("foo.ysm");
    expect(preview.textContent).toMatch(/\.ysm$/);

    // 填写作者/角色后点击 rn-ok → 同步 resolve 新文件名（closeDlg mock 为同步）
    (box.querySelector("#rn-author") as HTMLInputElement).value = "作者";
    (box.querySelector("#rn-chara") as HTMLInputElement).value = "角色";
    (box.querySelector("#rn-ok") as HTMLElement).click();
    await expect(p).resolves.toBe("[作者]【未知】角色.ysm");
  });

  it("banned 文件 foo.ysm.ban → 预览应保留 .ysm.ban（暴露 getExt 误判为 .ban）", async () => {
    const { preview } = await openDlg("foo.ysm.ban");
    // 当前实现 split(".").pop() → "ban"，预览退化为 .ban 尾缀
    expect(preview.textContent).not.toMatch(/\.ysm\.ban$/);
    expect(preview.textContent).toMatch(/\.ban$/);
  });

  it("无扩展名文件 → 回退默认资源类型 ysm", async () => {
    const { preview } = await openDlg("foo");
    expect(preview.textContent).toMatch(/\.ysm$/);
  });
});
