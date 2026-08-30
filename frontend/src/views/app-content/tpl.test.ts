// @vitest-environment node
// ===== app-content 页面模板测试 =====
// 覆盖：repository/instances/settings/downloads/diagnostics/recycle/github/workshop HTML 生成
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  repositoryHTML,
  instancesHTML,
  settingsHTML,
  diagnosticsHTML,
  recycleHTML,
  githubHTML,
  workshopHTML,
} from "./tpl.ts";
import type { WailsAndroidBridge } from "../../backend/platform.ts";

const { getAndroidBridgeMock, isViewerModeMock, isWebPlatformMock } = vi.hoisted(() => ({
  getAndroidBridgeMock: vi.fn().mockReturnValue(null), // 默认桌面（无 Android 桥）
  isViewerModeMock: vi.fn().mockReturnValue(false), // 默认桌面（非查看器模式）
  isWebPlatformMock: vi.fn().mockReturnValue(false), // 默认桌面（非网页版）
}));
vi.mock("../../utils/dom/android-bridge.ts", () => ({
  getAndroidBridge: getAndroidBridgeMock,
  isViewerMode: isViewerModeMock,
}));
vi.mock("../../backend/platform-web.ts", () => ({
  isWebPlatform: isWebPlatformMock,
}));

beforeEach(() => {
  getAndroidBridgeMock.mockReturnValue(null);
  isViewerModeMock.mockReturnValue(false);
  isWebPlatformMock.mockReturnValue(false);
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
    expect(html).toContain("set-mc-path");
    expect(html).toContain("set-link-mode");
    expect(html).toContain("set-files-root");
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
    // 桌面模式展示完整偏好：主题选择器、动画开关、默认启动页、文件存储高级网格
    expect(html).toContain("theme-picker");
    expect(html).toContain("set-animations");
    expect(html).toContain("set-default-page");
    expect(html).toContain("set-advanced-grid");
    // worker 解析开关收敛到独立「解析」tab（FBX / MMD PMX 逃生舱），不在界面 tab 内
    expect(html).toContain('data-tab="parser"');
    expect(html).toContain('id="stg-tab-parser"');
    expect(html).toContain("set-fbx-worker");
    expect(html).toContain("set-mmd-worker");
    const uiTab = html.slice(html.indexOf("<!-- stg-tab-ui -->"), html.indexOf("<!-- /stg-tab-ui -->"));
    expect(uiTab).not.toContain("set-fbx-worker");
    expect(uiTab).not.toContain("set-mmd-worker");
    // 桌面模式不显示网页版 FSA 授权卡片
    expect(html).not.toContain("web-repo-auth-btn");
  });  it("diagnosticsHTML 包含诊断 Tab 与面板", () => {
    const html = diagnosticsHTML();
    expect(html).toContain('data-tab="diagnostics"');
    expect(html).toContain('id="diag-scan-conflict"');
  });

  it("recycleHTML 包含清空回收站按钮", () => {
    const html = recycleHTML();
    expect(html).toContain('id="recy-empty"');
    expect(html).toContain("清空回收站");
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
