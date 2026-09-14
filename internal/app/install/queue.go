// ========== 下载队列（install 域子包） ==========
// 从 app.go / app_download.go 垂直切分而来（ADR-179 P1：拆解 internal/app 扁平巨型包）。
// 回调注入替代 *App 反向引用（延续 ADR-002 P1：打破 DownloadQueue ↔ App 循环，解锁独立测试）。
//
// 并发模型（ADR-237）：**常驻 worker + channel**，取代原「改共享状态 + 启停 goroutine +
// epoch 代际」模型。原模型同一根因（worker 生命周期由共享状态推导而非由同步原语表达）
// 以五形态暴露，各自需要一处补丁：epoch 代际（启停窗口）/ restart 分支（丢失唤醒）/
// spawnEpoch 捕获（spawn 与取锁之间被取代）/ panicked（重启循环）/ shuttingDown（退出空转）。
// 现模型下 worker 只启动一次并阻塞在 select 上，Enqueue 写任务、Cancel 发信号**均不启停
// goroutine**——「旧 worker vs 新 worker」「spawn 窗口」「丢失唤醒」在结构上不可表达。
// 仅保留 panicked（回调 panic 的 recover 兜底，是必要防御，与生命周期解耦）。
package install

import (
	"context"
	"fmt"
	"log"
	"os"
	"strings"
	"sync"

	"ysm-model-manager/go/types"
)

// DownloadQueue 串行下载队列
// 回调注入替代 *App 反向引用（ADR-002 P1：打破 DownloadQueue ↔ App 循环，解锁独立测试）
type DownloadQueue struct {
	tasks   []types.DownloadTask
	mu      sync.Mutex
	running bool
	// ctx 为本批任务的取消 context（Cancel 时替换）；parentCtx 为队列生命周期父 context
	// （应用级 appCtx）：应用退出时在途下载与消费循环一并终止。
	ctx       context.Context
	cancelFn  context.CancelFunc
	parentCtx context.Context

	// wake 唤醒信号（容量 1 的非阻塞信号量）：Enqueue 追加任务后投递。
	// 容量 1 保证「多次入队只需一次唤醒即够」——worker 被唤醒后会消费到队列排空为止，
	// 因此不会丢失唤醒（原模型靠 restart 分支补偿的正是这个丢失窗口）。
	wake chan struct{}
	// cancelCh 取消信号（容量 1）：Cancel 投递，worker 在 select 中处理。
	cancelCh chan struct{}
	// stopped 标记 worker 已因子 context 退出（应用退出）：
	// 由 run() 退出前 close，测试可 <-q.stopped 确定性等待 worker 退出。
	stopped chan struct{}

	downloadFn func(ctx context.Context, url, saveDir string) (string, error)
	emitFn     func(name string, args ...interface{})
	logFn      func(op, modelName, sourcePath, targetDir string, fileSize int64, status, errMsg string)
}

// NewDownloadQueue 创建串行下载队列（回调由 App 初始化时注入）。
// parent 传应用生命周期 context（a.appCtx）：队列 ctx 派生自 parent，
// 应用退出时在途下载与消费循环一并终止；parent 为 nil 时回退 Background（测试兜底）。
//
// 常驻 worker 在此启动一次（ADR-237），生命周期绑定 parentCtx——parent 取消即退出，无泄漏。
func NewDownloadQueue(parent context.Context, downloadFn func(ctx context.Context, url, saveDir string) (string, error), emitFn func(name string, args ...interface{}), logFn func(op, modelName, sourcePath, targetDir string, fileSize int64, status, errMsg string)) *DownloadQueue {
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := context.WithCancel(parent)
	q := &DownloadQueue{
		downloadFn: downloadFn,
		emitFn:     emitFn,
		logFn:      logFn,
		ctx:        ctx,
		cancelFn:   cancel,
		parentCtx:  parent,
		wake:       make(chan struct{}, 1),
		cancelCh:   make(chan struct{}, 1),
		stopped:    make(chan struct{}),
	}
	go q.run()
	return q
}

// Enqueue 入队一批下载任务（URL 仅允许 https，防 SSRF / 本地文件读取）。
func (q *DownloadQueue) Enqueue(tasks []types.DownloadTask) error {
	if q == nil {
		return nil
	}
	if len(tasks) == 0 {
		return nil
	}
	for _, t := range tasks {
		if !strings.HasPrefix(t.URL, "https://") {
			return fmt.Errorf("不支持的 URL scheme: %s（仅支持 https）", t.URL)
		}
	}
	q.mu.Lock()
	// 关闭窗口守卫：parentCtx 已取消（应用退出）时常驻 worker 已永久退出，
	// 新任务将无人消费——拒绝入队，否则任务滞留、前端永久卡 downloading。
	if q.parentCtx.Err() != nil {
		q.mu.Unlock()
		return fmt.Errorf("应用正在退出，下载队列已停止，拒绝新任务")
	}
	// 新一批任务视为重新开始：复位取消标志，否则上次取消后队列永不发 done
	//（前端会永久卡 downloading）。原模型的 cancelled 字段现由 wake/cancelCh 双信号表达：
	// 入队即代表「新一批开始」，无需显式复位标志。
	q.tasks = append(q.tasks, tasks...)
	q.running = true
	total := len(q.tasks)
	q.mu.Unlock()

	// 非阻塞投递唤醒（cap 1 信号量）：已有待处理唤醒时无需重复投递——
	// worker 每次唤醒都会消费到队列排空，故不会丢失本次新增的任务。
	select {
	case q.wake <- struct{}{}:
	default:
	}
	log.Printf("[queue] emit queue:status enqueued total=%d", total)
	q.emitFn("queue:status", "enqueued", total, "")
	return nil
}

// Cancel 取消在途队列并清空待处理任务。
func (q *DownloadQueue) Cancel() {
	if q == nil {
		return
	}
	q.mu.Lock()
	if q.running {
		q.cancelFn() // 取消在途下载请求
		q.ctx, q.cancelFn = context.WithCancel(q.parentCtx)
	}
	q.tasks = nil
	q.running = false
	q.mu.Unlock()

	// 通知 worker 取消已发生。陈旧的 wake 信号无需清理：Cancel 已在锁内清空
	// q.tasks，迟到的唤醒只会触发一次空队列 consume（入口判空直接返回），
	// 不可能消费已取消的任务。
	select {
	case q.cancelCh <- struct{}{}:
	default:
	}
	log.Printf("[queue] emit queue:status cancelled")
	q.emitFn("queue:status", "cancelled", 0, "")
}

// Status 返回队列结构化状态（ADR-145：types.QueueStatusInfo 为跨包 DTO，JSON 契约不变）。
func (q *DownloadQueue) Status() types.QueueStatusInfo {
	if q == nil {
		return types.QueueStatusInfo{}
	}
	q.mu.Lock()
	defer q.mu.Unlock()
	return types.QueueStatusInfo{Remaining: len(q.tasks), Running: q.running}
}

// process 手动/测试驱动路径：同步消费当前队列。
// 保留供测试直接驱动消费循环（无需 goroutine 与时序编排，天然确定性）。
func (q *DownloadQueue) process() {
	q.consume()
}

// run 常驻消费循环（ADR-237）：唯一 worker，启动一次，阻塞在 select 上。
// 三路信号：应用退出（parentCtx）/ 取消 / 唤醒消费。
func (q *DownloadQueue) run() {
	defer close(q.stopped)
	for {
		select {
		case <-q.parentCtx.Done():
			// 应用退出：终止消费，不发 done（退出不是「下载完成」）
			return
		case <-q.cancelCh:
			// 取消：分支体无需动作——Cancel 已在锁内清空 q.tasks，待处理的陈旧
			// wake 只会触发一次空队列 consume（入口判空直接返回），不可能消费
			// 已取消的任务（不发 done——前端已收到 cancelled）。
			// 消费循环下一轮回到 select，等待新一批入队。
		case <-q.wake:
			q.consume()
		}
	}
}

// consume 消费队列至排空。由常驻 worker 在收到唤醒信号后调用，或由 process 同步驱动。
//
// 事件语义（严格保持 ADR-237 前的现状）：
//   - 每任务发 queue:file-start / queue:file-done；
//   - 队列排空且期间未被取消 → 发 queue:status done；
//   - 取消（Cancel 已递增 ctx 代际 / running 置 false）后不发 done；
//   - 回调 panic 被 recover 拦截并 fail-stop（不发 done，不重启——防无限重启循环）。
func (q *DownloadQueue) consume() {
	// 标记消费中：Status().Running 在消费期间为真（与旧实现 processForEpoch 进入即
	// 置 running 的语义一致）。队列为空时不置位——Cancel 已清空 tasks，陈旧的
	// consume 驱动不会把已取消的队列重新标记为运行中。
	q.mu.Lock()
	if len(q.tasks) == 0 {
		q.mu.Unlock()
		return
	}
	q.running = true
	q.mu.Unlock()

	// panicked 标志：downloadFn/emitFn/logFn 回调 panic 被 recover 拦截后置 true，
	// 阻止发出「假 done」——UI 收到 done 会认为下载完成，但队列实际 fail-stop 在
	// panic 任务上。panic 不该被当成普通下载失败继续消费。
	panicked := false
	defer func() {
		// recover 兜底：串行消费核心管道若回调 panic 无拦截会直接崩溃整个桌面进程
		// （conc.Pool / watcher.loop / dedup.worker 的 worker 均有同款兜底）。
		// recover 必须在 done 判定之前执行，panicked 标志才来得及参与。
		if r := recover(); r != nil {
			panicked = true
			log.Printf("[queue] consume panic（回调 panic 已拦截，队列 fail-stop）: %v", r)
		}
		// running 复位与 panicked 解耦：无论是否 panic，消费循环退出后队列都不应
		// 停留在「运行中」——否则 Status().Running 永久为真、前端卡 downloading。
		q.mu.Lock()
		idle := len(q.tasks) == 0
		running := q.running
		q.running = false
		q.mu.Unlock()
		// done 仅在「未 panic、队列已排空、且此前确实在运行、parent 未退出」时发：
		// panic 时队列 fail-stop 停在 panic 任务上，假 done 会让前端误判整体完成。
		shuttingDown := q.parentCtx.Err() != nil
		if !panicked && idle && running && !shuttingDown {
			log.Printf("[queue] emit queue:status done")
			q.emitFn("queue:status", "done", 0, "")
		}
	}()

	for {
		q.mu.Lock()
		if q.parentCtx.Err() != nil {
			// 应用退出：终止消费（defer 中 shuttingDown 分支抑制 done）
			q.mu.Unlock()
			return
		}
		if len(q.tasks) == 0 {
			q.mu.Unlock()
			return
		}
		task := q.tasks[0]
		q.tasks = q.tasks[1:]
		remaining := len(q.tasks)
		// 锁内快照 ctx：Cancel 会替换 q.ctx，必须用本任务发起时的 ctx 做请求取消
		ctx := q.ctx
		q.mu.Unlock()

		log.Printf("[queue] emit queue:file-start name=%s pos=%d left=%d", task.Name, remaining+1, remaining)
		q.emitFn("queue:file-start", task.Name, remaining+1, remaining)

		savePath, err := q.downloadFn(ctx, task.URL, task.SaveDir)
		if err != nil {
			log.Printf("[queue] emit queue:file-done name=%s status=fail err=%v", task.Name, err)
			q.emitFn("queue:file-done", task.Name, "fail", err.Error())
			q.logFn("download", task.Name, task.URL, task.SaveDir, 0, "failed", err.Error())
		} else {
			log.Printf("[queue] emit queue:file-done name=%s status=ok", task.Name)
			q.emitFn("queue:file-done", task.Name, "ok", "")
			// 写入导入日志
			var fileSize int64
			if fi, st := os.Stat(savePath); st == nil {
				fileSize = fi.Size()
			}
			q.logFn("download", task.Name, task.URL, task.SaveDir, fileSize, "success", "")
		}

		select {
		case <-ctx.Done():
			// 本任务已在取消的 ctx 上快速失败；不再继续消费（defer 中 running 已被
			// Cancel 置 false，故不发 done）
			return
		default:
		}
	}
}
