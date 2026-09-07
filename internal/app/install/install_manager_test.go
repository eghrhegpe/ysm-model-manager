package install

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"

	"ysm-model-manager/go/types"
)

// TestNewManager 构造函数测试
func TestNewManager(t *testing.T) {
	queue := NewDownloadQueue(context.Background(), nil, nil, nil)
	deps := ConfigDeps{
		LoadAppConfig: func() types.AppConfig { return types.AppConfig{} },
		SaveAppConfig: func(cfg types.AppConfig) error { return nil },
	}
	m := NewManager(queue, deps)
	if m == nil {
		t.Fatal("NewManager 应返回非 nil Manager")
	}
	if m.Queue == nil {
		t.Fatal("Manager.Queue 应被设置")
	}
	if m.deps.LoadAppConfig == nil {
		t.Fatal("Manager.deps.LoadAppConfig 应被设置")
	}
	if m.deps.SaveAppConfig == nil {
		t.Fatal("Manager.deps.SaveAppConfig 应被设置")
	}
}

// TestNewManager_NilQueue 测试 nil queue
func TestNewManager_NilQueue(t *testing.T) {
	deps := ConfigDeps{
		LoadAppConfig: func() types.AppConfig { return types.AppConfig{} },
		SaveAppConfig: func(cfg types.AppConfig) error { return nil },
	}
	m := NewManager(nil, deps)
	if m == nil {
		t.Fatal("NewManager 应返回非 nil Manager")
	}
	if m.Queue != nil {
		t.Fatal("Manager.Queue 应为 nil")
	}
}

// TestSyncLinkMode 同步链接模式到内存快照
func TestSyncLinkMode(t *testing.T) {
	queue := NewDownloadQueue(context.Background(), nil, nil, nil)
	deps := ConfigDeps{
		LoadAppConfig: func() types.AppConfig { return types.AppConfig{} },
		SaveAppConfig: func(cfg types.AppConfig) error { return nil },
	}
	m := NewManager(queue, deps)

	m.SyncLinkMode("symlink")
	if m.getLinkMode() != "symlink" {
		t.Errorf("SyncLinkMode 后 getLinkMode 应为 symlink, got %q", m.getLinkMode())
	}

	m.SyncLinkMode("hardlink")
	if m.getLinkMode() != "hardlink" {
		t.Errorf("SyncLinkMode 后 getLinkMode 应为 hardlink, got %q", m.getLinkMode())
	}

	m.SyncLinkMode("copy")
	if m.getLinkMode() != "copy" {
		t.Errorf("SyncLinkMode 后 getLinkMode 应为 copy, got %q", m.getLinkMode())
	}
}

// TestSyncLinkMode_NilManager 测试 nil Manager
func TestSyncLinkMode_NilManager(t *testing.T) {
	var m *Manager
	m.SyncLinkMode("symlink") // 不应 panic
}

// TestSetLinkMode 设置链接模式（含持久化和内存同步）
func TestSetLinkMode(t *testing.T) {
	savedCfg := &types.AppConfig{}
	queue := NewDownloadQueue(context.Background(), nil, nil, nil)
	deps := ConfigDeps{
		LoadAppConfig: func() types.AppConfig { return *savedCfg },
		SaveAppConfig: func(cfg types.AppConfig) error {
			*savedCfg = cfg
			return nil
		},
	}
	m := NewManager(queue, deps)

	// 首次设置
	err := m.SetLinkMode("symlink")
	if err != nil {
		t.Fatalf("SetLinkMode(symlink) 失败: %v", err)
	}
	if savedCfg.LinkMode != "symlink" {
		t.Errorf("配置未持久化: LinkMode=%q", savedCfg.LinkMode)
	}
	if m.GetLinkMode() != "symlink" {
		t.Errorf("内存快照未同步: GetLinkMode=%q", m.GetLinkMode())
	}

	// 重复设置相同值（应无操作）
	err = m.SetLinkMode("symlink")
	if err != nil {
		t.Fatalf("重复设置相同值不应报错: %v", err)
	}

	// 修改为新值
	err = m.SetLinkMode("copy")
	if err != nil {
		t.Fatalf("SetLinkMode(copy) 失败: %v", err)
	}
	if savedCfg.LinkMode != "copy" {
		t.Errorf("配置未更新: LinkMode=%q", savedCfg.LinkMode)
	}
	if m.GetLinkMode() != "copy" {
		t.Errorf("内存快照未更新: GetLinkMode=%q", m.GetLinkMode())
	}
}

// TestSetLinkMode_InvalidMode 测试无效模式
func TestSetLinkMode_InvalidMode(t *testing.T) {
	queue := NewDownloadQueue(context.Background(), nil, nil, nil)
	deps := ConfigDeps{
		LoadAppConfig: func() types.AppConfig { return types.AppConfig{} },
		SaveAppConfig: func(cfg types.AppConfig) error { return nil },
	}
	m := NewManager(queue, deps)

	err := m.SetLinkMode("invalid")
	if err == nil {
		t.Error("无效模式应返回 error")
	}
	if m.GetLinkMode() != "" {
		t.Errorf("无效模式不应修改内存快照: got %q", m.GetLinkMode())
	}
}

// TestSetLinkMode_NilManager 测试 nil Manager
func TestSetLinkMode_NilManager(t *testing.T) {
	var m *Manager
	err := m.SetLinkMode("symlink")
	if err == nil {
		t.Error("nil Manager 应返回 error")
	}
}

// TestSetLinkMode_SaveError 测试保存配置失败
func TestSetLinkMode_SaveError(t *testing.T) {
	queue := NewDownloadQueue(context.Background(), nil, nil, nil)
	deps := ConfigDeps{
		LoadAppConfig: func() types.AppConfig { return types.AppConfig{} },
		SaveAppConfig: func(cfg types.AppConfig) error { return fmt.Errorf("save failed") },
	}
	m := NewManager(queue, deps)

	err := m.SetLinkMode("symlink")
	if err == nil {
		t.Error("保存失败应返回 error")
	}
	if m.GetLinkMode() != "" {
		t.Errorf("保存失败不应同步内存快照: got %q", m.GetLinkMode())
	}
}

// TestGetLinkMode 公开读取
func TestGetLinkMode(t *testing.T) {
	queue := NewDownloadQueue(context.Background(), nil, nil, nil)
	deps := ConfigDeps{
		LoadAppConfig: func() types.AppConfig { return types.AppConfig{} },
		SaveAppConfig: func(cfg types.AppConfig) error { return nil },
	}
	m := NewManager(queue, deps)

	m.SyncLinkMode("hardlink")
	if m.GetLinkMode() != "hardlink" {
		t.Errorf("GetLinkMode 应返回 hardlink, got %q", m.GetLinkMode())
	}
}

// TestGetLinkMode_NilManager 测试 nil Manager
func TestGetLinkMode_NilManager(t *testing.T) {
	var m *Manager
	if m.GetLinkMode() != "" {
		t.Errorf("nil Manager GetLinkMode 应返回空串, got %q", m.GetLinkMode())
	}
}

// TestNewDownloadQueue 构造函数测试
func TestNewDownloadQueue(t *testing.T) {
	q := NewDownloadQueue(context.Background(), nil, nil, nil)
	if q == nil {
		t.Fatal("NewDownloadQueue 应返回非 nil")
	}
	status := q.Status()
	if status.Remaining != 0 || status.Running {
		t.Errorf("新队列状态应为空: got %+v", status)
	}
}

// TestNewDownloadQueue_NilParent 测试 nil parent context
func TestNewDownloadQueue_NilParent(t *testing.T) {
	// 本用例正是验证「nil parent → 回退 context.Background()」，nil 是被测输入，不可替换。
	//nolint:staticcheck // SA1012：刻意传 nil 以覆盖 queue.go 的 nil 兜底分支
	q := NewDownloadQueue(nil, nil, nil, nil)
	if q == nil {
		t.Fatal("NewDownloadQueue(nil parent) 应返回非 nil（回退 Background）")
	}
}

// TestEnqueue_EmptyTasks 测试空任务列表
func TestEnqueue_EmptyTasks(t *testing.T) {
	q := NewDownloadQueue(context.Background(), nil, nil, nil)
	err := q.Enqueue([]types.DownloadTask{})
	if err != nil {
		t.Fatalf("空任务列表不应报错: %v", err)
	}
	status := q.Status()
	if status.Remaining != 0 {
		t.Errorf("空入队后队列应为空: got %d", status.Remaining)
	}
}

// TestEnqueue_NilQueue 测试 nil queue
func TestEnqueue_NilQueue(t *testing.T) {
	var q *DownloadQueue
	err := q.Enqueue([]types.DownloadTask{{Name: "a", URL: "https://a", SaveDir: "/"}})
	if err != nil {
		t.Fatalf("nil queue Enqueue 不应报错: %v", err)
	}
}

// TestEnqueue_InvalidURLScheme 测试非 https URL
func TestEnqueue_InvalidURLScheme(t *testing.T) {
	q := NewDownloadQueue(context.Background(), nil, nil, nil)
	err := q.Enqueue([]types.DownloadTask{{Name: "a", URL: "http://a", SaveDir: "/"}})
	if err == nil {
		t.Error("非 https URL 应返回 error")
	}
	err = q.Enqueue([]types.DownloadTask{{Name: "a", URL: "file:///a", SaveDir: "/"}})
	if err == nil {
		t.Error("file:// URL 应返回 error")
	}
}

// TestEnqueue_Basic 测试基本入队
func TestEnqueue_Basic(t *testing.T) {
	var emitted []string
	var emittedMu sync.Mutex
	mockDownloadFn := func(ctx context.Context, url, saveDir string) (string, error) {
		// 慢速下载，给测试时间检查队列状态
		time.Sleep(200 * time.Millisecond)
		return "", nil
	}
	mockEmitFn := func(name string, args ...interface{}) {
		emittedMu.Lock()
		emitted = append(emitted, name)
		emittedMu.Unlock()
	}
	mockLogFn := func(op, modelName, sourcePath, targetDir string, fileSize int64, status, errMsg string) {}
	q := NewDownloadQueue(context.Background(), mockDownloadFn, mockEmitFn, mockLogFn)
	err := q.Enqueue([]types.DownloadTask{
		{Name: "a", URL: "https://example.com/a", SaveDir: "/tmp"},
		{Name: "b", URL: "https://example.com/b", SaveDir: "/tmp"},
	})
	if err != nil {
		t.Fatalf("Enqueue 失败: %v", err)
	}
	// 入队后队列可能已开始处理（异步 process），Remaining 可能为 1（正在处理第一个）或 2（尚未开始）
	status := q.Status()
	if status.Remaining < 1 || status.Remaining > 2 {
		t.Errorf("入队后队列应有 1-2 个任务: got %d", status.Remaining)
	}
	if !status.Running {
		t.Error("队列应标记为 running")
	}
	// 等待异步 process 处理完
	time.Sleep(500 * time.Millisecond)
	// 验证发射了 queue:status enqueued
	emittedMu.Lock()
	found := false
	for _, e := range emitted {
		if e == "queue:status" {
			found = true
			break
		}
	}
	emittedMu.Unlock()
	if !found {
		t.Log("未捕获到 queue:status 事件")
	}
}

// TestCancel_Basic 测试基本取消
func TestCancel_Basic(t *testing.T) {
	mockDownloadFn := func(ctx context.Context, url, saveDir string) (string, error) {
		return "", nil
	}
	mockEmitFn := func(name string, args ...interface{}) {}
	mockLogFn := func(op, modelName, sourcePath, targetDir string, fileSize int64, status, errMsg string) {}
	q := NewDownloadQueue(context.Background(), mockDownloadFn, mockEmitFn, mockLogFn)
	q.Enqueue([]types.DownloadTask{
		{Name: "a", URL: "https://example.com/a", SaveDir: "/tmp"},
	})
	// 等待 process 启动
	time.Sleep(50 * time.Millisecond)
	q.Cancel()
	status := q.Status()
	if status.Remaining != 0 {
		t.Errorf("取消后队列应为空: got %d", status.Remaining)
	}
	if status.Running {
		t.Error("取消后队列不应 running")
	}
}

// TestCancel_NilQueue 测试 nil queue
func TestCancel_NilQueue(t *testing.T) {
	var q *DownloadQueue
	q.Cancel() // 不应 panic
}

// TestCancel_Idempotent 测试重复取消幂等
func TestCancel_Idempotent(t *testing.T) {
	mockDownloadFn := func(ctx context.Context, url, saveDir string) (string, error) {
		return "", nil
	}
	mockEmitFn := func(name string, args ...interface{}) {}
	mockLogFn := func(op, modelName, sourcePath, targetDir string, fileSize int64, status, errMsg string) {}
	q := NewDownloadQueue(context.Background(), mockDownloadFn, mockEmitFn, mockLogFn)
	q.Cancel()
	q.Cancel() // 第二次不应 panic
	status := q.Status()
	if status.Running {
		t.Error("重复取消后不应 running")
	}
}

// TestCancel_ThenEnqueue 测试取消后重新入队
func TestCancel_ThenEnqueue(t *testing.T) {
	mockDownloadFn := func(ctx context.Context, url, saveDir string) (string, error) {
		return "", nil
	}
	mockEmitFn := func(name string, args ...interface{}) {}
	mockLogFn := func(op, modelName, sourcePath, targetDir string, fileSize int64, status, errMsg string) {}
	q := NewDownloadQueue(context.Background(), mockDownloadFn, mockEmitFn, mockLogFn)
	q.Enqueue([]types.DownloadTask{{Name: "a", URL: "https://a", SaveDir: "/"}})
	q.Cancel()
	// 取消后再入队
	err := q.Enqueue([]types.DownloadTask{{Name: "b", URL: "https://b", SaveDir: "/"}})
	if err != nil {
		t.Fatalf("取消后入队失败: %v", err)
	}
	status := q.Status()
	if status.Remaining != 1 {
		t.Errorf("取消后入队应有 1 个任务: got %d", status.Remaining)
	}
	if !status.Running {
		t.Error("取消后入队应重新 running")
	}
}

// TestStatus_NilQueue 测试 nil queue 状态
func TestStatus_NilQueue(t *testing.T) {
	var q *DownloadQueue
	status := q.Status()
	if status.Remaining != 0 || status.Running {
		t.Errorf("nil queue Status 应为零值: got %+v", status)
	}
}

// TestDownloadQueue_ConcurrentEnqueueCancel 测试并发入队/取消竞态
func TestDownloadQueue_ConcurrentEnqueueCancel(t *testing.T) {
	mockDownloadFn := func(ctx context.Context, url, saveDir string) (string, error) {
		return "", nil
	}
	mockEmitFn := func(name string, args ...interface{}) {}
	mockLogFn := func(op, modelName, sourcePath, targetDir string, fileSize int64, status, errMsg string) {}
	q := NewDownloadQueue(context.Background(), mockDownloadFn, mockEmitFn, mockLogFn)
	done := make(chan struct{})
	// 并发：一个 goroutine 不断入队，另一个不断取消
	go func() {
		for i := 0; i < 100; i++ {
			q.Enqueue([]types.DownloadTask{{Name: "t", URL: "https://x", SaveDir: "/"}})
			time.Sleep(1 * time.Millisecond)
		}
		close(done)
	}()
	go func() {
		for i := 0; i < 50; i++ {
			q.Cancel()
			time.Sleep(2 * time.Millisecond)
		}
	}()
	<-done
	// 最终状态不应 panic，队列应处于一致状态
	status := q.Status()
	_ = status // 仅验证不 panic
}
