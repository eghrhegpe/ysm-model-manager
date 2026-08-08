// ===== 渲染对齐黄金对比 =====
// 同一 Bedrock geometry JSON：
//   specA = C# ThreeJsPayloadBuilder 复刻（csharp-builder.mjs）
//   specB = Go threejs.Build()（cmd/specgen）
// 对比骨骼/mesh 结构与数值（容差 1e-3），并给出「归一化后」（Go ×1/16，对齐 C# ExportScale）结果。
// 用法: node compare.mjs <geometry.json>...
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { buildSpecFromBedrockJson } from "./csharp-builder.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SPECGEN = join(HERE, "cmd", "specgen");
const TOL = 1e-3;

function maxDiff(a, b) {
  const n = Math.max(a.length, b.length);
  if (n === 0) return { diff: 0, maxA: 0, maxB: 0 };
  let d = 0;
  for (let i = 0; i < n; i++) {
    const av = a[i] ?? 0, bv = b[i] ?? 0;
    d = Math.max(d, Math.abs(av - bv));
  }
  const maxA = Math.max(...a.map(Math.abs)), maxB = Math.max(...b.map(Math.abs));
  return { diff: d, maxA, maxB };
}

function cmpField(name, a, b, scale = 1) {
  const n = Math.max(a.length, b.length);
  let diff = 0, scaledDiff = 0;
  for (let i = 0; i < n; i++) {
    const av = a[i] ?? 0, bv = b[i] ?? 0;
    diff = Math.max(diff, Math.abs(av - bv));
    // 归一化：b（Go 侧）缩放到 C# 尺度（×1/16）后逐元素比
    scaledDiff = Math.max(scaledDiff, Math.abs(av - bv / scale));
  }
  const maxA = Math.max(...a.map(Math.abs)), maxB = Math.max(...b.map(Math.abs));
  const ok = diff <= TOL;
  const scaledOk = scaledDiff <= TOL;
  return { name, diff, scaledDiff, ok, scaledOk, maxA, maxB };
}

function reportField(f, indent = "    ") {
  const mark = f.scaledOk ? "✅" : "❌";
  console.log(`${indent}${mark} ${f.name}: rawDiff=${f.diff.toExponential(3)} normalizedDiff=${f.scaledDiff.toExponential(3)} (maxA=${f.maxA.toExponential(3)}, maxB=${f.maxB.toExponential(3)})`);
}

function compareOne(jsonPathArg) {
  const jsonPath = resolve(jsonPathArg); // 绝对路径，规避子进程 cwd 差异
  const data = readFileSync(jsonPath, "utf8");
  const specA = buildSpecFromBedrockJson(data);
  const goOut = execFileSync("go", ["run", SPECGEN, jsonPath], { encoding: "utf8", cwd: HERE, maxBuffer: 200 * 1024 * 1024 });
  const specB = JSON.parse(goOut);

  const modelA = specA.models[0];
  const modelB = specB.models?.[0];
  console.log(`\n=== ${jsonPath} ===`);
  if (!modelB) { console.log("  ❌ Go 侧无输出"); return; }

  // ---- 骨骼 ----
  const bonesA = [...modelA.bones].sort((x, y) => x.id.localeCompare(y.id));
  const bonesB = [...modelB.bones].sort((x, y) => x.id.localeCompare(y.id));
  console.log(`骨骼: C#=${bonesA.length} Go=${bonesB.length} ${bonesA.length === bonesB.length ? "✅" : "❌"}`);
  if (bonesA.length !== bonesB.length) {
    const idsA = bonesA.map(b => b.id), idsB = bonesB.map(b => b.id);
    console.log(`  C# 独有: ${idsA.filter(i => !idsB.includes(i))}`);
    console.log(`  Go 独有: ${idsB.filter(i => !idsA.includes(i))}`);
  }
  const boneNames = new Set([...bonesA.map(b => b.id), ...bonesB.map(b => b.id)]);
  let boneFailPos = 0, boneFailRot = 0, boneScaleOnly = 0, boneFailPosList = [], boneFailRotList = [];
  for (const id of [...boneNames].sort()) {
    const a = bonesA.find(b => b.id === id);
    const b = bonesB.find(b => b.id === id);
    if (!a || !b) { console.log(`    ⚠️ 骨骼 ${id} 仅一侧存在`); continue; }
    const p = cmpField(`bone ${id}.localPosition`, a.localPosition, b.localPosition, 16);
    const r = cmpField(`bone ${id}.localRotation`, a.localRotation, b.localRotation);
    if (!p.scaledOk) {
      boneFailPos++;
      // 分类：纯尺度差（归一化后≈0 但 raw 差≈16 倍）vs 真差异
      const ratio = p.maxB > 1e-9 ? p.maxB / p.maxA : 0;
      const pureScale = Math.abs(ratio - 16) < 0.5 && p.scaledDiff < 0.1;
      if (pureScale) boneScaleOnly++;
      boneFailPosList.push(`${id}(n=${p.scaledDiff.toFixed(4)},r=${ratio.toFixed(2)})`);
    }
    if (!r.scaledOk) { boneFailRot++; boneFailRotList.push(id); }
    reportField(p); reportField(r);
  }
  console.log(`  ▶ 骨骼汇总: localPosition ❌ ${boneFailPos}/${bonesA.length}（纯尺度 ${boneScaleOnly}，真差异 ${boneFailPos - boneScaleOnly}）| localRotation ❌ ${boneFailRot}/${bonesA.length}`);
  if (boneFailPosList.length) console.log(`    localPosition 差异示例: ${boneFailPosList.slice(0, 10).join("  ")}`);
  if (boneFailRotList.length) console.log(`    localRotation 差异骨骼: ${boneFailRotList.join(", ")}`);

  // ---- mesh（按 boneId + 出现顺序对齐）----
  const meshesA = [...modelA.meshGroups];
  const meshesB = [...modelB.meshGroups];
  console.log(`mesh: C#=${meshesA.length} Go=${meshesB.length} ${meshesA.length === meshesB.length ? "✅" : "❌"}`);
  if (meshesA.length !== meshesB.length) {
    // 按 (boneId) 分组对比数量
    const countByBone = (ms) => ms.reduce((acc, m) => { acc[m.boneId] = (acc[m.boneId] ?? 0) + 1; return acc; }, {});
    const ca = countByBone(meshesA), cb = countByBone(meshesB);
    const allBones = new Set([...Object.keys(ca), ...Object.keys(cb)]);
    const diffs = [];
    for (const b of allBones) if ((ca[b] ?? 0) !== (cb[b] ?? 0)) diffs.push(`${b}: C#${ca[b] ?? 0}/Go${cb[b] ?? 0}`);
    console.log(`    mesh 数量差异骨骼: ${diffs.join("  ")}`);
  }
  let meshFail = 0, meshFailList = [];
  const n = Math.max(meshesA.length, meshesB.length);
  for (let i = 0; i < n; i++) {
    const a = meshesA[i], b = meshesB[i];
    if (!a || !b) { console.log(`    ⚠️ mesh #${i} 仅一侧存在`); continue; }
    const label = `${a.boneId ?? "?"}#${i}`;
    const p = cmpField(`mesh ${label}.localPosition`, a.localPosition, b.localPosition, 16);
    const r = cmpField(`mesh ${label}.localRotation`, a.localRotation, b.localRotation);
    const pos = cmpField(`mesh ${label}.positions`, a.positions, b.positions, 16);
    const nrm = cmpField(`mesh ${label}.normals`, a.normals, b.normals);
    const uv = cmpField(`mesh ${label}.uvs`, a.uvs, b.uvs);
    const idx = cmpField(`mesh ${label}.indices`, a.indices, b.indices);
    const ok = p.scaledOk && r.scaledOk && pos.scaledOk && nrm.scaledOk && uv.scaledOk && idx.scaledOk;
    if (!ok) { meshFail++; if (meshFailList.length < 8) meshFailList.push(label); }
    reportField(p); reportField(r);
    reportField(pos); reportField(nrm); reportField(uv); reportField(idx);
  }
  console.log(`  ▶ mesh 汇总: ❌ ${meshFail}/${meshesA.length}${meshFailList.length ? " 示例: " + meshFailList.join(", ") : ""}`);
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.log("用法: node compare.mjs <geometry.json>...");
  process.exit(1);
}
for (const f of files) compareOne(f);
console.log("\n== 完成 ==");
