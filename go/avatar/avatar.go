// Package avatar 创作者头像提取与缓存，不依赖 Wails runtime。
package avatar

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

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
	return r.Replace(name)
}

// ReadCachedAvatar 读取缓存中的头像，返回 data URI。
func ReadCachedAvatar(authorName string) (string, error) {
	safe := SafeName(authorName)
	cachedPath := filepath.Join(CacheDir(), safe+".png")
	data, err := os.ReadFile(cachedPath)
	if err != nil {
		return "", nil
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(data), nil
}

// SaveAvatarData 将头像数据写入缓存。
func SaveAvatarData(safeName string, data []byte, mime string) string {
	os.MkdirAll(CacheDir(), 0755)
	os.WriteFile(filepath.Join(CacheDir(), safeName+".png"), data, 0644)
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
				if !strings.HasPrefix(ap, "avatar") && !strings.Contains(ap, "/avatar/") {
					continue
				}
				avatarPath := filepath.Join(dir, au.Avatar)
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
		if !strings.HasPrefix(ap, "avatar") && !strings.Contains(ap, "/avatar") {
			ap = "avatar/" + ap
		}
		avatarPath := filepath.Join(dir, ap)
		if avatarData, err := os.ReadFile(avatarPath); err == nil {
			os.WriteFile(cachedPath, avatarData, 0644)
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
	cmd := exec.Command(nodeJSPath, scriptPath)
	hideWindow(cmd)
	cmd.Dir = tmpDir
	output, err := cmd.CombinedOutput()
	if err != nil {
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
