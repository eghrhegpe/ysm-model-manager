// Package avatar 创作者头像提取与缓存，不依赖 Wails runtime。
//
// 本文件（avatar_decode.go）：Node.js + WASM 解码桥——SetNodeJS 注入 Node/WASM 资源、
// DecodeYSMData 统一解码实现（ADR-164：收敛 internal/app wasm_decoder.go 逐字复刻双胞胎，
// 全仓唯一副本）、DecodeYSMFiles 兼容薄封装、limitedBuffer 输出护栏与 toBytes 字节转换。
// 拆分自原 avatar.go（ADR-040 文件行数治理）。
package avatar

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"ysm-model-manager/go/executil"
	"ysm-model-manager/go/fsutil"
)

// WASM 解码子进程超时上限
const decodeTimeout = 60 * time.Second

// decodeMaxInput 子进程解码输入 .ysm 上限（>200MB 拒绝，防超大输入拖垮子进程/内存膨胀；
// ADR-164 统一补齐——原 avatar 无输入护栏，对齐 internal/app ysmDecodeMaxInput 口径；
// avatar 调用方 readLimitedModel 50MB 限读，此护栏为 app 共用路径兜底）。
const decodeMaxInput = 200 << 20

// decodeMaxOutput 解码子进程 stdout 上限（防恶意模型输出膨胀拖垮内存；对齐 internal/app ysmDecodeMaxOutput 口径）
const decodeMaxOutput = 200 << 20

// nodeEnv 持有 SetNodeJS 注入的解码环境。启动期一次注入、运行时只读；
// 重置场景经 mutex 串行化（根 AGENTS「重置场景必须用 Mutex」，sync.Once 不可复用）。
type nodeEnv struct {
	mu       sync.Mutex
	nodePath string
	glue     func() string
	wasm     func() []byte
}

var env nodeEnv

// SetNodeJS 设置 Node.js 路径和 WASM/胶水代码加载函数（线程安全）。
func SetNodeJS(nodePath string, glueFn func() string, wasmFn func() []byte) {
	env.mu.Lock()
	env.nodePath, env.glue, env.wasm = nodePath, glueFn, wasmFn
	env.mu.Unlock()
}

// getEnv 读取当前注入环境（线程安全快照，DecodeYSMFiles 一次性取用）。
func getEnv() (string, func() string, func() []byte) {
	env.mu.Lock()
	defer env.mu.Unlock()
	return env.nodePath, env.glue, env.wasm
}

// limitedBuffer 流式输出护栏：写满 max 后丢弃超限部分并置 exceeded，保持内存有界
// （与 internal/app wasm_decoder.go 同款，跨包无法共享故本地复制最小实现；
// 防解压炸弹在 Node/WASM 内膨胀到数百 MB~GB 级峰值内存）。
type limitedBuffer struct {
	buf      bytes.Buffer
	max      int
	exceeded bool
}

func (l *limitedBuffer) Write(p []byte) (int, error) {
	if l.buf.Len()+len(p) > l.max {
		l.exceeded = true
		return len(p), nil // 丢弃超限部分，保持内存有界
	}
	return l.buf.Write(p)
}

// ysmDecodedFile DecodeYSMData 返回的单个解码文件（Path 已剥 /output/ 前缀）。
type ysmDecodedFile struct {
	Path string
	Data []byte
}

// DecodeYSMData 底层解码 .ysm，返回完整文件列表（Path 剥 /output/ 前缀，Data 为原始字节）。
// ADR-164 统一实现：go/avatar 与 internal/app 双胞胎桥收敛后全仓唯一副本
// （internal/app runYSMNodeJSDecode 变薄封装调本函数）。
// 返回 nil 表示解码不可用/失败（未注入、输入超限、超时、输出超限、标记缺失、JSON 解析失败）。
func DecodeYSMData(ysmData []byte) []ysmDecodedFile {
	nodePath, glueFn, wasmFn := getEnv()
	if nodePath == "" || glueFn == nil || wasmFn == nil {
		return nil
	}
	// 输入大小护栏：超大/畸形 .ysm 直接拒绝，不进入子进程（防内存膨胀/拖垮）
	if len(ysmData) > decodeMaxInput {
		log.Printf("[avatar] 输入 .ysm 过大: %d bytes (上限 %d)\n", len(ysmData), decodeMaxInput)
		return nil
	}
	glueRaw := glueFn()
	wasmBin := wasmFn()
	if len(glueRaw) == 0 || len(wasmBin) == 0 {
		return nil
	}
	gluePatched := strings.ReplaceAll(glueRaw,
		";updateMemoryViews()",
		`;updateMemoryViews();Module["HEAPU8"]=HEAPU8`)

	tmpDir, err := os.MkdirTemp("", "ysm-avatar-*")
	if err != nil {
		log.Printf("[avatar] 创建临时目录失败: %v", err)
		return nil
	}
	defer os.RemoveAll(tmpDir)

	glueFile := filepath.Join(tmpDir, "YSMParser_patched.js")
	if err := os.WriteFile(glueFile, []byte(gluePatched), fsutil.FilePerms); err != nil {
		log.Printf("[avatar] 写入 glue 脚本失败: %v", err)
		return nil
	}
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
      else{r.push({path:p.substring(8),data:Array.from(FS.readFile(p))})}}
    return r}
  console.log('FILES_JSON:'+JSON.stringify(cl('/output')));
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1)});
`, glueFile, wasmB64, ysmB64)

	scriptPath := filepath.Join(tmpDir, "decode.cjs")
	if err := os.WriteFile(scriptPath, []byte(script), fsutil.FilePerms); err != nil {
		log.Printf("[avatar] 写入 decode 脚本失败: %v", err)
		return nil
	}
	// 子进程加超时护栏（WASM 死循环/Node 卡死时防永久挂起冻结 UI 线程）
	ctx, cancel := context.WithTimeout(context.Background(), decodeTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, nodePath, scriptPath)
	executil.HideWindow(cmd)
	cmd.Dir = tmpDir
	// 输出护栏：stdout 流式截断（防解压炸弹在 Node/WASM 内膨胀到数百 MB~GB 级峰值内存），
	// stderr 同样受限缓冲（8MB 封顶），仅用于失败诊断
	outLimited := &limitedBuffer{max: decodeMaxOutput}
	errLimited := &limitedBuffer{max: 8 << 20} // stderr 仅诊断用，8MB 封顶
	cmd.Stdout = outLimited
	cmd.Stderr = errLimited
	if err := cmd.Run(); err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			fmt.Fprintf(os.Stderr, "[ysm-avatar] decode timed out after %v\n", decodeTimeout)
			return nil
		}
		if errLimited.exceeded {
			// limitedBuffer 超限时整段丢弃，buf 可能短于 512——先取长度再切片，
			// 防诊断输出自身 panic（[:512] 越界）
			diag := errLimited.buf.String()
			if len(diag) > 512 {
				diag = diag[:512]
			}
			fmt.Fprintln(os.Stderr, "[ysm-avatar] decode failed (stderr too large):", diag)
		} else {
			fmt.Fprintln(os.Stderr, "[ysm-avatar] decode failed:", errLimited.buf.String())
		}
		return nil
	}
	if outLimited.exceeded {
		log.Printf("[avatar] 解码输出过大 (上限 %d)", decodeMaxOutput)
		return nil
	}
	output := outLimited.buf.Bytes()
	outStr := string(output)
	idx := strings.Index(outStr, "FILES_JSON:")
	if idx < 0 {
		return nil
	}
	jsonStr := outStr[idx+len("FILES_JSON:"):]
	// 中间形态走 []int：Node 脚本输出数字数组（Array.from(FS.readFile)），
	// json 对 []byte 字段的数组解码语义不透明，[]int → toBytes 显式转换
	var rawFiles []struct {
		Path string `json:"path"`
		Data []int  `json:"data"`
	}
	if err := json.Unmarshal([]byte(jsonStr), &rawFiles); err != nil {
		return nil
	}
	files := make([]ysmDecodedFile, len(rawFiles))
	for i, rf := range rawFiles {
		files[i] = ysmDecodedFile{Path: rf.Path, Data: toBytes(rf.Data)}
	}
	return files
}

// DecodeYSMFiles 兼容薄封装（ADR-164）：调统一实现 DecodeYSMData 后转 []int——
// 历史签名返回 JSON 数组形态（前端绑定面遗留），avatar_extract.go:37/384 两处消费方
// 依赖此形态，保持不变；新代码应直接用 DecodeYSMData 的 []byte 直通形态。
func DecodeYSMFiles(ysmData []byte) []struct {
	Path string `json:"path"`
	Data []int  `json:"data"`
} {
	files := DecodeYSMData(ysmData)
	if len(files) == 0 {
		return nil
	}
	out := make([]struct {
		Path string `json:"path"`
		Data []int  `json:"data"`
	}, len(files))
	for i, f := range files {
		out[i] = struct {
			Path string `json:"path"`
			Data []int  `json:"data"`
		}{Path: f.Path, Data: toInts(f.Data)}
	}
	return out
}

func toBytes(data []int) []byte {
	b := make([]byte, len(data))
	for i, v := range data {
		b[i] = byte(v)
	}
	return b
}

// toInts 兼容薄封装的 []byte → []int 转换（DecodeYSMFiles 历史 []int 形态）。
// []byte 是内部统一形态（DecodeYSMData），仅老签名出口需要转回。
func toInts(data []byte) []int {
	out := make([]int, len(data))
	for i, v := range data {
		out[i] = int(v)
	}
	return out
}
