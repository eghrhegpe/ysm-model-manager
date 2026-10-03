package app

// 写入自诊断（临时排障工具，YSM_WRITE_DIAG=1 启用，验证后可移除）。
// 背景：2026-09-27「仓内 exe 写 AppData 全部 Access denied，浏览/读正常」雷霆——
// 排查要求失败进程自己交代原因（令牌/错误码/多路径探测），替代外围搬文件推断。
// 系统内可疑过滤驱动：sysdiag.sys（火绒主动防御）、ahflt.sys（微软电脑管家 AntiHack）。

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"unsafe"

	"golang.org/x/sys/windows"
)

// runWriteDiag 多路径写探测 + 进程令牌自述，逐行输出到 stderr（[write-diag] 前缀）。
func runWriteDiag() {
	dir := configDir()
	_ = os.MkdirAll(dir, 0o755)
	for _, probe := range []struct {
		label string
		path  string
	}{
		{"配置目录", dir},
		{"TEMP", os.TempDir()},
		{"LocalAppData探测目录", filepath.Join(os.Getenv("LOCALAPPDATA"), "ysm-diag-probe")},
	} {
		if probe.path == "" {
			continue
		}
		_ = os.MkdirAll(probe.path, 0o755)
		f, err := os.CreateTemp(probe.path, ".diag-*.tmp")
		if err != nil {
			fmt.Fprintf(os.Stderr, "[write-diag] %s(%s) 创建失败: %v (winerr=%d)\n",
				probe.label, probe.path, err, winErrCode(err))
		} else {
			name := f.Name()
			_ = f.Close()
			_ = os.Remove(name)
			fmt.Fprintf(os.Stderr, "[write-diag] %s(%s) 创建成功\n", probe.label, probe.path)
		}
	}

	// 已存在文件的打开写（区分「拒绝创建」vs「拒绝写入」）
	existing := filepath.Join(dir, "creators.json")
	if hf, err := os.OpenFile(existing, os.O_WRONLY|os.O_APPEND, 0o644); err != nil {
		fmt.Fprintf(os.Stderr, "[write-diag] 已存在文件追加写失败: %v (winerr=%d)\n", err, winErrCode(err))
	} else {
		_ = hf.Close()
		fmt.Fprintf(os.Stderr, "[write-diag] 已存在文件追加写成功\n")
	}

	tok := windows.GetCurrentProcessToken()
	defer func() { _ = tok.Close() }()

	// 完整性级别：x/sys 无现成 API，getInfo(25)=TokenIntegrityLevel 手解
	// TOKEN_MANDATORY_LABEL{ SID_AND_ATTRIBUTES }：SID rev(1)+count(1)+auth(6)+rid[]，
	// 完整性 RID = 最后一个子权限
	var ret uint32
	// TokenIntegrityLevel=25：先查长度再取（x/sys 未导出该 API，走原始 syscall）
	_, _, _ = procGetTokenInformation.Call(uintptr(tok), 25, 0, 0,
		uintptr(unsafe.Pointer(&ret)))
	if ret > 0 {
		buf := make([]byte, ret)
		r, _, callErr := procGetTokenInformation.Call(uintptr(tok), 25,
			uintptr(unsafe.Pointer(&buf[0])), uintptr(ret), uintptr(unsafe.Pointer(&ret)))
		if r != 0 {
			count := buf[1] // SID: rev(1)+count(1)+auth(6)+rid[count]
			rid := *(*uint32)(unsafe.Add(unsafe.Pointer(&buf[8]), uintptr(count-1)*4))
			fmt.Fprintf(os.Stderr, "[write-diag] 完整性级别 RID: %d (8192=Medium, 4096=Low)\n", rid)
		} else {
			fmt.Fprintf(os.Stderr, "[write-diag] 完整性级别查询失败: callErr=%v\n", callErr)
		}
	}

	if groups, err := tok.GetTokenGroups(); err == nil {
		fmt.Fprintf(os.Stderr, "[write-diag] 令牌组数: %d\n", groups.GroupCount)
		for _, g := range groups.AllGroups() {
			name := "?"
			acct, domain, _, lerr := g.Sid.LookupAccount("")
			if lerr == nil {
				name = domain + "\\" + acct
			}
			var attrs []string
			if g.Attributes&windows.SE_GROUP_USE_FOR_DENY_ONLY != 0 {
				attrs = append(attrs, "DENY_ONLY")
			}
			if g.Attributes&windows.SE_GROUP_ENABLED != 0 {
				attrs = append(attrs, "ENABLED")
			}
			if strings.Contains(name, "Codex") || strings.Contains(name, "Sandbox") ||
				strings.Contains(name, "PC Manager") || len(attrs) > 0 {
				fmt.Fprintf(os.Stderr, "[write-diag] 令牌组: %s (%s) [%s]\n", g.Sid.String(), name,
					strings.Join(attrs, ","))
			}
		}
	}
	if u, err := tok.GetTokenUser(); err == nil {
		if acct, domain, _, lerr := u.User.Sid.LookupAccount(""); lerr == nil {
			fmt.Fprintf(os.Stderr, "[write-diag] 进程用户: %s\\%s\n", domain, acct)
		}
	}
}

var procGetTokenInformation = windows.NewLazySystemDLL("advapi32.dll").NewProc("GetTokenInformation")

// winErrCode 提取 syscall errno（Access denied=5）
func winErrCode(err error) int {
	for e := err; e != nil; e = unwrapErr(e) {
		if errno, ok := e.(windows.Errno); ok {
			return int(errno)
		}
	}
	return -1
}

func unwrapErr(err error) error {
	type unwrapper interface{ Unwrap() error }
	if u, ok := err.(unwrapper); ok {
		return u.Unwrap()
	}
	return nil
}
