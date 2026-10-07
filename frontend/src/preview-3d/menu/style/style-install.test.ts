// ===== style-install 幂等注入原语测试 =====
// createInstallableStyles：menu 样式两消费者（slide-menu-styles / components-styles）与
// mount-preview-core 共用的 CSSStyleSheet 构建 + document.head 幂等注入脚手架。
// 既有测试只断言消费者产出的 CSS 内容契约（components/slide-menu-styles 冒烟），
// 从不触碰脚手架自身——本测试钉住「幂等注入」这一核心不变量（重复调用不得追加
// 第二个 <style>，否则样式双份、坑排查），以及 sheet 回退与解析失败兜底语义。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInstallableStyles } from "./style-install.ts";

const ATTR = "data-dsh-preview-install-test";

function installedTags(doc: Document = document): HTMLStyleElement[] {
  return Array.from(doc.head.querySelectorAll(`style[${ATTR}]`));
}

beforeEach(() => {
  document.head.innerHTML = "";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createInstallableStyles", () => {
  it("install()：注入一个带 dataAttr 标记的 <style>，内容为完整 css 文本", () => {
    const out = createInstallableStyles(".x { color: red }", ATTR, "t");
    out.install();
    const tags = installedTags();
    expect(tags.length).toBe(1);
    expect(tags[0].getAttribute("data-dsh-preview-install-test")).toBe("");
    expect(tags[0].textContent).toBe(".x { color: red }");
  });

  it("installed 旗标幂等：二次/三次 install() 不再追加节点", () => {
    const out = createInstallableStyles("a{}", ATTR, "t");
    out.install();
    out.install(document);
    out.install(document);
    expect(installedTags().length).toBe(1);
  });

  it("install(doc)：注入目标是传入的文档（head 归属正确）", () => {
    const appendChild = vi.fn();
    const setAttribute = vi.fn();
    const fakeDoc = {
      createElement: () => ({ setAttribute, textContent: "" }),
      head: { appendChild },
    } as unknown as Document;
    const out = createInstallableStyles("b{}", ATTR, "t");
    out.install(fakeDoc);
    expect(appendChild).toHaveBeenCalledTimes(1);
    // 默认 document 不受影响
    expect(installedTags().length).toBe(0);
    // 二次 install 仍幂等（跨 doc 也同一旗标）
    out.install(fakeDoc);
    expect(appendChild).toHaveBeenCalledTimes(1);
  });

  it("sheet：环境支持 CSSStyleSheet 时产出可用的 CSSStyleSheet，否则回退 null", () => {
    const out = createInstallableStyles(".x{}", ATTR, "t");
    if (typeof CSSStyleSheet !== "undefined" && "replaceSync" in CSSStyleSheet.prototype) {
      expect(out.sheet).toBeInstanceOf(CSSStyleSheet);
    } else {
      expect(out.sheet).toBeNull();
    }
  });

  it("CSS 解析失败 → console.error 留痕、不抛（消费方模块顶层调用不受阻断；style 注入仍可用）", () => {
    // happy-dom 的 CSSStyleSheet.replaceSync 极少抛错——显式钉死「解析失败不炸」语义：
    // 失败只应留 console.error（sheet 保持构造中的残值，但 style 标签注入路径不依赖它）
    class BoomStyleSheet {
      replaceSync(): void {
        throw new Error("syntax error");
      }
    }
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("CSSStyleSheet", BoomStyleSheet);
    try {
      const out = createInstallableStyles("!!!bad css!!!", ATTR, "t");
      expect(errSpy).toHaveBeenCalled();
      out.install();
      expect(installedTags().length, "解析失败不阻断 style 注入").toBe(1);
    } finally {
      errSpy.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});