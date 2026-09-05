package sync

import (
	"ysm-model-manager/go/internal/testutil"

	"os"
	"path/filepath"
	"reflect"
	"sort"
	"testing"

	"ysm-model-manager/go/scanner"
)

// TestCollectEntriesFromScanEqualsWalk 锁定 collectEntriesFromScan 与 collectEntriesWalk
// 语义等价，覆盖 Walk 的 SkipDir 三种情形：根级平铺文件、叶子模型文件夹、容器模型文件夹
// （直接含模型文件 + 子模型文件夹）。防止「复用扫描缓存」性能修复引入同步条目漂移。
func TestCollectEntriesFromScanEqualsWalk(t *testing.T) {
	root := t.TempDir()
	// 根级平铺模型文件（恒登记）
	testutil.WriteTestFile(t, filepath.Join(root, "solo.pmx"), "x")
	// 非模型文件（应被忽略）
	testutil.WriteTestFile(t, filepath.Join(root, "readme.txt"), "x")
	// 叶子模型文件夹：内含 model.pmx，自身作为整体单元（内部文件不登记）
	mkdir(t, filepath.Join(root, "leaf_pack"))
	testutil.WriteTestFile(t, filepath.Join(root, "leaf_pack", "model.pmx"), "x")
	// 容器模型文件夹：直接含 model.pmx + 子模型文件夹 sub（自身与子夹均登记、内部文件登记）
	mkdir(t, filepath.Join(root, "container"))
	testutil.WriteTestFile(t, filepath.Join(root, "container", "model.pmx"), "x")
	mkdir(t, filepath.Join(root, "container", "sub"))
	testutil.WriteTestFile(t, filepath.Join(root, "container", "sub", "model2.pmx"), "x")

	rtype := "EntityPlayer" // 无嵌套模式，走 scan 反推路径

	walkMap := collectEntriesWalk(root, rtype)
	if len(walkMap) == 0 {
		t.Fatalf("walkMap 为空：测试树未产生任何模型条目，请检查 rtype=%s 的扩展名配置", rtype)
	}
	scanEntries, _ := scanner.ScanEntriesWithHit(root)
	scanMap := collectEntriesFromScan(scanEntries, root, rtype)
	if scanMap == nil {
		t.Fatalf("collectEntriesFromScan 返回 nil（rtype=%s 不应回退 Walk）", rtype)
	}
	if !reflect.DeepEqual(walkMap, scanMap) {
		t.Errorf("collectEntriesFromScan 与 Walk 结果不一致\nWalk: %v\nScan: %v", walkMap, scanMap)
	}
}

// TestSyncResourcesDirLevelScanMatchesWalk 端到端：对同一目录自比（global==instance），
// 注入 scanFn 与 Walk 两种实现应给出相同的 Synced 条目集合。
func TestSyncResourcesDirLevelScanMatchesWalk(t *testing.T) {
	root := t.TempDir()
	mkdir(t, filepath.Join(root, "leaf_pack"))
	testutil.WriteTestFile(t, filepath.Join(root, "leaf_pack", "model.pmx"), "x")
	mkdir(t, filepath.Join(root, "container"))
	testutil.WriteTestFile(t, filepath.Join(root, "container", "model.pmx"), "x")
	mkdir(t, filepath.Join(root, "container", "sub"))
	testutil.WriteTestFile(t, filepath.Join(root, "container", "sub", "model2.pmx"), "x")
	testutil.WriteTestFile(t, filepath.Join(root, "solo.pmx"), "x")

	rtype := "EntityPlayer"
	walkRes := SyncResourcesDirLevel(root, root, rtype)
	scanRes := SyncResourcesDirLevelScan(root, root, rtype, scanner.ScanEntriesWithHit)
	if !equalStringSlice(walkRes.Synced, scanRes.Synced) {
		t.Errorf("Synced 不一致\nWalk: %v\nScan: %v", walkRes.Synced, scanRes.Synced)
	}
}

// TestCollectFolderFilesFromScanEqualsWalk 锁定 collectFolderFilesFromScan 与
// collectFolderFiles（Walk）语义等价：对同一 folder，从组根全量扫描条目反推出的
// 相对路径→绝对路径集合必须 == Walk 直接产出。覆盖叶子夹（内部文件全收）、
// 容器夹（内部文件全收 + 子夹文件）、根级平铺三种情形。
func TestCollectFolderFilesFromScanEqualsWalk(t *testing.T) {
	root := t.TempDir()

	// 目标 folder：container（直接含 model.pmx + 子夹 sub/model2.pmx）
	container := filepath.Join(root, "container")
	mkdir(t, container)
	testutil.WriteTestFile(t, filepath.Join(container, "model.pmx"), "x")
	mkdir(t, filepath.Join(container, "sub"))
	testutil.WriteTestFile(t, filepath.Join(container, "sub", "model2.pmx"), "x")
	// 同层干扰：另一个叶子夹 leaf（不应出现在 container 的结果里）
	mkdir(t, filepath.Join(root, "leaf"))
	testutil.WriteTestFile(t, filepath.Join(root, "leaf", "solo.pmx"), "x")
	// 根级平铺干扰
	testutil.WriteTestFile(t, filepath.Join(root, "root_solo.pmx"), "x")

	rtype := "EntityPlayer" // 无嵌套模式，走 scan 反推路径

	walkMap := collectFolderFiles(container, rtype)
	if len(walkMap) == 0 {
		t.Fatalf("collectFolderFiles(container) 为空：测试树未产生模型条目，rtype=%s", rtype)
	}

	// 组根全量条目（模拟刷新暖好的缓存）：首次调用走盘 hit=false，
	// 二次调用命中 30s 缓存 hit=true——与生产「刷新后查看同步」场景一致
	_, _ = scanner.ScanEntriesWithHit(root) // 暖缓存
	allEntries, hit := scanner.ScanEntriesWithHit(root)
	if !hit || len(allEntries) == 0 {
		t.Fatalf("scanner 未返回组根条目（hit=%v, len=%d），反推路径无法验证", hit, len(allEntries))
	}
	scanMap := collectFolderFilesFromScan(container, rtype, allEntries)
	if !reflect.DeepEqual(walkMap, scanMap) {
		t.Errorf("collectFolderFilesFromScan 与 Walk 结果不一致\nWalk: %v\nScan: %v", walkMap, scanMap)
	}

	// 反向确认：scanMap 不含 leaf / root_solo（仅 container 子树）
	for k := range scanMap {
		if k == "solo.pmx" || k == "root_solo.pmx" {
			t.Errorf("反推结果泄漏了 container 外的文件：%s", k)
		}
	}
}

func mkdir(t *testing.T, p string) {
	t.Helper()
	if err := os.MkdirAll(p, 0o755); err != nil {
		t.Fatal(err)
	}
}

func equalStringSlice(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	sa := append([]string(nil), a...)
	sb := append([]string(nil), b...)
	sort.Strings(sa)
	sort.Strings(sb)
	for i := range sa {
		if sa[i] != sb[i] {
			return false
		}
	}
	return true
}
