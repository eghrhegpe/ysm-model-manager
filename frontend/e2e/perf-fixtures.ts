// ===== 性能面板 e2e 的**真实载荷**夹具（ADR-262 D5）=====
// 取值自 `go run . --cli --files-root tests/fixtures/ysm … --format json`（2026-09-18 实测）。
// 只保留界面真正读的键（去掉 bytes / size_bytes / models / output / filesRoot 等），数值原样。
// 立因：性能面板此前的渲染断言只在 vitest（jsdom + mock executeCLI）——不跑布局/CSS，
// 抓不到「元素被吞掉」「i18n 占位符残留」这类只在真实浏览器暴露的缺陷。

export const SINGLE_BENCH_SAVED = {
  model: "tests\\fixtures\\ysm\\shen-fengling\\ysm.json",
  iterations: 1,
  total_ms: 9.015,
  per_iteration_ms: 9.015,
  bottleneck: "② JSON 解析",
  format: "YSM",
  hints: ["所有阶段 <10ms，性能良好"],
  identity: {
    relPath: "shen-fengling/ysm.json",
    rtype: "ysm",
    rtype_label: "YSM 模型",
  },
  stages: [
    {
      name: "① 清单读取",
      ms: 0,
      status: "ok",
      bottleneck: false,
      note: "✅ 115B",
      runtime: "go",
      stats: {
        n: 1,
        median_ms: 0,
        p95_ms: 0,
      },
    },
    {
      name: "② JSON 解析",
      ms: 7.914,
      status: "ok",
      bottleneck: false,
      note: "✅ 1 bones, 0 textures (YSM)",
      runtime: "go",
      stats: {
        n: 1,
        median_ms: 7.914,
        p95_ms: 7.914,
      },
    },
    {
      name: "③ 数据验证",
      ms: 0,
      status: "ok",
      bottleneck: false,
      note: "✅ ✅ 结构校验通过: 1 骨骼, 1 立方块, 0 纹理",
      runtime: "go",
      stats: {
        n: 1,
        median_ms: 0,
        p95_ms: 0,
      },
    },
    {
      name: "④ 几何数据准备",
      ms: 0,
      status: "ok",
      bottleneck: false,
      note: "✅ 192B",
      runtime: "go",
      stats: {
        n: 1,
        median_ms: 0,
        p95_ms: 0,
      },
    },
    {
      name: "⑤ 纹理数据准备",
      ms: 0,
      status: "ok",
      bottleneck: false,
      note: "✅ 0B",
      runtime: "go",
      stats: {
        n: 1,
        median_ms: 0,
        p95_ms: 0,
      },
    },
    {
      name: "⑥ 序列化模拟",
      ms: 0.507,
      status: "ok",
      bottleneck: false,
      note: "✅ 实测载荷 239B（Wails binding 走 JSON 序列化）",
      runtime: "go",
      stats: {
        n: 1,
        median_ms: 0.507,
        p95_ms: 0.507,
      },
    },
    {
      name: "⑦ 缓存检查",
      ms: 0.593,
      status: "ok",
      bottleneck: false,
      note: "⚠️ 缓存未命中（总缓存: 64 个文件, 10.1MB）",
      runtime: "go",
      stats: {
        n: 1,
        median_ms: 0.593,
        p95_ms: 0.593,
      },
    },
  ],
  baseline: {
    diff: {
      path: "C:\\Users\\ZHUJIE~1\\AppData\\Local\\Temp\\e2e-base2.json",
      threshold_pct: 50,
      noise_floor_ms: 1,
      verdict: "ok",
      degraded: 0,
      stages: [
        {
          name: "① 清单读取",
          base_ms: 0,
          now_ms: 0,
          delta_pct: 0,
          verdict: "noise",
        },
        {
          name: "② JSON 解析",
          base_ms: 8.226,
          now_ms: 7.914,
          delta_pct: -3.7928519328957107,
          verdict: "faster",
        },
        {
          name: "③ 数据验证",
          base_ms: 0,
          now_ms: 0,
          delta_pct: 0,
          verdict: "noise",
        },
        {
          name: "④ 几何数据准备",
          base_ms: 0,
          now_ms: 0,
          delta_pct: 0,
          verdict: "noise",
        },
        {
          name: "⑤ 纹理数据准备",
          base_ms: 0,
          now_ms: 0,
          delta_pct: 0,
          verdict: "noise",
        },
        {
          name: "⑥ 序列化模拟",
          base_ms: 0,
          now_ms: 0.507,
          delta_pct: 0,
          verdict: "noise",
        },
        {
          name: "⑦ 缓存检查",
          base_ms: 0,
          now_ms: 0.593,
          delta_pct: 0,
          verdict: "noise",
        },
      ],
    },
  },
};

export const SINGLE_BENCH_BASELINE_MISSING = {
  model: "tests\\fixtures\\ysm\\shen-fengling\\ysm.json",
  iterations: 1,
  total_ms: 15.191,
  per_iteration_ms: 15.191,
  bottleneck: "② JSON 解析",
  format: "YSM",
  hints: ["② JSON 解析 14.6ms：模型可能过大，考虑精简数据或使用更快的解析器"],
  identity: {
    relPath: "shen-fengling/ysm.json",
    rtype: "ysm",
    rtype_label: "YSM 模型",
  },
  stages: [
    {
      name: "① 清单读取",
      ms: 0,
      status: "ok",
      bottleneck: false,
      note: "✅ 115B",
      runtime: "go",
      stats: {
        n: 1,
        median_ms: 0,
        p95_ms: 0,
      },
    },
    {
      name: "② JSON 解析",
      ms: 14.569,
      status: "slow",
      bottleneck: true,
      note: "✅ 1 bones, 0 textures (YSM)",
      runtime: "go",
      stats: {
        n: 1,
        median_ms: 14.569,
        p95_ms: 14.569,
      },
    },
    {
      name: "③ 数据验证",
      ms: 0,
      status: "ok",
      bottleneck: false,
      note: "✅ ✅ 结构校验通过: 1 骨骼, 1 立方块, 0 纹理",
      runtime: "go",
      stats: {
        n: 1,
        median_ms: 0,
        p95_ms: 0,
      },
    },
    {
      name: "④ 几何数据准备",
      ms: 0,
      status: "ok",
      bottleneck: false,
      note: "✅ 192B",
      runtime: "go",
      stats: {
        n: 1,
        median_ms: 0,
        p95_ms: 0,
      },
    },
    {
      name: "⑤ 纹理数据准备",
      ms: 0,
      status: "ok",
      bottleneck: false,
      note: "✅ 0B",
      runtime: "go",
      stats: {
        n: 1,
        median_ms: 0,
        p95_ms: 0,
      },
    },
    {
      name: "⑥ 序列化模拟",
      ms: 0,
      status: "ok",
      bottleneck: false,
      note: "✅ 实测载荷 239B（Wails binding 走 JSON 序列化）",
      runtime: "go",
      stats: {
        n: 1,
        median_ms: 0,
        p95_ms: 0,
      },
    },
    {
      name: "⑦ 缓存检查",
      ms: 0.621,
      status: "ok",
      bottleneck: false,
      note: "⚠️ 缓存未命中（总缓存: 64 个文件, 10.1MB）",
      runtime: "go",
      stats: {
        n: 1,
        median_ms: 0.621,
        p95_ms: 0.621,
      },
    },
  ],
  baseline: {
    error: "missing",
    detail:
      "未找到基准文件 C:\\Users\\ZHUJIE~1\\AppData\\Local\\Temp\\e2e-none.json：请先用 --save-baseline 记录一次基准",
  },
};

export const CONC_BENCH_REAL = {
  workers: 4,
  max_models: 3,
  model_count: 3,
  serial: {
    total_ms: 11.1793,
    per_model_ms: 3.726433333333333,
  },
  parallel: [
    {
      workers: 2,
      total_ms: 1.1501,
      speedup: 9.720285192591948,
      verdict: "excellent",
    },
    {
      workers: 4,
      total_ms: 1.0243,
      speedup: 10.914087669628039,
      verdict: "excellent",
    },
  ],
  file_read: {
    file_count: 30,
    serial_ms: 3.3301,
    parallel_ms: 1.0757,
    speedup: 3.0957516036069537,
  },
  hints: ["✅ 推荐使用 4 workers，可获得 10.9x 加速", "💡 适合场景: 批量模型分析、并行文件处理"],
};
