// download_path.go：下载目标路径解析与安全校验（原 download.go 拆分，2026-10 文件行数治理）。
// ResolveSavePath / resolveRepoRelPath / sanitizeRelPath / joinSavePathUnderDir / stripRecycleSegments——
// URL → 落盘路径推导 + 目录穿越防护 + 回收站段剥离。
package download

import (
	"log"
	neturl "net/url"
	"os"
	"path/filepath"
	"strings"

	"ysm-model-manager/go/fsutil"
)

func isBinaryContentType(ct string) bool {
	if ct == "" {
		return true
	}
	ct = strings.ToLower(strings.TrimSpace(strings.SplitN(ct, ";", 2)[0]))
	// 仅拒绝 HTML/XHTML 错误页——这是唯一会伪装成"完整响应"的危险文本类型
	nonFileTypes := map[string]bool{
		"text/html":             true,
		"application/xhtml+xml": true,
		"application/xml":       true, // 纯 XML 错误页常见于反向代理
		"text/xml":              true,
	}
	return !nonFileTypes[ct]
}

// ResolveSavePath 从 GitHub raw URL 解析存储路径和回退源。
func ResolveSavePath(rawURL, saveDir string) (savePath string, jsdURL, apiURL string) {
	if err := os.MkdirAll(saveDir, fsutil.DirPerms); err != nil {
		log.Printf("[download] 创建保存目录失败 %s: %v", saveDir, err)
		return "", "", ""
	}
	// BUG-B-1/2/13 修复：用 neturl.Parse 分离 path/query/fragment，
	// 分支标记（/main/ /master/）只在 URL path 段查找，避免 query 中的 "/main/" 误识别为分支；
	// 提取的 relPath 不携带 query/fragment，避免 savePath/jsdURL/apiURL 污染。
	u, err := neturl.Parse(rawURL)
	if err != nil {
		log.Printf("[download] URL 解析失败 %s: %v", rawURL, err)
		return "", "", ""
	}
	urlPath := u.Path
	if urlPath == "" {
		urlPath = rawURL // 降级：无法解析时使用原始 URL
	}

	repoPath, branch, relPath := resolveRepoRelPath(u, rawURL, urlPath)
	relPath = sanitizeRelPath(relPath)
	if relPath == "" {
		log.Printf("[download] 拒绝空路径（URL 路径仅含 .recycle/.git 段）: %s", rawURL)
		return "", "", ""
	}
	// NUL 字节跨平台差异修复——Windows filepath.Abs 遇到 NUL 直接报错（攻击失效），
	// Linux/macOS filepath.Abs 放行，但 os.Create("file.ysm\x00.exe") 实际创建的是 "file.ysm"
	// （C 字符串以 NUL 截断，后缀被剥离），攻击者可绕过前端扩展名校验。
	// 主动剔除，跨平台一致行为。
	if strings.Contains(relPath, "\x00") {
		log.Printf("[download] 拒绝含 NUL 字节的路径: %s", rawURL)
		return "", "", ""
	}
	savePath, ok := joinSavePathUnderDir(saveDir, relPath)
	if !ok {
		return "", "", ""
	}

	if repoPath != "" {
		normalized := filepath.ToSlash(relPath)
		if branch == "" {
			branch = "main"
		}
		jsdURL = "https://cdn.jsdelivr.net/gh/" + repoPath + "@" + branch + "/" + normalized
		apiURL = "https://api.github.com/repos/" + repoPath + "/contents/" + normalized
	}
	return
}

// resolveRepoRelPath 解析 owner/repo、分支与仓库内相对路径（三段式回退）。
// raw.githubusercontent.com 结构化定位：/{owner}/{repo}/{branch}/{path...} 固定四段式，
// 分支名任意（dev/develop/release/1.0 等）都能拿到完整 relPath 与带正确分支的
// jsd/api 回退源，不再依赖 /main/ /master/ 枚举（枚举只对默认分支恰好是二者的仓库有效）。
// host 大小写不敏感（RFC 3986），且 u 已在上方 Parse——不用字符串前缀判定。
func resolveRepoRelPath(u *neturl.URL, rawURL, urlPath string) (repoPath, branch, relPath string) {
	if strings.EqualFold(u.Host, "raw.githubusercontent.com") {
		if parts := strings.SplitN(strings.TrimPrefix(urlPath, "/"), "/", 4); len(parts) == 4 &&
			parts[0] != "" && parts[1] != "" && parts[2] != "" && parts[3] != "" {
			repoPath = parts[0] + "/" + parts[1]
			branch = parts[2]
			relPath = parts[3]
		}
	}
	if relPath == "" {
		// 支持 main 与 master 默认分支（默认分支非 main 的仓库不再解析失败）；
		// 非 raw 前缀来源（jsdelivr 直链等）走此回退。
		for _, b := range []string{"/main/", "/master/"} {
			if idx := strings.Index(urlPath, b); idx > 0 {
				relPath = urlPath[idx+len(b):]
				branch = b[1 : len(b)-1]
				break
			}
		}
	}
	if relPath == "" {
		relPath = filepath.Base(u.Path)
		if relPath == "" {
			relPath = filepath.Base(rawURL)
		}
	}
	return repoPath, branch, relPath
}

// sanitizeRelPath 归一化仓库内相对路径：分隔符转本机、剔除 .git/ 前缀、逐段剔除 .recycle。
func sanitizeRelPath(relPath string) string {
	relPath = strings.ReplaceAll(relPath, "/", string(filepath.Separator))
	// BUG-B-8 修复：剔除 .git/ 前缀，防止下载 .git/config 泄露仓库 token/远端配置。
	relPath = strings.TrimPrefix(relPath, ".git"+string(filepath.Separator))
	// #8 回收站目录隔离：剔除 relPath 中所有名为 .recycle 的目录段（大小写不敏感，
	// 对齐 fsutil.IsRecycleDir 的 EqualFold 口径——dedup/scanner/sync 把任意层级的 .recycle
	// 视为回收站）。若下载落到 saveDir 下任意 .recycle 子树：扫描器会跳过该文件（不可见）、
	// 回收站 Empty() 会 RemoveAll 整目录（下载文件被静默清除），Windows 大小写不敏感下
	// .Recycle/.RECYCLE 亦指向同一目录。逐段剔除保证下载不落入任何回收站目录。
	return stripRecycleSegments(relPath)
}

// joinSavePathUnderDir 拼接 saveDir 与 relPath 并做路径遍历防护——
// 确保 savePath 经 Clean 后仍在 saveDir 下；越界或路径异常返回 ok=false（并留日志）。
func joinSavePathUnderDir(saveDir, relPath string) (savePath string, ok bool) {
	savePath = filepath.Clean(filepath.Join(saveDir, relPath))
	absSaveDir, err := filepath.Abs(saveDir)
	if err != nil {
		log.Printf("[download] saveDir 路径异常 %s: %v", saveDir, err)
		return "", false
	}
	absSavePath, err := filepath.Abs(savePath)
	if err != nil {
		log.Printf("[download] savePath 路径异常 %s: %v", savePath, err)
		return "", false
	}
	if !strings.HasPrefix(absSavePath, absSaveDir+string(filepath.Separator)) && absSavePath != absSaveDir {
		log.Printf("[download] 拒绝路径越界: %s (期望在 %s 内)", absSavePath, absSaveDir)
		return "", false
	}
	return savePath, true
}

// stripRecycleSegments 移除 relPath 中所有名为 .recycle 的目录段（大小写不敏感，
// 与 fsutil.IsRecycleDir 的 EqualFold 语义一致）。返回空串时由调用方拒绝该 URL
// （见 ResolveSavePath 的 relPath=="" 守卫），不会落盘到回收站目录。
func stripRecycleSegments(relPath string) string {
	sep := string(filepath.Separator)
	segs := strings.Split(relPath, sep)
	out := make([]string, 0, len(segs))
	for _, seg := range segs {
		if strings.EqualFold(seg, ".recycle") {
			continue
		}
		out = append(out, seg)
	}
	return strings.Join(out, sep)
}
