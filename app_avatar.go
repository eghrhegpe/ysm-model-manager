// ========== 创作者头像提取 ==========
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
)

// creatorAvatarCacheDir 头像缓存目录（exe 同目录下的 creators_cache/）
func creatorAvatarCacheDir() string {
	exe, _ := os.Executable()
	return filepath.Join(filepath.Dir(exe), "creators_cache")
}

// CachedCreatorAvatar 检查缓存中是否有作者头像，返回 data URI
func (a *App) CachedCreatorAvatar(authorName string) (string, error) {
	safe := safeFilename(authorName)
	cachedPath := filepath.Join(creatorAvatarCacheDir(), safe+".png")
	data, err := os.ReadFile(cachedPath)
	if err != nil {
		return "", nil
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(data), nil
}

// BatchExtractCreatorAvatars 批量提取所有有本地模型的创作者头像
// 已缓存的跳过，只提取新头像
// 返回 { authorName: dataURI, ... }
func (a *App) BatchExtractCreatorAvatars() (map[string]string, error) {
	result := map[string]string{}
	if a.RepoRoot == "" {
		return result, nil
	}

	cacheDir := creatorAvatarCacheDir()
	os.MkdirAll(cacheDir, 0755)

	// 扫描仓库，收集每个作者的一个 .ysm 文件路径
	entries := a.ScanModelEntries(a.RepoRoot)
	seen := map[string]string{} // author -> ysmPath
	for _, e := range entries {
		name := e.Name
		if strings.HasSuffix(strings.ToLower(name), ".ban") {
			name = name[:len(name)-4]
		}
		if strings.HasPrefix(name, "[") {
			if idx := strings.Index(name, "]"); idx > 0 {
				author := name[1:idx]
				if author == "" {
					continue
				}
				if _, ok := seen[author]; !ok {
					ext := strings.ToLower(filepath.Ext(e.Path))
					if ext == ".ysm" {
						seen[author] = e.Path
					}
				}
			}
		}
	}

	for author, ysmPath := range seen {
		// 检查缓存
		safe := safeFilename(author)
		cachedPath := filepath.Join(cacheDir, safe+".png")
		if _, err := os.Stat(cachedPath); err == nil {
			data, _ := os.ReadFile(cachedPath)
			if data != nil {
				result[author] = "data:image/png;base64," + base64.StdEncoding.EncodeToString(data)
			}
			continue
		}

		// 提取头像
		dataURI := a.decodeOneAvatar(ysmPath, cacheDir, safe)
		if dataURI != "" {
			result[author] = dataURI
		}
	}

	return result, nil
}

// DebugExtractCreatorAvatar 调试版：提取指定作者头像，返回详细步骤信息
func (a *App) DebugExtractCreatorAvatar(authorName string) map[string]string {
	info := map[string]string{
		"author":   authorName,
		"repoRoot": a.RepoRoot,
		"step":     "init",
		"status":   "pending",
	}
	if a.RepoRoot == "" {
		info["status"] = "no_repo_root"
		info["step"] = "repo_root_empty"
		return info
	}

	// 1. 扫描仓库找该作者的模型文件
	entries := a.ScanModelEntries(a.RepoRoot)
	var foundPath string
	for _, e := range entries {
		name := e.Name
		if strings.HasSuffix(strings.ToLower(name), ".ban") {
			name = name[:len(name)-4]
		}
		if strings.HasPrefix(name, "[") {
			if idx := strings.Index(name, "]"); idx > 0 {
				author := name[1:idx]
				if author == authorName {
					ext := strings.ToLower(filepath.Ext(e.Path))
					if ext == ".ysm" {
						foundPath = e.Path
						info["found_path"] = foundPath
						break
					}
				}
			}
		}
	}
	if foundPath == "" {
		info["status"] = "no_model_file_found"
		info["step"] = "scan_failed"
		return info
	}
	info["step"] = "found_model"

	// 2. 读取文件
	ysmData, err := os.ReadFile(foundPath)
	if err != nil {
		info["status"] = "read_file_failed"
		info["error"] = err.Error()
		return info
	}
	info["file_size"] = fmt.Sprintf("%d", len(ysmData))
	info["step"] = "file_read"

	// 3. Node.js 路径
	info["node_path"] = nodeJSPath
	if nodeJSPath == "" {
		info["status"] = "no_nodejs"
		info["step"] = "node_not_found"
		return info
	}

	// 4. 解码
	files := decodeYSMFiles(ysmData)
	if len(files) == 0 {
		info["status"] = "decode_failed"
		info["step"] = "decode_returned_empty"
		return info
	}
	info["file_count"] = fmt.Sprintf("%d", len(files))
	info["step"] = "decoded"

	// 5. 列出所有文件路径
	var paths []string
	var hasAvatar bool
	for _, f := range files {
		low := strings.ToLower(f.Path)
		paths = append(paths, f.Path)
		if strings.HasPrefix(low, "avatar") || strings.Contains(low, "/avatar/") {
			hasAvatar = true
			info["avatar_path"] = f.Path
			info["avatar_size"] = fmt.Sprintf("%d", len(f.Data))
		}
	}
	info["all_files"] = strings.Join(paths, " | ")
	info["has_avatar_dir"] = fmt.Sprintf("%v", hasAvatar)

	if !hasAvatar {
		info["status"] = "no_avatar_in_ysm"
		info["step"] = "avatar_dir_missing"
		return info
	}

	// 6. 提取成功
	cacheDir := creatorAvatarCacheDir()
	os.MkdirAll(cacheDir, 0755)
	safe := safeFilename(authorName)
	cachedPath := filepath.Join(cacheDir, safe+".png")
	dataURI := a.decodeOneAvatar(foundPath, cacheDir, safe)
	if dataURI == "" {
		info["status"] = "extract_failed"
		info["step"] = "decode_one_avatar_failed"
		return info
	}
	info["cached_path"] = cachedPath
	info["data_uri_len"] = fmt.Sprintf("%d", len(dataURI))
	info["status"] = "ok"
	info["step"] = "done"
	return info
}

// decodeOneAvatar 解码 .ysm 文件并提取 avatar/ 下的头像
func (a *App) decodeOneAvatar(ysmPath, cacheDir, safeName string) string {
	ysmData, err := os.ReadFile(ysmPath)
	if err != nil {
		return ""
	}

	// 用 Node.js + WASM 解码
	files := decodeYSMFiles(ysmData)
	if len(files) == 0 {
		return ""
	}

	// 找 avatar/ 下的第一张图片
	for _, f := range files {
		low := strings.ToLower(f.Path)
		if !strings.HasSuffix(low, ".png") && !strings.HasSuffix(low, ".jpg") {
			continue
		}
		if !strings.HasPrefix(low, "avatar") && !strings.Contains(low, "/avatar/") {
			continue
		}
		data := make([]byte, len(f.Data))
		for i, v := range f.Data {
			data[i] = byte(v)
		}
		os.WriteFile(filepath.Join(cacheDir, safeName+".png"), data, 0644)
		mime := "image/png"
		if strings.HasSuffix(low, ".jpg") {
			mime = "image/jpeg"
		}
		return "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(data)
	}

	return ""
}

// safeFilename 安全文件名
func safeFilename(name string) string {
	r := strings.NewReplacer(
		"/", "_", "\\", "_", ":", "_", "*", "_",
		"?", "_", "\"", "_", "<", "_", ">", "_", "|", "_",
	)
	return r.Replace(name)
}

// decodeYSMFiles 底层解码，复用 Node.js + WASM，返回完整文件列表
func decodeYSMFiles(ysmData []byte) []struct {
	Path string `json:"path"`
	Data []int  `json:"data"`
} {
	if nodeJSPath == "" {
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

	cmd := exec.Command(nodeJSPath, scriptPath)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	cmd.Dir = tmpDir
	output, err := cmd.CombinedOutput()
	if err != nil {
		fmt.Fprintln(os.Stderr, "[ysm-avatar] 解码失败:", string(output))
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
