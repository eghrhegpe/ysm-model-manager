package app

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"syscall"

	"ysm-model-manager/go/avatar"
	"ysm-model-manager/go/geometry"
	"ysm-model-manager/go/types"
)

// nodeJSPath 查找 node.js 可执行文件
var nodeJSPath = findNodeJS()

func init() {
	avatar.SetNodeJS(nodeJSPath, getGlueCode, getWasmBinary)
}

func findNodeJS() string {
	// PATH 查找（跨平台：Linux/macOS 命中 "node"，Windows 命中 "node.exe"）
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
type decodedYSMExtra struct {
	Path string
	Data []byte
}

// runYSMNodeJSDecode 用 Node.js + WASM 解码 .ysm，返回解出的全部文件（Path/Data）。
// decodeYSMViaNodeJS（合并单组件）与 decodeYSMComponentsViaNodeJS（多组件）共用此解码。
func runYSMNodeJSDecode(ysmData []byte) []decodedYSMExtra {
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

	var rawFiles []struct {
		Path string `json:"path"`
		Data []int  `json:"data"`
	}
	if err := json.Unmarshal([]byte(jsonStr), &rawFiles); err != nil {
		fmt.Fprintln(os.Stderr, "[ysm-node] JSON 解析失败:", err)
		return nil
	}
	files := make([]decodedYSMExtra, 0, len(rawFiles))
	for _, rf := range rawFiles {
		data := make([]byte, len(rf.Data))
		for i, v := range rf.Data {
			data[i] = byte(v)
		}
		files = append(files, decodedYSMExtra{Path: rf.Path, Data: data})
	}
	return files
}

// decodeYSMViaNodeJS 用 Node.js + WASM 解码 .ysm 并合并为单 BedrockModel（单组件模式）。
func decodeYSMViaNodeJS(ysmData []byte) *types.BedrockModel {
	files := runYSMNodeJSDecode(ysmData)
	if len(files) == 0 {
		return nil
	}

	// 找 geometry JSON 文件（合并全部组件 bones，保持历史单组件行为）
	var merged *types.BedrockModel
	for _, f := range files {
		low := strings.ToLower(f.Path)
		if !strings.HasSuffix(low, ".json") || strings.HasSuffix(low, "ysm.json") {
			continue
		}
		data := f.Data
		if g := geometry.ParseBedrockGeometry(data); g != nil {
			for bi := range g.Bones {
				for ci := range g.Bones[bi].Cubes {
					g.Bones[bi].Cubes[ci].CubeTexW = g.TexWidth
					g.Bones[bi].Cubes[ci].CubeTexH = g.TexHeight
				}
			}
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
		data := f.Data
		mime := "image/png"
		if strings.HasSuffix(low, ".jpg") {
			mime = "image/jpeg"
		}
		merged.Texture = "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(data)
		// 纹理名（去扩展名）供前端纹理列表显示，与 AnalyzeBedrockModel 的 Textures 契约一致
		tn := f.Path
		if idx := strings.LastIndexAny(tn, "/\\"); idx >= 0 {
			tn = tn[idx+1:]
		}
		tn = strings.TrimSuffix(tn, ".png")
		tn = strings.TrimSuffix(tn, ".jpg")
		merged.TextureNames = []string{tn}
		break
	}

	return merged
}

// decodeYSMComponentsViaNodeJS 解码 .ysm 并收集为多组件列表（不合并 bones）。
// 每个组件 = 独立 BedrockModel；TexSlot 按全局文件序分配（main 优先，其余按路径排序），
// 供 threejs.BuildMulti 生成多组件 spec（YSMViewer 式多组件同屏，arm 等保留为独立组件）。
func decodeYSMComponentsViaNodeJS(ysmData []byte) []types.BedrockModel {
	files := runYSMNodeJSDecode(ysmData)
	if len(files) == 0 {
		return nil
	}

	// 收集模型文件（ParseBedrockGeometry 非空的 .json；动画 JSON 解析为 nil 自动过滤）
	type mf struct {
		path string
		data []byte
	}
	var modelFiles []mf
	for _, f := range files {
		low := strings.ToLower(f.Path)
		if !strings.HasSuffix(low, ".json") || strings.HasSuffix(low, "ysm.json") {
			continue
		}
		if g := geometry.ParseBedrockGeometry(f.Data); g != nil {
			modelFiles = append(modelFiles, mf{path: f.Path, data: f.Data})
		}
	}
	if len(modelFiles) == 0 {
		return nil
	}
	// main 优先（YSMViewer 式主组件），其余按路径排序（确定性，ADR-039）
	// 注意：用 basename 判定 main（main.json / main.geo.json），与 zip 版
	// geometry.IsMainModelName 同口径——strings.Contains(..., "main.json")
	// 对 main.geo.json 不命中，会把 arm 排在 main 前（code_review P2）。
	sort.SliceStable(modelFiles, func(i, j int) bool {
		mi := geometry.IsMainModelName(modelFiles[i].path)
		mj := geometry.IsMainModelName(modelFiles[j].path)
		if mi != mj {
			return mi
		}
		return modelFiles[i].path < modelFiles[j].path
	})

	comps := make([]types.BedrockModel, 0, len(modelFiles))
	for i, mf := range modelFiles {
		g := geometry.ParseBedrockGeometry(mf.data)
		if g == nil {
			continue
		}
		// TexSlot = 全局纹理序（组件 i 的纹理起点；与 FindGeometryInExtractedYSM 的
		// 文件序 texSlot 口径一致，前端 texArr 全局数组按序索引）
		for bi := range g.Bones {
			for ci := range g.Bones[bi].Cubes {
				g.Bones[bi].Cubes[ci].CubeTexW = g.TexWidth
				g.Bones[bi].Cubes[ci].CubeTexH = g.TexHeight
				g.Bones[bi].Cubes[ci].TexSlot = i
			}
		}
		comps = append(comps, *g)
	}
	return comps
}
