// ===== 能力持久化·存档恢复工具箱（拆轴自 scene-capability.ts，锐评 2026-10-07 #6）=====
// 收口「巨型 scene-capability.ts 混装接口 + 工具」锐评结论：本文件收敛 cap 通用持久化基建
// （FieldKind / FieldRestorer / oneOf / restoreFields / bindFieldRestorers /
// pickPersistFields）——**零依赖纯 TS 叶**（仿 env-pixels.ts / environment-ownership.ts 的
// 零依赖叶范式）；scene-capability.ts 只保留能力接口 + localStorage IO（persistState /
// restoreState）。消费方（各 cap 的 saveState/loadState）直引本叶，
// scene-capability.ts 不再承载工具箱，fan-in 回归接口本分。
// （原第 5 个工具 restoreBySchema 已随锐评 2026-10-08 P1-0/P3-1 下沉 water-persist.ts
// ——它是 water-only 消费方的暗特化，本零依赖叶不接 envState 运行时依赖。）

/** 持久化字段种别：普通字段按 typeof 分发；枚举字段走 oneOf 白名单 */
export type FieldKind = "number" | "boolean" | { oneOf: readonly string[] };

/**
 * 持久化种别表绑定到目标对象，生成 restoreFields 的 restorer 表（表驱动持久化基建，
 * 2026-09 锐评 P2-1：params 接口 + 种别表两处互锁后，save/load 自动跟随，四处手工同步收敛为两处）。
 * 对 target 的写入用一次受控宽化 cast——运行时安全由 restoreFields 的 typeof 分发保证：
 * restorer 只在存档值类型与种别匹配时被调用，写入类型必然正确。
 */
export function bindFieldRestorers<P extends object>(
  target: P,
  spec: { [K in keyof P]?: FieldKind },
): Record<string, FieldRestorer> {
  const out: Record<string, FieldRestorer> = {};
  const writable = target as unknown as Record<string, number | boolean | string>;
  for (const key of Object.keys(spec) as Array<keyof P & string>) {
    const kind = spec[key];
    if (kind === undefined) continue;
    if (kind === "number") {
      out[key] = {
        number: (v) => {
          writable[key] = v;
        },
      };
    } else if (kind === "boolean") {
      out[key] = {
        boolean: (v) => {
          writable[key] = v;
        },
      };
    } else {
      out[key] = oneOf(kind.oneOf, (v) => {
        writable[key] = v;
      });
    }
  }
  return out;
}

/** 按种别表键集从 source 导出白名单对象（saveState 的表驱动形态，键集与表恒等） */
export function pickPersistFields<P extends object>(
  source: P,
  spec: { [K in keyof P]?: FieldKind },
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(spec) as Array<keyof P & string>) {
    out[key] = source[key];
  }
  return out;
}

/** 单字段恢复器：按存档值的实际类型分派，类型不匹配则跳过（等价于手写 typeof 守卫） */
export interface FieldRestorer {
  number?: (v: number) => void;
  boolean?: (v: boolean) => void;
  string?: (v: string) => void;
  /**
   * 枚举白名单：值为 string 且命中 values 才 apply（取代手写
   * `typeof v === "string" && (v === "a" || v === "b")` 的枚举守卫）。
   * 与 string 同配时 string 优先（oneOf 仅作缺省的受约束分发）。
   */
  oneOf?: { values: readonly string[]; apply: (v: string) => void };
}

/**
 * 枚举白名单恢复器工厂：保持调用方零断言（apply 收到窄化后的枚举类型）。
 * apply 的宽化断言收敛在这一处——运行时分发前已过 `values.includes` 校验，
 * 传入 v 必然 ∈ values，断言不引入不安全。
 */
export function oneOf<T extends string>(
  values: readonly T[],
  apply: (v: T) => void,
): FieldRestorer {
  return { oneOf: { values, apply: apply as (v: string) => void } };
}

/**
 * 类型安全的字段批量恢复器（取代各 cap `loadState` 里逐行手写的
 * `if (typeof state.x === "number") this.params.x = state.x;`）。
 *
 * 收敛动机：该样板在 ground / sky / water 等 cap 之间构成 jscpd 10 行级重复块
 * （`ground-capability#sky-capability` 等），且每新增一个持久化字段就多复制一行。
 *
 * @returns 至少一个字段成功回填 true；无存档、或存档值全部类型不匹配（含损坏数据）
 *   返回 false——「无存档」与「有存档但什么都没恢复」对调用方是同一早退语义。
 */
/** 线性雾近/远端的最小景深跨度（锐评 X-2 2026-10-04）。
 * 下沉自 fog-capability.ts——断开 fog-capability ↔ fog-menu 的循环依赖边：
 * fog-menu 原本值导入 normalizeFogRange（运行时边），使两文件互相 import；纯函数落到本零依赖
 * 叶后，fog-menu 不再对 fog-capability 产生运行时依赖边。FOG_MIN_DEPTH 仅本文件内
 * normalizeFogRange 引用，刻意不 export（无外部消费者，避免新增未用导出被 deadcode 基线捕获）。 */
const FOG_MIN_DEPTH = 1;

/**
 * 线性雾跨字段规范化（锐评 X-2 2026-10-04）：逐字段 schema `range` 管不到 near/far 的关系
 * （`fogNear ∈ [0,500]`、`fogFar ∈ [10,2000]` 各自合法，`near=500 / far=10` 却可同时成立），
 * 而 three 线性雾的 GLSL 插值 `smoothstep(fogNear, fogFar, d)` 在 `edge0 ≥ edge1` 时进入未定义域。
 * 规则：**far 至少比 near 大 `FOG_MIN_DEPTH`**；near 原样透传。
 * ⚠️ 这是消费点规范化：envState 仍存用户原值（面板显示原值）。「显示值 ≠ 生效值」的出口
 * （far 滑杆挂 `getHint`）登记在 `docs/archive/audit-water-critique.md` §七 X-2，未接。
 */
export function normalizeFogRange(near: number, far: number): { near: number; far: number } {
  return { near, far: Math.max(far, near + FOG_MIN_DEPTH) };
}

/** 单字段恢复分派：按类型走对应 restorer（number/boolean/string，string 优先 exact 再 oneOf） */
function restoreFieldByType(v: unknown, restorer: FieldRestorer): boolean {
  if (typeof v === "number") {
    if (restorer.number) {
      restorer.number(v);
      return true;
    }
  } else if (typeof v === "boolean") {
    if (restorer.boolean) {
      restorer.boolean(v);
      return true;
    }
  } else if (typeof v === "string") {
    if (restorer.string) {
      restorer.string(v);
      return true;
    }
    if (restorer.oneOf?.values.includes(v)) {
      restorer.oneOf.apply(v);
      return true;
    }
  }
  return false;
}

export function restoreFields(
  state: Record<string, unknown> | null,
  spec: Record<string, FieldRestorer>,
): boolean {
  if (!state) return false;
  let applied = false;
  for (const [key, restorer] of Object.entries(spec)) {
    if (restoreFieldByType(state[key], restorer)) applied = true;
  }
  return applied;
}
