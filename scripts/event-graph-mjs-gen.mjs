#!/usr/bin/env node
/**
 * event-graph-mjs-gen.mjs — 生成 event-graph.mjs 的脚手架入口。
 * 用法：node scripts/event-graph-mjs-gen.mjs [--check] [--json] [--strict]
 * 退出码：0 成功；1 生成/校验失败。
 * 设计意图：event-graph.mjs 的配套生成器入口（事件契约守护的脚手架侧）。
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
