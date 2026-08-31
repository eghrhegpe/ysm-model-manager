/**
 * 用 Node.js + WASM 解码 .ysm 文件（callMain + MEMFS 路径）。
 * test-decode-from-memory.mjs — YSMParser WASM 解码冒烟测试
 * 设计意图：与 internal/app/wasm_decoder.go 的 decodeYSMViaNodeJS 保持同一调用方式，本地验证 web 产物可解码。
 * 依赖：fs / path / os / child_process（+ 外部 YSMParser glue）
 * 用法：
 *   node scripts/test-decode-from-memory.mjs
 * 退出码：
 *   0 成功 / 1 FATAL
 */
// 用 Node.js + WASM 解码 .ysm 文件（callMain + MEMFS 路径）
// 与 internal/app/wasm_decoder.go 的 decodeYSMViaNodeJS 保持同一调用方式。
//
// 为什么不用 ysm_decode_from_memory（内存解析）？
// frontend/public/wasm/YSMParser.wasm（Go embed 实际资产，6-17 版）的
// Emscripten 导出面只含 _main（callMain 可用），未导出 _malloc / ccall /
// ysm_decode_from_memory。内存解析 API 只在 frontend/src/wasm/ysm-wasm-data.js
// （6-08 版）存在。生产路径（wasm_decoder.go / avatar.go）一律走 callMain +
// MEMFS，无需 _malloc / ccall —— 这就是「纯 Node 解码」的正解。
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";
import { parseArgs } from "../_lib/parse-args.ts";

const ROOT = process.cwd();
const WASM_PATH = join(ROOT, "frontend/public/wasm/YSMParser.wasm");
const GLUE_PATH = join(ROOT, "frontend/public/wasm/YSMParser.js");
const OUTPUT_DIR = join(ROOT, "tests/ysm-reference");

const wasmBin = readFileSync(WASM_PATH);
const wasmB64 = wasmBin.toString("base64");

const args = parseArgs(process.argv.slice(2));
if (args.unknown.length) {
  console.error(`❌ 未知参数: ${args.unknown.join(', ')}（--help 查看用法）`);
  process.exit(1);
}
const file = args._[0] || "upstream/[瀛猫]【Vup】穆小泠(黑色晚礼服)2.0.ysm";
const name = file.split("/").pop().replace(".ysm", "");

const ysmData = readFileSync(file);
const ysmB64 = ysmData.toString("base64");

const script = `
const YSMParser = require(${JSON.stringify(GLUE_PATH)});
const wb64=${JSON.stringify(wasmB64)};
const wb=Uint8Array.from(atob(wb64),c=>c.charCodeAt(0));
const yb64=${JSON.stringify(ysmB64)};
const yr=atob(yb64);const ys=new Uint8Array(yr.length);
for(let i=0;i<yr.length;i++)ys[i]=yr.charCodeAt(i);
async function main(){
  const mod=await YSMParser({wasmBinary:wb.buffer,noInitialRun:true});
  const FS=mod.FS;
  try{FS.mkdir('/input')}catch(e){}  // EEXIST 忽略是预期：目录已存在时 mkdir 抛错，不影响后续写文件（R15 P3 #2）
  try{FS.mkdir('/output')}catch(e){} // 同上
  FS.writeFile('/input/model.ysm',ys);
  try{mod.callMain(['-i','/input','-o','/output'])}catch(e){
    if(!(e&&e.name==='ExitStatus'))throw e}
  function cl(dir){
    const r=[];const es=FS.readdir(dir).filter(f=>f!=='.'&&f!=='..');
    for(const e of es){const p=dir+'/'+e;
      if(FS.isDir(FS.stat(p).mode)){r.push(...cl(p))}
      else{r.push({path:p,data:Array.from(FS.readFile(p))})}}
    return r}
  const files=cl('/output');
  console.log('FILE_COUNT:'+files.length);
  for(const f of files){
    if(f.path.endsWith('.json')&&!f.path.endsWith('ysm.json')){
      console.log('GEOMETRY_FILE:'+f.path+'|'+f.data.length)}}
  process.stdout.write('FILES_JSON:'+JSON.stringify(files));
  process.exit(0);
}
main().catch(e=>{console.error('FATAL:',e);process.exit(1)});
`;

// 临时脚本写到系统临时目录（避免污染 tests/ysm-reference）
const tmpScript = join(tmpdir(), `ysm-decode-${Date.now()}.cjs`);
writeFileSync(tmpScript, script);

try {
    const result = execSync(`node "${tmpScript}"`, {
        encoding: "utf-8",
        maxBuffer: 50 * 1024 * 1024,
    });
    console.log("STDOUT:", result.slice(0, 3000));
    // 落盘解码文件（tests/ysm-reference/<模型名>/...）
    const idx = result.indexOf("FILES_JSON:");
    if (idx >= 0) {
        const files = JSON.parse(result.slice(idx + "FILES_JSON:".length));
        const outDir = join(OUTPUT_DIR, name);
        mkdirSync(outDir, { recursive: true });
        for (const f of files) {
            const p = join(outDir, f.path);
            mkdirSync(dirname(p), { recursive: true });
            if (!existsSync(p)) writeFileSync(p, Buffer.from(f.data));
        }
        console.log("WROTE_FILES:" + files.length + " ->", outDir);
    }
} catch (e) {
    console.log("ERROR:", e.message?.slice(0, 500));
    console.log("STDOUT:", e.stdout?.slice(0, 2000));
} finally {
    try { rmSync(tmpScript, { force: true }); } catch {}
}
