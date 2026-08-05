import { readFileSync } from "fs";
const r = JSON.parse(readFileSync(process.argv[2], "utf8"));
const norm = (p) => p.split("\\").join("/").replace(/^js\//, "");
for (const d of r.duplicates) {
  const f1 = norm(d.firstFile.name), f2 = norm(d.secondFile.name);
  const hit =
    (f1.includes("litematic-3d") && f2.includes("skeleton")) ||
    (f1.includes("skeleton") && f2.includes("litematic-3d"));
  if (hit) {
    console.log("=== D-3 clone ===");
    console.log("f1:", f1, "L" + d.firstFile.startLoc.line + "-" + d.firstFile.endLoc.line);
    console.log("f2:", f2, "L" + d.secondFile.startLoc.line + "-" + d.secondFile.endLoc.line);
    console.log("lines:", d.lines, "tokens:", d.tokens);
    console.log("fragment (first 600 chars):");
    console.log((d.fragment || "").slice(0, 600));
    console.log("---");
  }
}
