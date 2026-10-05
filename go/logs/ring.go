// ===== go/logs/ring.go：分区环形裁剪（ADR-322 D3 元失败证据不可驱逐）=====
//
// 立因：单漏斗日志环在崩溃态下最先丢掉最值钱的证据。「第一次出错」要么被同类的
// 后续重复条目挤掉，要么被另一类的高频业务日志整类挤没——而这正是元失败最需要
// 留痕的时刻（元失败风暴本身就是高频写入）。故按类分配额，而非"把 cap 调大"
// （调大只是把问题推后，且挤掉的仍是同一批证据）。
//
// 本文件只放这一条口径，op 环（logs.go）与 runtime 环（runtime.go）共用：
// 两环的分区谓词不同（Operation == "ui" vs Tag == "meta"），但配额、淘汰顺序与
// 峰值重分配口径同源。收敛于此而非两处各写一遍——两处实现漂移过一次就会让
// 「op 环保底而 runtime 环不保底」这类半修状态静默存在。
package logs

// protectedShareNum 受保护分区占环容量的分数（1/4）。四分之一是折中：
// 元失败证据通常只有个位数条（锁存原因一条 + 通道未落盘提示），给多了让位给
// 业务日志（导入/同步流水），给少了在"业务日志 400 条 + 元失败 150 条"的混合
// 态下会截断元失败现场。整数除向下取整，最小保底 1 条（limit 很小时不至于为 0）。
const protectedShareNum = 4

// peakCapFactor 峰值 backing 数组的重分配阈值倍数（cap > limit×4 才重分配）。
// 与裁剪前一致：正常 append 流的 cap 被钳制在 ~2×limit，达不到 4×，故该分支
// 只在突发峰值回落（或测试直构超大 backing）时触发。
const peakCapFactor = 4

// trimRing 分区环形裁剪：把超出 limit 的条目从「受保护分区之外」开始淘汰，
// 只有受保护分区自身也超配额时才淘汰它。发生裁剪且 backing 数组远超上限时
// 顺带重分配释放峰值占用（原 appendOp / Write 各自内联的那段，两环同源）。
//
//   - 受保护类封顶 limit/protectedShareNum：无论业务日志多少都不会被整类挤没
//     （元失败风暴挤掉 import 诊断 → 正是 ADR-322 §1 缺口 5 的病灶）。
//   - 业务类吃掉剩余配额，超出照样淘汰最旧：保护不等于无限，环仍是环。
//
// ⚠️ 区内仍按「丢最旧」：同类重复失败的信息量近似，「第一次」的价值在本设计里
// 由**类边界**保全（单条元失败证据在业务风暴中整条消失才是原病灶），而非头保留
// ——头保留会让隔天的首条 import 记录长期霸占窗口，且与既有契约
// TestLogger_Load_Over500Trim「保留最末 N 条」冲突。
//
// 就地左移淘汰（append 覆写）不新分配 slice：两处调用点的 ring 均为独占持有。
// 左移后清零尾槽，避免 ImportLog/RuntimeLog 的 string 字段被尾槽继续引用
// （环长期持有大 ErrorMsg 字符串是真实的内存滞留，reslice 方案无此问题）。
// limit <= 0 视作「不限」，原样返回。
func trimRing[T any](ring []T, limit int, isProtected func(T) bool) []T {
	if limit <= 0 || len(ring) <= limit {
		return ring
	}
	protectedLimit := limit / protectedShareNum
	if protectedLimit < 1 {
		protectedLimit = 1
	}
	limit0 := limit // 防止下方补零写越界时读到被改写的 limit
	for len(ring) > limit0 {
		// 单趟扫描同时定位两类各自的最旧条目与受保护条数：
		// 两类都不超配额时总量不可能超限（配额和 == limit），故 victim < 0 分支
		// 仅为防御（isProtected 恒假等异常谓词下不 panic），取末 limit 条兜底。
		oldestProtected, oldestPlain, protectedCount := -1, -1, 0
		for i, e := range ring {
			if isProtected(e) {
				protectedCount++
				if oldestProtected < 0 {
					oldestProtected = i
				}
			} else if oldestPlain < 0 {
				oldestPlain = i
			}
		}
		victim := oldestPlain
		if protectedCount > protectedLimit {
			victim = oldestProtected
		}
		if victim < 0 {
			ring = ring[len(ring)-limit0:]
			break
		}
		copy(ring[victim:], ring[victim+1:])
		ring[len(ring)-1] = *new(T) // 尾槽清零：解除对已淘汰条目的 string 引用
		ring = ring[:len(ring)-1]
	}
	if cap(ring) > limit0*peakCapFactor {
		nb := make([]T, len(ring))
		copy(nb, ring)
		ring = nb
	}
	return ring
}
