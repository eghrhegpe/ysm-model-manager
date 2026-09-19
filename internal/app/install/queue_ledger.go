// ========== 下载队列落盘账本 ==========
// 借鉴隔壁 .dsh 的 durable ledger 范式：把 DownloadQueue「尚未开始」的排队任务镜像到磁盘，
// 进程崩溃/重启后由 UseLedger 播种回队列自动续排，不再整批丢失。
//
// 有意不借 .dsh 的其余两件：
//   - scheduler + lastTickAt：本队列是 wake(channel) 驱动排空，无周期性 tick 循环，加 tick 即死重量；
//   - .lock + revision 乐观并发：单进程 + sync.Mutex 已守队列状态，跨进程锁是 YAGNI。
//
// 语义边界（v1 最小账本）：账本只存 pending（未开始）任务。任务一旦出队即视为已启动、移出 pending，
// 因此崩溃时「在途那一个」不自动重下——字节级断点续传是「续传 ADR」的职责（见 go/download/download.go
// 预留插槽），本模块刻意与之解耦、不触碰 .part / Range 逻辑。
package install

import (
	"encoding/json"
	"log"
	"os"
	"strings"

	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/types"
)

// ledgerSchemaVersion 账本格式版本；不符即按损坏忽略（安全降级，不阻断启动）。
const ledgerSchemaVersion = 1

// ledgerState 落盘结构。字段导出仅供本包 json 编解码，不跨包/前端消费。
type ledgerState struct {
	SchemaVersion int                  `json:"schemaVersion"`
	Tasks         []types.DownloadTask `json:"tasks"`
}

// removeLedger 删除账本文件（pending 清空 / 损坏清理）。ledgerPath 为空即禁用态，跳过；
// 文件不存在视为已达目标（幂等）。删除对象是配置目录下的 download-queue.json，
// 与模型库资源无关，故 scanner 缓存失效（W7）不适用。
func (q *DownloadQueue) removeLedger() {
	if q.ledgerPath == "" {
		return
	}
	if err := os.Remove(q.ledgerPath); err != nil && !os.IsNotExist(err) {
		log.Printf("[queue] 删除下载账本失败: %v", err)
	}
}

// persist 原子写当前 pending 快照（snapshot 在 q.mu 内取，写盘在 q.mu 外，避免 IO 持锁）。
// pending 为空时删除文件：避免下次启动误续已跑完的批。ledgerMu 串行化并发写，
// last-writer-wins 对续排账本可接受（最坏是某次写稍旧，重启后仍收敛到正确的 pending 集）。
func (q *DownloadQueue) persist() {
	if q == nil || q.ledgerPath == "" {
		return
	}
	q.mu.Lock()
	snapshot := make([]types.DownloadTask, len(q.tasks))
	copy(snapshot, q.tasks)
	q.mu.Unlock()

	q.ledgerMu.Lock()
	defer q.ledgerMu.Unlock()

	if len(snapshot) == 0 {
		q.removeLedger()
		return
	}
	data, err := json.Marshal(ledgerState{SchemaVersion: ledgerSchemaVersion, Tasks: snapshot})
	if err != nil {
		log.Printf("[queue] 序列化下载账本失败: %v", err)
		return
	}
	if err := fsutil.WriteFileAtomic(q.ledgerPath, data); err != nil {
		log.Printf("[queue] 写下载账本失败: %v", err)
	}
}

// UseLedger 启用落盘账本，并把上次未完成的 pending 任务播种回队列（随后唤醒 worker 续排）。
//   - path 为空（平台数据根缺失，见 app_config.configDir）：静默禁用持久化，行为零漂移。
//   - 账本不存在 / 读取失败 / JSON 损坏 / schemaVersion 不符：忽略并清理损坏文件，不阻断启动。
//   - 播种复用 Enqueue 的 https 守卫：防陈旧账本被外部篡改后引入非 https（SSRF/本地读）任务。
func (q *DownloadQueue) UseLedger(path string) {
	if q == nil || path == "" {
		return
	}
	q.ledgerPath = path

	data, err := os.ReadFile(path)
	if err != nil {
		return // 不存在属正常首次启动；读错误亦安全降级为无账本
	}
	var st ledgerState
	if err := json.Unmarshal(data, &st); err != nil || st.SchemaVersion != ledgerSchemaVersion {
		log.Printf("[queue] 下载账本损坏或版本不符，忽略并清理: %v", err)
		q.removeLedger() // 此时 ledgerPath 已置为 path，清理损坏文件
		return
	}
	if len(st.Tasks) == 0 || q.parentCtx.Err() != nil {
		return // 空账本或应用正在退出：不续排
	}

	accepted := make([]types.DownloadTask, 0, len(st.Tasks))
	for _, t := range st.Tasks {
		if strings.HasPrefix(t.URL, "https://") {
			accepted = append(accepted, t)
		}
	}
	if len(accepted) == 0 {
		return
	}

	q.mu.Lock()
	q.tasks = append(q.tasks, accepted...)
	q.running = true
	total := len(q.tasks)
	q.mu.Unlock()

	// 与 Enqueue 同款非阻塞唤醒：常驻 worker 醒来后把续排任务消费到排空。
	select {
	case q.wake <- struct{}{}:
	default:
	}
	log.Printf("[queue] 从账本续排 %d 个下载任务", len(accepted))
	q.emitFn("queue:status", "enqueued", total, "")
}
