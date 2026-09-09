#!/usr/bin/env node
/**
 * ts-alias-resolver.ts — loader 线程侧：@/#root 别名 resolve 钩子（与 ts-alias-register.ts 配对）。
 *
 * 只接管已登记别名说明符（tsconfig paths 白名单，alias-resolve.ts 同源；catch-all
 * @/* 被 ADR-146 D1 禁用故不会漏配），其余说明符一律 nextResolve 透传——
 * 相对路径 / 裸包名零行为变更。
 */
import { pathToFileURL } from "node:url";
import { tryResolveAlias } from "./alias-resolve.ts";

interface ResolveResult {
  url: string;
  shortCircuit?: boolean;
}
type NextResolve = (
  specifier: string,
  context: { parentURL?: string },
) => ResolveResult | Promise<ResolveResult>;

export function resolve(
  specifier: string,
  context: { parentURL?: string },
  nextResolve: NextResolve,
): ResolveResult | Promise<ResolveResult> {
  const abs = tryResolveAlias(specifier);
  // nextResolve 的第二参必须是 context 对象（Node 24 ESM hooks 校验，传字符串即
  // ERR_INVALID_ARG_TYPE）——展开别名时透传原 context 保留 parentURL。
  if (abs) return nextResolve(pathToFileURL(abs).href, context);
  return nextResolve(specifier, context);
}
