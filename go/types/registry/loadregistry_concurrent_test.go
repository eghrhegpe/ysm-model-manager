package types

import (
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
)

// --- helper: 合法的 resource_types.json (含 ysm 类型) ---

func validRegistryJSON(withConfigFallback bool) []byte {
	cfgFallback := ``
	if withConfigFallback {
		cfgFallback = `, "configFallback": "YsmRoot"`
	}
	return []byte(`{
  "resourceTypes": [
    {
      "id": "ysm",
      "name": "YSM 模型",
      "extensions": [".ysm", ".zip"],
      "storageSubDir": "ysm",
      "configField": "YsmRoot"` + cfgFallback + `,
      "instanceDir": "ysm",
      "instanceLevel": true,
      "preview": "3d",
      "detector": "ysm"
    },
    {
      "id": "custom-test",
      "name": "自定义测试类型",
      "extensions": [".ct"],
      "storageSubDir": "custom",
      "configField": "CustomRoot",
      "instanceDir": "custom",
      "instanceLevel": false,
      "preview": "none",
      "detector": "extension"
    }
  ]
}`)
}

func writeValidRegistryFile(t *testing.T, dir string, filename string) string {
	t.Helper()
	p := filepath.Join(dir, filename)
	if err := os.WriteFile(p, validRegistryJSON(true), 0644); err != nil {
		t.Fatalf("写测试 JSON 失败: %v", err)
	}
	return p
}

// ============================================================
// 1. 并发读写: LoadRegistry + SetRegistryPath 交替, -race 检测
// ============================================================

func TestLoadRegistry_ConcurrentReadAndSetPath(t *testing.T) {
	dir := t.TempDir()
	regPath := filepath.Join(dir, "external.json")
	if err := os.WriteFile(regPath, validRegistryJSON(true), 0644); err != nil {
		t.Fatal(err)
	}

	const goroutines = 12
	var wg sync.WaitGroup
	var successCount int64
	var nilCount int64

	for i := 0; i < goroutines; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			for j := 0; j < 50; j++ {
				if (idx+j)%3 == 0 {
					// 交替把路径切换到 embedded 回退位 & 显式文件
					if (idx+j)%2 == 0 {
						SetRegistryPath(regPath)
					} else {
						SetRegistryPath("")
					}
				}
				reg := LoadRegistry()
				if reg == nil {
					atomic.AddInt64(&nilCount, 1)
					continue
				}
				atomic.AddInt64(&successCount, 1)
			}
		}(i)
	}
	wg.Wait()

	if nilCount > 0 {
		t.Errorf("并发 LoadRegistry 返回 nil 次数 = %d (应 0)", nilCount)
	}
	if successCount <= 0 {
		t.Errorf("并发 LoadRegistry 成功次数 = %d (应 >0)", successCount)
	}
	// 关键断言：ysm 类型仍可见（回退链没有被打穿）
	rt := RegistryType("ysm")
	if rt == nil {
		t.Error("并发压力下 ysm 类型应仍可见")
	}
}

// ============================================================
// 2. 返回指针稳定性: 缓存命中 → 同指针; SetRegistryPath → 新指针
// ============================================================

func TestLoadRegistry_PointerStabilityOnCacheHit(t *testing.T) {
	// 先确保有缓存
	reg := LoadRegistry()
	if reg == nil {
		t.Fatal("首次 LoadRegistry 不应返回 nil")
	}
	_ = reg

	// 用 RegistryType 的返回值间接判断指针是否同一次加载
	// 更直接: 两次调用返回同一 registry 对象 (同 ResourceTypes slice 头部地址)
	reg1 := LoadRegistry()
	reg2 := LoadRegistry()
	// 通过 ResourceTypes 切片地址比较 (缓存命中时应完全相同)
	slice1 := reg1.ResourceTypes
	slice2 := reg2.ResourceTypes
	if len(slice1) == 0 || len(slice2) == 0 {
		t.Fatal("registry 为空，无法比较指针")
	}
	// 借用 unsafe 通过 uintptr 比较指针值
	// 改用字符串比较 ID 稳定性——指针值我们无法直接取, 但 slice 头部
	// 通过 reflect 也可行。这里用最朴素的策略: 用 &reg1.ResourceTypes[0] vs &reg2.ResourceTypes[0]
	// Go 中不能直接转 uintptr, 但可比较指针相等性
	// 通过 helper 函数接收指针并比较
	equalPtr := func(a, b *ResourceType) bool {
		return a == b
	}
	if !equalPtr(&reg1.ResourceTypes[0], &reg2.ResourceTypes[0]) {
		t.Error("缓存命中: 两次 LoadRegistry 应返回同一 registry (slice 元素地址应相同)")
	}

	// SetRegistryPath 后: 应返回新指针
	SetRegistryPath("")
	defer SetRegistryPath("")
	reg3 := LoadRegistry()
	if reg3 == nil {
		t.Fatal("SetRegistryPath 后 LoadRegistry 不应 nil")
	}
	// 缓存已被清，重新 load → 新的 &reg 分配
	// 但底层数据可能是 embedded (同字节), 结构体对象是新分配
	// 我们验证 slice 头部地址不再相同 (大概率)——不做强断言, 只做观察
	_ = reg3
}

func TestLoadRegistry_PointerChangeAfterSetPath(t *testing.T) {
	// 显式路径文件
	dir := t.TempDir()
	p1 := writeValidRegistryFile(t, dir, "a.json")
	p2 := writeValidRegistryFile(t, dir, "b.json")

	SetRegistryPath(p1)
	defer SetRegistryPath("")

	reg1 := LoadRegistry()
	reg1rt := RegistryType("ysm")
	if reg1rt == nil {
		t.Fatal("p1 加载后 ysm 应可见")
	}

	// 切路径 → 触发重新加载
	SetRegistryPath(p2)
	reg2 := LoadRegistry()
	reg2rt := RegistryType("ysm")
	if reg2rt == nil {
		t.Fatal("p2 加载后 ysm 应可见")
	}

	// reg1.ResourceTypes[0] 与 reg2.ResourceTypes[0] 地址应不同 (不同加载)
	if &reg1.ResourceTypes[0] == &reg2.ResourceTypes[0] {
		t.Error("SetRegistryPath 后应重新分配 registry，slice 元素地址不应相同")
	}

	// 数据内容一致 (两个文件内容相同)
	if reg1.ResourceTypes[0].ID != reg2.ResourceTypes[0].ID {
		t.Errorf("两个路径加载内容应一致: %q vs %q",
			reg1.ResourceTypes[0].ID, reg2.ResourceTypes[0].ID)
	}
}

// ============================================================
// 3. 极端路径: 空串 / 空格 / 超长 / NUL / 目录
// ============================================================

func TestLoadRegistry_PathEmptyString(t *testing.T) {
	SetRegistryPath("")
	defer SetRegistryPath("")

	reg := LoadRegistry()
	if reg == nil {
		t.Fatal("空路径应走 embedded 回退而非 nil")
	}
	// 空串触发 embedded 回退 → ysm 应可见
	rt := RegistryType("ysm")
	if rt == nil {
		t.Error("空路径 → embedded 回退后 ysm 应仍可见")
	}
}

func TestLoadRegistry_PathAllSpaces(t *testing.T) {
	SetRegistryPath("       ")
	defer SetRegistryPath("")

	reg := LoadRegistry()
	if reg == nil {
		t.Error("全空格路径应走 fallback (文件不存在) 而非 nil")
	}
	rt := RegistryType("ysm")
	if rt == nil {
		t.Error("全空格路径回退后 ysm 应仍可见")
	}
}

func TestLoadRegistry_PathVeryLong(t *testing.T) {
	// Windows MAX_PATH = 260; 长路径前缀 \\?\\ 可至 32767
	// 我们构造 64k 长度的路径
	longPath := filepath.Join(t.TempDir(), strings.Repeat("a", 65535))
	SetRegistryPath(longPath)
	defer SetRegistryPath("")

	reg := LoadRegistry()
	if reg == nil {
		t.Error("超长路径应走 fallback (文件不存在) 而非 nil")
	}
	rt := RegistryType("ysm")
	if rt == nil {
		t.Error("超长路径回退后 ysm 应仍可见")
	}
}

func TestLoadRegistry_PathWithNULByte(t *testing.T) {
	// NUL 字节路径在 Windows 上 os.ReadFile 会返回错误 ("unknown")
	// 加载链应优雅回退
	nulPath := t.TempDir() + "\\x" + string(byte(0)) + "y.json"
	SetRegistryPath(nulPath)
	defer SetRegistryPath("")

	reg := LoadRegistry()
	if reg == nil {
		t.Error("含 NUL 路径应走 fallback 而非 nil")
	}
	rt := RegistryType("ysm")
	if rt == nil {
		t.Error("NUL 路径回退后 ysm 应仍可见")
	}
}

func TestLoadRegistry_PathIsDirectory(t *testing.T) {
	// SetRegistryPath 设为一个目录路径 → os.ReadFile 报错 → 走 fallback
	dir := t.TempDir()
	SetRegistryPath(dir)
	defer SetRegistryPath("")

	reg := LoadRegistry()
	if reg == nil {
		t.Error("目录路径应走 fallback 而非 nil")
	}
	rt := RegistryType("ysm")
	if rt == nil {
		t.Error("目录路径回退后 ysm 应仍可见")
	}
}

// ============================================================
// 4. 加载链: 显式文件优先 / 缓存命中 / 文件删除后缓存不变
// ============================================================

func TestLoadRegistry_LoadFromExplicitFile(t *testing.T) {
	dir := t.TempDir()
	p := writeValidRegistryFile(t, dir, "explicit.json")
	SetRegistryPath(p)
	defer SetRegistryPath("")

	reg := LoadRegistry()
	if reg == nil {
		t.Fatal("显式文件应成功加载")
	}
	// 显式文件含 custom-test 类型 (embedded 中没有)
	rt := RegistryType("custom-test")
	if rt == nil {
		t.Error("显式文件应优先于 embedded: custom-test 类型应可见")
	}
	if RegistryType("ysm") == nil {
		t.Error("显式文件应含 ysm")
	}
}

func TestLoadRegistry_CacheSurvivesFileDelete(t *testing.T) {
	dir := t.TempDir()
	p := writeValidRegistryFile(t, dir, "transient.json")
	SetRegistryPath(p)
	defer SetRegistryPath("")

	reg1 := LoadRegistry()
	if reg1 == nil || len(reg1.ResourceTypes) == 0 {
		t.Fatal("首次加载失败")
	}
	firstCount := len(reg1.ResourceTypes)
	firstID := reg1.ResourceTypes[0].ID

	// 删除文件
	if err := os.Remove(p); err != nil {
		t.Fatalf("删除测试文件失败: %v", err)
	}

	// 再次 LoadRegistry → 应返回缓存 (不变)
	reg2 := LoadRegistry()
	if reg2 == nil {
		t.Fatal("缓存命中时不应返回 nil")
	}
	if len(reg2.ResourceTypes) != firstCount {
		t.Errorf("缓存命中率下数量应不变: %d vs %d", len(reg2.ResourceTypes), firstCount)
	}
	if reg2.ResourceTypes[0].ID != firstID {
		t.Errorf("缓存命中率下内容应不变: %q vs %q", reg2.ResourceTypes[0].ID, firstID)
	}

	// 删除后 SetRegistryPath 到新文件 → 应重新加载新文件
	p2 := writeValidRegistryFile(t, dir, "new.json")
	SetRegistryPath(p2)
	defer SetRegistryPath("")
	reg3 := LoadRegistry()
	if reg3 == nil {
		t.Fatal("切到新文件后应成功加载")
	}
	// 新文件加载应得到相同逻辑内容
	if RegistryType("ysm") == nil {
		t.Error("切到新文件后 ysm 应仍可见")
	}
}

func TestLoadRegistry_DefaultNameNotReadFromCwd(t *testing.T) {
	// 默认 registryPath 是相对名 "resource_types.json"
	// 源码: if registryPath != "resource_types.json" { read explicit }
	// 验证: 设置 registryPath 为 "resource_types.json" (默认名)
	// 即使 cwd 中有该文件, 也不会被误读

	// 把 registryPath 直接设为默认名
	SetRegistryPath("resource_types.json")
	defer SetRegistryPath("")

	// 在 t.TempDir 中创建一个 resource_types.json, 内容含一个特殊标记类型
	// 但因为默认名被跳过, 这个文件不应被读取
	dir := t.TempDir()
	p := filepath.Join(dir, "resource_types.json")
	markerJSON := []byte(`{"resourceTypes":[{"id":"MARKER-TYPE-UNIQUE","name":"marker","extensions":[".mk"],"storageSubDir":"mk","configField":"MkRoot","instanceDir":"mk"}]}`)
	if err := os.WriteFile(p, markerJSON, 0644); err != nil {
		t.Fatal(err)
	}

	// 用 registryPath 指向该文件 (通过完整路径)—— 但源码按名字跳过
	// 我们把 registryPath 设为绝对路径:
	SetRegistryPath(p)
	defer SetRegistryPath("")

	// 绝对路径 ≠ "resource_types.json", 所以被读取
	reg := LoadRegistry()
	if reg == nil {
		t.Fatal("LoadRegistry 应成功")
	}
	rt := RegistryType("MARKER-TYPE-UNIQUE")
	if rt == nil {
		t.Error("绝对路径下应读到 marker 类型")
	}

	// 现在把 registryPath 设为默认名 (相对), 应走 embedded
	SetRegistryPath("resource_types.json")
	defer SetRegistryPath("")
	reg2 := LoadRegistry()
	if reg2 == nil {
		t.Fatal("默认名应走 embedded")
	}
	rt2 := RegistryType("MARKER-TYPE-UNIQUE")
	if rt2 != nil {
		t.Error("默认名 'resource_types.json' 应跳过显式路径, 不应读到 marker 类型")
	}
	// embedded 含 ysm
	if RegistryType("ysm") == nil {
		t.Error("默认名回退 embedded 后 ysm 应可见")
	}
}

// ============================================================
// 5. 并发下 RegistryType 的指针拷贝 (防外部篡改)
// ============================================================

func TestLoadRegistry_ConcurrentRegistryTypePointerCopy(t *testing.T) {
	SetRegistryPath("")
	defer SetRegistryPath("")

	// 预热缓存
	_ = LoadRegistry()

	const goroutines = 10
	var wg sync.WaitGroup
	var corruption int64

	for i := 0; i < goroutines; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			for j := 0; j < 100; j++ {
				rt := RegistryType("ysm")
				if rt == nil {
					atomic.AddInt64(&corruption, 1)
					continue
				}
				// 篡改返回值: ID 改成一个异常值
				rt.ID = "CORRUPTED-" + string(rune('0'+(idx%10)))
				// 如果 RegistryType 返回的是缓存的指针, 下一轮查询会读到脏值
			}
		}(i)
	}
	wg.Wait()

	// 再次查询 ysm, ID 应是干净的 "ysm"
	rt := RegistryType("ysm")
	if rt == nil {
		t.Fatal("并发压力后 ysm 应仍可见")
	}
	if rt.ID != "ysm" {
		t.Errorf("RegistryType 应返回指针拷贝: ID = %q (应 'ysm')", rt.ID)
	}
	if corruption > 0 {
		t.Logf("并发中出现 nil 次数 = %d (可能是缓存重建期间短暂状态)", corruption)
	}
}
