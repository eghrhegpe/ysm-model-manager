// Package avatar 创作者头像提取与缓存，不依赖 Wails runtime。
package avatar

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"strings"
	"time"
)

// CacheDir 返回头像缓存目录（exe 同目录下的 creators_cache/）。
// 外部可覆盖此函数（测试时可设置临时目录）。
var CacheDir = func() string {
	exe, _ := os.Executable()
	return filepath.Join(filepath.Dir(exe), "creators_cache")
}

type authorEntry struct {
	Name   string `json:"name"`
	Role   string `json:"role,omitempty"`
	Avatar string `json:"avatar,omitempty"`
}

// SafeName 将非法文件名字符替换为下划线。
func SafeName(name string) string {
	r := strings.NewReplacer(
		"/", "_", "\\", "_", ":", "_", "*", "_",
		"?", "_", "\"", "_", "<", "_", ">", "_", "|", "_",
	)
	safe := r.Replace(name)
	// P2 修复：Windows 保留设备名（CON/PRN/AUX/NUL/COM1-9/LPT1-9）与尾部点/空格
	// 会导致缓存写失败（"CON.png" 被系统拒绝）；去尾后与保留名比对则加下划线前缀
	safe = strings.TrimRight(safe, " .")
	base := safe
	// P3 修复（code_review）：按 '.' 与 '_' 均分割——Windows 保留设备名
	// 无论带什么扩展名/后缀都被系统拒绝（CON.png / COM1.config / CON.Doe），
	// 原实现只按 '_' 分割导致点号变体逃逸
	if idx := strings.IndexAny(base, "._"); idx >= 0 {
		base = base[:idx]
	}
	switch strings.ToUpper(base) {
	case "CON", "PRN", "AUX", "NUL",
		"COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
		"LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9":
		return "_" + safe
	}
	return safe
}

// isSafeAvatarPath 强校验头像相对路径：
// Clean 规范化后必须位于 "avatar" 目录下（严格前缀），且不含 ".." 逃逸段。
// P1 修复：原 HasPrefix("avatar") 弱校验放行 "avatar/../../x" 逃出模型目录，
// 且 "avatars/.."、"avatarx/.." 等非精确目录也会误放行。
// P2 修复（code_review）：接受裸文件名（"alice.png" → avatar/alice.png 归一化），
// 兼容 ysm.json 中不带 avatar/ 前缀的旧式声明——安全目标（拒绝 .. 逃逸）不牺牲兼容。
func isSafeAvatarPath(ap string) bool {
	// P3 修复（code_review）：先把反斜杠归一化为正斜杠再校验——原新增守卫
	// `strings.Contains(ap, "\\") → return false` 会把 Windows 上合法的 `avatar\alice.png`
	// 分隔写法也拒绝（filepath.Join 在 Windows 上解析到 avatar/ 内，改动前正常工作）；
	// 归一化后合法反斜杠路径放行，逃逸形态 `avatar\..\x` 折叠为 `avatar/../x` 被既有
	// `..` 段检查拒绝（顺带封住 Windows 反斜杠逃逸）
	ap = strings.ReplaceAll(ap, "\\", "/")
	clean := path.Clean(strings.ToLower(strings.TrimSpace(ap)))
	if clean == "avatar" {
		return true
	}
	if !strings.HasPrefix(clean, "avatar/") {
		// 裸文件名：归一化为 avatar/ 前缀再校验（旧式 ysm.json 声明兼容）。
		// P3 修复：仅当原始串不含 `/`（确为纯文件名）时才归一化——原实现对任意
		// 非 avatar/ 前缀路径归一化，`avatar/../x` 先被 path.Clean 折叠为 `x`
		// 再归一化为 `avatar/x` 放行，而调用方 filepath.Join(dir, 原始路径)
		// 实际读到 avatar/ 之外、模型目录内的任意文件（违反「严格 avatar/ 前缀」）
		if strings.Contains(ap, "/") {
			return false
		}
		clean = path.Clean("avatar/" + clean)
	}
	// 拒绝任何 ".." 段（Clean 后仍含则说明原路径有逃逸意图）
	for _, seg := range strings.Split(clean, "/") {
		if seg == ".." {
			return false
		}
	}
	return strings.HasPrefix(clean, "avatar/")
}

// ReadCachedAvatar 读取缓存中的头像，返回 data URI。
// 缓存未命中时返回 ("", nil)，IO 错误时返回 ("", err)。
func ReadCachedAvatar(authorName string) (string, error) {
	safe := SafeName(authorName)
	cachedPath := filepath.Join(CacheDir(), safe+".png")
	data, err := os.ReadFile(cachedPath)
	if err != nil {
		if os.IsNotExist(err) {
			return "", nil // 缓存未命中，非错误
		}
		return "", err // IO 错误（权限/磁盘故障等）
	}
	// P3 修复：按文件头嗅探 mime——原硬编码 `data:image/png`，JPEG 头像以 .png 落盘
	// （SaveAvatarData 恒用 safeName+".png"）读回时 MIME 错误（前端 <img> 仍可显示，
	// 但导出/复制 data URI 给其他工具时 type 不匹配）
	mime := "image/png"
	if len(data) >= 3 && data[0] == 0xFF && data[1] == 0xD8 && data[2] == 0xFF {
		mime = "image/jpeg"
	}
	return "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(data), nil
}

// SaveAvatarData 将头像数据写入缓存。
func SaveAvatarData(safeName string, data []byte, mime string) string {
	if err := os.MkdirAll(CacheDir(), 0755); err != nil {
		log.Printf("[avatar] 缓存目录创建失败: %v", err)
	}
	if err := os.WriteFile(filepath.Join(CacheDir(), safeName+".png"), data, 0644); err != nil {
		log.Printf("[avatar] 缓存写入失败: %v", err)
	}
	return "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(data)
}

// DecodeOneAvatar 从模型文件中提取指定所有者的头像。
// modelPath 支持 .ysm / .zip / .7z / .json（解压目录）。
func DecodeOneAvatar(modelPath, cacheDir, safeName string) string {
	ext := strings.ToLower(filepath.Ext(modelPath))
	var authors []authorEntry

	switch ext {
	case ".ysm":
		ysmData, err := os.ReadFile(modelPath)
		if err != nil {
			return ""
		}
		files := DecodeYSMFiles(ysmData)
		if len(files) == 0 {
			return ""
		}
		// 找 ysm.json
		for _, f := range files {
			if strings.HasSuffix(strings.ToLower(f.Path), "ysm.json") {
				data := toBytes(f.Data)
				var root struct {
					Meta struct {
						Authors []authorEntry `json:"authors"`
					} `json:"metadata"`
				}
				if json.Unmarshal(data, &root) == nil {
					authors = root.Meta.Authors
				}
				break
			}
		}
		if len(authors) == 0 {
			// 降级：取 avatar/ 目录第一张
			for _, f := range files {
				low := strings.ToLower(f.Path)
				if !strings.HasSuffix(low, ".png") && !strings.HasSuffix(low, ".jpg") {
					continue
				}
				if !strings.HasPrefix(low, "avatar") && !strings.Contains(low, "/avatar/") {
					continue
				}
				mime := "image/png"
				if strings.HasSuffix(low, ".jpg") {
					mime = "image/jpeg"
				}
				return SaveAvatarData(safeName, toBytes(f.Data), mime)
			}
		}
		// 按作者名匹配
		for _, f := range files {
			for _, au := range authors {
				if SafeName(au.Name) == safeName && au.Avatar != "" {
					ap := strings.ToLower(au.Avatar)
					if !strings.HasPrefix(ap, "avatar") && !strings.Contains(ap, "/avatar/") {
						continue
					}
					fp := strings.ToLower(f.Path)
					if fp == ap || strings.HasSuffix(fp, "/"+ap) || strings.HasSuffix(fp, "\\"+ap) {
						mime := "image/png"
						if strings.HasSuffix(fp, ".jpg") {
							mime = "image/jpeg"
						}
						return SaveAvatarData(safeName, toBytes(f.Data), mime)
					}
				}
			}
		}

	case ".zip":
		data, err := os.ReadFile(modelPath)
		if err != nil {
			return ""
		}
		zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
		if err != nil {
			return ""
		}
		ysmData := ReadFileFromZip(zr, "ysm.json")
		if ysmData != nil {
			var root struct {
				Meta struct {
					Authors []authorEntry `json:"authors"`
				} `json:"metadata"`
			}
			if json.Unmarshal(ysmData, &root) == nil {
				authors = root.Meta.Authors
			}
		}
		for _, au := range authors {
			if SafeName(au.Name) == safeName && au.Avatar != "" {
				ap := strings.ToLower(au.Avatar)
				if !strings.HasPrefix(ap, "avatar") && !strings.Contains(ap, "/avatar/") {
					continue
				}
				if avatarData := ReadFileFromZip(zr, au.Avatar); avatarData != nil {
					mime := "image/png"
					if strings.HasSuffix(strings.ToLower(au.Avatar), ".jpg") {
						mime = "image/jpeg"
					}
					return SaveAvatarData(safeName, avatarData, mime)
				}
			}
		}

	case ".json":
		data, err := os.ReadFile(modelPath)
		if err != nil {
			return ""
		}
		var root struct {
			Meta struct {
				Authors []authorEntry `json:"authors"`
			} `json:"metadata"`
		}
		if json.Unmarshal(data, &root) == nil {
			authors = root.Meta.Authors
		}
		dir := filepath.Dir(modelPath)
		for _, au := range authors {
			if SafeName(au.Name) == safeName && au.Avatar != "" {
				ap := strings.ToLower(au.Avatar)
				// P1 修复：强校验（Clean + avatar/ 前缀 + 拒绝 ..），防 avatar/../../x 逃逸读任意文件
				if !isSafeAvatarPath(ap) {
					continue
				}
				avatarPath := filepath.Join(dir, au.Avatar)
				// 落盘前 Rel 复查：Join 后必须仍在模型目录内
				if rel, err := filepath.Rel(dir, avatarPath); err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
					continue
				}
				if avatarData, err := os.ReadFile(avatarPath); err == nil {
					mime := "image/png"
					if strings.HasSuffix(strings.ToLower(au.Avatar), ".jpg") {
						mime = "image/jpeg"
					}
					return SaveAvatarData(safeName, avatarData, mime)
				}
			}
		}
	}
	return ""
}

// CacheAvatarsFromJSON 从解压目录的 ysm.json 缓存所有作者头像。
func CacheAvatarsFromJSON(modelPath string) {
	if !strings.HasSuffix(strings.ToLower(modelPath), ".json") {
		return
	}
	data, err := os.ReadFile(modelPath)
	if err != nil {
		return
	}
	var root struct {
		Meta struct {
			Authors []struct {
				Name   string `json:"name"`
				Avatar string `json:"avatar"`
			} `json:"authors"`
		} `json:"metadata"`
	}
	if json.Unmarshal(data, &root) != nil {
		return
	}
	dir := filepath.Dir(modelPath)
	cacheDir := CacheDir()
	os.MkdirAll(cacheDir, 0755)
	for _, au := range root.Meta.Authors {
		if au.Name == "" || au.Avatar == "" {
			continue
		}
		safe := SafeName(au.Name)
		cachedPath := filepath.Join(cacheDir, safe+".png")
		if _, err := os.Stat(cachedPath); err == nil {
			continue
		}
		ap := au.Avatar
		// P1 修复：强校验（Clean + avatar/ 前缀 + 拒绝 ..），防逃逸读模型目录外文件并写入缓存
		if !isSafeAvatarPath(ap) {
			continue
		}
		avatarPath := filepath.Join(dir, ap)
		// Rel 复查：Join 后必须仍在模型目录内
		if rel, err := filepath.Rel(dir, avatarPath); err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			continue
		}
		if avatarData, err := os.ReadFile(avatarPath); err == nil {
			if err := os.WriteFile(cachedPath, avatarData, 0644); err != nil {
				log.Printf("[avatar] 缓存写入失败 %s: %v", cachedPath, err)
			}
		}
	}
}

// ReadFileFromZip 从 ZIP 读取指定路径的文件。
func ReadFileFromZip(zr *zip.Reader, target string) []byte {
	target = strings.ReplaceAll(target, "\\", "/")
	for _, f := range zr.File {
		p := strings.ReplaceAll(f.Name, "\\", "/")
		if strings.HasSuffix(strings.ToLower(p), strings.ToLower(target)) {
			rc, err := f.Open()
			if err != nil {
				return nil
			}
			defer rc.Close()
			data, err := io.ReadAll(rc)
			if err != nil {
				return nil
			}
			return data
		}
	}
	return nil
}

// DecodeYSMFiles 通过 Node.js + WASM 解码 YSM 文件。
// nodeJSPath 是 Node.js 可执行文件路径（可全局设置）。
var nodeJSPath string

var getGlueCode func() string
var getWasmBinary func() []byte

// SetNodeJS 设置 Node.js 路径和 WASM/胶水代码加载函数。
func SetNodeJS(nodePath string, glueFn func() string, wasmFn func() []byte) {
	nodeJSPath = nodePath
	getGlueCode = glueFn
	getWasmBinary = wasmFn
}

// DecodeYSMFiles 底层解码，返回完整文件列表。
func DecodeYSMFiles(ysmData []byte) []struct {
	Path string `json:"path"`
	Data []int  `json:"data"`
} {
	if nodeJSPath == "" || getGlueCode == nil || getWasmBinary == nil {
		return nil
	}
	glueRaw := getGlueCode()
	wasmBin := getWasmBinary()
	if len(glueRaw) == 0 || len(wasmBin) == 0 {
		return nil
	}
	gluePatched := strings.ReplaceAll(glueRaw,
		";updateMemoryViews()",
		`;updateMemoryViews();Module["HEAPU8"]=HEAPU8`)

	tmpDir, err := os.MkdirTemp("", "ysm-avatar-*")
	if err != nil {
		return nil
	}
	defer os.RemoveAll(tmpDir)

	glueFile := filepath.Join(tmpDir, "YSMParser_patched.js")
	if err := os.WriteFile(glueFile, []byte(gluePatched), 0644); err != nil {
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
	if err := os.WriteFile(scriptPath, []byte(script), 0644); err != nil {
		return nil
	}
	// P2 修复：子进程加超时护栏（WASM 死循环/Node 卡死时防永久挂起冻结 UI 线程）
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, nodeJSPath, scriptPath)
	hideWindow(cmd)
	cmd.Dir = tmpDir
	output, err := cmd.CombinedOutput()
	if err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			fmt.Fprintln(os.Stderr, "[ysm-avatar] decode timed out after 60s")
			return nil
		}
		fmt.Fprintln(os.Stderr, "[ysm-avatar] decode failed:", string(output))
		return nil
	}
	outStr := string(output)
	idx := strings.Index(outStr, "FILES_JSON:")
	if idx < 0 {
		return nil
	}
	jsonStr := outStr[idx+len("FILES_JSON:"):]
	var files []struct {
		Path string `json:"path"`
		Data []int  `json:"data"`
	}
	if err := json.Unmarshal([]byte(jsonStr), &files); err != nil {
		return nil
	}
	return files
}

func toBytes(data []int) []byte {
	b := make([]byte, len(data))
	for i, v := range data {
		b[i] = byte(v)
	}
	return b
}
