#!/usr/bin/env node
/**
 * gen-cmds.ts — 秒级 gen 脚本清单的单一事实源（ADR-151 项 6）。
 *
 * 背景：commit-with-check.ts 内联 11 个 gen、.githooks/pre-commit 内联 15 个
 * （多 gen-routes / gen-routes-quick / gen-cli-doc / gen-cli-completion），两处
 * 平行维护已漂移 4 个命令。本文件收敛唯一清单：
 *   - TS 侧：import { GEN_CMDS } from './_lib/gen-cmds.ts'
 *   - sh 侧（pre-commit）：node scripts/_lib/gen-cmds.ts 逐行输出消费
 *
 * 全集以 .githooks/pre-commit 的 15 个为准（commit-with-check 是子集，取全集
 * 预刷新可保证「残余 gen 产物若过期，门禁 --check 不因缺刷新而挂」）。
 *
 * 用法：
 *   node scripts/_lib/gen-cmds.ts        # 逐行输出命令清单（sh 侧管道消费）
 */
export const GEN_CMDS: string[] = [
  'gen-docs-index.ts',
  'event-graph.ts',
  'gen-knowledge-index.ts',
  'build-novel-index.ts',
  'gen-project-map.ts',
  'gen-vitepress-sidebar.ts',
  'gen-knowledge-h1.ts',
  'gen-knowledge-symbols.ts',
  'gen-knowledge-adr.ts',
  'gen-knowledge-tests.ts',
  'gen-knowledge-autogen.ts',
  'gen-routes.ts',
  'gen-routes-quick.ts',
  'gen-cli-doc.ts',
  'gen-cli-completion.ts',
  'generate-locale-json.ts',
];

// 直接运行时逐行输出（sh 侧 node scripts/_lib/gen-cmds.ts | while read）
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('_lib/gen-cmds.ts')) {
  for (const c of GEN_CMDS) console.log(c);
}
