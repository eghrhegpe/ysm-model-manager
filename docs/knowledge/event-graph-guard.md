---
kind: event-graph-guard
name: Bus 事件契约守卫
tier: leaf
category: core
source_files:
  - scripts/event-graph.ts
auto_fields:
  symbols_with_lines:
    - emitterDrift
    - readEmitterRegistry
tests:
  - tests/test_bus_contract.ts
use_when:
  - 未传参
  - 缺参
  - bus 事件
  - 事件契约
  - 事件漂移
  - 内联脚本
  - 可选链
  - 跨行调用
status: active
---
# Bus 事件契约守卫

## 概览

`scripts/event-graph.ts` 是 Bus 事件契约的唯一机器守卫：从 `frontend/src/bus.ts` 的 `BusEvents`
接口提取权威事件清单，扫描 `frontend/src/**/*.ts|js`（排除 .test.ts）与 `frontend/*.html`
内联脚本，产出 `docs/event-graph.md`（生成物，pre-commit GEN_CMDS 自动同步）。

## 核心职责（2026-08-29「未传参」审计加固）

| 异常类 | 含义 | strict 下 |
|--------|------|-----------|
| undeclared | 事件名不在 BusEvents 表（emit/on/once/off 四侧） | 硬错误 |
| missing_payload | 非 void 事件 emit 缺第二参数 ★核心 | 硬错误 |
| void_with_payload | void 事件 emit 多传 payload | 硬错误 |
| voidDrift | VOID_EVENTS 清单 vs `: void` 标记双向漂移 | 硬错误 |
| emitterAdditions | 在 `docs/.bus-emitters.json` 登记表外的文件发射了事件（ADR-270-d3） | 硬错误 |
| emitterRemovable | 在册发射文件已不再发射（可收紧登记表） | 仅提示 |
| 孤儿发射 / 鬼订阅 | emit 无订阅 / 订阅无 emit | 仅记录 |

- **可选链盲区已修**：旧版正则要求接收者后紧跟 `.`，`window.bus?.emit(...)` 整行失明——
  实证漂移：index.html 内联 `emit("nav:change")` 全项目无监听、`loading:start/end`
  幽灵监听，长期漏检。现 `\s*\??\.\s*` 兼容两种形态。
- **跨行调用盲区已修（2026-08-29 二轮）**：调用点发现曾有行级正则三件套，形状不一致
  （CALL_TAIL_RE 允许行尾 `(` 而 CALL_PARENT_RE 不允许），`bus.on(` 换行写事件名的
  跨行订阅恒漏检——实证：sync.ts 订阅 sync:download:missing 被误报孤儿发射。
  现统一为偏移法单入口（CALL_HEAD_RE 定位 + extractArgs 平衡括号取首参），
  单行/跨行/可选链全覆盖；emit 实参检查同源复用。
- **正则字面量引号陷阱已修**：回调体 `.replace(/"/g, ...)` 的裸引号曾被 extractArgs
  误当字符串边界 → 括号配对失衡 → 整条调用点丢失。现按 lexer 启发式跳过正则字面量
  （前导字符判定 + 字符类感知 + 跨行降级）。stripNoise 同步改为等宽空白替换，
  块注释不再压行，报告行号精确可导航。
- **实参计数**：偏移法平衡括号提取实参段（跨行调用可查）；argc 含事件名，
  typed 合法 ≥2、void 合法 ==1。仅校验字面量事件名 + `bus.*` 接收者（自定义 emitter 不误伤）。
- **JSON 先行**：`--json` 无论成败都输出结构化报告再定退出码（doctor/CI/测试消费）。
- `--root <dir>` 仅供测试 fixture 覆盖仓库根。

## 对外 API / 入口

```bash
node scripts/event-graph.ts                 # 生成 docs/event-graph.md
node scripts/event-graph.ts --check         # 校验生成物新鲜度（pre-push ALL_STATIC_TOOLS）
node scripts/event-graph.ts --strict        # 硬错误阻断（pre-push FRONTEND_STATIC_TOOLS 已挂）
node scripts/event-graph.ts --json          # 机读报告
node scripts/event-graph.ts --update        # 按现扫收敛登记表（只减不增）
node scripts/event-graph.ts --update --force # 显式新增登记（首次种表也必须带 --force）
```

### 合法发射者登记表（ADR-270-d3）

`docs/.bus-emitters.json` 登记 `{事件: [合法发射文件]}`（键序与数组序按码点排序），
对照 bus 扇入面把发射端冻结成在册清单：表外文件发射 → `emitterAdditions` 硬错误，
`--strict` 阻断（pre-push FRONTEND 档）。表只减不增，新增须 `--update --force` 显式登记。
`--update` 缺表时即使无增长也拒绝整表重种（误删请从 git 恢复）——
**表缺失 = 闸未武装 = 硬错误**，禁止静默缴械。

## 与其他子系统关系

- 契约事实源 = `frontend/src/bus.ts`（BusEvents + VOID_EVENTS；运行时缺参 console.warn 同源）
- 门禁挂点：`scripts/pre-push-gate.ts` 的 `ALL_STATIC_TOOLS`（--check+autoFix）与
  `FRONTEND_STATIC_TOOLS`（--strict）；契约测试 `tests/test_bus_contract.ts`
- TS 类型表只约束 .ts 调用方；html 内联 / 运行时边界靠本守卫兜底

## 不变量

- 新增事件 → 只改 bus.ts 一处（类型表 + 必要时 VOID_EVENTS），守卫自动覆盖全部调用面
- emit 非 void 事件必须带 payload；void 事件必须不带——违者 push 被闸
- 孤儿/鬼订阅是设计信号非错误：新增事件先想清楚发射方与订阅方是否成对落地
- 发射端只减不增：新增发射点须与登记表同步（`--update --force`）；登记表缺失 = 硬错误

## 相关

- [event-bus.md](event-bus.md)（bus.ts 本体）
- docs/event-graph.md（自动生成的事件图）
