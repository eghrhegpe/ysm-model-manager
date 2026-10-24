// 组件隔离渲染入口:?c=<name> 挂载单个 Web Component,mock 桥由 mock-install.ts
// 在本模块之前装好(ESM 静态 import 按声明序求值,先于下方动态 import)。
//
// 就绪协议(锐评 P1-1 重写):光有「子元素非空」不算就绪——<style> 壳、空态占位、错误态
// 骨架全都能满足旧判据,于是空壳截图一路绿灯。现在每个条目声明一个 probe(选择器 +
// 最小命中数),probe 命中才算渲染成功;命中不到就置 data-error 让 shot.mjs 判失败。
// 另在 body 上挂 data-render 统计(元素数 / 去样式文本长度),供 shot.mjs 做二次否决。
import "./mock-install.ts";
import { initI18n, setLocaleHost } from "@/core/i18n/locale.ts";
import { makeLocaleHost } from "@/utils/dom/locale-host.ts";
import { bus } from "../src/bus.ts";

/** 渲染成功判据:选择器在组件根(Shadow DOM 优先,否则 light DOM)内至少命中 min 个。 */
type Probe = { selector: string; min?: number };

/** 两种挂载形态:Custom Element(tag+load)或函数式弹窗(imperative,如 dialogs 的 showXxx)。
 *  attrs = 挂载前要写上的属性(生产里由父模板/事件写入,隔离渲染必须自己补,
 *  否则组件走「无 instance」降级分支——sync-manager 的空态假绿就是这么来的)。
 *  preload = 组件运行时依赖、但自身不 import 的兄弟组件模块(app-content 只写
 *  <app-tree>/<app-sidebar> 标签,define 在各自模块里——不预载就是一片空白)。
 *  mock = 只对本次截图生效的 binding 覆写(e2e 的 MOCK_DATA 里这些键是 undefined,
 *  因为它们服务于 e2e 的**降级路径**用例;截图要看的是正常路径,两者不能互相迁就)。 */
type Entry =
  | {
      tag: string;
      load: () => Promise<unknown>;
      probe: Probe;
      attrs?: Record<string, string>;
      preload?: (() => Promise<unknown>)[];
      mock?: Record<string, () => Promise<unknown>>;
      imperative?: undefined;
    }
  | { imperative: (host: HTMLElement) => Promise<void>; probe: Probe };

/** 组件注册表:新增目标组件在此登记一条(动态 import 路径须静态字符串,vite 才能预转译)。
 *  probe 不是装饰:它是「这张截图证明了什么」的唯一书面契约,写错 = 假绿。
 *  选择器一律取 data-testid 稳定钩子(Design.md §19.1),不绑 class。 */
const REGISTRY: Record<string, Entry> = {
  "app-tree": {
    tag: "app-tree",
    load: () => import("../src/views/app-tree/index.ts"),
    // 树必须渲染出真实行(文件夹或文件),只有 tree-root 空容器 = 扫描未回
    probe: { selector: '[data-testid="tree-file"], [data-testid="tree-dir"]', min: 1 },
  },
  "app-sync-manager": {
    tag: "app-sync-manager",
    load: () => import("../src/views/app-sync-manager/index.ts"),
    // 生产里 instance 由 init-pages.mountSyncManager 在 package:selected 时写入;
    // 隔离渲染没有侧栏点击,不补这个属性组件就走 _showNoInstance() 的「未指定整合包」
    // 占位——这正是锐评 P0-2 里 0.0% 覆盖率那张空壳图的成因。
    attrs: { instance: "1.20.1-Fabric", "default-type": "ysm" },
    // 同步面板必须有真实条目行;.sm-empty 空态不算(空态由空态专用条目承担)
    probe: { selector: ".sm-item, .sm-dir", min: 1 },
  },
  "app-toast": {
    tag: "app-toast",
    load: () => import("../src/views/app-toast/index.ts"),
    probe: { selector: '[data-testid="toast"]', min: 3 },
  },
  "app-sidebar": {
    tag: "app-sidebar",
    load: () => import("../src/views/app-sidebar/index.ts"),
    // 不能只查 toolbar 的 sidebar-push:那个按钮在骨架屏阶段就已存在,查它等于
    // 「页面刚打开就判就绪」——截到的是四行 sk-line 骨架(锐评 P0-2 同类假绿)。
    // sidebar-check 只在真实整合包卡片里出现,要求列表已从 binding 加载完。
    probe: { selector: '[data-testid="sidebar-check"]', min: 1 },
  },
  "app-nav": {
    tag: "app-nav",
    load: () => import("../src/views/app-nav/index.ts"),
    probe: { selector: '[data-testid="nav-item"]', min: 1 },
  },
  "app-content": {
    tag: "app-content",
    load: () => import("../src/views/app-content/index.ts"),
    // 兄弟组件是 <app-tree>/<app-sidebar> 标签,define 在各自模块里;不预载 → 页面面板
    // 挂着两个未升级的空标签,截图 = 一大片背景色(锐评 P0-2 的 1.4% 空壳图)。
    preload: [
      () => import("../src/views/app-tree/index.ts"),
      () => import("../src/views/app-sidebar/index.ts"),
    ],
    // 面板壳(.page)不够:要求仓库树真渲染出文件行(穿透 app-tree 的 shadowRoot 查)。
    probe: { selector: '[data-testid="tree-file"], [data-testid="tree-dir"]', min: 1 },
  },
  "app-preview": {
    tag: "app-preview",
    load: () => import("../src/views/app-preview/index.ts"),
    // e2e 的 MOCK_DATA 把 ExtractYsmSummary/ExtractYSMHeader 留成 undefined,
    // 是为了让 preview.spec 覆盖「解析失败」降级路径(那条用例断言 Parse failed 文案)。
    // 截图要的是正常路径,故在此覆写:给出真实摘要 → 详情卡渲染 .md-row 而不是错误文案。
    mock: {
      ExtractYsmSummary: async () => ({
        schema: "ysm-summary/v1",
        source: "model-a.ysm",
        name: "Model A",
        tips: "截图用示例摘要",
        license: "CC BY-NC-SA 4.0",
        authors: [{ name: "作者甲", roles: "建模" }],
        spec: 2,
        format: "ysm",
        size: 1024,
        stats: { textures: 2, models: 1, animations: 6, texWidth: 64, texHeight: 64 },
        animGroups: [{ id: "idle", name: "待机", items: ["idle", "idle_2"] }],
        preview: { hasGui: false },
      }),
      ExtractYSMHeader: async () => ({
        isYsm: true,
        isFree: true,
        hasFree: true,
        hash: "9f2c1a7d",
        name: "Model A",
        license: "CC BY-NC-SA 4.0",
        authorName: "作者甲",
        authorRole: "建模",
      }),
    },
    // 只查 preview-content 不够:初始占位(.dp-placeholder)、解析失败错误态、
    // 真详情卡三种都带这个容器(锐评 P0-2 的 0.6% 就是错误态被当成成功)。
    // .md-row 只在真卡片里出现(占位/错误态都没有),用它把三者区分开。
    probe: { selector: "#preview-content .md-row", min: 1 },
  },
  // 事件驱动组件(锐评 P1-2 补登):不挂进页面就是一个永远没被验证的组件。
  // 由 SCENARIOS 派 menu:show 才能出画面。
  "context-menu": {
    tag: "context-menu",
    load: () => import("../src/views/context-menu/index.ts"),
    probe: { selector: '[data-testid="ctx-item"]', min: 3 },
  },
  // dialogs 是函数式 Promise API(非 Custom Element):imperative 形态直接调打开函数,
  // 不 await resolve(弹窗开着即可截图);模板注入走 views 侧 tpl(seam,ADR-208)。
  "dialog-rename": {
    probe: { selector: ".dlg-overlay .dlg-body, .dlg-overlay input", min: 1 },
    imperative: async () => {
      const { showRenameDialog } = await import("../src/features/dialogs/rename.ts");
      const { renameTpl } = await import("../src/views/app-tree/tpl-rename.ts");
      void showRenameDialog("/e2e/repo/model-a.ysm", "model-a.ysm", { tpl: renameTpl });
    },
  },
  "dialog-tag-editor": {
    probe: { selector: ".dlg-overlay .dlg-body, .dlg-overlay input", min: 1 },
    imperative: async () => {
      const { modalTagEditor } = await import("../src/features/dialogs/tag-editor.ts");
      const { tagEditorTpl } = await import("../src/views/app-tree/tpl-tag-editor.ts");
      void modalTagEditor("/e2e/repo/model-a.ysm", { tpl: tagEditorTpl });
    },
  },
  "dialog-adv-filter": {
    probe: { selector: ".dlg-overlay .dlg-body, .dlg-overlay input", min: 1 },
    imperative: async () => {
      const { modalAdvFilter } = await import("../src/features/dialogs/adv-filter.ts");
      const { advFilterTpl } = await import("../src/views/app-tree/tpl-adv-filter.ts");
      void modalAdvFilter({ tpl: advFilterTpl } as Parameters<typeof modalAdvFilter>[0]);
    },
  },
};

/** 组件挂载后的一次性场景注入:与 REGISTRY 键对应;无则空操作。
 *  场景是「把组件推到有内容的态」的手段,不是可选项——纯事件驱动组件不注入就永远是空壳。 */
const SCENARIOS: Record<string, () => void> = {
  // toast 是纯事件驱动组件,挂上去不出画面——派三条不同类型的 toast 供回看。
  "app-toast": () => {
    bus.emit("toast:show", { msg: "导入完成:3 个模型", type: "success" });
    setTimeout(
      () => bus.emit("toast:show", { msg: "同步推送完成(镜像源加速)", type: "info" }),
      150,
    );
    setTimeout(
      () => bus.emit("toast:show", { msg: "配置文件写入失败:文件被占用", type: "error" }),
      300,
    );
  },
  // 预览面板是选中驱动(model:select),不注入事件只会渲染空壳提示。
  "app-preview": () => {
    bus.emit("model:select", {
      path: "/e2e/repo/model-a.ysm",
      isDir: false,
      rtype: "ysm",
    });
  },
  // 右键菜单同理:只监听 bus "menu:show",不派事件就一个像素都不画。
  "context-menu": () => {
    bus.emit("menu:show", {
      x: 120,
      y: 80,
      items: [
        { label: "重命名", action: "rename" },
        { label: "复制到整合包", action: "push" },
        { divider: true },
        { label: "删除", action: "delete", danger: true },
      ],
    });
  },
};

// 清单单源出口:shot.mjs 打开无参页从这里读组件清单,勿在 shot.mjs 再抄一份(锐评 P2-1)。
(window as unknown as Record<string, unknown>).__harnessRegistry__ = Object.keys(REGISTRY);

/** 冻结动画:让截图不依赖固定 sleep(锐评:400ms 硬等既是假绿来源也是慢)。
 *  noAnimationsCSS 挂在 :host-context(.no-animations) 上,故须打在 <html>。 */
document.documentElement.classList.add("no-animations");

/** 在组件根内查 probe:Shadow DOM 优先,回落 light DOM。
 *  **穿透嵌套 shadow 边界**:app-content 的 .page 里挂的是 <app-tree>,树的文件行在
 *  app-tree 自己的 shadowRoot 里——只查 app-content 自己的根永远查不到,会让
 *  「页面壳在、树没数据」这种半死状态误判为就绪。故逐层下潜 shadowRoot 累加命中。 */
function countProbe(root: ParentNode, probe: Probe): number {
  const count = (n: ParentNode): number => {
    let n0 = 0;
    try {
      n0 = n.querySelectorAll(probe.selector).length;
    } catch {
      n0 = 0;
    }
    let hosts: Element[] = [];
    try {
      hosts = Array.from(n.querySelectorAll("*"));
    } catch {
      hosts = [];
    }
    for (const el of hosts) {
      const sr = (el as Element & { shadowRoot?: ShadowRoot | null }).shadowRoot;
      if (sr) n0 += count(sr);
    }
    return n0;
  };
  return count(root);
}

/** 去样式文本长度:shadowRoot.textContent 会把 <style> 内容算进去,
 *  直接量长度会把「只有 CSS 的空壳」判成有内容(知识卡里的抽验教训)。 */
function visibleTextLen(root: ParentNode): number {
  // 不能 cloneNode 整根:root 可能是 ShadowRoot,而 ShadowRoot 节点不可克隆
  // （"Failed to execute 'cloneNode' on 'Node': ShadowRoot nodes are not clonable"）。
  // 改为自行走树、跳过 style/script —— 同样达到「不把 CSS 当正文」的目的。
  let text = "";
  const walk = (n: Node): void => {
    if (n.nodeType === Node.TEXT_NODE) {
      text += n.textContent ?? "";
      return;
    }
    // DOCUMENT_NODE 也要走:弹窗挂在 document 下,只认 Element/Fragment 会让文本恒为 0
    // （dialog 三条曾因此全部误判 textLen=0 而假红）。
    if (
      n.nodeType !== Node.ELEMENT_NODE &&
      n.nodeType !== Node.DOCUMENT_FRAGMENT_NODE &&
      n.nodeType !== Node.DOCUMENT_NODE
    ) {
      return;
    }
    const tag = (n as Element).tagName;
    if (tag === "STYLE" || tag === "SCRIPT") return;
    n.childNodes.forEach(walk);
    // 穿透 shadow 边界:嵌套组件(app-content → app-tree)的正文在各自 shadowRoot 里
    const sr = (n as Element & { shadowRoot?: ShadowRoot | null }).shadowRoot;
    if (sr) sr.childNodes.forEach(walk);
  };
  walk(root as Node);
  return text.replace(/\s+/g, " ").trim().length;
}

function markReady(extra: Record<string, string> = {}): void {
  for (const [k, v] of Object.entries(extra)) document.body.setAttribute(k, v);
  document.body.setAttribute("data-ready", "1");
}

async function mountComponent(name: string): Promise<void> {
  // i18n 初始化(复刻 app-modules 启动链:setLocaleHost → initI18n 预载语言包)。
  // 隔离渲染不走完整启动链,不补这步界面会裸奔 i18n key(首轮实测教训)。
  setLocaleHost(makeLocaleHost());
  await initI18n();
  const entry = REGISTRY[name];
  const host = document.getElementById("host");
  if (entry === undefined || host === null) {
    markReady({
      "data-error": entry === undefined ? `unknown component: ${name}` : "no host",
    });
    return;
  }

  // 统一就绪判据:probe 命中 + 文本非空。两种形态共用一条出口,避免「弹窗只验 overlay
  // 存在、组件只验子元素非空」两套互不相干的标准(锐评 P1-1 的根因)。
  const settle = (root: ParentNode, what: string): void => {
    const deadline = Date.now() + 8000;
    const poll = (): void => {
      const hits = countProbe(root, entry.probe);
      const need = entry.probe.min ?? 1;
      const textLen = visibleTextLen(root);
      if (hits >= need && textLen > 0) {
        // 再让两帧动画/数据渲染落地后标记就绪。
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            const n = (root as Element).querySelectorAll?.("*").length ?? 0;
            markReady({ "data-render": `hits=${hits} text=${textLen} nodes=${n}` });
          }),
        );
        return;
      }
      if (Date.now() > deadline) {
        markReady({
          "data-error": `${what}: probe "${entry.probe.selector}" hits=${hits}/${need} textLen=${textLen}`,
        });
        return;
      }
      setTimeout(poll, 100);
    };
    poll();
  };

  // 函数式形态:执行 imperative(弹窗挂到 body 层 overlay)。
  if (entry.imperative !== undefined) {
    await entry.imperative(host);
    settle(document, "dialog");
    return;
  }
  // 覆写 binding 须在组件模块求值前生效(部分模块在顶层读绑定/建缓存)。
  for (const [k, fn] of Object.entries(entry.mock ?? {})) {
    const app = (window as unknown as { go?: { main?: { App?: Record<string, unknown> } } }).go
      ?.main?.App;
    if (app) app[k] = fn;
  }
  await entry.load();
  // 兄弟组件预载:必须在建标签前完成 define,否则 <app-tree> 是未升级的空标签
  for (const load of entry.preload ?? []) await load();
  const el = document.createElement(entry.tag);
  el.style.display = "block";
  // 属性须在 append 前写好:connectedCallback 里读 getAttribute 决定初始化分支,
  // append 之后再 setAttribute 只能走 attributeChangedCallback 的二次路径。
  for (const [k, v] of Object.entries(entry.attrs ?? {})) el.setAttribute(k, v);
  host.append(el);
  SCENARIOS[name]?.();
  // 等元素升级完成再开轮询(自定义元素 define 在动态 import 内,可能晚一拍)。
  if (!customElements.get(entry.tag)) {
    await customElements.whenDefined(entry.tag);
  }
  settle(el.shadowRoot ?? el, "component");
}

const name = new URLSearchParams(location.search).get("c") ?? "app-tree";
void mountComponent(name);
