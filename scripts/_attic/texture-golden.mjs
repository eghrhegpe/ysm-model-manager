#!/usr/bin/env node
/**
 * texture-golden.mjs — upstream 真实 .ysm 全量 golden 扫描（组件序 / 纹理名契约回归）。
 *
 * 设计意图：B 层真实模型回归——upstream/ 下真实皮肤包用 Node+WASM 解码，
 * 输出"组件序 + 纹理名序"golden 表，人工扫一遍即可发现合成夹具覆盖不到的
 * 真实命名边界（main.geo.json / 大写扩展名 / 纹理声明序与收集序错位等）。
 * 与 A 层（go/geometry/testdata 合成复现）互补：A 层锁契约，B 层扫全量。
 *
 * 零依赖（node:fs / node:path / node:module）；复用 frontend/public/wasm/ 的
 * YSMParser.js + YSMParser.wasm（emscripten 产物，CommonJS 可 require）。
 *
 * 用法：
 *   node scripts/texture-golden.mjs                # 文本表格（默认扫 upstream/）
 *   node scripts/texture-golden.mjs --dir <目录>    # 指定 .ysm 目录
 *   node scripts/texture-golden.mjs --json         # JSON（CI / 子代理消费）
 *   node scripts/texture-golden.mjs --limit 2      # 只解码前 N 个（调试）
 *
 * 退出码：解码失败（ERROR）→ 1；成功 / 无 .ysm → 0（WARN 不阻断）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../_lib/parse-args.mjs';

const require = createRequire(import.meta.url);
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..', '..'); // _attic/ 下一层才是仓库根
const WASM_DIR = path.join(ROOT, 'frontend', 'public', 'wasm');
const GLUE_JS = path.join(WASM_DIR, 'YSMParser.js');
const WASM_BIN = path.join(WASM_DIR, 'YSMParser.wasm');

/** 解码单个 .ysm（YSGP 容器 → 文件列表），与 internal/app/wasm_decoder.go 同源逻辑。
 * 临时静音 console：YSMParser 会打印解析日志污染 stdout（--json 需纯净输出）。 */
async function decodeYsm(ysmPath) {
  const origLog = console.log;
  const origError = console.error;
  console.log = () => {};
  console.error = () => {};
  try {
    const YSMParser = require(GLUE_JS);
    const wb = fs.readFileSync(WASM_BIN);
    const ys = fs.readFileSync(ysmPath);
    const mod = await YSMParser({ wasmBinary: wb.buffer, noInitialRun: true });
    const FS = mod.FS;
    try { FS.mkdir('/input'); } catch { /* 已存在 */ }
    try { FS.mkdir('/output'); } catch { /* 已存在 */ }
    FS.writeFile('/input/model.ysm', ys);
    try { mod.callMain(['-i', '/input', '-o', '/output']); } catch (e) {
      // P1-1（code_review）：ExitStatus 是 emscripten 对 main 返回的封装——name 匹配还不够，
      // status 非零即解码失败，必须显式抛错，否则损坏 .ysm 会被记录为「成功空行」（0 组件/0 纹理、退出 0）
      if (!(e && e.name === 'ExitStatus')) throw e;
      const st = e.status ?? e.code ?? 1;
      if (st !== 0) throw new Error(`YSMParser 解码退出码 ${st}`);
    }
    function collect(dir) {
      const out = [];
      for (const name of FS.readdir(dir).filter((f) => f !== '.' && f !== '..')) {
        const p = dir + '/' + name;
        if (FS.isDir(FS.stat(p).mode)) out.push(...collect(p));
        else out.push({ path: p, data: Buffer.from(FS.readFile(p)) });
      }
      return out;
    }
    return collect('/output');
  } finally {
    console.log = origLog;
    console.error = origError;
  }
}

/** main 判定：basename 去扩展名 == main / main.geo（对齐 Go IsMainModelName） */
function isMainName(name) {
  let base = name.toLowerCase().replace(/\\/g, '/');
  base = base.slice(base.lastIndexOf('/') + 1);
  base = base.replace(/\.json$/i, '');
  return base === 'main' || base === 'main.geo';
}

/** 组件排序：main 优先 + 其余按路径字母序（对齐 Go buildComponents 无 orderMap 兜底） */
function sortComponents(files) {
  return files.slice().sort((a, b) => {
    const ma = isMainName(a.path) ? 1 : 0;
    const mb = isMainName(b.path) ? 1 : 0;
    if (ma !== mb) return mb - ma;
    return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
  });
}

/** 解析 ysm.json 的 texture 声明序（对齐 collectArchiveFiles 的 texOrder） */
function parseTexOrder(files) {
  const ysm = files.find((f) => f.path.toLowerCase().endsWith('ysm.json'));
  if (!ysm) return null;
  try {
    const json = JSON.parse(ysm.data.toString('utf8'));
    const tex = json?.files?.player?.texture;
    if (!tex) return null;
    const arr = Array.isArray(tex) ? tex : [tex];
    return arr.map((t) => {
      const s = typeof t === 'string' ? t : t?.uv || t?.path || '';
      const base = s.replace(/\\/g, '/').slice(s.replace(/\\/g, '/').lastIndexOf('/') + 1);
      return base.toLowerCase().replace(/\.(png|jpg|tga)$/i, '');
    });
  } catch {
    return null;
  }
}

/** 判断是否为可解析的几何 JSON（对齐 Go ParseBedrockGeometry 非 nil 过滤） */
function isGeometry(f) {
  if (!f.path.toLowerCase().endsWith('.json')) return false;
  try {
    const json = JSON.parse(f.data.toString('utf8'));
    const geo = json?.['minecraft:geometry'];
    return Array.isArray(geo) && geo.length > 0 && Array.isArray(geo[0]?.bones);
  } catch {
    return false;
  }
}

/** 分析单个模型：组件序 + 纹理名序 */
async function analyzeModel(ysmPath) {
  const files = await decodeYsm(ysmPath);
  const models = files.filter(
    (f) =>
      // P2-3（code_review）：对齐 Go——只按 ysm.json 后缀排除，无 animation/controller 名称黑名单
      //（wasm_decoder.go:235-243 靠 ParseBedrockGeometry 解析结果过滤，路径含 animation/controller 的
      // 合法 geometry 如 animations/head.geo.json 不应被整条剔除）；endsWith 而非 includes（子串过宽）
      isGeometry(f) && !f.path.toLowerCase().endsWith('ysm.json'),
  );
  const textures = files.filter(
    (f) =>
      /\.(png|jpg)$/i.test(f.path) &&
      // P2-2（code_review）：与 Go 三处 `avatar/` 前缀口径一致——任意子串 includes 会把
      // my_avatar.png / avatars/foo.png 等非头像纹理误剔
      !f.path.toLowerCase().includes('avatar/') &&
      // P2-1（code_review）：WASM 主路径不过滤 <4KB（wasm_decoder.go:191-193），golden 须与运行时同口径；
      // 64×64 真实箭矢纹理（~2KB）会被 4KB 过滤误杀（此过滤只存在于 zip 路径 archive.go:830）
      f.data.length > 0,
  );
  const sorted = sortComponents(models);
  const texOrder = parseTexOrder(files);
  const texNames = textures.map((t) => {
    const base = t.path.replace(/\\/g, '/').split('/').pop();
    return base.replace(/\.(png|jpg)$/i, '');
  });
  const mainFirst = sorted.length > 0 && isMainName(sorted[0].path);
  return {
    model: path.basename(ysmPath),
    components: sorted.length,
    textures: textures.length,
    componentOrder: sorted.map((m) => m.path.replace(/^\/output\//, '')),
    textureNames: texNames,
    texOrderDeclared: texOrder,
    mainFirst,
    warnings: [],
  };
}

function formatTable(rows) {
  const lines = [];
  lines.push('模型 | 组件数 | main第1 | 组件序 | 纹理序');
  lines.push('--- | --- | --- | --- | ---');
  for (const r of rows) {
    const ord = r.componentOrder.join(', ') || '(无)';
    const tex = (r.texOrderDeclared || r.textureNames).join(', ') || '(无)';
    lines.push(`${r.model} | ${r.components} | ${r.mainFirst ? '✅' : '⚠️'} | ${ord} | ${tex}`);
    for (const w of r.warnings) lines.push(`  ⚠️ ${w}`);
  }
  return lines.join('\n');
}

async function main() {
  // 统一走共享 parseArgs：--json bool、--dir/--limit 带值；limit 需 Number 转换
  const parsed = parseArgs(process.argv.slice(2), {
    bools: ['json'],
    strings: ['dir', 'limit'],
    defaults: { dir: path.join(ROOT, 'upstream') },
  });
  // ADR-043 陷阱 #12：未知 flag 显式拒绝（--jsno 拼错不得静默忽略）
  if (parsed.unknown.length) {
    console.error(`[texture-golden] ❌ 未知参数: ${parsed.unknown.join(', ')}（支持 --json / --dir <目录> / --limit N）`);
    return 1;
  }
  const opts = {
    json: parsed.json,
    dir: parsed.dir,
    limit: parsed.limit ? Number(parsed.limit) || Infinity : Infinity,
  };
  if (!fs.existsSync(GLUE_JS) || !fs.existsSync(WASM_BIN)) {
    console.error(`[texture-golden] 缺少 WASM 资源: ${WASM_DIR}`);
    return 1;
  }
  if (!fs.existsSync(opts.dir)) {
    console.error(`[texture-golden] 目录不存在: ${opts.dir}`);
    return 1;
  }
  const ysmFiles = fs.readdirSync(opts.dir).filter((f) => f.toLowerCase().endsWith('.ysm'));
  if (ysmFiles.length === 0) {
    // P2-4（code_review）：--json 模式空目录也必须输出合法 JSON（消费者按 JSON 解析，人类文本会抛异常）
    if (opts.json) console.log(JSON.stringify({ total: 0, errors: 0, rows: [] }));
    else console.log(`[texture-golden] 未找到 .ysm（目录: ${opts.dir}）`);
    return 0;
  }
  let errors = 0;
  const rows = [];
  for (const f of ysmFiles.slice(0, opts.limit)) {
    try {
      const r = await analyzeModel(path.join(opts.dir, f));
      rows.push(r);
      console.error(`[texture-golden] ✓ ${r.model}: ${r.components} 组件 / ${r.textures} 纹理`);
    } catch (e) {
      errors++;
      console.error(`[texture-golden] ✗ ${f} 解码失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (opts.json) {
    console.log(JSON.stringify({ total: rows.length, errors, rows }, null, 2));
  } else {
    console.log(formatTable(rows));
    console.log(`\n总计: ${rows.length} 模型 / 失败 ${errors}`);
  }
  return errors > 0 ? 1 : 0;
}

main().then((code) => process.exit(code));
