// ===== go/avatar Node 管线补测 =====
// DecodeYSMData 依赖真实 Node.js + WASM 解码。这里用「假 YSMParser 胶水模块」替换
// getGlueCode 注入的胶水：由真实 node 执行生成的 decode 脚本时返回静态文件树，
// 从而端到端验证 子进程管线/输出解析/超时与错误分支，无需真实 WASM 解码。
package avatar

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"
)

// requireNode 跳过无 node 环境（CI 机器需真实 node 才跑管线测试）。
func requireNode(t *testing.T) {
	t.Helper()
	if _, err := exec.LookPath("node"); err != nil {
		t.Skip("node 不可用，跳过 Node 管线测试")
	}
}

// withFakeNode 注入假胶水/wasm 并恢复全局状态（经 SetNodeJS 线程安全读写）。
func withFakeNode(t *testing.T, glue string, wasm []byte) {
	t.Helper()
	oldNode, oldGlue, oldWasm := getEnv()
	SetNodeJS("node", func() string { return glue }, func() []byte { return wasm })
	t.Cleanup(func() { SetNodeJS(oldNode, oldGlue, oldWasm) })
}

// withFakeNodeCmd 用 Windows .cmd 假 node：忽略脚本参数直接输出固定内容/退出码。
func withFakeNodeCmd(t *testing.T, content string) {
	t.Helper()
	if runtime.GOOS != "windows" {
		t.Skip("Windows-only：.cmd 假 node")
	}
	path := filepath.Join(t.TempDir(), "fake-node.cmd")
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}
	oldNode, oldGlue, oldWasm := getEnv()
	SetNodeJS(path, func() string { return "irrelevant" }, func() []byte { return []byte{1} })
	t.Cleanup(func() { SetNodeJS(oldNode, oldGlue, oldWasm) })
}

// fakeGlueModule 生成假 YSMParser 胶水模块：静态文件树（键为 /output/ 前缀路径，
// entries 顺序即 readdir 顺序），cl() 遍历/读取全部基于该扁平映射推导。
// callMainBody 可注入失败行为（如抛错）。
func fakeGlueModule(entries [][2]string, callMainBody string) string {
	parts := make([]string, 0, len(entries))
	for _, e := range entries {
		nums := make([]string, 0, len(e[1]))
		for i := 0; i < len(e[1]); i++ {
			nums = append(nums, strconv.Itoa(int(e[1][i])))
		}
		parts = append(parts, fmt.Sprintf("%q:[%s]", e[0], strings.Join(nums, ",")))
	}
	const tmpl = `// 假 YSMParser：静态文件树，不执行真实 WASM 解码
var FILES = {%s};
function readdir(p) {
  var pref = p.charAt(p.length - 1) === '/' ? p : p + '/';
  var out = [];
  for (var k in FILES) {
    if (k.indexOf(pref) === 0) {
      var rest = k.slice(pref.length);
      var name = rest.indexOf('/') < 0 ? rest : rest.slice(0, rest.indexOf('/'));
      if (name && out.indexOf(name) < 0) out.push(name);
    }
  }
  return out;
}
function stat(p) {
  var pref = p.charAt(p.length - 1) === '/' ? p : p + '/';
  for (var k in FILES) { if (k.indexOf(pref) === 0) return { mode: 0o040000 | 0o755 }; }
  if (FILES[p]) return { mode: 0o100000 | 0o644 };
  throw new Error('ENOENT: ' + p);
}
function readFile(p) {
  if (!FILES[p]) throw new Error('ENOENT: ' + p);
  return FILES[p];
}
module.exports = function () {
  return {
    FS: {
      mkdir: function () {},
      writeFile: function () {},
      readdir: readdir,
      stat: stat,
      readFile: readFile,
      isDir: function (m) { return (m & 0o170000) === 0o040000; }
    },
    callMain: %s
  };
};
`
	return fmt.Sprintf(tmpl, strings.Join(parts, ","), callMainBody)
}

// writeYSM 写一个内容任意的 .ysm 文件（假胶水下 DecodeYSMData 不校验内容）。
func writeYSM(t *testing.T, content string) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "model.ysm")
	if err := os.WriteFile(p, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestDecodeYSMData_SetupGuards(t *testing.T) {
	oldNode, oldGlue, oldWasm := getEnv()
	defer func() { SetNodeJS(oldNode, oldGlue, oldWasm) }()

	// node 路径未设置 → nil
	SetNodeJS("", nil, nil)
	if got := DecodeYSMData([]byte("x")); got != nil {
		t.Fatalf("node 未设置应返回 nil, 得到 %v", got)
	}
	// 胶水函数未设置 → nil
	SetNodeJS("node", nil, func() []byte { return []byte{1} })
	if got := DecodeYSMData([]byte("x")); got != nil {
		t.Fatalf("胶水未设置应返回 nil, 得到 %v", got)
	}
	// wasm 函数未设置 → nil
	SetNodeJS("node", func() string { return "g" }, nil)
	if got := DecodeYSMData([]byte("x")); got != nil {
		t.Fatalf("wasm 未设置应返回 nil, 得到 %v", got)
	}
	// 空胶水 → nil
	SetNodeJS("node", func() string { return "" }, func() []byte { return []byte{1} })
	if got := DecodeYSMData([]byte("x")); got != nil {
		t.Fatalf("空胶水应返回 nil, 得到 %v", got)
	}
	// 空 wasm → nil
	SetNodeJS("node", func() string { return "g" }, func() []byte { return nil })
	if got := DecodeYSMData([]byte("x")); got != nil {
		t.Fatalf("空 wasm 应返回 nil, 得到 %v", got)
	}
}

// TestDecodeYSMData_Pipeline 端到端：真实 node 执行生成的 decode 脚本，假胶水返回
// 静态文件树，验证 stdout FILES_JSON 输出解析为文件列表（路径 + 数据）。
func TestDecodeYSMData_Pipeline(t *testing.T) {
	requireNode(t)
	ysmJSON := `{"metadata":{"authors":[{"name":"测试用户","avatar":"avatar/face.png"}]}}`
	glue := fakeGlueModule([][2]string{
		{"/output/ysm.json", ysmJSON},
		{"/output/avatar/face.png", "fake-png-data"},
	}, "function () {}")
	withFakeNode(t, glue, []byte{1, 2, 3})

	files := DecodeYSMData([]byte("fake-ysm-bytes"))
	if files == nil {
		t.Fatal("假胶水管线应解码出文件列表, 得到 nil")
	}
	if len(files) != 2 {
		t.Fatalf("应解析出 2 个文件, 得到 %d: %+v", len(files), files)
	}
	if files[0].Path != "ysm.json" {
		t.Errorf("首个文件应为 ysm.json, 得到 %q", files[0].Path)
	}
	if string(files[0].Data) != ysmJSON {
		t.Errorf("ysm.json 数据解析错误: %q", files[0].Data)
	}
	if files[1].Path != "avatar/face.png" {
		t.Errorf("第二个文件应为 avatar/face.png, 得到 %q", files[1].Path)
	}
	if string(files[1].Data) != "fake-png-data" {
		t.Errorf("avatar 数据解析错误: %q", files[1].Data)
	}
}

// TestDecodeYSMData_CallMainThrow callMain 抛错 → 子进程失败分支 → nil（stderr 诊断）。
func TestDecodeYSMData_CallMainThrow(t *testing.T) {
	requireNode(t)
	glue := fakeGlueModule([][2]string{
		{"/output/ysm.json", `{"metadata":{}}`},
	}, `function () { throw {name: 'MyErr', message: 'boom'}; }`)
	withFakeNode(t, glue, []byte{1})

	if got := DecodeYSMData([]byte("x")); got != nil {
		t.Fatalf("callMain 抛错应返回 nil, 得到 %v", got)
	}
}

// TestDecodeYSMData_NoMarker 假 node 输出不含 FILES_JSON: 标记 → nil。
func TestDecodeYSMData_NoMarker(t *testing.T) {
	withFakeNodeCmd(t, "@echo off\r\necho HELLO_NO_MARKER\r\n")
	if got := DecodeYSMData([]byte("x")); got != nil {
		t.Fatalf("无 FILES_JSON 标记应返回 nil, 得到 %v", got)
	}
}

// TestDecodeYSMData_BadJSON 假 node 输出 FILES_JSON: 后跟非法 JSON → nil。
func TestDecodeYSMData_BadJSON(t *testing.T) {
	withFakeNodeCmd(t, "@echo off\r\necho FILES_JSON:not-json\r\n")
	if got := DecodeYSMData([]byte("x")); got != nil {
		t.Fatalf("非法 JSON 应返回 nil, 得到 %v", got)
	}
}

// TestDecodeYSMData_ExitError 假 node 退出码 1 + stderr 诊断 → nil。
func TestDecodeYSMData_ExitError(t *testing.T) {
	withFakeNodeCmd(t, "@echo off\r\necho boom 1>&2\r\nexit /b 1\r\n")
	if got := DecodeYSMData([]byte("x")); got != nil {
		t.Fatalf("子进程失败应返回 nil, 得到 %v", got)
	}
}

// TestDecodeYSMData_StderrTooLarge 覆盖「解码失败 + stderr 超 8MB」分支（errLimited.exceeded）：
// 假胶水在 require 阶段向 stderr 倾倒 >8MB 数据（单次大写入），随后 callMain 抛错退出码 1。
// 修复前该分支 `buf.String()[:512]` 在 buf<512 时越界 panic；修复后应返回 nil 且不 panic。
func TestDecodeYSMData_StderrTooLarge(t *testing.T) {
	requireNode(t)
	big := strings.Repeat("x", 9<<20)
	glue := "process.stderr.write(" + strconv.Quote(big) + ");\n" +
		`module.exports = function () { throw new Error('boom'); };`
	withFakeNode(t, glue, []byte{1})

	if got := DecodeYSMData([]byte("x")); got != nil {
		t.Fatalf("stderr 超限 + 解码失败应返回 nil, 得到 %v", got)
	}
}

// ===== ExtractAvatarURI .ysm 分支补测（假胶水管线）=====

func TestExtractAvatarURI_FromYSM_Happy(t *testing.T) {
	requireNode(t)
	old := CacheDir
	CacheDir = func() string { return t.TempDir() }
	defer func() { CacheDir = old }()

	ysmJSON := `{"metadata":{"authors":[{"name":"测试用户","avatar":"avatar/face.png"}]}}`
	glue := fakeGlueModule([][2]string{
		{"/output/ysm.json", ysmJSON},
		{"/output/avatar/face.png", "fake-png-data"},
	}, "function () {}")
	withFakeNode(t, glue, []byte{1})

	result := ExtractAvatarURI(writeYSM(t, "fake-ysm"), "测试用户")
	if !strings.HasPrefix(result, "data:image/png;base64,") {
		t.Fatalf(".ysm 作者匹配应返回 PNG URI, 得到 %q", result)
	}
}

func TestExtractAvatarURI_FromYSM_JPG(t *testing.T) {
	requireNode(t)
	old := CacheDir
	CacheDir = func() string { return t.TempDir() }
	defer func() { CacheDir = old }()

	ysmJSON := `{"metadata":{"authors":[{"name":"测试用户","avatar":"avatar/face.jpg"}]}}`
	glue := fakeGlueModule([][2]string{
		{"/output/ysm.json", ysmJSON},
		{"/output/avatar/face.jpg", "jpeg-data"},
	}, "function () {}")
	withFakeNode(t, glue, []byte{1})

	result := ExtractAvatarURI(writeYSM(t, "fake-ysm"), "测试用户")
	if !strings.HasPrefix(result, "data:image/jpeg;base64,") {
		t.Fatalf(".ysm jpg 头像应返回 JPEG URI, 得到 %q", result)
	}
}

func TestExtractAvatarURI_FromYSM_Fallback(t *testing.T) {
	// 无 ysm.json → 降级取 avatar/ 目录第一张图
	requireNode(t)
	old := CacheDir
	CacheDir = func() string { return t.TempDir() }
	defer func() { CacheDir = old }()

	glue := fakeGlueModule([][2]string{
		{"/output/avatar/face.png", "fake-png-data"},
	}, "function () {}")
	withFakeNode(t, glue, []byte{1})

	result := ExtractAvatarURI(writeYSM(t, "fake-ysm"), "测试用户")
	if !strings.HasPrefix(result, "data:image/png;base64,") {
		t.Fatalf("无作者信息应降级取 avatar/ 首图, 得到 %q", result)
	}
}

func TestExtractAvatarURI_FromYSM_FallbackJPG(t *testing.T) {
	requireNode(t)
	old := CacheDir
	CacheDir = func() string { return t.TempDir() }
	defer func() { CacheDir = old }()

	glue := fakeGlueModule([][2]string{
		{"/output/avatar/face.jpg", "jpeg-data"},
	}, "function () {}")
	withFakeNode(t, glue, []byte{1})

	result := ExtractAvatarURI(writeYSM(t, "fake-ysm"), "测试用户")
	if !strings.HasPrefix(result, "data:image/jpeg;base64,") {
		t.Fatalf("降级取 jpg 应返回 JPEG URI, 得到 %q", result)
	}
}

func TestExtractAvatarURI_FromYSM_UnsafePath(t *testing.T) {
	// 作者 avatar 逃逸路径被 isSafeAvatarPath 拒绝 → 空（authors 非空时不走降级）
	requireNode(t)
	old := CacheDir
	CacheDir = func() string { return t.TempDir() }
	defer func() { CacheDir = old }()

	ysmJSON := `{"metadata":{"authors":[{"name":"测试用户","avatar":"../evil.png"}]}}`
	glue := fakeGlueModule([][2]string{
		{"/output/ysm.json", ysmJSON},
		{"/output/avatar/face.png", "fake-png-data"},
	}, "function () {}")
	withFakeNode(t, glue, []byte{1})

	result := ExtractAvatarURI(writeYSM(t, "fake-ysm"), "测试用户")
	if result != "" {
		t.Fatalf(".ysm 逃逸路径应返回空, 得到 %q", result)
	}
}

func TestExtractAvatarURI_FromYSM_MissingAvatar(t *testing.T) {
	// 作者匹配但解码产物中无对应头像文件 → 空
	requireNode(t)
	old := CacheDir
	CacheDir = func() string { return t.TempDir() }
	defer func() { CacheDir = old }()

	ysmJSON := `{"metadata":{"authors":[{"name":"测试用户","avatar":"avatar/missing.png"}]}}`
	glue := fakeGlueModule([][2]string{
		{"/output/ysm.json", ysmJSON},
		{"/output/avatar/face.png", "fake-png-data"},
	}, "function () {}")
	withFakeNode(t, glue, []byte{1})

	result := ExtractAvatarURI(writeYSM(t, "fake-ysm"), "测试用户")
	if result != "" {
		t.Fatalf(".ysm 缺头像文件应返回空, 得到 %q", result)
	}
}

// TestExtractAvatarURI_FromYSM_NotYSMJSON 回归：名为 "notysm.json" 的文件不得被当作
// ysm.json 元数据解析（后缀误匹配缺陷）。修复前 authors 从 notysm.json 读出后作者
// 匹配失败且 authors 非空不走降级 → 空；修复后无真实 ysm.json → 降级取首图 → URI。
func TestExtractAvatarURI_FromYSM_NotYSMJSON(t *testing.T) {
	requireNode(t)
	old := CacheDir
	CacheDir = func() string { return t.TempDir() }
	defer func() { CacheDir = old }()

	// notysm.json 声明了指向不存在文件的头像；真实 avatar/face.png 存在（降级可命中）
	notYSM := `{"metadata":{"authors":[{"name":"测试用户","avatar":"avatar/missing.png"}]}}`
	glue := fakeGlueModule([][2]string{
		{"/output/notysm.json", notYSM},
		{"/output/avatar/face.png", "fake-png-data"},
	}, "function () {}")
	withFakeNode(t, glue, []byte{1})

	result := ExtractAvatarURI(writeYSM(t, "fake-ysm"), "测试用户")
	if !strings.HasPrefix(result, "data:image/png;base64,") {
		t.Fatalf("notysm.json 不得作为元数据, 应降级取首图返回 PNG URI, 得到 %q", result)
	}
}

// TestCacheAvatarsFromModel_YSM_EmptyNamesNoOp 回归（原 TestModelAuthorNames 语义
// 迁至缓存路径验证）：作者含空名时不得产出 ".png"/"_.png" 垃圾缓存；未声明
// avatar 字段的作者匹配失败不缓存；声明头像的正常作者照常缓存。
func TestCacheAvatarsFromModel_YSM_EmptyNamesNoOp(t *testing.T) {
	requireNode(t)
	old := CacheDir
	cacheDir := t.TempDir()
	CacheDir = func() string { return cacheDir }
	defer func() { CacheDir = old }()

	ysmJSON := `{"metadata":{"authors":[{"name":"测试用户","avatar":"avatar/face.png"},{"name":"用户B"},{"name":""}]}}`
	glue := fakeGlueModule([][2]string{
		{"/output/ysm.json", ysmJSON},
		{"/output/avatar/face.png", "fake-png-data"},
	}, "function () {}")
	withFakeNode(t, glue, []byte{1})

	CacheAvatarsFromModel(writeYSM(t, "fake-ysm"))
	if _, err := os.Stat(filepath.Join(cacheDir, "测试用户.png")); err != nil {
		t.Fatalf("声明头像的作者应被缓存, 测试用户.png 缺失: %v", err)
	}
	if _, err := os.Stat(filepath.Join(cacheDir, "用户B.png")); err == nil {
		t.Fatal("未声明 avatar 字段的作者不得缓存（作者匹配需 avatar 字段）")
	}
	ents, _ := os.ReadDir(cacheDir)
	for _, e := range ents {
		if e.Name() == ".png" || e.Name() == "_.png" {
			t.Fatalf("空作者名不应产生缓存文件: %s", e.Name())
		}
	}
}

// TestCacheAvatarsFromModel_YSM_NotYSMJSON 回归（原 TestModelAuthorNames_WrongOrder
// 语义迁至缓存路径验证）：notysm.json 先于 ysm.json 时不得被当作元数据——
// 只缓存真实 ysm.json 声明作者的头像，notysm.json 的 用户X 不产出缓存。
func TestCacheAvatarsFromModel_YSM_NotYSMJSON(t *testing.T) {
	requireNode(t)
	old := CacheDir
	cacheDir := t.TempDir()
	CacheDir = func() string { return cacheDir }
	defer func() { CacheDir = old }()

	glue := fakeGlueModule([][2]string{
		{"/output/notysm.json", `{"metadata":{"authors":[{"name":"用户X","avatar":"avatar/face.png"}]}}`},
		{"/output/ysm.json", `{"metadata":{"authors":[{"name":"测试用户","avatar":"avatar/face.png"}]}}`},
		{"/output/avatar/face.png", "fake-png-data"},
	}, "function () {}")
	withFakeNode(t, glue, []byte{1})

	CacheAvatarsFromModel(writeYSM(t, "fake-ysm"))
	if _, err := os.Stat(filepath.Join(cacheDir, "测试用户.png")); err != nil {
		t.Fatalf("真实 ysm.json 作者应被缓存, 测试用户.png 缺失: %v", err)
	}
	if _, err := os.Stat(filepath.Join(cacheDir, "用户X.png")); err == nil {
		t.Fatal("notysm.json 不得作为元数据产生缓存")
	}
}

// TestCacheAvatarsFromModel_YSM .ysm 模型整体缓存（作者名 → ExtractAvatarURI → 写缓存）。
func TestCacheAvatarsFromModel_YSM(t *testing.T) {
	requireNode(t)
	old := CacheDir
	cacheDir := t.TempDir()
	CacheDir = func() string { return cacheDir }
	defer func() { CacheDir = old }()

	ysmJSON := `{"metadata":{"authors":[{"name":"测试用户","avatar":"avatar/face.png"}]}}`
	glue := fakeGlueModule([][2]string{
		{"/output/ysm.json", ysmJSON},
		{"/output/avatar/face.png", "fake-png-data"},
	}, "function () {}")
	withFakeNode(t, glue, []byte{1})

	CacheAvatarsFromModel(writeYSM(t, "fake-ysm"))
	if _, err := os.Stat(filepath.Join(cacheDir, "测试用户.png")); err != nil {
		t.Fatalf(".ysm 模型应缓存作者头像, 测试用户.png 缺失: %v", err)
	}
}

// TestExtractAvatarURI_FromYSM_FallbackJPEG 回归：降级路径 .jpeg 扩展名兼容
// （原漏 .jpeg 使 avatar/face.jpeg 声明的头像在不走作者匹配的降级路径下被跳过；
// avatarCandidates 含 .jpeg，但降级扫描的 HasSuffix 只认 .png/.jpg——口径对齐）。
func TestExtractAvatarURI_FromYSM_FallbackJPEG(t *testing.T) {
	requireNode(t)
	old := CacheDir
	CacheDir = func() string { return t.TempDir() }
	defer func() { CacheDir = old }()

	// 无 ysm.json（authors 为空）→ 降级取 avatar/ 首图，文件为 .jpeg
	glue := fakeGlueModule([][2]string{
		{"/output/avatar/face.jpeg", "jpeg-data"},
	}, "function () {}")
	withFakeNode(t, glue, []byte{1})

	result := ExtractAvatarURI(writeYSM(t, "fake-ysm"), "测试用户")
	if !strings.HasPrefix(result, "data:image/jpeg;base64,") {
		t.Fatalf("降级取 .jpeg 应返回 JPEG URI, 得到 %q", result)
	}
}
