#!/usr/bin/env node
/**
 * ts-alias-register.ts — 父进程侧：为 Node 契约 runner 登记 @/#root 别名运行时解析。
 *
 * Node 原生 TS 执行不解析 tsconfig paths：契约测试（tests/*.ts）的 import 链一旦
 * 进入含 @/<dir>/* 别名 import 的 frontend 源码即报 ERR_MODULE_NOT_FOUND
 * （Cannot find package '@/xxx'；首例 = a1e76940b cube-mesh.ts → @/preview-3d/model/*）。
 *
 * 接线点：scripts/_lib/contract-tests.ts spawnTestOnce 的 execArgv `--import` 本文件。
 * 单一事实源：frontend/tsconfig.json paths 白名单（alias-resolve.ts tryResolveAlias，
 * 与 check-path-hygiene 同源；catch-all @/* 被禁，不会漏配）。
 * 护栏：tests/test_contract_alias_runtime.ts。
 */
import { register } from "node:module";

// resolver 在独立 loader 线程执行；同项目模块（alias-resolve.ts）可直接 import。
register("./ts-alias-resolver.ts", import.meta.url);
