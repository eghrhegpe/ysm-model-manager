// ===== app-content 页面模板测试 =====
// 覆盖：repository/instances/settings/downloads/diagnostics/recycle/github/workshop HTML 生成
import { describe, it, expect } from "vitest";
import {
  repositoryHTML,
  instancesHTML,
  settingsHTML,
  downloadsHTML,
  diagnosticsHTML,
  recycleHTML,
  githubHTML,
  workshopHTML,
} from "./tpl.ts";

describe("app-content 模板", () => {
  it("repositoryHTML 包含仓库结构", () => {
    expect(repositoryHTML()).toContain("repo-wrap");
  });

  it("instancesHTML 挂载 app-sidebar 与占位提示", () => {
    const html = instancesHTML();
    expect(html).toContain('<app-sidebar class="ins-sidebar"></app-sidebar>');
    expect(html).toContain("instances.emptyHint");
  });

  it("settingsHTML 包含设置面板骨架", () => {
    const html = settingsHTML();
    expect(html).toContain("settings");
  });

  it("downloadsHTML 包含导入表单与拖拽区", () => {
    const html = downloadsHTML();
    expect(html).toContain('id="dl-import"');
    expect(html).toContain("拖拽模型文件");
    expect(html).toContain('id="dl-queue-count"');
  });

  it("diagnosticsHTML 包含诊断 Tab 与面板", () => {
    const html = diagnosticsHTML();
    expect(html).toContain('data-tab="diagnostics"');
    expect(html).toContain('id="diag-scan-conflict"');
  });

  it("recycleHTML 包含清空回收站按钮", () => {
    const html = recycleHTML();
    expect(html).toContain('id="recy-empty"');
    expect(html).toContain("recycle.empty");
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
