// ===== 重命名对话框测试（集成级：真实 modal.ts，验证陷阱 #14/#15/#3）=====
// 不 mock esc/registerDlg/closeDlg——原 mock 恰好覆盖陷阱 #15（转义）/#14（单例槽位）
// /#3（finally/连点防重入）的载体；改用真实实现后这些防线可被测试锁定。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { extractHeaderMock } = vi.hoisted(() => ({
  extractHeaderMock: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../../wails/app.ts", () => ({
  getApp: vi.fn().mockResolvedValue({ ExtractYSMHeader: extractHeaderMock }),
}));

import { showRenameDialog } from "./rename.ts";

async function openDlg(
  currentName: string,
  filePath: string | null = "/mc/" + currentName,
) {
  const p = showRenameDialog(filePath, currentName);
  await new Promise((r) => setTimeout(r, 0)); // 等 DOM 挂载
  const overlay = document.querySelector(".dlg-overlay") as HTMLElement;
  const box = overlay.querySelector(".dlg-box") as HTMLElement;
  const q = (sel: string): HTMLElement =>
    box.querySelector(sel) as HTMLElement;
  return {
    p,
    overlay,
    box,
    preview: q("#rn-preview"),
    author: q("#rn-author") as HTMLInputElement,
    work: q("#rn-work") as HTMLInputElement,
    chara: q("#rn-chara") as HTMLInputElement,
    err: q("#rn-err"),
    tips: q("#rn-tips"),
    ok: q("#rn-ok"),
    cancel: q("#rn-cancel"),
    headerBtn: q("#rn-from-header") as HTMLButtonElement,
    sub: q(".dlg-sub"),
  };
}

/** 等待 promise 是否已 settle（用于「不应提交」的负向断言） */
async function settledIn(pr: Promise<unknown>, ms: number): Promise<boolean> {
  let settled = false;
  pr.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  await new Promise((r) => setTimeout(r, ms));
  return settled;
}

beforeEach(() => {
  document.body.innerHTML = "";
  extractHeaderMock.mockReset();
  extractHeaderMock.mockResolvedValue(null);
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("showRenameDialog — 扩展名推导（getExt）", () => {
  it("普通文件 foo.ysm → 预览以 .ysm 结尾，提交 resolve 新名", async () => {
    const { preview, author, chara, ok, p } = await openDlg("foo.ysm");
    expect(preview.textContent).toMatch(/\.ysm$/);

    author.value = "作者";
    chara.value = "角色";
    ok.click();
    await expect(p).resolves.toBe("[作者]【未知】角色.ysm");
  });

  it("banned 文件 foo.ysm.ban → 扩展名取 ysm 且保留 .ban 尾缀", async () => {
    const { preview, author, chara, ok, p } = await openDlg("foo.ysm.ban");
    expect(preview.textContent).toMatch(/\.ysm\.ban$/);

    author.value = "作者";
    chara.value = "角色";
    ok.click();
    await expect(p).resolves.toBe("[作者]【未知】角色.ysm.ban");
  });

  it("无扩展名文件 → 回退默认资源类型 ysm", async () => {
    const { preview } = await openDlg("foo");
    expect(preview.textContent).toMatch(/\.ysm$/);
  });

  it(".BAN 大写尾缀 → 仍识别为 banned 并保留原大写尾缀", async () => {
    const { author, chara, ok, p } = await openDlg("foo.ysm.BAN");
    author.value = "作者";
    chara.value = "角色";
    ok.click();
    await expect(p).resolves.toBe("[作者]【未知】角色.ysm.BAN");
  });
});

describe("showRenameDialog — 取消路径", () => {
  it("点 #rn-cancel → resolve null", async () => {
    const { cancel, p } = await openDlg("foo.ysm");
    cancel.click();
    await expect(p).resolves.toBeNull();
  });

  it("点遮罩自身 → resolve null", async () => {
    const { overlay, p } = await openDlg("foo.ysm");
    overlay.click(); // e.target === overlay → close(null)
    await expect(p).resolves.toBeNull();
  });

  it("Escape 键 → resolve null", async () => {
    const { overlay, p } = await openDlg("foo.ysm");
    overlay.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await expect(p).resolves.toBeNull();
  });
});

describe("showRenameDialog — Enter 提交", () => {
  it("overlay 上按 Enter（焦点不在按钮）→ 提交", async () => {
    const { overlay, author, chara, p } = await openDlg("foo.ysm");
    author.value = "作者";
    chara.value = "角色";
    overlay.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await expect(p).resolves.toBe("[作者]【未知】角色.ysm");
  });

  it("焦点在按钮上按 Enter → 不触发提交（P2 守卫）", async () => {
    const { ok, p } = await openDlg("foo.ysm");
    ok.focus();
    ok.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    // 守卫：Enter 在按钮上走原生激活而非转发——预览未填必填字段，不应提交
    expect(await settledIn(p, 50)).toBe(false);
  });
});

describe("showRenameDialog — 校验失败", () => {
  it("空作者 → err 文案 + 焦点 #rn-author + 不提交", async () => {
    const { ok, err, author, p } = await openDlg("foo.ysm");
    author.value = "";
    ok.click();
    expect(err.textContent).toBeTruthy();
    expect(document.activeElement).toBe(author);
    expect(await settledIn(p, 50)).toBe(false);
  });

  it("输入后 err 清空（input 事件）", async () => {
    const { ok, err, author, chara } = await openDlg("foo.ysm");
    author.value = "";
    chara.value = "角色";
    ok.click();
    expect(err.textContent).toBeTruthy();
    author.value = "作者";
    author.dispatchEvent(new Event("input", { bubbles: true }));
    expect(err.textContent).toBe("");
  });
});

describe("showRenameDialog — 读取头部", () => {
  it("成功 → 填作者 + 展示 tips", async () => {
    extractHeaderMock.mockResolvedValue({
      isYsm: true,
      authorName: "头部作者",
      tips: "头部介绍",
    });
    const { headerBtn, author, tips } = await openDlg("foo.ysm");
    headerBtn.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(author.value).toBe("头部作者");
    expect(tips.textContent).toContain("头部介绍");
    // finally 恢复按钮文案与可用态（陷阱 #3）
    expect(headerBtn.disabled).toBe(false);
  });

  it("ExtractYSMHeader reject → tips 显示读取失败", async () => {
    extractHeaderMock.mockRejectedValue(new Error("not ysm"));
    const { headerBtn, tips } = await openDlg("foo.ysm");
    headerBtn.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(tips.textContent).toContain("读取失败");
    expect(headerBtn.disabled).toBe(false);
  });

  it("filePath=null → 提示尚未导入", async () => {
    const { headerBtn, tips } = await openDlg("foo.ysm", null);
    headerBtn.click();
    expect(tips.textContent).toContain("尚未导入");
  });
});

describe("showRenameDialog — 连点防重入（真实 closeDlg _closing 守卫）", () => {
  it("连点 rn-ok → 只 resolve 一次", async () => {
    const { ok, author, chara, p } = await openDlg("foo.ysm");
    author.value = "作者";
    chara.value = "角色";
    ok.click();
    ok.click();
    await expect(p).resolves.toBe("[作者]【未知】角色.ysm");
  });
});

describe("showRenameDialog — esc 转义（陷阱 #15，真实 esc）", () => {
  it("文件名含 HTML → 标题区不注入元素、原文以转义形式保留", async () => {
    const { sub } = await openDlg('<img src=x onerror=alert(1)>.ysm');
    expect(sub.querySelector("img")).toBeNull();
    expect(sub.textContent).toContain("<img");
  });
});
