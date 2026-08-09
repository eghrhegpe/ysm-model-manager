// ===== 批量重命名对话框测试 =====
// 覆盖：updateAll 对 banned 文件（foo.ysm.ban）扩展名/角色名/尾缀的处理、普通文件、应用载荷
import { describe, it, expect, vi, beforeEach } from "vitest";

const { closeDlgMock, registerDlgMock } = vi.hoisted(() => ({
  closeDlgMock: vi.fn((_o: unknown, resolve?: () => void) => resolve?.()),
  registerDlgMock: vi.fn(),
}));

vi.mock("./modal.ts", () => ({
  registerDlg: registerDlgMock,
  closeDlg: closeDlgMock,
  esc: (s: unknown): string => String(s),
}));

import { showBatchRenameDialog } from "./batch-rename.ts";
import type { BatchRenameChange } from "./batch-rename.ts";

async function open(entries: Array<{ Name: string; Path?: string }>) {
  const onApply = vi.fn().mockResolvedValue(undefined);
  const pending = showBatchRenameDialog("/dir", entries, onApply);
  await new Promise((r) => setTimeout(r, 0));
  const dlg = document.querySelector(".dlg-overlay")!;
  return { onApply, pending, dlg };
}

beforeEach(() => {
  document.body.innerHTML = "";
  closeDlgMock.mockClear();
  registerDlgMock.mockClear();
});

describe("showBatchRenameDialog — banned 文件处理", () => {
  it("foo2024.ysm.ban → 新名保留 .ban 尾缀且扩展名为 ysm（不误判为 .ban）", async () => {
    const { onApply, pending, dlg } = await open([
      { Name: "foo2024.ysm.ban", Path: "/dir/foo2024.ysm.ban" },
    ]);

    // 默认 updateAll 已生成新名（日期规范化 " (2024)"），预览应含 .ysm.ban
    const preview = dlg.querySelector("#br-preview") as HTMLElement;
    expect(preview.innerHTML).toContain(".ysm.ban");

    (dlg.querySelector("#br-apply") as HTMLElement).click();
    await pending;

    expect(onApply).toHaveBeenCalledTimes(1);
    const changes = onApply.mock.calls[0][0] as BatchRenameChange[];
    expect(changes[0].oldName).toBe("foo2024.ysm.ban");
    expect(changes[0].newName).toMatch(/\.ysm\.ban$/);
    // 扩展名是 ysm 而非 ban，角色名无 .ysm 残留
    expect(changes[0].newName).toContain("foo (2024).ysm.ban");
  });

  it("普通文件 a2024.ysm → 新名以 .ysm 结尾，无 .ban", async () => {
    const { onApply, pending, dlg } = await open([{ Name: "a2024.ysm", Path: "/dir/a.ysm" }]);
    const btn = dlg.querySelector("#br-apply") as HTMLElement;
    btn.click();
    await pending;

    const changes = onApply.mock.calls[0][0] as BatchRenameChange[];
    expect(changes[0].newName).toMatch(/\.ysm$/);
    expect(changes[0].newName).not.toContain(".ban");
  });

  it("无变更（新名===原名）→ 提示不应用", async () => {
    // 已规范命名的文件 updateAll 后不变 → changed 空，只 toast 不调 onApply（弹窗不关闭）
    const { onApply, dlg } = await open([{ Name: "[A]【W】C.ysm", Path: "/dir/x.ysm" }]);

    (dlg.querySelector("#br-apply") as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 0));

    expect(onApply).not.toHaveBeenCalled();
  });
});
