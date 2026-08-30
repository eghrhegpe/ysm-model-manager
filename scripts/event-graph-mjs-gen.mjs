#!/usr/bin/env node
/**
 * event-graph-mjs-gen.mjs — 【未完成残件】event-graph.mjs 的脚手架入口（半截）。
 * 当前状态：仅有参数解析骨架，无 main / 无生成逻辑 / 无 process.exit——本文件
 * 不产出任何东西，也未在任何门禁/脚本中被引用。event-graph.mjs 本体已能
 * --check/--json/--strict 全套工作，本文件属于历史遗留的未完成脚手架。
 * 处理建议：补全为真正可用的生成器，或直接删除。
 * 用法：node scripts/event-graph-mjs-gen.mjs [--check] [--json] [--strict]
 * 退出码：无（当前不执行任何逻辑，恒退出 0）。
 * 设计意图：原计划生成 event-graph.mjs 的脚手架入口；现已由 event-graph.mjs 本体取代。
 * 依赖：node:fs / node:path / _lib/scan-files.mjs（零外部依赖）
 */
import fs from 'node:fs';
import path from 'node:path';
import { getRoot, relPosix } from './_lib/scan-files.mjs';

const ROOT = getRoot();
const SRC_DIR = path.join(ROOT, 'frontend', 'src');
const INDEX_HTML = path.join(ROOT, 'frontend', 'index.html');
const BUS_TS = path.join(SRC_DIR, 'bus.ts');
const OUT = path.join(ROOT, 'docs', 'event-graph.md');
const ARGS = new Set(process.argv.slice(2));
const CHECK = ARGS.has('--check');
const JSON_OUT = ARGS.has('--json');
const STRICT = ARGS.has('--strict');
