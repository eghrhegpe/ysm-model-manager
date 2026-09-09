// @vitest-environment node
// ===== Animation Controller 状态机测试（animation-controller.ts）=====
// 解析 .animation_controllers.json + 运行时状态转换评估。
import { describe, it, expect, vi } from "vitest";
import {
  parseAnimationControllerJSON,
  AnimationControllerRuntime,
  findControllerForAnimation,
  buildControllerAnimationIndex,
  type AnimationController,
} from "./animation-controller.ts";
import { createMolangParser } from "./molang.ts";
import * as log from "@/utils/base/primitives/log.ts";

// ── 解析 ────────────────────────────────────────

describe("parseAnimationControllerJSON 解析", () => {
  it("非法 JSON 返回解析错误", () => {
    const r = parseAnimationControllerJSON("{not json");
    expect(r.controllers).toEqual([]);
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it("缺少 animation_controllers 字段返回错误", () => {
    const r = parseAnimationControllerJSON('{"format_version":"1.17.0"}');
    expect(r.controllers).toEqual([]);
    expect(r.errors[0]).toMatch(/animation_controllers/);
  });

  it("转换目标不存在时写入 errors", () => {
    const json = `{
      "animation_controllers": {
        "player.test": {
          "states": {
            "idle": {
              "animations": ["idle"],
              "transitions": [ { "nonexistent_state": "query.anim_time >= 1" } ]
            },
            "walk": { "animations": ["walk"] }
          }
        }
      }
    }`;
    const r = parseAnimationControllerJSON(json);
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.errors.some((e) => e.includes("转换目标不存在"))).toBe(true);
    expect(r.errors.some((e) => e.includes("nonexistent_state"))).toBe(true);
  });

  it("解析状态：动画列表 / transitions / on_exit / blend_transition", () => {
    const json = `{
      "animation_controllers": {
        "player.post_main": {
          "states": {
            "idle": {
              "animations": ["idle"],
              "on_exit": ["variable.hit = 1"],
              "transitions": [ { "walk": "query.anim_time >= 1" }, { "jump": "" } ]
            },
            "walk": { "animations": ["walk"] },
            "jump": { "animations": ["jump"], "blend_transition": 0.5 }
          }
        }
      }
    }`;
    const r = parseAnimationControllerJSON(json);
    expect(r.errors).toEqual([]);
    expect(r.controllers).toHaveLength(1);

    const c = r.controllers[0];
    expect(c.name).toBe("player.post_main");
    expect(c.initialState).toBe("idle"); // 首个状态即初始状态

    const idle = c.states.get("idle")!;
    expect(idle.animations).toEqual(["idle"]);
    expect(idle.blendTransition).toBe(0.2); // 缺省 0.2s
    expect(idle.transitions).toHaveLength(2);
    // 非空条件 → unconditional=false、condition 编译成功
    expect(idle.transitions[0].target).toBe("walk");
    expect(idle.transitions[0].unconditional).toBe(false);
    expect(idle.transitions[0].condition).not.toBeNull();
    // 空表达式 → 显式无条件转换
    expect(idle.transitions[1].target).toBe("jump");
    expect(idle.transitions[1].unconditional).toBe(true);

    const jump = c.states.get("jump")!;
    expect(jump.blendTransition).toBe(0.5);

    expect(idle.onExit.length).toBe(1);
  });

});

// ── 状态机运行时 ────────────────────────────────────────

function buildController(): AnimationController {
  return parseAnimationControllerJSON(`{
      "animation_controllers": {
        "player.post_main": {
          "states": {
            "idle": {
              "animations": ["idle"],
              "on_exit": ["variable.hit = 1"],
              "transitions": [ { "walk": "query.anim_time >= 1" } ]
            },
            "walk": { "animations": ["walk"], "blend_transition": 0.3 },
            "jump": { "animations": ["jump"] }
          }
        }
      }
    }`).controllers[0];
}

describe("AnimationControllerRuntime 状态机", () => {
  it("初始状态取首帧、currentAnimation 取 animations 首位", () => {
    const rt = new AnimationControllerRuntime(buildController());
    expect(rt.current_state).toBe("idle");
    expect(rt.currentAnimation).toBe("idle");
  });

  it("时间条件未满足 → 不切换、返回 false", () => {
    const rt = new AnimationControllerRuntime(buildController());
    expect(rt.update(0.5)).toBe(false);
    expect(rt.current_state).toBe("idle");
  });

  it("时间条件满足（query.anim_time>=1）→ 切状态、触发回调、返回 true", () => {
    const changes: { name: string; blend: number }[] = [];
    const rt = new AnimationControllerRuntime(buildController(), (name, blend) => {
      changes.push({ name, blend });
    });
    expect(rt.update(1.0)).toBe(true);
    expect(rt.current_state).toBe("walk");
    expect(changes).toEqual([{ name: "walk", blend: 0.3 }]);
  });

  it("无条件转换（空表达式）总是触发", () => {
    // idle 的 jump 无条件转换在 walk 条件前，若都满足则取旧条件首个命中（walk）。
    // 单独验证 unconditional：构造只有空条件的第一条转换。
    const ctrl = parseAnimationControllerJSON(`{
      "animation_controllers": { "c": {
        "states": {
          "a": { "transitions": [ { "b": "" } ] },
          "b": { "animations": ["b"] }
        }
      }}
    }`).controllers[0];
    const rt = new AnimationControllerRuntime(ctrl);
    expect(rt.update(0)).toBe(true);
    expect(rt.current_state).toBe("b");
  });

  it("condition=null 且非 unconditional（编译失败守护）→ 跳过不触发", () => {
    // molangjs 全容错解析几乎不产生编译失败；此处直接构造 condition=null
    // 命中运行时「条件编译失败 → 跳过」防御分支（不被无条件短路）。
    const ctrl: AnimationController = {
      name: "c",
      initialState: "a",
      molangParser: createMolangParser(),
      states: new Map([
        ["a", { name: "a", animations: [], onExit: [], blendTransition: 0.2, transitions: [
          { target: "b", condition: null, raw: "(", unconditional: false },
        ] }],
        ["b", { name: "b", animations: ["b"], onExit: [], blendTransition: 0.2, transitions: [] }],
      ]),
    };
    const rt = new AnimationControllerRuntime(ctrl);
    expect(rt.update(5)).toBe(false);
    expect(rt.current_state).toBe("a");
  });

  it("转换触发时执行 on_exit（经 v.* 持久作用域可见）", () => {
    const scope: Record<string, number> = {};
    const rt = new AnimationControllerRuntime(buildController());
    rt.setMolangScope(scope); // 控制器求值段开启持久作用域（工厂实例）
    expect(rt.update(99)).toBe(true); // 触发到 walk
    rt.update(0.5); // 处于 walk，无转换
    expect(scope["variable.hit"]).toBe(1); // on_exit 写入的变量跨帧持久
  });

  it("on_exit 执行失败被静默忽略、不阻断转换", () => {
    const ctrl = parseAnimationControllerJSON(`{
      "animation_controllers": { "c": {
        "states": {
          "a": { "on_exit": ["1/0"], "transitions": [ { "b": "" } ] },
          "b": { "animations": ["b"] }
        }
      }}
    }`).controllers[0];
    const rt = new AnimationControllerRuntime(ctrl);
    expect(rt.update(0)).toBe(true); // 转换仍触发
    expect(rt.current_state).toBe("b");
  });

  it("条件表达式执行失败时写日志（logWarn）", () => {
    // 构造 condition 求值时抛错的条件
    const ctrl: AnimationController = {
      name: "c",
      initialState: "a",
      molangParser: createMolangParser(),
      states: new Map([
        ["a", { name: "a", animations: [], onExit: [], blendTransition: 0.2, transitions: [
          { target: "b", condition: () => { throw new Error("eval fail"); }, raw: "throw", unconditional: false },
        ] }],
        ["b", { name: "b", animations: ["b"], onExit: [], blendTransition: 0.2, transitions: [] }],
      ]),
    };
    const rt = new AnimationControllerRuntime(ctrl);
    const spy = vi.spyOn(log, "logWarn");
    rt.update(1);
    expect(spy).toHaveBeenCalledWith("anim-ctrl", "条件表达式执行失败", expect.anything());
    spy.mockRestore();
  });

  it("on_exit 执行失败时写日志（logWarn）", () => {
    const ctrl: AnimationController = {
      name: "c",
      initialState: "a",
      molangParser: createMolangParser(),
      states: new Map([
        ["a", { name: "a", animations: [], onExit: [() => { throw new Error("exit fail"); }], blendTransition: 0.2, transitions: [
          { target: "b", condition: null, raw: "", unconditional: true },
        ] }],
        ["b", { name: "b", animations: ["b"], onExit: [], blendTransition: 0.2, transitions: [] }],
      ]),
    };
    const rt = new AnimationControllerRuntime(ctrl);
    const spy = vi.spyOn(log, "logWarn");
    rt.update(0);
    expect(spy).toHaveBeenCalledWith("anim-ctrl", "on_exit 执行失败", expect.anything());
    spy.mockRestore();
  });

  it("reset 回到初始状态、清空 timeInState", () => {
    const rt = new AnimationControllerRuntime(buildController());
    rt.update(1.0);
    expect(rt.current_state).toBe("walk");
    rt.reset();
    expect(rt.current_state).toBe("idle");
    expect(rt.update(0.5)).toBe(false); // timeInState 已清零
  });

  it("当前状态无 animations → currentAnimation 返回空串", () => {
    const ctrl = parseAnimationControllerJSON(`{
      "animation_controllers": { "c": {
        "states": { "empty": { "transitions": [ { "e2": "" } ] }, "e2": {} }
      }}
    }`).controllers[0];
    const rt = new AnimationControllerRuntime(ctrl);
    expect(rt.currentAnimation).toBe("");
  });

  it("自环转换（A→A）不重置 timeInState、不触发 onStateChange", () => {
    const changes: string[] = [];
    const ctrl = parseAnimationControllerJSON(`{
      "animation_controllers": { "c": {
        "states": {
          "a": { "animations": ["a"], "transitions": [ { "a": "" } ] }
        }
      }}
    }`).controllers[0];
    const rt = new AnimationControllerRuntime(ctrl, (name) => { changes.push(name); });
    // 无条件自环转换应被跳过，timeInState 持续增长，不触发任何回调
    expect(rt.update(0.5)).toBe(false);
    expect(rt.update(0.5)).toBe(false);
    expect(rt.current_state).toBe("a");
    expect(changes).toEqual([]);
  });

  it("显式 initial_state 优先于首个声明状态", () => {
    const ctrl = parseAnimationControllerJSON(`{
      "animation_controllers": { "c": {
        "initial_state": "run",
        "states": {
          "idle": { "animations": ["idle"] },
          "run": { "animations": ["run"] }
        }
      }}
    }`).controllers[0];
    expect(ctrl.initialState).toBe("run");
    const rt = new AnimationControllerRuntime(ctrl);
    expect(rt.current_state).toBe("run");
    expect(rt.currentAnimation).toBe("run");
  });

  it("单字符串 on_exit 生效（与数组形态等价）", () => {
    const scope: Record<string, number> = {};
    const ctrl = parseAnimationControllerJSON(`{
      "animation_controllers": { "c": {
        "states": {
          "a": { "on_exit": "variable.done = 1", "transitions": [ { "b": "" } ] },
          "b": { "animations": ["b"] }
        }
      }}
    }`).controllers[0];
    const rt = new AnimationControllerRuntime(ctrl);
    rt.setMolangScope(scope); // 控制器求值段开启持久作用域（工厂实例）
    expect(rt.update(0)).toBe(true);
    expect(rt.current_state).toBe("b");
    expect(scope["variable.done"]).toBe(1); // 单字符串 on_exit 被正确编译执行
  });
});

// ── 控制器查找 ────────────────────────────────────────

describe("findControllerForAnimation", () => {
  it("匹配到含该动画名的控制器", () => {
    const c = buildController();
    expect(findControllerForAnimation([c], "walk")).toBe(c);
  });

  it("未匹配返回 null", () => {
    expect(findControllerForAnimation([buildController()], "nonexistent")).toBeNull();
  });
});

describe("buildControllerAnimationIndex", () => {
  it("构建动画名到控制器的映射", () => {
    const c = buildController();
    const index = buildControllerAnimationIndex([c]);
    expect(index.get("walk")).toBe(c);
    expect(index.get("nonexistent")).toBeUndefined();
  });

  it("多个控制器取首次命中", () => {
    const c1 = buildController();
    const c2 = buildController();
    const index = buildControllerAnimationIndex([c1, c2]);
    // 两个控制器都有 "walk"，应返回第一个
    expect(index.get("walk")).toBe(c1);
  });
});