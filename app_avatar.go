// ========== 创作者头像提取 ==========
package main

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
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
// 支持 .ysm / .zip / .7z / 解压目录
// 返回 { authorName: dataURI, ... }
func (a *App) BatchExtractCreatorAvatars() (map[string]string, error) {
	result := map[string]string{}
	if a.ysmRoot() == "" {
		return result, nil
	}

	cacheDir := creatorAvatarCacheDir()
	os.MkdirAll(cacheDir, 0755)

	// 扫描仓库，收集每个作者的一个模型文件路径
	entries := a.ScanModelEntries(a.ysmRoot())
	seen := map[string]string{} // author -> modelPath
	for _, e := range entries {
		name := e.Name
		if strings.HasSuffix(strings.ToLower(name), ".ban") {
			name = name[:len(name)-4]
		}
		if strings.HasPrefix(name, "[") {
			if idx := strings.Index(name, "]"); idx > 0 {
				author := strings.TrimSpace(name[1:idx])
				if author == "" {
					continue
				}
				if _, ok := seen[author]; !ok {
					ext := strings.ToLower(filepath.Ext(e.Path))
					if ext == ".ysm" || ext == ".zip" || ext == ".7z" || ext == ".json" {
						seen[author] = e.Path
					}
				}
			}
		}
	}

	for author, modelPath := range seen {
		safe := safeFilename(author)
		cachedPath := filepath.Join(cacheDir, safe+".png")
		if _, err := os.Stat(cachedPath); err == nil {
			data, _ := os.ReadFile(cachedPath)
			if data != nil {
				result[author] = "data:image/png;base64," + base64.StdEncoding.EncodeToString(data)
			}
			continue
		}
		dataURI := a.decodeOneAvatar(modelPath, cacheDir, safe)
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
		"repoRoot": a.ysmRoot(),
		"step":     "init",
		"status":   "pending",
	}
	if a.ysmRoot() == "" {
		info["status"] = "no_repo_root"
		return info
	}

	entries := a.ScanModelEntries(a.ysmRoot())
	var foundPath string
	for _, e := range entries {
		name := e.Name
		if strings.HasSuffix(strings.ToLower(name), ".ban") {
			name = name[:len(name)-4]
		}
		if strings.HasPrefix(name, "[") {
			if idx := strings.Index(name, "]"); idx > 0 {
				author := strings.TrimSpace(name[1:idx])
				if author == authorName {
					ext := strings.ToLower(filepath.Ext(e.Path))
					if ext == ".ysm" || ext == ".zip" || ext == ".7z" || ext == ".json" {
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
		return info
	}
	info["step"] = "found_model"

	cacheDir := creatorAvatarCacheDir()
	os.MkdirAll(cacheDir, 0755)
	safe := safeFilename(authorName)
	info["step"] = "extracting"
	dataURI := a.decodeOneAvatar(foundPath, cacheDir, safe)
	if dataURI == "" {
		info["status"] = "extract_failed"
		return info
	}
	info["cached_path"] = filepath.Join(cacheDir, safe+".png")
	info["data_uri_len"] = fmt.Sprintf("%d", len(dataURI))
	info["status"] = "ok"
	return info
}

// decodeOneAvatar 从模型文件中提取指定所有者的头像
// 支持 .ysm (WASM解码)、.zip/.7z (直接解析)、.json (解压目录)
func (a *App) decodeOneAvatar(modelPath, cacheDir, safeName string) string {
	ext := strings.ToLower(filepath.Ext(modelPath))

	// 读取 ysm.json 获取作者→头像路径映射
	type authorEntry struct {
		Name    string `json:"name"`
		Role    string `json:"role,omitempty"`
		Avatar  string `json:"avatar,omitempty"`
	}
	var authors []authorEntry

	switch ext {
	case ".ysm":
		ysmData, err := os.ReadFile(modelPath)
		if err != nil {
			return ""
		}
		files := decodeYSMFiles(ysmData)
		if len(files) == 0 {
			return ""
		}
		log.Printf("[avatar] ysm 解码文件数=%d", len(files))
		// 找 ysm.json 解析作者列表
		for _, f := range files {
			if strings.HasSuffix(strings.ToLower(f.Path), "ysm.json") {
				data := make([]byte, len(f.Data))
				for i, v := range f.Data {
					data[i] = byte(v)
				}
				var root struct {
					Meta struct {
						Authors []authorEntry `json:"authors"`
					} `json:"metadata"`
				}
				if json.Unmarshal(data, &root) == nil {
					authors = root.Meta.Authors
					log.Printf("[avatar] ysm.json 作者数=%d", len(authors))
					for _, au := range authors {
						log.Printf("[avatar]   作者=%s avatar=%s", au.Name, au.Avatar)
					}
				}
				break
			}
		}
		// 列出所有文件找 avatar/ 目录的
		for _, f := range files {
			low := strings.ToLower(f.Path)
			if strings.HasPrefix(low, "avatar") || strings.Contains(low, "/avatar/") {
				log.Printf("[avatar] 找到头像文件: %s (%d bytes)", f.Path, len(f.Data))
			}
		}
		if len(authors) == 0 {
			// 降级：无作者信息时取 avatar/ 目录第一张
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
				log.Printf("[avatar] 保存: %s (%d bytes)", filepath.Join(cacheDir, safeName+".png"), len(data)); log.Printf("[avatar] 保存: %s (%d bytes)", filepath.Join(cacheDir, safeName+".png"), len(data)); os.WriteFile(filepath.Join(cacheDir, safeName+".png"), data, 0644)
				mime := "image/png"
				if strings.HasSuffix(low, ".jpg") {
					mime = "image/jpeg"
				}
				return "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(data)
			}
		}
	// 按作者名匹配头像路径
	for _, f := range files {
		for _, au := range authors {
			if safeFilename(au.Name) == safeName && au.Avatar != "" {
				ap := strings.ToLower(au.Avatar)
				// 只接受 avatar/ 目录下的文件，拒绝 textures/ 等
				if !strings.HasPrefix(ap, "avatar") && !strings.Contains(ap, "/avatar/") {
					continue
				}
				fp := strings.ToLower(f.Path)
				if fp == ap || strings.HasSuffix(fp, "/"+ap) || strings.HasSuffix(fp, "\\"+ap) {
						data := make([]byte, len(f.Data))
						for i, v := range f.Data {
							data[i] = byte(v)
						}
						os.WriteFile(filepath.Join(cacheDir, safeName+".png"), data, 0644)
						mime := "image/png"
						if strings.HasSuffix(fp, ".jpg") {
							mime = "image/jpeg"
						}
						return "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(data)
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
		// 先读 ysm.json
		ysmData := readFileFromZip(zr, "ysm.json")
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
		log.Printf("[avatar] zip 路径: ysm.json 作者数=%d", len(authors))
		for _, au := range authors {
			log.Printf("[avatar]   作者=%q avatar=%q", au.Name, au.Avatar)
		}
		// 按作者名匹配头像路径
		for _, au := range authors {
			if safeFilename(au.Name) == safeName && au.Avatar != "" {
				ap := strings.ToLower(au.Avatar)
				if !strings.HasPrefix(ap, "avatar") && !strings.Contains(ap, "/avatar/") {
					continue
				}
				if avatarData := readFileFromZip(zr, au.Avatar); avatarData != nil {
					log.Printf("[avatar] 保存: %s (%d bytes)", filepath.Join(cacheDir, safeName+".png"), len(avatarData)); log.Printf("[avatar] 保存: %s (%d bytes)", filepath.Join(cacheDir, safeName+".png"), len(avatarData)); os.WriteFile(filepath.Join(cacheDir, safeName+".png"), avatarData, 0644)
					mime := "image/png"
					if strings.HasSuffix(strings.ToLower(au.Avatar), ".jpg") {
						mime = "image/jpeg"
					}
					return "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(avatarData)
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
		log.Printf("[avatar] json 路径: 作者数=%d safeName=%s", len(authors), safeName)
		for _, au := range authors {
			log.Printf("[avatar]   作者=%q avatar=%q safeAuthor=%q", au.Name, au.Avatar, safeFilename(au.Name))
		}
		dir := filepath.Dir(modelPath)
		for _, au := range authors {
			if safeFilename(au.Name) == safeName && au.Avatar != "" {
				ap := strings.ToLower(au.Avatar)
				if !strings.HasPrefix(ap, "avatar") && !strings.Contains(ap, "/avatar/") {
					continue
				}
				avatarPath := filepath.Join(dir, au.Avatar)
				if avatarData, err := os.ReadFile(avatarPath); err == nil {
					log.Printf("[avatar] 保存: %s (%d bytes)", filepath.Join(cacheDir, safeName+".png"), len(avatarData)); log.Printf("[avatar] 保存: %s (%d bytes)", filepath.Join(cacheDir, safeName+".png"), len(avatarData)); os.WriteFile(filepath.Join(cacheDir, safeName+".png"), avatarData, 0644)
					mime := "image/png"
					if strings.HasSuffix(strings.ToLower(au.Avatar), ".jpg") {
						mime = "image/jpeg"
					}
					return "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(avatarData)
				}
			}
		}
	}

	return ""
}

// readFileFromZip 从 ZIP 读取指定路径的文件
func readFileFromZip(zr *zip.Reader, target string) []byte {
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

// CacheModelAvatars 从解压目录的 ysm.json 读取所有作者头像，缓存到 creators_cache/
// 供创作者界面使用，不返回数据
func (a *App) CacheModelAvatars(modelPath string) {
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
	cacheDir := creatorAvatarCacheDir()
	os.MkdirAll(cacheDir, 0755)
	for _, au := range root.Meta.Authors {
		if au.Name == "" || au.Avatar == "" {
			continue
		}
		safe := safeFilename(au.Name)
		cachedPath := filepath.Join(cacheDir, safe+".png")
		if _, err := os.Stat(cachedPath); err == nil {
			continue // 已有缓存
		}
		ap := au.Avatar
		if !strings.HasPrefix(ap, "avatar") && !strings.Contains(ap, "/avatar") {
			ap = "avatar/" + ap
		}
		avatarPath := filepath.Join(dir, ap)
		if avatarData, err := os.ReadFile(avatarPath); err == nil {
			os.WriteFile(cachedPath, avatarData, 0644)
		}
	}
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
