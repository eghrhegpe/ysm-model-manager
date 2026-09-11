# ADR-226：清理 mdXx 人工命名空间前缀

- **状态**：🔄 部分采纳（提案，待 Jieling 拍板后实施）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-11
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/preview-3d/adapters/*`、`decoder/*`、`model/*`

---

## 1. 背景（Context）

`mdMm` / `mdWs` / `mdLi` / `mdMg` 人工命名空间前缀散落 **14 个真实文件（函数命中 156 处）**，是 ADR-167 按行数切片的疤痕（`md`=model，`Mm`=mmd，`Ws`=workspace，`Li`=litematic，`Mg`=modelGroup）。

实证（2026-09-11 grep 复查）：函数命中 `mdMm:56`、`mdWs:53`、`mdLi:32`、`mdMg:15`（preview-3d 内共 156）；**类型别名另计约 28 个** MdXx 前缀 interface/type（mdMm 19 在 `mmd-types.ts`、mdWs 5 在 `wasm-decode.ts`+`ysm-meta-parser.ts`、mdLi 3 在 `litematic-adapter.ts`、mdMg 1 在 `model/model-group-builder.ts`），须一并清理。

文件范围：**14 个真实文件**（初稿 15 含 `backend/web-fs-bedrock.ts:65` 注释提及 `mdWsHandleYsmJsonSpec`，系文档参照非真符号，已排除），跨 `litematic-adapter` / `mmd-adapter`(+test) / `mmd-build-*`(6) / `mmd-shared` / `mmd-types` / `decoder/wasm-decode` / `decoder/ysm-meta-parser` / `model/model-group-builder`。

人工命名空间在无模块系统时代必要；今 TS 模块作用域已天然隔离，前缀纯属噪音，且**阻碍搜索/重命名/审查**（grep `buildFoo` 命中被 `mdMmBuildFoo` 前缀吞没）。

## 2. 决策（Decision）

1. 按所属模块语义去前缀，函数名归位：
   - 模块内私有函数：直接去前缀（作用域已隔离，无冲突）。
   - 跨文件导出函数：去前缀 + **同步全部 import 站点**（配 `grep -rn "mdXx..."` 全量核对）。
2. **分批执行**，每前缀（mdMm/mdWs/mdLi/mdMg）独立提交/PR，配 `vitest run` 回归。
3. 命名归位约定（示例）：`mdMmBuildFoo` → `buildMmdFoo`（保留格式语义）；纯内部助手去前缀后用文件作用域唯一名。
4. 改名后跑 `check-binding-usage` + `check-path-hygiene`（R5/R6）确认无漏引用、无裸目录入口。

## 3. 后果（Consequences）

- **正面**：可读性↑；grep/重命名成本↓；消除切片疤痕；审查聚焦真实逻辑。
- **负面**：大型重命名（156 处/15 文件），review 负担大；导出符号改名易漏引用点致编译失败。
- **已知遗留**：`decoder/wasm-decode`、`decoder/ysm-meta-parser`、`model/model-group-builder` 属跨层符号，须逐一对账红线，不可机械批量替换。
- **风险/门禁**：每批后全量 `npm run typecheck` 复验；建议在 `git mv`/改名前先 `git status --short` 确认仅本批文件。

## 4. 数据溯源

- 来源：`grep -rho "mdXx[A-Za-z0-9_]*" frontend/src/preview-3d/` → 各前缀计数（mdMm 56 / mdWs 53 / mdLi 32 / mdMg 15）。
- 来源：`grep -rln "mdMm|mdWs|mdLi|mdMg" frontend/src/preview-3d/` → 15 文件清单。
- 结果：建议 4 批（按前缀）× 独立提交；优先低风险私有函数，后处理导出符号。
