#!/usr/bin/env node
/**
 * migrate-quick-groups.ts — 一次性迁移：quick_groups 野生组名 → 规范词表（2026-10-05 治理）。
 *
 * 背景：quick_groups 原是每卡自由文本，80 个组名里 69 个只挂 1 张卡。本脚本按
 * RENAMES 映射表把全库卡片 frontmatter 的 quick_groups 块改写为规范词表
 * （scripts/_lib/knowledge-cards.ts QUICK_GROUPS，14 组），改写后去重保序。
 * 词表既不映射也不在词表内的组名 → 记 problem 并 exit 1（不允许静默丢组）。
 * 迁移完成后本脚本留档 artifacts/ 作为映射关系的审计记录，不再重跑。
 */
import fs from "node:fs";
import path from "node:path";
import { QUICK_GROUPS } from "../scripts/_lib/knowledge-cards.ts";

/** 旧组名 → 规范组名（10 个规范名已是现役大组，不在表内 = 原样保留）。 */
const RENAMES: Record<string, string> = {
  // → 3D 预览与模型追加（3D 全家桶：渲染/菜单/相机/纹理/解析/程序化贴图）
  "3D 渲染与预览核心": "3D 预览与模型追加",
  "3D 预览菜单系统": "3D 预览与模型追加",
  "3D 预览面板与模型追加": "3D 预览与模型追加",
  "3D spec 渲染与模型追加": "3D 预览与模型追加",
  多模型同框与场景管理: "3D 预览与模型追加",
  "骨骼/几何渲染层": "3D 预览与模型追加",
  相机与漫游控制: "3D 预览与模型追加",
  纹理缓存与渲染性能调优: "3D 预览与模型追加",
  "preview-3d": "3D 预览与模型追加",
  "pack 模型光照": "3D 预览与模型追加",
  地面材质: "3D 预览与模型追加",
  程序化贴图: "3D 预览与模型追加",
  噪声生成: "3D 预览与模型追加",
  骨骼与几何校正: "3D 预览与模型追加",
  "UV / 贴图定位": "3D 预览与模型追加",
  预览渲染与反推: "3D 预览与模型追加",
  预览状态层契约: "3D 预览与模型追加",
  "WASM 解析器维护": "3D 预览与模型追加",
  缓存: "3D 预览与模型追加",
  // → 后端桥接与数据存储（Wails/网页版/平台路由/CLI 桥）
  "CLI 桥": "后端桥接与数据存储",
  参数序列化: "后端桥接与数据存储",
  后端桥接与运行时: "后端桥接与数据存储",
  后端桥接与平台路由: "后端桥接与数据存储",
  "网页版与 IndexedDB": "后端桥接与数据存储",
  平台检测与模式路由: "后端桥接与数据存储",
  "IndexedDB 模型库": "后端桥接与数据存储",
  // → UI 交互与弹窗（弹窗家族/toast/图标治理）
  "toast 收债": "UI 交互与弹窗",
  业务对话框: "UI 交互与弹窗",
  "emoji 摸排 / UI_ICONS 消费 / 孤儿图标 / 迁移残留": "UI 交互与弹窗",
  // → 配置与注册表
  资源类型与仓库状态: "配置与注册表",
  // → 文件操作与标签（导入/拖拽/目录选择/文件排障）
  拖拽导入与平台适配: "文件操作与标签",
  跨平台目录选择与路径解析: "文件操作与标签",
  "排查「读正常写拒绝」类雷霆：先做「换位置」对照实验（仓内 vs 仓外），再查 ACL/令牌/安全软件记录":
    "文件操作与标签",
  // → 下载与社区（新建桶）
  创意工坊下载: "下载与社区",
  社区与创意工坊: "下载与社区",
  // → 前端分层与边界（新建桶：seam/边界/守卫/命名/解析簇/全局状态）
  边界与豁免: "前端分层与边界",
  前端分层: "前端分层与边界",
  代际守卫: "前端分层与边界",
  状态管理: "前端分层与边界",
  命名与可读性: "前端分层与边界",
  黑话治理: "前端分层与边界",
  解析与数据: "前端分层与边界",
  // → 重构与域切分（新建桶：重构方法论/Go 域切分经验）
  重构: "重构与域切分",
  "install: queue / linkMode / launcher": "重构与域切分",
  "shared (不迁): logger / runtimeLogs / scan cache / config": "重构与域切分",
  // → 门禁与脚本（工具链/钩子/CI/lint/覆盖率/jscpd/lib-adoption）
  门禁: "门禁与脚本",
  提交与钩子: "门禁与脚本",
  "门禁集成与 pre-push 流程": "门禁与脚本",
  门禁与脚本: "门禁与脚本",
  工具与门禁: "门禁与脚本",
  静态分析: "门禁与脚本",
  "Go 覆盖率": "门禁与脚本",
  Go: "门禁与脚本",
  脚本治理与文档一致性: "门禁与脚本",
  "baseline 维护与冻结策略": "门禁与脚本",
  重复对详情定位: "门禁与脚本",
  搬迁漂移研判与豁免决策: "门禁与脚本",
  "新增/调整守护规则（RULES 表）": "门禁与脚本",
  违规研判与误报排除: "门禁与脚本",
  "共享层自身收敛（_lib 内手搓）": "门禁与脚本",
  采用率全景解读: "门禁与脚本",
  构建与发版: "门禁与脚本",
  // → 测试与验证（新建桶：e2e/菜单测试/parity/测试工具箱）
  视觉验证: "测试与验证",
  "菜单测试 / cap 节点树断言 / 布局快照债务": "测试与验证",
  契约对拍: "测试与验证",
  双端互锁: "测试与验证",
  "testid 查询与元素选择": "测试与验证",
  "异步等待策略与 flaky 治理": "测试与验证",
  "事件模拟（fire 系列）": "测试与验证",
  "组件挂载/卸载编排": "测试与验证",
  异步等待进阶: "测试与验证",
};

const KNOW = path.resolve(import.meta.dirname, "..", "docs", "knowledge");
const NON_CARDS = new Set(["index.md", "README.md", "AGENTS.md", "routes.md", "routes-quick.md"]);
const CANON = new Set(QUICK_GROUPS);

// 与 gen-routes-quick 同款 status 闸：draft/snapshot/superseded 卡不进路由表，
// 是冻结快照——治理不搅动它们（日后翻 active 时词表外组名会被生成器 WARN 拦下）。
function isActiveCard(text: string): boolean {
  const m = text.match(/^---\r?\n[\s\S]*?\r?\n---/);
  if (!m) return false;
  const sm = m[0].match(/^status:\s*(.+)\s*$/m);
  return !sm || sm[1]!.trim() === "active";
}

let changed = 0;
let skipped = 0;
const problems: string[] = [];
for (const f of fs.readdirSync(KNOW).filter((f) => f.endsWith(".md") && !NON_CARDS.has(f))) {
  const p = path.join(KNOW, f);
  const text = fs.readFileSync(p, "utf8");
  if (!isActiveCard(text)) {
    skipped++;
    continue;
  }
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(eol);
  const gi = lines.indexOf("quick_groups:");
  if (gi === -1) {
    skipped++;
    continue;
  }
  let end = gi + 1;
  const items: string[] = [];
  while (end < lines.length && /^ {2}- \S/.test(lines[end]!)) {
    items.push(lines[end]!.slice(4).trim());
    end++;
  }
  if (!items.length) {
    problems.push(`${f}: quick_groups: 块为空或格式非列表`);
    continue;
  }
  const mapped: string[] = [];
  let dirty = false;
  for (const it of items) {
    const g = RENAMES[it] ?? it;
    if (!RENAMES[it] && !CANON.has(it)) problems.push(`${f}: 词表外且无映射的组名: ${it}`);
    if (!mapped.includes(g)) mapped.push(g);
    if (g !== it) dirty = true;
  }
  if (mapped.length !== items.length) dirty = true;
  if (!dirty) {
    skipped++;
    continue;
  }
  const newLines = [
    ...lines.slice(0, gi + 1),
    ...mapped.map((g) => `  - ${g}`),
    ...lines.slice(end),
  ];
  fs.writeFileSync(p, newLines.join(eol));
  changed++;
  console.log(`${f}: [${items.join(" | ")}] → [${mapped.join(" | ")}]`);
}
console.log(`\n改写 ${changed} 卡，无变化跳过 ${skipped}，异常 ${problems.length}`);
for (const pr of problems) console.log(`⚠ ${pr}`);
process.exit(problems.length ? 1 : 0);
