// ===== Bedrock Animation Controller 解析 + 状态机（wine_fox 等模型支持）=====
// 解析 .animation_controllers.json，构建状态机图，每帧评估转换条件。
// 与 animation.ts 的 Timeline 事件配合：Timeline 写 v.* 变量，Controller 读变量决定状态切换。

import { logWarn } from "@/utils/base/log.ts";
import { createMolangParser, type MolangFn, type MolangParser } from "./molang.ts";

// ── 类型定义 ────────────────────────────────────────

/** 状态转换定义 */
export interface ControllerTransition {
  /** 目标状态名 */
  target: string;
  /** 编译后的 Molang 条件闭包（返回 0/非0）；null = 无条件或编译失败，由 unconditional 区分 */
  condition: MolangFn | null;
  /** 原始条件表达式（调试用） */
  raw: string;
  /** 是否显式无条件转换（空表达式）：true 时总是触发；false 且 condition 为 null = 编译失败，跳过 */
  unconditional: boolean;
}

/** 单个状态定义 */
export interface ControllerState {
  /** 状态名 */
  name: string;
  /** 该状态播放的动画名列表（按序） */
  animations: string[];
  /** 离开状态时执行的 Molang 动作（如 v.next_idle = 0） */
  onExit: MolangFn[];
  /** 转换列表（按数组顺序评估，首个满足条件的触发） */
  transitions: ControllerTransition[];
  /** 状态间过渡时间（秒） */
  blendTransition: number;
}

/** 动画控制器（状态机） */
export interface AnimationController {
  /** 控制器名（如 player.post_main） */
  name: string;
  /** 所有状态 */
  states: Map<string, ControllerState>;
  /** 初始状态名 */
  initialState: string;
  /** 独立 Molang 解析器实例（工厂模式，根除多播放器 activeScope 互盖） */
  molangParser: MolangParser;
}

// ── 解析 ────────────────────────────────────────

/**
 * 解析 Bedrock Animation Controller JSON
 * @param jsonStr .animation_controllers.json 文件内容
 * @returns 解析结果：controllers + 错误列表
 */
export function parseAnimationControllerJSON(jsonStr: string): {
  controllers: AnimationController[];
  errors: string[];
} {
  const errors: string[] = [];
  let root: { format_version?: string; animation_controllers?: Record<string, unknown> };
  try {
    root = JSON.parse(jsonStr);
  } catch (e) {
    return { controllers: [], errors: [`JSON 解析失败: ${(e as Error).message}`] };
  }

  const acs = root?.animation_controllers;
  if (!acs || typeof acs !== "object") {
    return { controllers: [], errors: ["缺少 animation_controllers 字段"] };
  }

  const controllers: AnimationController[] = [];

  for (const [controllerName, controllerRaw] of Object.entries(acs)) {
    if (!controllerRaw || typeof controllerRaw !== "object") continue;
    const controllerObj = controllerRaw as {
      states?: Record<string, unknown>;
      initial_state?: string;
    };
    const statesRaw = controllerObj.states;
    if (!statesRaw || typeof statesRaw !== "object") continue;

    const states = new Map<string, ControllerState>();

    // 每个控制器持有独立 Molang 解析器实例（工厂模式，根除多播放器 activeScope 互盖）
    const localParser = createMolangParser();

    for (const [stateName, stateRaw] of Object.entries(statesRaw)) {
      if (!stateRaw || typeof stateRaw !== "object") continue;
      const stateObj = stateRaw as {
        animations?: string[];
        on_exit?: string[];
        transitions?: Array<Record<string, string>>;
        blend_transition?: number;
      };

      // 解析动画名
      const animations = Array.isArray(stateObj.animations) ? stateObj.animations : [];

      // 解析 on_exit 动作（容错：单字符串与数组形态均支持，与 transitions 一致）
      const onExit: MolangFn[] = [];
      const rawExit = stateObj.on_exit;
      const exitExprs = Array.isArray(rawExit)
        ? rawExit
        : typeof rawExit === "string"
          ? [rawExit]
          : [];
      for (const expr of exitExprs) {
        if (typeof expr === "string") {
          // 使用控制器自有 parser 实例编译（工厂模式，隔离多播放器作用域）
          const fn = localParser.compileMolang(expr);
          if (fn) onExit.push(fn);
        }
      }

      // 解析转换条件
      const transitions: ControllerTransition[] = [];
      if (Array.isArray(stateObj.transitions)) {
        for (const transRaw of stateObj.transitions) {
          if (!transRaw || typeof transRaw !== "object") continue;
          // 转换格式: { "targetState": "conditionExpression" }
          for (const [target, condExpr] of Object.entries(transRaw)) {
            if (typeof condExpr !== "string") continue;
            // 空表达式 = 显式无条件转换（总是触发）；非空但编译失败 = 条件非法，
            // 运行期跳过不触发（不 fail-open），并上报错误便于排查。
            const unconditional = condExpr.trim() === "";
            const condition = localParser.compileMolang(condExpr);
            if (!unconditional && !condition) {
              errors.push(
                `[${controllerName}.${stateName}] 转换条件编译失败: ${target} → ${condExpr}`,
              );
            }
            transitions.push({ target, condition, raw: condExpr, unconditional });
          }
        }
      }

      const blendTransition =
        typeof stateObj.blend_transition === "number" ? stateObj.blend_transition : 0.2; // 默认 0.2s

      states.set(stateName, {
        name: stateName,
        animations,
        onExit,
        transitions,
        blendTransition,
      });
    }

    // 校验转换目标 ∈ states（防静默跳过）：不在 states 的 target 写入 errors
    for (const [stateName, state] of states) {
      for (const trans of state.transitions) {
        if (!states.has(trans.target)) {
          errors.push(`[${controllerName}.${stateName}] 转换目标不存在: ${trans.target}`);
        }
      }
    }

    // 初始状态优先级：显式 initial_state > "default" > 首个声明状态
    let initialState: string | null = null;
    if (
      typeof controllerObj.initial_state === "string" &&
      states.has(controllerObj.initial_state)
    ) {
      initialState = controllerObj.initial_state;
    } else if (states.has("default")) {
      initialState = "default";
    } else {
      initialState = states.keys().next().value ?? null;
    }

    if (states.size > 0 && initialState) {
      controllers.push({
        name: controllerName,
        states,
        initialState,
        molangParser: localParser,
      });
    }
  }

  return { controllers, errors };
}

// ── 状态机运行时 ────────────────────────────────────────

/**
 * 动画控制器运行时：维护当前状态，每帧评估转换条件。
 * 与 YsmAnimPlayer 配合：Controller 决定播放哪个 clip，Player 负责实际渲染。
 */
export class AnimationControllerRuntime {
  private controller: AnimationController;
  private currentState: ControllerState;
  private currentAnimIndex = 0;
  private timeInState = 0;
  /** 状态切换回调 */
  private onStateChange?: ((animationName: string, blendTime: number) => void) | undefined;

  constructor(
    controller: AnimationController,
    onStateChange?: (animationName: string, blendTime: number) => void,
  ) {
    this.controller = controller;
    // biome-ignore lint/style/noNonNullAssertion: 确定性断言(构建期不变量/窄化逃生)
    this.currentState = controller.states.get(controller.initialState)!;
    this.onStateChange = onStateChange;
  }

  /** 获取当前状态名 */
  get current_state(): string {
    return this.currentState.name;
  }

  /** 获取当前播放的动画名 */
  get currentAnimation(): string {
    const anims = this.currentState.animations;
    return anims.length > 0 ? anims[this.currentAnimIndex % anims.length] : "";
  }

  /** 获取当前状态的混合过渡时间 */
  get blendTransition(): number {
    return this.currentState.blendTransition;
  }

  /**
   * 设置/清除当前控制器的持久变量作用域（委托给自有 parser 实例）。
   * @param scope 每播放器 v.* 变量容器；传 null 恢复默认
   */
  setMolangScope(scope: Record<string, number> | null): void {
    this.controller.molangParser.setScope(scope);
  }

  /**
   * 每帧更新：评估转换条件，必要时切换状态。
   * v.* 变量经控制器自有 parser 实例的 setScope 持久作用域读取（timeline 写入跨帧可见），
   * 此处不再接收变量快照。
   * @param dt 帧间隔（秒）
   * @returns 是否发生了状态切换
   */
  update(dt: number): boolean {
    this.timeInState += dt;

    // 评估当前状态的转换条件
    for (const trans of this.currentState.transitions) {
      let conditionMet = false;
      if (trans.condition) {
        try {
          // 用 timeInState 作为 anim_time：时间条件（query.anim_time >= 1）才能触发
          conditionMet = trans.condition(this.timeInState) !== 0;
        } catch (err) {
          logWarn("anim-ctrl", "条件表达式执行失败", err);
        }
      } else if (trans.unconditional) {
        // 显式无条件转换（空表达式）：总是触发
        conditionMet = true;
      }
      // else: 条件编译失败 → 跳过不触发（不再 fail-open 成无条件转换）

      if (conditionMet) {
        // 自环转换（A→A）跳过：避免每帧 onExit → 切自身 → timeInState 归零 → 下帧再触发，
        // 导致 onStateChange 轰炸播放器。
        if (trans.target === this.currentState.name) continue;

        // 执行当前状态的 on_exit 动作
        for (const fn of this.currentState.onExit) {
          try {
            fn(0);
          } catch (err) {
            logWarn("anim-ctrl", "on_exit 执行失败", err);
          }
        }

        // 切换到目标状态
        const targetState = this.controller.states.get(trans.target);
        if (targetState) {
          this.currentState = targetState;
          this.currentAnimIndex = 0;
          this.timeInState = 0;

          // 通知播放器切换动画
          if (this.onStateChange) {
            this.onStateChange(this.currentAnimation, targetState.blendTransition);
          }

          return true;
        }
      }
    }

    return false;
  }

  /** 重置到初始状态 */
  reset(): void {
    // biome-ignore lint/style/noNonNullAssertion: 确定性断言(构建期不变量/窄化逃生)
    this.currentState = this.controller.states.get(this.controller.initialState)!;
    this.currentAnimIndex = 0;
    this.timeInState = 0;
  }
}

/**
 * 构建动画名 → 控制器的索引。
 * O(n×m) 一次性构建，后续查找 O(1)。
 * wine_fox 等模型有 10+ 控制器、每控制器 5+ 状态时，
 * 每次切换动画从全量扫描改为直接命中。
 */
export function buildControllerAnimationIndex(
  controllers: AnimationController[],
): Map<string, AnimationController> {
  const index = new Map<string, AnimationController>();
  for (const ctrl of controllers) {
    for (const state of ctrl.states.values()) {
      for (const animName of state.animations) {
        // 只记录首次命中（与 findControllerForAnimation 语义一致）
        if (!index.has(animName)) {
          index.set(animName, ctrl);
        }
      }
    }
  }
  return index;
}

/**
 * 从多个控制器中查找匹配指定动画名的控制器（便捷入口，单次查找）。
 * wine_fox 等模型的控制器名通常与动画文件名对应。
 *
 * 实现是单遍早退线性扫描：命中即返回，通常远快于全量构建索引。
 * 需要对同一批 controllers 做多次查找的调用方，应自行用
 * buildControllerAnimationIndex 构建一次索引后复用（真正的 O(1) 命中）——
 * 在本函数内每次调用重建索引是 O(n×m) + Map 分配，严格劣于早退扫描
 * （code_review b9fdfffbe：旧「O(1)」注释与实现相悖，已更正）。
 */
export function findControllerForAnimation(
  controllers: AnimationController[],
  animationName: string,
): AnimationController | null {
  for (const ctrl of controllers) {
    for (const state of ctrl.states.values()) {
      if (state.animations.includes(animationName)) return ctrl;
    }
  }
  return null;
}
