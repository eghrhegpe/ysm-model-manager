#!/usr/bin/env node
/**
 * test_check_params.ts — 参数陷阱扫描器契约测试。
 *
 * 锁 `check-params.ts` 核心纯函数，深绑定生产实现，防「测试手抄」漂移：
 *   - trapScore：陷阱分 = params + boolParams（bool 另 +1 加重 → 权重 2）。
 *   - trapTier：分级边界。
 *   - trapReasons：长参数 / 布尔陷阱触发理由与门槛。
 *
 * 运行：node tests/test_check_params.ts（失败 exit 1；契约 runner 收集）。
 */
import assert from "node:assert/strict";
import { trapScore, trapTier, trapReasons } from "../scripts/check-params.ts";

// ─── 1) trapScore：bool 加权重 ──────────────────────────
{
  assert.equal(trapScore(6, 0), 6, "6 参 0 bool = 6");
  assert.equal(trapScore(4, 2), 6, "4 参 + 2 bool = 6（bool 各 +1 加重）");
  assert.equal(trapScore(0, 0), 0, "空参数 = 0");
}

// ─── 2) trapTier：分级边界（threshold=6）───────────────
{
  assert.equal(trapTier(5, 6), "clean", "5<6 clean");
  assert.equal(trapTier(6, 6), "yellow", "6=阈值 yellow");
  assert.equal(trapTier(11, 6), "yellow", "11<2*6 yellow");
  assert.equal(trapTier(12, 6), "orange", "12=2*6 orange");
  assert.equal(trapTier(17, 6), "orange", "17<3*6 orange");
  assert.equal(trapTier(18, 6), "red", "18=3*6 red");
}

// ─── 3) trapReasons：门槛与组合 ────────────────────────
{
  assert.deepEqual(trapReasons(6, 0, 6), ["参数过长(6≥6)"], "参闭阈值即长参数");
  assert.deepEqual(trapReasons(5, 0, 6), [], "5 参无理由");
  assert.deepEqual(trapReasons(4, 2, 6), ["布尔陷阱(bool×2)"], "bool≥2 即陷阱，参数未达阈值不报长参");
  assert.deepEqual(trapReasons(3, 1, 6), [], "单个 bool 不触发");
  assert.deepEqual(
    trapReasons(8, 4, 6),
    ["参数过长(8≥6)", "布尔陷阱(bool×4)"],
    "长参 + 布尔陷阱双理由并存",
  );
}

console.log("✅ test_check_params.ts 全部通过（4 组断言）");