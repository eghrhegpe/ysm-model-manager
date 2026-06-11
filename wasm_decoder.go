package main

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"

	"ysm-model-manager/go/types"
)

// nodeJSPath 查找 node.js 可执行文件
var nodeJSPath = findNodeJS()

func findNodeJS() string {
	// 已知路径（emsdk 自带）
	candidates := []string{
		"C:\\Users\\zhujieling11\\emsdk\\node\\22.16.0_64bit\\bin\\node.exe",
		"C:\\Users\\zhujieling11\\emsdk\\node\\22.16.0_64bit\\node.exe",
	}
	for _, p := range candidates {
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	// PATH 查找
	if p, err := exec.LookPath("node"); err == nil {
		return p
	}
	if p, err := exec.LookPath("node.exe"); err == nil {
		return p
	}
	return ""
}

// decodeYSMViaNodeJS 用 Node.js + WASM 解码 .ysm 文件
// 嵌入的 JS 胶水代码和 WASM 二进制会写到临时目录执行
func decodeYSMViaNodeJS(ysmData []byte) *types.BedrockModel {
	if nodeJSPath == "" {
		return nil
	}

	// 读取内嵌的胶水代码和 WASM 二进制
	glueRaw := getGlueCode()
	wasmBin := getWasmBinary()
	if len(glueRaw) == 0 || len(wasmBin) == 0 {
		return nil
	}

	// Patch 胶水代码暴露 HEAPU8
	gluePatched := strings.ReplaceAll(glueRaw,
		";updateMemoryViews()",
		`;updateMemoryViews();Module["HEAPU8"]=HEAPU8`)

	tmpDir, err := os.MkdirTemp("", "ysm-node-*")
	if err != nil {
		return nil
	}
	defer os.RemoveAll(tmpDir)

	// 写入 WASM 和胶水代码
	glueFile := filepath.Join(tmpDir, "YSMParser_patched.js")
	if err := os.WriteFile(glueFile, []byte(gluePatched), 0644); err != nil {
		return nil
	}

	// 构建解码脚本：通过 FS 写文件 + callMain（绕开 _malloc 导出问题）
	ysmB64 := base64.StdEncoding.EncodeToString(ysmData)
	wasmB64 := base64.StdEncoding.EncodeToString(wasmBin)
	script := fmt.Sprintf(`const YSMParser = require(%q);
const wb64=%q;const wb=Uint8Array.from(atob(wb64),c=>c.charCodeAt(0));
const yb64=%q;const yr=atob(yb64);const ys=new Uint8Array(yr.length);
for(let i=0;i<yr.length;i++)ys[i]=yr.charCodeAt(i);
async function main(){
  const mod=await YSMParser({wasmBinary:wb.buffer,noInitialRun:true});
  const FS=mod.FS;
  try{FS.mkdir('/input')}catch(e){}
  try{FS.mkdir('/output')}catch(e){}
  FS.writeFile('/input/model.ysm',ys);
  try{mod.callMain(['-i','/input','-o','/output'])}catch(e){
    if(!(e&&e.name==='ExitStatus'))throw e}
  function cl(dir){
    const r=[];const es=FS.readdir(dir).filter(f=>f!=='.'&&f!=='..');
    for(const e of es){const p=dir+'/'+e;
      if(FS.isDir(FS.stat(p).mode)){r.push(...cl(p))}
      else{r.push({path:p,data:Array.from(FS.readFile(p))})}}
    return r}
  console.log('FILES_JSON:'+JSON.stringify(cl('/output')));
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1)});
`, glueFile, wasmB64, ysmB64)

	scriptPath := filepath.Join(tmpDir, "decode.cjs")
	if err := os.WriteFile(scriptPath, []byte(script), 0644); err != nil {
		return nil
	}

	// 执行
	cmd := exec.Command(nodeJSPath, scriptPath)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	cmd.Dir = tmpDir
	output, err := cmd.CombinedOutput()
	if err != nil {
		fmt.Fprintln(os.Stderr, "[ysm-node] 解码失败:", string(output))
		return nil
	}

	// 解析输出：找 FILES_JSON: 标记行
	outStr := string(output)
	idx := strings.Index(outStr, "FILES_JSON:")
	if idx < 0 {
		fmt.Fprintln(os.Stderr, "[ysm-node] 未找到输出标记")
		return nil
	}
	jsonStr := outStr[idx+len("FILES_JSON:"):]

	var files []struct {
		Path string `json:"path"`
		Data []int  `json:"data"`
	}
	if err := json.Unmarshal([]byte(jsonStr), &files); err != nil {
		fmt.Fprintln(os.Stderr, "[ysm-node] JSON 解析失败:", err)
		return nil
	}

	// 找 geometry JSON 文件
	var merged *types.BedrockModel
	for _, f := range files {
		low := strings.ToLower(f.Path)
		if !strings.HasSuffix(low, ".json") || strings.HasSuffix(low, "ysm.json") {
			continue
		}
		data := make([]byte, len(f.Data))
		for i, v := range f.Data {
			data[i] = byte(v)
		}
		if g := parseBedrockGeometry(data); g != nil {
			if merged == nil {
				merged = g
			} else {
				merged.Bones = append(merged.Bones, g.Bones...)
				merged.BoneCount += g.BoneCount
				merged.CubeCount += g.CubeCount
			}
		}
	}

	if merged == nil {
		return nil
	}

	// 找纹理
	for _, f := range files {
		low := strings.ToLower(f.Path)
		if !strings.HasSuffix(low, ".png") && !strings.HasSuffix(low, ".jpg") {
			continue
		}
		if strings.Contains(low, "avatar/") {
			continue
		}
		data := make([]byte, len(f.Data))
		for i, v := range f.Data {
			data[i] = byte(v)
		}
		mime := "image/png"
		if strings.HasSuffix(low, ".jpg") {
			mime = "image/jpeg"
		}
		merged.Texture = "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(data)
		break
	}

	return merged
}
