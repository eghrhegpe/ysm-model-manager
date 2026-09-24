// @vitest-environment node
// ===== app-content 页面模板测试 =====
// 覆盖：repository/instances/settings/downloads/diagnostics/recycle/github/workshop HTML 生成
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  repositoryHTML,
  instancesHTML,
  diagnosticsHTML,
  githubHTML,
  workshopHTML,
} from "./tpl.ts";
import { settingsHTML } from "./settings/tpl-settings.ts";
import { recycleHTML, renderRecycleListHtml } from "./tpl-recycle.ts";
import { TD_CAM_SPEED, TD_ROT_MODE } from "@/preview-3d/infra/settings-schema.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";
import type { WailsAndroidBridge } from "@/backend/platform.ts";

/** id 边界切片：定位面板起止（renderTabs 输出 id="stg-tab-xxx"） */
function panelSlice(html: string, id: string, nextId: string): string {
  const start = html.indexOf(`id="${id}"`);
  const end = html.indexOf(`id="${nextId}"`);
  return html.slice(start, end);
}

const { getAndroidBridgeMock, isViewerModeMock, isWebPlatformMock, canBindingMock } = vi.hoisted(
  () => ({
    getAndroidBridgeMock: vi.fn().mockReturnValue(null), // 默认桌面（无 Android 桥）
    isViewerModeMock: vi.fn().mockReturnValue(false), // 默认桌面（非查看器模式）
    isWebPlatformMock: vi.fn().mockReturnValue(false), // 默认桌面（非网页版）
    // 桌面能力矩阵全量（启动默认页下拉框经 navItems() → can() 读它拉取菜单项）
    canBindingMock: vi.fn().mockReturnValue(true),
  }),
);
vi.mock("@/backend/platform.ts", () => ({
  getAndroidBridge: getAndroidBridgeMock,
  isViewerMode: isViewerModeMock,
}));
vi.mock("@/backend/platform-web.ts", () => ({
  isWebPlatform: isWebPlatformMock,
  canBinding: canBindingMock,
}));

beforeEach(() => {
  getAndroidBridgeMock.mockReturnValue(null);
  isViewerModeMock.mockReturnValue(false);
  isWebPlatformMock.mockReturnValue(false);
  canBindingMock.mockReturnValue(true);
});

describe("app-content 模板", () => {
  it("repositoryHTML 包含仓库结构", () => {
    const html = repositoryHTML();
    expect(html).toContain("repo-wrap");
    // 桌面模式：回收站/查重/最旧模型 tab 均显示
    expect(html).toContain('data-tab="recycle"');
    expect(html).toContain('data-tab="dedup"');
    expect(html).toContain('data-tab="oldest"');
  });

  it("repositoryHTML 查看器模式隐藏回收站/查重/最旧模型 tab（依赖本地文件系统操作）", () => {
    isViewerModeMock.mockReturnValue(true); // 查看器模式（Android/网页版）
    const html = repositoryHTML();
    expect(html).toContain("repo-wrap");
    expect(html).not.toContain('data-tab="recycle"');
    expect(html).not.toContain('data-tab="dedup"');
    expect(html).not.toContain('data-tab="oldest"');
    // 文件树 tab 保留（导入 tab 已从模板中移除）
    expect(html).toContain('data-tab="tree"');
    isViewerModeMock.mockReturnValue(false);
  });

  it("instancesHTML 挂载 app-sidebar 与占位提示", () => {
    const html = instancesHTML();
    expect(html).toContain('<app-sidebar class="ins-sidebar"></app-sidebar>');
    expect(html).toContain("点击左侧整合包查看模型");
  });

  it("settingsHTML 包含设置面板骨架", () => {
    const html = settingsHTML();
    expect(html).toContain("settings");
    expect(html).toMatch(/<button[^>]*class="stg-path-val"[^>]*id="set-mc-path"/);
    expect(html).toMatch(/<button[^>]*class="stg-path-val"[^>]*id="set-files-root"/);
    expect(html).toMatch(/<button[^>]*class="theme-card[^"]*"[^>]*data-theme=/);
    expect(html).toContain("set-link-mode");
    // .stg-page 是设置面板唯一滚动容器；tab-body 不再重复承担 overflow。
    expect(html).not.toMatch(/class="tab-body"[^>]*style="[^"]*overflow-y:auto/);
  });

  it("解析与鸣谢使用默认收起的原生 details，worker 开关有完整可访问名称", () => {
    const html = settingsHTML();
    const parserTag = html.match(/<details[^>]*class="stg-details stg-parser-details"[^>]*>/)?.[0] ?? "";
    const creditsTag = html.match(/<details[^>]*class="stg-details stg-credits-details"[^>]*>/)?.[0] ?? "";
    expect(parserTag).not.toContain("open");
    expect(creditsTag).not.toContain("open");
    expect(html).toMatch(/<summary[^>]*class="stg-details-summary"[^>]*>[\s\S]*?解析/);
    expect(html).toMatch(/<summary[^>]*class="stg-details-summary"[^>]*>[\s\S]*?鸣谢/);

    const fbxTag = html.match(/<input[^>]*id="set-fbx-worker"[^>]*>/)?.[0] ?? "";
    const mmdTag = html.match(/<input[^>]*id="set-mmd-worker"[^>]*>/)?.[0] ?? "";
    expect(fbxTag).toContain('aria-labelledby="stg-fbx-worker-label stg-fbx-worker-action"');
    expect(fbxTag).toContain('aria-describedby="stg-fbx-worker-hint"');
    expect(mmdTag).toContain('aria-labelledby="stg-mmd-worker-label stg-mmd-worker-action"');
    expect(mmdTag).toContain('aria-describedby="stg-mmd-worker-hint"');
  });

  it("settingsHTML Android 查看器模式隐藏游戏根目录/链接模式/下载镜像源卡片，保留本地文件存储卡", () => {
    isViewerModeMock.mockReturnValue(true); // Android：查看器模式、有 Java 桥、非网页版
    getAndroidBridgeMock.mockReturnValue({ requestStoragePermission: vi.fn() } as unknown as WailsAndroidBridge);
    const html = settingsHTML();
    expect(html).not.toContain("set-mc-path");
    expect(html).not.toContain("set-mc-detect");
    expect(html).not.toContain("set-link-mode");
    expect(html).not.toContain("set-relink");
    // 本地文件存储路径卡片保留——Android 走 Java 桥授权与仓库定位，非网页版 FSA
    expect(html).toContain("stg-files-card");
    expect(html).toContain("set-files-root");
    expect(html).toContain("set-advanced-grid");
    // 下载镜像源卡片 Android 模式隐藏——浏览器下载走 fetchWithFallback 三路回退，不依赖该配置
    expect(html).not.toContain("set-mirror");
    expect(html).not.toContain("mirror-hint-");
    // viewer 下不再输出误导性的空「路径配置」区；本地存储卡仍由后续 renderStgStorageCard 产出
    expect(html).not.toContain("路径配置");
    // 语言/主题等纯前端偏好卡片保留
    expect(html).toContain("set-lang");
  });

  it("settingsHTML 网页版（isWebPlatform=true）显示网页版文件来源 FSA 授权卡片", () => {
    isViewerModeMock.mockReturnValue(true);
    isWebPlatformMock.mockReturnValue(true);
    const html = settingsHTML();
    // 网页版隐藏本地文件路径配置后，改显 FSA 授权卡片
    expect(html).toContain("stg-web-repo-card");
    expect(html).toContain("web-repo-auth-btn");
    expect(html).toContain("web-repo-auth-status");
    // 网页版只有文件来源入口，外层节标题不应继续声称可配置“路径”
    const basicTab = panelSlice(html, "stg-tab-general", "stg-tab-appearance");
    expect(basicTab).toContain(`${UI_ICONS.settings} 文件来源</div>`);
    expect(basicTab).not.toContain(`${UI_ICONS.settings} 路径配置</div>`);
    expect(basicTab).not.toContain('class="stg-grid"');
  });

  it("settingsHTML Android（桥存在但非网页版）渲染本地路径卡而非 FSA 授权卡", () => {
    // 回归：仅网页版才渲染需 showDirectoryPicker 的 FSA 卡；
    // Android 有 Java 桥但 isWebPlatform=false，应渲染 files 卡，避免报"浏览器不支持 FSA"
    isViewerModeMock.mockReturnValue(true);
    isWebPlatformMock.mockReturnValue(false);
    getAndroidBridgeMock.mockReturnValue({ requestStoragePermission: vi.fn() } as unknown as WailsAndroidBridge);
    const html = settingsHTML();
    expect(html).not.toContain("web-repo-auth-btn");
    expect(html).not.toContain("stg-web-repo-card");
    // Android 作为 viewer 隐藏游戏根/链接卡，但保留本地文件路径卡（走 Java 桥授权 + 仓库定位）
    expect(html).not.toContain("set-mc-path");
    expect(html).not.toContain("set-link-mode");
    expect(html).toContain("stg-files-card");
    expect(html).toContain("set-files-root");
  });

  it("settingsHTML 桌面模式包含主题选择/默认页/高级设置网格", () => {
    const html = settingsHTML();
    // 方案 A：一级菜单按用户任务命名，保留四个槽位，不恢复解析/鸣谢独立入口
    // 「常规」图标=controls（旋钮）：齿轮是左侧一级导航的设置入口，二级 tab 复用会层级歧义
    expect(html).toContain(`data-tab="general">${UI_ICONS.controls} 常规</button>`);
    expect(html).toContain(`data-tab="appearance">${UI_ICONS.appearance} 外观</button>`);
    // tab 名 2026-09 直白化：原「3D 与解析」（键名 settings.operations="操作"，键名与文案脱节）
    // → 「3D 预览」（键名 settings.tab3d）。回归防线：不得退回妥协拼接名
    expect(html).toContain(`data-tab="preview3d">${UI_ICONS.joystick} 3D 预览</button>`);
    expect(html).not.toContain(`data-tab="preview3d">${UI_ICONS.joystick} 3D 与解析</button>`);
    expect(html).not.toContain(`data-tab="general">${UI_ICONS.controls} 基础设置</button>`);
    expect(html).not.toContain(`data-tab="appearance">${UI_ICONS.appearance} 界面与体验</button>`);
    // 桌面模式展示完整偏好：主题选择器、动画开关、默认启动页、文件存储高级网格
    expect(html).toContain("theme-picker");
    expect(html).toContain("set-animations");
    expect(html).toContain("set-default-page");
    // 启动默认页与动画开关已升格为 .stg-card（与路径/存储/语言卡同口径）——
    // 回归防线：曾用 .settings-group 裸行组，夹在卡片间视觉断裂
    expect(html).toContain('id="stg-default-page-card"');
    expect(html).toContain('id="stg-anim-card"');
    expect(html).toContain('id="set-remember-page"');
    // 开关必须在卡片标题行（.stg-card-hdr）的 actions 里，与「游戏根目录 / 自动搜索」同构——
    // 回归防线：曾在 body 里左右各写一句同义描述（重复描述）
    const animHdr = html.slice(
      html.indexOf('id="stg-anim-card"'),
      html.indexOf('id="stg-anim-card"') + 600,
    );
    expect(animHdr).toMatch(/stg-card-hdr[\s\S]*?id="set-animations"/);
    const dpHdr = html.slice(html.indexOf('id="stg-default-page-card"'));
    expect(dpHdr).toMatch(/stg-card-hdr[\s\S]*?id="set-remember-page"/);
    // 键位网格已改为 stg-grid 工厂小卡容器（与基础设置路径卡同构），列数由响应式 CSS 决定
    expect(html).toContain('id="td-keymap-grid" class="stg-grid stg-keymap-grid"');
    // 启动默认页属于「常规」，不属于「外观」
    const basicTab = panelSlice(html, "stg-tab-general", "stg-tab-appearance");
    const uiTab = panelSlice(html, "stg-tab-appearance", "stg-tab-preview3d");
    expect(basicTab).toContain('id="stg-default-page-card"');
    expect(basicTab).toContain('id="set-default-page"');
    expect(uiTab).not.toContain('id="stg-default-page-card"');
    expect(uiTab).not.toContain('id="set-default-page"');
    // github/diagnostics/settings 可作启动页却在 UI 选不到（能力被 UI 阉割）
    const dpSel = html.slice(html.indexOf('id="set-default-page"'));
    const optVals = [...dpSel.slice(0, dpSel.indexOf("</select>")).matchAll(/<option value="([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(optVals).toEqual([
      "repository",
      "instances",
      "community",
      "github",
      "diagnostics",
      "settings",
    ]);
    // 无标题卡片组必须显式挂 stg-section，避免与上方组贴死
    expect(html).toContain("stg-section");
    // .settings-group 的常量（margin-bottom / animation）已入类，
    // 内联仅保留 animation-delay——不得再把常量手写回模板（曾 7 处副本）
    expect(html).not.toContain("margin-bottom:12px;animation:card-in");
    expect(html).toContain('class="settings-group" style="animation-delay:');
    expect(html).toContain("set-advanced-grid");
    // 6 tab → 4 tab 收口：旧「解析」「鸣谢」tab 槽退役，id 不得残留
    expect(html).not.toContain('data-tab="parser"');
    expect(html).not.toContain('data-tab="credits"');
    expect(html).not.toContain('id="stg-tab-parser"');
    expect(html).not.toContain('id="stg-tab-credits"');
    // 3D 预览 + 解析开关收口进「3D 预览」tab
    expect(html).toContain('data-tab="preview3d"');
    expect(html).toContain('id="stg-tab-preview3d"');
    const opsTab = panelSlice(html, "stg-tab-preview3d", "stg-tab-about");
    expect(opsTab).toContain('id="td-camspeed"');
    expect(opsTab).toContain('id="td-keymap-grid"');
    expect(opsTab).toContain('id="td-keymap-hint"');
    // 值域 / 默认值 / 枚举消费 preview-3d/infra/settings-schema（ADR-303）：本页曾自写
    // 一份裸字面量，与 ⚙ 面板 + 读取层三份副本漂移（改一处漏一处即拖了没反应）
    expect(opsTab).toContain(`min="${TD_CAM_SPEED.min}" max="${TD_CAM_SPEED.max}"`);
    expect(opsTab).toContain(`value="${TD_CAM_SPEED.default}"`);
    for (const mode of TD_ROT_MODE.values) {
      expect(opsTab, `旋转模式 ${mode} 未在本页产出`).toContain(`<option value="${mode}">`);
    }
    expect(uiTab).not.toContain('id="td-camspeed"');
    expect(uiTab).not.toContain('id="td-keymap-grid"');
    // worker 解析开关（FBX / MMD 逃生舱）收口进「3D 预览」tab，不在外观 tab 内
    expect(opsTab).toContain("set-fbx-worker");
    expect(opsTab).toContain("set-mmd-worker");
    expect(uiTab).not.toContain("set-fbx-worker");
    expect(uiTab).not.toContain("set-mmd-worker");
    // 「关于 + 鸣谢」合并 tab：版本/更新检查（About 节）与鸣谢小节（t("settings.credits") 节标题）同页
    expect(html).toContain('id="stg-tab-about"');
    const aboutTab = html.slice(html.indexOf('id="stg-tab-about"'));
    expect(aboutTab).toContain('id="set-version"');
    expect(aboutTab).toContain('id="set-check-update"');
    expect(aboutTab).toContain("鸣谢");
    // 正文段落原语：禁止再内联复制 `color:var(--muted);line-height:1.7` 配方（应写 class="stg-desc"）
    expect(html).not.toContain("color:var(--muted);line-height:1.7");
    expect(html).toContain('class="stg-desc"');
    // 桌面模式不显示网页版 FSA 授权卡片
    expect(html).not.toContain("web-repo-auth-btn");
  });

  it("设置页无裸样式仿卡：卡片一律走 stgCard/stgCards 构造器（2026-09 范式收债回归）", () => {
    const html = settingsHTML();
    // 裸样式仿卡配方原散落在 About 五卡 + 字体三栏 + 语言卡：各自复制
    // `background:var(--surf);border:1px solid var(--bd);border-radius:...`，与正典 .stg-card
    // 的间距/圆角/入场动画三处漂移。现已全部升格 stgCard()，此处钉死不得回退。
    expect(html).not.toContain("background:var(--surf);border:1px solid var(--bd)");
    expect(html).not.toContain("background: var(--surf);border:1px solid var(--bd)");
    // About 五卡的圆角曾用 --radius-lg，与审计 P1-2 收口后的 --radius-card 不一致
    const aboutTab2 = html.slice(html.indexOf('id="stg-tab-about"'));
    expect(aboutTab2).not.toContain("--radius-lg");
    // 每张卡必须有构造器产出的标题行（hdr 图标+标题合一，防再次漂移）
    const cardCount = [...html.matchAll(/class="stg-card"/g)].length;
    const hdrCount = [...html.matchAll(/class="stg-card-hdr"/g)].length;
    expect(cardCount).toBeGreaterThan(0);
    expect(hdrCount, "每张 .stg-card 都应带 stgCardHeader 产出的 hdr").toBe(cardCount);
    // About 页关键 id 仍需在（升格为构造器时不得丢绑定钩子）
    for (const id of ["set-version", "set-check-update", "set-update-check"]) {
      expect(aboutTab2, `About 卡升格后丢失绑定钩子 #${id}`).toContain(`id="${id}"`);
    }
  });

  it("同族卡片入场延迟由 stgCards 按序号派生，无手填阶梯漂移（2026-09 P2 回归）", () => {
    const html = settingsHTML();
    // 组内延迟 = startMs + i*step 派生：路径三卡 step 60 → 0/60/120；字体三卡 → 60/90/120
    // 只统计 .stg-card 自身的延迟（.settings-group 行组另有 240/270/300 的页级档，不在此断言域）
    const delays = [...html.matchAll(/class="stg-card"[^>]*?animation-delay:(\d+)ms/g)].map((m) =>
      Number(m[1]),
    );
    expect(delays.length).toBeGreaterThan(0);
    expect(delays).toContain(0);
    expect(delays).toContain(60);
    expect(delays).toContain(120);
    // 防阶梯失控：卡片延迟不得超过页面编排上限（语言卡 240ms 为当前最大卡片档）
    expect(Math.max(...delays)).toBeLessThanOrEqual(240);
  });
  it("diagnosticsHTML 包含诊断 Tab 与面板", () => {
    const html = diagnosticsHTML();
    // ADR-300 §2.1：三组顶层 tab（日志/基准/体检），原六 tab 收口
    expect(html).toContain('data-tab="logs"');
    expect(html).toContain('data-tab="bench"');
    expect(html).toContain('data-tab="audit"');
    // 降级不是删除：record 退成 logs 组 pill、scan 退成 bench 组 pill（§2.1），旧顶层 id 不得残留
    expect(html).not.toContain('data-tab="record"');
    expect(html).not.toContain('data-tab="scan"');
    expect(html).not.toContain('data-tab="sync-conflict"');
    expect(html).toContain('id="diag-tab-logs"');
    expect(html).toContain('id="diag-scan-health"');
    expect(html).toContain('id="diag-clear"');
    // ADR-300 §2.2：子 pill 稳定钩子由 renderSubBar 从 group+id 派生
    expect(html).toContain('data-testid="diag-sub-bench-scan"');
    expect(html).toContain('data-testid="diag-sub-audit-sync"');
    // ADR-288 D2：两个只读扫描是「常驻栏 + 结果区」两段式（栏内即入口）。
    // ⚠️ 结构不变量（按钮必须在栏内、不得住结果容器）由 conflicts/health 的 dead-end
    // 墓碑用例以真实 DOM 关系钉死；此处只做模板层存在性断言。
    expect(html).toContain('id="diag-health-bar"');
    expect(html).toContain('id="diag-sync-bar"');
    expect(html).toContain('id="diag-sync-conflict-list"');
    expect(html).toContain('class="diag-pane"');
  });
  // ===== ADR-300 S1+S2：顶层 tab 名词化 / 父子同名消解 / 子 pill 单点语法 / skipped 专用图标 =====
  it("诊断页顶层 tab 名词化，skipped chip 用专用图标不蹭闪电（桌面零告知噪音）", () => {
    const html = diagnosticsHTML();
    // 顶层「日志」让出与子 pill「操作日志」的父子同名；顶层按钮 = 图标 + 新文案
    expect(html).toContain(`data-tab="logs">${UI_ICONS.clipboard} 日志</button>`);
    expect(html).toContain(`data-tab="bench">${UI_ICONS.performance} 基准</button>`);
    expect(html).toContain(`data-tab="audit">${UI_ICONS.diagnose} 体检</button>`);
    // 子 pill 走 renderSubBar 统一标记（data-sub + 派生 testid + a11y：role=radio/aria-checked/roving），
    // 且文案不带图标（§2.3 图标预算）
    expect(html).toContain(
      '<button class="diag-sub-tab active" data-sub="op" data-testid="diag-sub-logs-op" role="radio" aria-checked="true" tabindex="0">操作日志</button>',
    );
    // 「跳过」全链路一枚 skip 图标（`tpl` chip ↔ logs.ts 行）；闪电不再兼任状态筛选
    expect(html).toContain(`data-status="skipped">${UI_ICONS.skip}`);
    expect(html).not.toContain(`data-status="skipped">${UI_ICONS.performance}`);
    // 桌面模式无任何东西被藏 → 告知行零噪音（ADR-300 §2.5）
    expect(html).not.toContain("repo-tabs-notice");
  });
  it("网页版诊断页产出「仅桌面版」告知行，且落位在 tab 栏与面板之间", () => {
    isViewerModeMock.mockReturnValue(true);
    try {
      const html = diagnosticsHTML();
      expect(html).toContain(
        '<div class="repo-tabs-notice">性能基准与仓库体检仅桌面版可用</div>',
      );
      // 成品落位：bar 之后、首个面板之前（tablist 外的 ARIA 红线由工厂测试另钉）
      const bar = html.indexOf('<div class="repo-tabs"');
      const notice = html.indexOf('class="repo-tabs-notice"');
      const panel = html.indexOf('id="diag-tab-logs"');
      expect(bar).toBeGreaterThanOrEqual(0);
      expect(notice).toBeGreaterThan(bar);
      expect(notice).toBeLessThan(panel);
    } finally {
      isViewerModeMock.mockReturnValue(false);
    }
  });
  it("日志工具栏含「操作类型」纵向筛选下拉（选项集 = OP_META 七类 + 全部）", () => {
    const html = diagnosticsHTML();
    expect(html).toContain('id="diag-log-op-filter"');
    // 七个操作类型 + 「全部」——与 logs.ts|OP_META 同源（新增操作类型时此处须同步）
    for (const op of ["all", "import", "scan", "download", "sync", "rename", "delete", "ui"]) {
      expect(html).toContain(`<option value="${op}">`);
    }
  });
  it("recycleHTML 包含清空回收站按钮", () => {
    const html = recycleHTML();
    expect(html).toContain('id="recy-empty"');
    expect(html).toContain("清空回收站");
  });

  it("renderRecycleListHtml 渲染 recy-restore / recy-del 按钮及 recy-item", () => {
    const html = renderRecycleListHtml([{ Name: "test.ysm", Path: "/mc/test.ysm", Size: 1024 }]);
    expect(html).toContain('data-testid="recy-item"');
    expect(html).toContain('data-testid="recy-restore"');
    expect(html).toContain('data-testid="recy-del"');
  });

  it("githubHTML 包含仓库网格与提示", () => {
    const html = githubHTML();
    expect(html).toContain('id="gh-grid"');
    expect(html).toContain("点击左侧仓库查看模型");
  });

  it("workshopHTML 包含站点 Tab 容器与导入导出按钮", () => {
    const html = workshopHTML();
    expect(html).toContain('id="ws-tabs"');
    expect(html).toContain('id="ws-export-btn"');
    expect(html).toContain('id="ws-import-btn"');
  });
});
