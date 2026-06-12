const fs = require("fs");
let content = fs.readFileSync(
  "C:/Users/zhujieling11/ysm-model-manager/frontend/js/components/app-preview/index.js",
  "utf8",
);

// Find the old method body between the one-line _decodeYsmViaWasm and _appendDebug
const marker1 = "return decodeYsmViaWasm(modelPath);\n  }";
const marker2 =
  "\n  /** 在预览区追加调试小字 */\n  _appendDebug(container, msg) {";

const idx1 = content.indexOf(marker1) + marker1.length;
const idx2 = content.indexOf(marker2, idx1);

if (idx1 > 0 && idx2 > idx1) {
  content = content.substring(0, idx1) + "\n\n  " + content.substring(idx2);
  fs.writeFileSync(
    "C:/Users/zhujieling11/ysm-model-manager/frontend/js/components/app-preview/index.js",
    content,
  );
  console.log("OK: removed " + (idx2 - idx1) + " chars");
} else {
  console.log("FAIL: markers not found");
  console.log("idx1=" + idx1 + " idx2=" + idx2);
}
