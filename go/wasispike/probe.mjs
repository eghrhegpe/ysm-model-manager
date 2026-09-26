// Node 侧交叉验证：同一份 standalone wasm，用 node:wasi 提供预打开目录 + 3 个 env 垫片
// 用途：判定 wazero panic 是 wazero EH bug 还是模块问题；并诊断 -fignore 构建 trap 原因

import fs from 'node:fs';
import { argv } from 'node:process';

const [wasmPath, ysmPath, outDir] = argv.slice(2);
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const wasm = fs.readFileSync(wasmPath);
const mod = await WebAssembly.compile(wasm);
const imports = { env: {} };
for (const imp of WebAssembly.Module.imports(mod)) {
  if (imp.module === 'wasi_snapshot_preview1') continue;
  if (imp.name === '__syscall_getdents64') imports.env[imp.name] = () => 0;
  else if (imp.name === '__syscall_getcwd') imports.env[imp.name] = (buf, size) => {
    const m = new DataView(imports.mem.buffer);
    const s = '/output\0';
    if (s.length > size) return -75;
    for (let i = 0; i < s.length; i++) m.setUint8(buf + i, s.charCodeAt(i));
    return s.length - 1;
  };
  else if (imp.name === '__syscall_readlinkat') imports.env[imp.name] = () => -22;
  else imports.env[imp.name] = () => { throw new Error('unexpected import ' + imp.name); };
}
// 自写最小 wasi_snapshot_preview1（与 Go 探针同构）：10 个导入 + 3 个 env 垫片
let mem = null;
const dv = () => new DataView(mem.buffer);
const u8 = () => new Uint8Array(mem.buffer);
const decoder = new TextDecoder();
const enc = new TextEncoder();
function iovecs(ptr, len) {
  const d = dv(); const out = [];
  for (let i = 0; i < len; i++) {
    const p = d.getUint32(ptr + i * 8, true), l = d.getUint32(ptr + i * 8 + 4, true);
    out.push({ p, l });
  }
  return out;
}
let started = false;
const wasiImports = {
  args_sizes_get: (r, c) => { const d = dv(); d.setUint32(r, 0, true); d.setUint32(c, 0, true); return 0; },
  args_get: () => 0,
  environ_sizes_get: (r, c) => { const d = dv(); d.setUint32(r, 0, true); d.setUint32(c, 0, true); return 0; },
  environ_get: () => 0,
  clock_time_get: (id, precision, out) => { dv().setBigUint64(out, BigInt(Date.now()) * 1000000n, true); return 0; },
  proc_exit: (code) => { throw new Error('proc_exit(' + code + ')'); },
  fd_write: (fd, iovs, len, nwritten) => {
    let total = 0; let s = '';
    for (const { p, l } of iovecs(iovs, len)) { s += decoder.decode(u8().subarray(p, p + l)); total += l; }
    (fd === 2 ? process.stderr : process.stdout).write(s);
    dv().setUint32(nwritten, total, true);
    return 0;
  },
  fd_read: (fd, iovs, len, nread) => 52, // EBADF-ish: 解码 happy path 不读 stdio
  fd_close: () => 0,
  fd_seek: () => 70, // ESPIPE
};
const envImports = {
  __syscall_getdents64: () => 0,
  __syscall_getcwd: (buf, size) => {
    const s = '/output\0';
    if (s.length > size) return -75;
    u8().set(enc.encode(s), buf);
    return s.length - 1;
  },
  __syscall_readlinkat: () => -22,
  emscripten_notify_memory_growth: () => {},
};

const inst = await WebAssembly.instantiate(mod, {
  wasi_snapshot_preview1: wasiImports,
  env: envImports,
});
mem = inst.exports.memory;

inst.exports.__wasm_call_ctors();

const data = new Uint8Array(fs.readFileSync(ysmPath));
const pIn = inst.exports.malloc(data.length);
new Uint8Array(inst.exports.memory.buffer).set(data, pIn);
const dv2 = () => new DataView(inst.exports.memory.buffer);

console.log('detect_version =', inst.exports.ysm_detect_version(pIn, data.length));

// 内存直出：ysm_decode_to_memory(data, size, out_ptr)
const pOut = inst.exports.malloc(8);
new DataView(inst.exports.memory.buffer).setUint32(pOut, 0, true);
const ret = inst.exports.ysm_decode_to_memory(pIn, data.length, pOut);
console.log('decode_to_memory 返回 =', ret);
if (ret !== 1) { console.error('解码失败（见 stderr 诊断）'); process.exit(1); }

// 读回序列化块：[u32 count][u32 nameLen][u32 dataLen][name][data]*
const bufPtr = dv2().getUint32(pOut, true);
const u8b = new Uint8Array(inst.exports.memory.buffer);
let w = bufPtr;
const count = dv2().getUint32(w, true); w += 4;
console.log('产物数 =', count);
let total = 0;
for (let i = 0; i < count && i < 8; i++) {
  const n = dv2().getUint32(w, true), d = dv2().getUint32(w + 4, true); w += 8;
  const name = decoder.decode(u8b.subarray(w, w + n)); w += n + d;
  total += d;
  console.log('  ', name, d, 'bytes');
}
inst.exports.free(bufPtr);
console.log('✅ 内存直出成功');
