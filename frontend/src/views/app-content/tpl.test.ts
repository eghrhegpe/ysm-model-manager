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
import { MIRROR_SOURCES } from "@/views/app-content/settings/settings-schema.ts";
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
    // 文件树 tab 保留（导入 tab 已从模板中移除）：viewer 退化态（声明 4 / 可见 1）tab 栏整块
    // 缺席——按钮不再在场，但面板照常产出（唯一面板 = 直接内容，无需切换语义）
    expect(html).toContain('id="repo-tab-tree"');
    expect(html).not.toContain('<button class="repo-tab');
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

  it("settingsHTML Android 查看器模式保留游戏根目录（授权入口）/本地文件存储卡，隐藏链接模式/下载镜像源卡片", () => {
    isViewerModeMock.mockReturnValue(true); // Android：查看器模式、有 Java 桥、非网页版
    getAndroidBridgeMock.mockReturnValue({ requestStoragePermission: vi.fn() } as unknown as WailsAndroidBridge);
    const html = settingsHTML();
    // 游戏根目录卡保留——安卓 viewer 是 Java 桥授权入口（点选走 requestStoragePermission + 仓库定位），严禁隐藏
    expect(html).toContain("set-mc-path");
    expect(html).toContain("set-mc-detect");
    expect(html).not.toContain("set-link-mode");
    expect(html).not.toContain("set-relink");
    // 本地文件存储路径卡片保留——Android 走 Java 桥授权与仓库定位，非网页版 FSA
    expect(html).toContain("stg-files-card");
    expect(html).toContain("set-files-root");
    expect(html).toContain("set-advanced-grid");
    // 下载镜像源卡片 Android 模式隐藏——浏览器下载走 fetchWithFallback 三路回退，不依赖该配置
    expect(html).not.toContain("set-mirror");
    expect(html).not.toContain("mirror-hint-");
    // viewer 下「环境」tab 路径段改为「文件来源」标题 + mc-path 卡（可见缺席），不再整段沉默消失；标题不含「路径配置」
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
    const envTab = panelSlice(html, "stg-tab-env", "stg-tab-appearance");
    expect(envTab).toContain(`${UI_ICONS.settings} 文件来源</div>`);
    expect(envTab).not.toContain(`${UI_ICONS.settings} 路径配置</div>`);
    expect(envTab).not.toContain('class="stg-grid"');
  });

  it("settingsHTML Android（桥存在但非网页版）渲染游戏根+本地路径卡而非 FSA 授权卡", () => {
    // 回归：仅网页版才渲染需 showDirectoryPicker 的 FSA 卡；
    // Android 有 Java 桥但 isWebPlatform=false，应渲染 files 卡，避免报"浏览器不支持 FSA"
    isViewerModeMock.mockReturnValue(true);
    isWebPlatformMock.mockReturnValue(false);
    getAndroidBridgeMock.mockReturnValue({ requestStoragePermission: vi.fn() } as unknown as WailsAndroidBridge);
    const html = settingsHTML();
    expect(html).not.toContain("web-repo-auth-btn");
    expect(html).not.toContain("stg-web-repo-card");
    // Android 作为 viewer 保留游戏根目录卡（授权入口）/本地文件路径卡，隐藏链接卡（走 Java 桥授权 + 仓库定位）
    expect(html).toContain("set-mc-path");
    expect(html).not.toContain("set-link-mode");
    expect(html).toContain("stg-files-card");
    expect(html).toContain("set-files-root");
  });

  it("settingsHTML 桌面模式包含主题选择/默认页/高级设置网格", () => {
    // tab 的 testid 由 id 派生（stg-tabbtn-* / stg-panel-*）：改名不会留下漂移的测试钩子。
    // ⚠️ 前缀不得叫 stg-tab-*：`data-testid="stg-tab-general"` 的属性文本里天然含子串
    // `id="stg-tab-general"`，按 `id="` 锚点切片（本文件 panelSlice）会先命中 tab 栏按钮
    // 而非面板 —— 2026-09 实测把切片顶到 bar 上，靠前缀岔开才消掉。
    const html = settingsHTML();
    expect(html).toContain('data-testid="stg-tabbtn-env"');
    expect(html).toContain('data-testid="stg-panel-appearance"');
    expect(html).not.toContain('data-testid="stg-tab-');
    // 方案 A：一级菜单按用户任务命名，保留四个槽位，不恢复解析/鸣谢独立入口
    // 2026-09-25 语义收债三条：槽名必须回答「这里能配什么」、键名与文案同义、
    // tab 图标不得与左侧一级导航同形（否则跨两级同形 = 同一字形两种语义）
    // ① 「常规」是零信息量抽屉（键名 settings.general 与「常规」同样脱钩）→ env / 环境
    expect(html).toContain(`data-tab="env">${UI_ICONS.folder} 环境</button>`);
    expect(html).not.toContain(`data-tab="general">${UI_ICONS.controls} 常规</button>`);
    expect(html).not.toContain(`data-tab="general">${UI_ICONS.controls} 基础设置</button>`);
    // ② 「外观」图标 = brush（绘制）：appearance（圆脸笑脸）同时是一级导航「社区」的图标
    expect(html).toContain(`data-tab="appearance">${UI_ICONS.brush} 外观</button>`);
    expect(html).not.toContain(`data-tab="appearance">${UI_ICONS.appearance} 界面与体验</button>`);
    // tab 名 2026-09 直白化：原「3D 与解析」（键名 settings.operations="操作"，键名与文案脱节）
    // → 「3D 预览」（键名 2026-10 自 settings.tab3d 再对齐 id 同名 = settings.preview3d）。
    // 回归防线：不得退回妥协拼接名
    expect(html).toContain(`data-tab="preview3d">${UI_ICONS.voxel} 3D 预览</button>`);
    expect(html).not.toContain(`data-tab="preview3d">${UI_ICONS.joystick} 3D 与解析</button>`);
    // ③ 「关于」tab 含真实设置（更新检查间隔 / 立即检查更新）→ 名字必须答「能配什么」
    expect(html).toContain(`data-tab="aboutUpdate">${UI_ICONS.info} 更新与关于</button>`);
    expect(html).not.toContain(`data-tab="about">${UI_ICONS.info} 关于</button>`);
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
    // 启动默认页属于「环境」，不属于「外观」
    const envTab = panelSlice(html, "stg-tab-env", "stg-tab-appearance");
    const uiTab = panelSlice(html, "stg-tab-appearance", "stg-tab-preview3d");
    expect(envTab).toContain('id="stg-default-page-card"');
    expect(envTab).toContain('id="set-default-page"');
    expect(uiTab).not.toContain('id="stg-default-page-card"');
    expect(uiTab).not.toContain('id="set-default-page"');
    // 语言是**显示偏好**，归「外观」而非「环境」（2026-09-25 收债：曾挂在零信息量的「常规」里）
    expect(envTab).not.toContain('id="stg-lang-card"');
    expect(uiTab).toContain('id="stg-lang-card"');
    expect(uiTab).toContain('id="set-lang"');
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
    // （允许 settings-group 带附加类，如 3D 预览首组补的 stg-section）
    expect(html).toMatch(/class="settings-group[^"]*" style="animation-delay:/);
    expect(html).toContain("set-advanced-grid");
    // 6 tab → 4 tab 收口：旧「解析」「鸣谢」tab 槽退役，id 不得残留
    expect(html).not.toContain('data-tab="parser"');
    expect(html).not.toContain('data-tab="credits"');
    expect(html).not.toContain('id="stg-tab-parser"');
    expect(html).not.toContain('id="stg-tab-credits"');
    // 3D 预览 + 解析开关收口进「3D 预览」tab
    expect(html).toContain('data-tab="preview3d"');
    expect(html).toContain('id="stg-tab-preview3d"');
    const opsTab = panelSlice(html, "stg-tab-preview3d", "stg-tab-aboutUpdate");
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
    // 「更新与关于」（含鸣谢小节）合并 tab：版本/更新检查（About 节）与鸣谢小节同页。
    // 2026-09-25 改名：旧「关于」不回答「这里能配什么」（本 tab 含真实设置）→ aboutUpdate
    expect(html).toContain('id="stg-tab-aboutUpdate"');
    const aboutTab = html.slice(html.indexOf('id="stg-tab-aboutUpdate"'));
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
    const aboutTab2 = html.slice(html.indexOf('id="stg-tab-aboutUpdate"'));
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
    // 只统计 .stg-card 自身的延迟（.settings-group 行组的页面级档位不在此断言域）
    const delays = [...html.matchAll(/class="stg-card"[^>]*?animation-delay:(\d+)ms/g)].map((m) =>
      Number(m[1]),
    );
    expect(delays.length).toBeGreaterThan(0);
    expect(delays).toContain(0);
    expect(delays).toContain(60);
    expect(delays).toContain(120);
    // 防阶梯失控：卡片延迟不得超过页面编排上限（鸣谢灵感第四卡 240ms 为当前最大卡片档）
    expect(Math.max(...delays)).toBeLessThanOrEqual(240);
  });

  it("镜像源 option/hint 由 MIRROR_SOURCES 派生：存在性随 schema，默认直连 hint 初始可见（2026-10 收债）", () => {
    const html = settingsHTML();
    // id 与 init.ts|applyMirrorHints 的 `mirror-hint-<成员>` 约定同源，缺一枚即静默断链；
    // option/hint 存在性必须随 schema 派生（此前模板手写裸列 = 「schema 有、下拉框静默没有」）
    for (const s of MIRROR_SOURCES) {
      expect(html, `镜像源 ${s} 缺 hint 块`).toContain(`id="mirror-hint-${s}"`);
    }
    // option 值域：direct 用空串（UI 层约定，init.ts|mirrorName 归一），其余用语义值
    expect(html).toMatch(/<option value="">[^<]*直连/);
    expect(html).toContain('<option value="jsdelivr">');
    expect(html).toContain('<option value="githubapi">');
    // 默认项（MIRROR_DEFAULT=direct）初始可见、其余 display:none——init 载入按实值纠正前的静态态
    expect(html).toContain('id="mirror-hint-direct" class="stg-hint-block">');
    expect(html).toContain('id="mirror-hint-jsdelivr" class="stg-hint-block" style="display:none"');
    expect(html).toContain('id="mirror-hint-githubapi" class="stg-hint-block" style="display:none"');
  });

  it("3D 预览 tab 行组 0ms 起步：行组与解析 details 两族同带（240 残锚收债）", () => {
    const html = settingsHTML();
    const p3d = panelSlice(html, "stg-tab-preview3d", "stg-tab-aboutUpdate");
    const delays = [...p3d.matchAll(/animation-delay:(\d+)ms/g)].map((m) => Number(m[1]));
    expect(delays.length).toBeGreaterThan(0);
    expect(delays).toContain(0);
    // 曾 240 起步：切 tab 白等 240ms 才见首行，且底部解析组（band 0）先亮于顶部行组（编排倒挂）。
    // 现两族统一 STG_BAND.preview3d=0 → 0/60/120 同步
    expect(Math.max(...delays)).toBeLessThanOrEqual(120);
  });

  it("3D 预览 tab 三行组已升格正典卡（2026-10 卡片流收口回归：不得回退行组范式）", () => {
    const html = settingsHTML();
    const p3d = panelSlice(html, "stg-tab-preview3d", "stg-tab-aboutUpdate");
    // 三个 3D 行（相机速度 / 旋转模式 / 键位映射）各升格为 .stg-card，带构造器产出的 hdr 标题行
    for (const id of ["stg-camspeed-card", "stg-rotmode-card", "stg-keymap-card"]) {
      expect(p3d, `3D 升卡后丢失卡片外壳 #${id}`).toContain(`id="${id}"`);
    }
    // 测试钩子（slider / select / keymap grid / reset 按钮）全保留（绑定不随升卡漂移）
    for (const id of ["td-camspeed", "td-camspeed-val", "td-rotmode", "td-keymap-grid", "td-keymap-reset"]) {
      expect(p3d, `3D 升卡后丢失绑定钩子 #${id}`).toContain(`id="${id}"`);
    }
    // 升卡后 3D 三行不再以裸 .settings-group 行组形态出现（解析 details 内的行组除外）：
    // 相机/旋转/键位三卡 body 内的 setting-row 均带 background:none（卡内透明行，避免卡中卡双层底）
    expect(p3d).toContain('class="setting-row" style="background:none');
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
  it("网页版诊断页产出「仅桌面版」告知行，且落位在首个面板之前（tablist 外的 ARIA 红线由工厂测试另钉）", () => {
    isViewerModeMock.mockReturnValue(true);
    try {
      const html = diagnosticsHTML();
      expect(html).toContain(
        '<div class="repo-tabs-notice">性能基准与仓库体检仅桌面版可用</div>',
      );
      // 成品落位：告知行直接贴在首个面板之前（tablist 外；降级态下 bar 整块缺席——
      // 告知行自包含，缺席的栏不牵连它；「缺失功能」分隔条反而更突出）
      const notice = html.indexOf('class="repo-tabs-notice"');
      const panel = html.indexOf('id="diag-tab-logs"');
      expect(notice).toBeGreaterThan(0);
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
