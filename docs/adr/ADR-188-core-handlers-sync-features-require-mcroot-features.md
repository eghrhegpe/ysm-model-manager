# ADR-188：core/handlers 迁出内核：sync 业务归 features，require-mcroot 归 features 共享原语

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-05
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：ADR-185（core-only 收敛）、ADR-187（features/ 目录归位，同期并行落地）

---

## 1. 背景（Context）

core 锐评（2026-09-05）发现 core 目录实为「三块真内核 + 一块借宿业务 + 一块全局副作用」的混合编队：

1. **业务住进内核**：`core/handlers/sync.ts` 硬编码 `RESOURCE_TYPES.YSM`、
   自陈 mmd/vrchat 未扩展（per-type 实例目录待扩展），是整合包业务而非内核；
   而 ADR-185 已把 context-menu / pack-ops / platform 迁 features，唯独 sync 留守——迁移半途。
2. **壳层无意义**：`core/handlers/global.ts` 仅 14 行汇编壳（registerPageStore + registerSync），
   core 的生命周期实际由 `views/app-content` 驱动，内核不自治。
3. **守卫归属错位**：`core/handlers/require-mcroot.ts` 是 features 内共享原语
   （sync + pack-ops/instance-ops 双消费），放在 core/handlers 造成 features → core/handlers 反向依赖。

## 2. 决策（Decision）

- **core 只留纯内核**：`i18n/`（t/tr/locale）、`page-store.ts`、`feedback.ts`（toast 系）、
  `error-diary.ts`（全局副作用，自持注册器）。core 不再设 `handlers/` 层。
- **`core/handlers/sync.ts` → `features/sync.ts`**：与 context-menu / pack-ops / platform 同层，
  均为「bus handler + Go 绑定调用」的业务单元。
- **`core/handlers/require-mcroot.ts` → `features/require-mcroot.ts`**：features 内共享守卫原语。
- **`core/handlers/global.ts` 删壳**：`views/app-content/index.ts` 直接 import
  `registerPageStore`（core）与 `registerSync`（features）注册，汇编职责上移至编排层（与 ADR-185 口径一致）。

## 3. 后果（Consequences）

**正面**：
- core 边界自洽：内核目录内不再有业务文件，依赖方向 views → core / features → core 单向成立。
- 消除 features → `core/handlers` 的反向依赖（instance-ops）。
- 少一层无信息量的汇编壳。

**负面 / 已知遗留**：
- features 平铺文件随 ADR-187 子域化继续增多；sync 后续扩 mmd/vrchat per-type 同步时
  可考虑升格 `features/sync/` 子域（届时另行决策）。
- core/feedback 与 utils/dom/feedback 双名同存（前者 toast 系、后者 flashBtn 系），
  更名收敛另议（锐评 P4 项，本次未动）。

## 4. 数据溯源

- 锐评报告（本会话 2026-09-05）：core 1978 行，149 处外部引用直插深路径；
  `handlers/sync.ts:139` YSM 硬编码；`global.ts` 14 行壳由 `app-content/index.ts:176` 消费。
- 迁移执行：`git mv` 四文件 + `git rm` global.ts，7 个消费点 import 更新，全程 git rename 追踪。
