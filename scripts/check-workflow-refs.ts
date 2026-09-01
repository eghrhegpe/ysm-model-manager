#!/usr/bin/env node
/**
 * check-workflow-refs.ts — GitHub Actions 工作流引用完整性检查。
 *
 * 背景：cmd/build-*.ps1 迁入 scripts/ 时 release.yml 仍引用旧路径 cmd\build-release.ps1，
 * Windows/Android 发版 CI 静默必挂，且 doctor/pre-push 无任何检查扫 .github/workflows/*.yml
 * 的 run: 路径引用——死引用一路存活。本脚本把「workflow 引用的脚本/目录必须存在」固化为卡点。
 *
 * 设计意图：迁移类治理（改名/移动脚本）后，引用方的存在性由 CI 门禁兜底，
 * 不再依赖人工记得同步 .github/workflows/。
 * 依赖：零依赖（node:fs / node:path / node:url + _lib/scan-files.ts 的 ROOT）
 *
 * 用法：
 *   node scripts/check-workflow-refs.ts            # 文本报告
 *   node scripts/check-workflow-refs.ts --json     # JSON（CI / doctor 消费）
 *
 * 退出码：0 通过 / 1 存在失效引用。
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './_lib/scan-files.ts';

const WF_DIR = path.join(ROOT, '.github', 'workflows');

// run: 命令中的 scripts/ 或 cmd/ 路径引用（兼容 ./scripts/、.\scripts\、裸 scripts/ 三种写法）。
// 要求前置边界（行首/空白/;|&），排除外部 Go 模块 URL 如 github.com/wailsapp/wails/v3/cmd/wails3
const REF_RE = /(^|[\s;|&])(?:\.\/|\.\\)?(scripts|cmd)[\\/]([a-zA-Z0-9._-]+)/gm;

const JSON_OUT = process.argv.includes('--json');

function main() {
  let wfFiles: string[] = [];
  try {
    wfFiles = fs.readdirSync(WF_DIR).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
  } catch {
    // .github/workflows 缺失时无法扫描，直接按无引用处理（仓库结构异常另由其他检查兜底）
    wfFiles = [];
  }

  const errors: string[] = [];
  const refs: any[] = [];
  for (const f of wfFiles) {
    const text = fs.readFileSync(path.join(WF_DIR, f), 'utf8');
    for (const m of text.matchAll(REF_RE)) {
      const rel = `${m[2]}/${m[3]}`;
      const abs = path.join(ROOT, m[2], m[3]);
      refs.push({ file: f, ref: rel });
      if (!fs.existsSync(abs)) {
        errors.push(`[${f}] 引用不存在的路径: ${rel}`);
      }
    }
  }

  if (JSON_OUT) {
    console.log(
      JSON.stringify(
        { _summary: { workflows: wfFiles.length, refs: refs.length, errors: errors.length }, errors, refs },
        null,
        2,
      ),
    );
    if (errors.length) process.exit(1);
    return;
  }

  console.log('══════════════════════════════════════');
  console.log(' 工作流引用完整性 (check-workflow-refs)');
  console.log('══════════════════════════════════════');
  console.log(`扫描 ${wfFiles.length} 个 workflow，引用 ${refs.length} 处，ERROR ${errors.length} 条`);
  console.log('──────────────────────────────────────');
  for (const e of errors) console.log(`❌ ${e}`);
  if (!errors.length) console.log('✅ 所有 run: 路径引用均存在。');
  if (errors.length) process.exit(1);
}

main();
