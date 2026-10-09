# ADR-235-d1：sky cap 资产管线下沉（太阳位置计算 + 天空资产）——cap 变薄编排壳

- **状态**：✅ 已采纳（Accepted）
- **日期**：2026-10-09
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **关联主 ADR**：ADR-235

---

## 背景（一句）

ADR-235 §2 已指出 `sky-capability.ts` 的太阳换算 / 天空 uniform 写入越位于编排壳；对照第 1 刀（[ADR-091-d1] 环境 cap 拆分）的范式，`sky-capability.ts`（967 行）仍是「编排 + 资产 + 计算」混装——`hourToSun`/`getSunPosition`（纯计算）、`createSky`/`writeUniforms`/`applyUniform`/`applyScaledUniform`（天空资产）未独立成可直测模块。

## 决策（三行）

- **子提交 A**：太阳位置纯计算下沉 `sky-sun.ts`（`hourToSun` / `getSunPosition` / `syncSunFromTime` 换算 / sunVector 球坐标换算），零 three 依赖，cap 只调结果。
- **子提交 B**：天空资产下沉 `sky-asset.ts`（`createSky` / `writeUniforms` / `applyUniform` / `applyScaledUniform`），收拢 ShaderMaterial uniforms 读写。
- 每个子提交独立 revertible（同 ADR-091-d1 口径），cap 只留编排 + envState 回调。

## 后果（一句）

cap 行数下降、纯逻辑可叶层直测；新模块须配**判别样本双侧**（第 0 刀 [ADR-311-d1] 纪律），行为不变量与既有 sky 测试逐条对齐不回归。回退 = `git revert` 对应子提交。