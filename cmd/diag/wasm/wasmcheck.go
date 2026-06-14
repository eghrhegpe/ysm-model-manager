//go:build ignore

package main

import (
	"encoding/base64"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

var nodePath string

func main() {
	nodePath = "C:\\Users\\zhujieling11\\emsdk\\node\\22.16.0_64bit\\bin\\node.exe"
	if _, err := os.Stat(nodePath); err != nil {
		fmt.Println("❌ Node.js:", err)
		os.Exit(1)
	}
	fmt.Println("✅ Node.js 可用")

	wasmDir := "C:\\Users\\zhujieling11\\YSMParser-main\\build-wasm\\YSMParser"
	glueFile := filepath.Join(wasmDir, "YSMParser.js")

	wasmData, err := os.ReadFile(filepath.Join(wasmDir, "YSMParser.wasm"))
	if err != nil {
		fmt.Println("❌ WASM:", err)
		os.Exit(1)
	}

	// 先简单测试加载
	simpleTest(nodePath, glueFile, wasmDir, wasmData)

	// 再测试解码
	ysmFile := "C:\\Users\\zhujieling11\\ysm-model-manager\\docs\\[Almeta_owx]【ATRI】亚托莉2025-08.ysm"
	ysmData, err := os.ReadFile(ysmFile)
	if err != nil {
		fmt.Println("⚠️  跳过文件测试:", err)
		return
	}
	fullTest(nodePath, glueFile, wasmDir, wasmData, ysmData)
}

func runNodeScript(wasmDir, glueFile string, wasmData []byte, scriptBody string) {
	wasmB64 := base64.StdEncoding.EncodeToString(wasmData)
	// 读取胶水代码并 patch HEAPU8 暴露
	glueRaw, _ := os.ReadFile(glueFile)
	gluePatched := strings.ReplaceAll(string(glueRaw),
		";updateMemoryViews()",
		`;updateMemoryViews();Module["HEAPU8"]=HEAPU8;Module["HEAP32"]=HEAP32`)

	tmpScriptDir, _ := os.MkdirTemp("", "ysmglue-*")
	defer os.RemoveAll(tmpScriptDir)
	patchedGlueFile := filepath.Join(tmpScriptDir, "YSMParser_patched.js")
	os.WriteFile(patchedGlueFile, []byte(gluePatched), 0644)

	script := fmt.Sprintf(`
const YSMParser = require(%q);
const wasmB64 = %q;
const wasmBin = Uint8Array.from(atob(wasmB64), c => c.charCodeAt(0));
async function main() {
  const mod = await YSMParser({ wasmBinary: wasmBin.buffer });
  %s
}
main().catch(e => { console.error(e); process.exit(1); });
`, patchedGlueFile, wasmB64, scriptBody)

	tmpDir, _ := os.MkdirTemp("", "ysm-*")
	defer os.RemoveAll(tmpDir)
	sp := filepath.Join(tmpDir, "t.cjs")
	os.WriteFile(sp, []byte(script), 0644)

	cmd := exec.Command(nodePath, sp)
	cmd.Dir = wasmDir
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		fmt.Println("\n❌ 失败:", err)
		os.Exit(1)
	}
}

func simpleTest(node, glueFile, wasmDir string, wasmData []byte) {
	runNodeScript(wasmDir, glueFile, wasmData,
		`console.log('✅ YSMParser loaded, ccall:', typeof mod.ccall);`)
	fmt.Println("✅ Node.js + YSMParser 运行正常")
}

func fullTest(node, glueFile, wasmDir string, wasmData, ysmData []byte) {
	ysmB64 := base64.StdEncoding.EncodeToString(ysmData)
	runNodeScript(wasmDir, glueFile, wasmData, fmt.Sprintf(`
  const FS = mod.FS;
  const ccall = mod.ccall;
  try { FS.mkdir('/input'); } catch(e) {}
  try { FS.mkdir('/output'); } catch(e) {}

  const b64 = %q;
  const raw = atob(b64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);

  console.log('文件大小:', bytes.length, 'bytes');

  const ptr = mod._malloc(bytes.length);
  mod.HEAPU8.set(bytes, ptr);
  const version = ccall('ysm_detect_version', 'number', ['number','number'], [ptr, bytes.length]);
  console.log('YSGP version:', version);

  const ok = ccall('ysm_decode_from_memory', 'number', ['number','number','string'], [ptr, bytes.length, '/output']);
  mod._free(ptr);
  console.log('decode result:', ok);

  if (ok) {
    const entries = FS.readdir('/output').filter(f => f !== '.' && f !== '..');
    console.log('输出文件:', JSON.stringify(entries));
    for (const f of entries) {
      const st = FS.stat('/output/' + f);
      console.log('  ' + f + ' (' + st.size + ' bytes)');
    }
  }
  process.exit(ok ? 0 : 1);
`, ysmB64))
	fmt.Println("\n✅ Node.js + YSMParser 解码成功！")
}
