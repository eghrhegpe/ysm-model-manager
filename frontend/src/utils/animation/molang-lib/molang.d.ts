// ===== molang.js 类型声明（vendor 嵌入副本，MIT）=====
// molangjs 是 IIFE 自执行模块，无官方 .d.ts；本文件为手工类型补全，
// 覆盖 molang.ts 实际用到的全部成员（parse / resetVariables / variables / variableHandler）。
// 不改动 vendor 源码（molang.js），仅作类型层补全。

/** Molang DSL 解析器（molangjs 内嵌副本） */
declare class Molang {
  global_variables: Record<string, unknown>;
  cache_enabled: boolean;
  use_radians: boolean;
  variables: Record<string, number>;
  variableHandler: ((key: string, variables: object) => number) | null;
  parse(input: string, variables?: Record<string, number>): number;
  resetVariables(): void;
}

export default Molang;
