// ===== 日记第二落盘通道（ADR-322 D2）：日记主通道失效时的 outbox =====
// 存在理由：日记主通道是 `toast/logError/window error → logUiMsg → DiarySink
// → AddOpLog → Go 日志环 → JSON 文件`，这条链的**终点与起点在同一个进程、同一个
// 存储域**。它整体不可用时（Go 桥挂、日志目录只读、web 版 IDB 拒绝写），
// 原实现的唯一落点是 `dbg()`（受调试门控）或 console（GUI 生产无 DevTools），
// 也就是「唯一的报告者把报告丢了」。本模块提供**不经 backend 的第二条通道**：
// localStorage，浏览器与桌面壳都恒可用，与 Go 进程无依赖。
//
// 铁律（勿违反）：本模块内**禁止**调用 logWarn/logError/pushToDiary。
// 写失败若 logWarn → 日记 sink → AddOpLog 失败 → 回到本模块 enqueue → 再 logWarn，
// 构成跨 microtask 的无限循环（不栈溢出，只是静默烧 CPU 直到页面关闭）。
// 判定依据：这里的失败是**元失败的元失败**（连最后一条通道都不通），
// 没有任何下游能接收它，故只能就地静默——与 diary-sink.ts 的就地截断同源。
//
// 存储键刻意不共用 web: 前缀（那是 web-store 的 IDB 命名空间），避免与
// ADR-071 的网页版持久化键混淆。
//
// ⚠️ 为何**不**走 utils/base/primitives/storage.ts 的 safeGetJSON/safeSet
// （仓内 localStorage 读写的统一入口，ADR-044）：那三个函数在失败分支调
// `logWarn("storage", ...)`，而 logWarn 经日记 sink 回到 AddOpLog 失败处 → 回到
// 本模块 enqueue → 写失败 → 再 logWarn，正是上面那条无限循环。故此处按同一
// ADR-322 决策里的「裸 try/catch 静默」条款走裸 localStorage——两条子句冲突时
// 取「不得经日记通道报错」的那条（安全性质优先于复用偏好）。

import type { DiaryEntry } from "@/core/error-diary.ts";

/** localStorage 键（ADR-322 D2） */
export const OUTBOX_KEY = "ysmm:diary-outbox";

/**
 * outbox 条数上限。主通道长期失效时（如日志目录只读）会持续堆积，无上限会把
 * localStorage 配额写满，进而连配置存储一起写失败。取 50 是权衡：够装一次崩溃
 * 循环的现场，超出丢最旧（与日志环「丢最旧」同策略；最旧的元失败证据价值最低，
 * 因为「现在还在失败」这个事实本身比任何一条旧消息更有信息量）。
 */
const OUTBOX_MAX = 50;

const STATUSES = new Set(["failed", "warn"]);

function isEntry(v: unknown): v is DiaryEntry {
  if (typeof v !== "object" || v === null) return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e.title === "string" && typeof e.detail === "string" && STATUSES.has(String(e.status))
  );
}

/**
 * 读 outbox。**裸 localStorage + 静默**：见文件头铁律。
 * 逐条 isEntry 过滤：localStorage 同域可被同机其他脚本/用户手改，损坏数据
 * 若原样放行会在 drain 时把 `undefined` 传给 AddOpLog，产出比丢失更糟的脏日志。
 * 返回保持写入顺序（最旧在前，drain 顺序即时间序）。
 */
export function readDiaryOutbox(): DiaryEntry[] {
  let raw: string | null;
  try {
    raw = localStorage.getItem(OUTBOX_KEY);
  } catch {
    return [];
  }
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out = parsed.filter(isEntry).slice(-OUTBOX_MAX);
  return out;
}

/** 写 outbox（**裸 localStorage + 静默**，同上）。写失败时 outbox 保持原状。 */
function writeDiaryOutbox(list: readonly DiaryEntry[]): void {
  try {
    if (list.length === 0) localStorage.removeItem(OUTBOX_KEY);
    else localStorage.setItem(OUTBOX_KEY, JSON.stringify(list));
  } catch {
    // 元失败：连 localStorage 都不通（隐私模式/配额满）。无下游可报告，静默。
  }
}

/**
 * 追加一条日记到 outbox。主通道失败时由 diary-sink 调用。
 * 已由 core 层净化/截断（title 200 / detail 500 字符，见 error-diary.ts 的
 * DIARY_MODEL_MAX / DIARY_ERRMSG_MAX），本层不重复截断——重复实现会漂移。
 */
export function enqueueDiaryOutbox(entry: DiaryEntry): void {
  const list = readDiaryOutbox();
  list.push({ title: entry.title, detail: entry.detail, status: entry.status });
  writeDiaryOutbox(list.slice(-OUTBOX_MAX));
}

/**
 * 启动期 drain：把 outbox 里的条目重新经 emit 送进主通道。
 *
 * 失败语义：**顺序发送、遇败即停**，剩余条目（含失败那条）原样留在 outbox
 * ——不跳过、不重排。理由：日志有时间序，drain 时若跳过坏条继续发，诊断页读到的
 * 因果链会被打乱（后发的错误先出现），比丢失更难排查。
 *
 * 成功条目在**整批结束后**一次性抹掉（不逐条写）：写放大 O(n) 次 localStorage，
 * 而中途崩溃的代价只是下个会话重发一遍（幂等性由 core 层 5s 去重窗口部分覆盖，
 * 重复出现总比丢失好）。
 *
 * @param emit 单条投递函数，拒绝视为「主通道仍不可用」（由调用方提供 AddOpLog 封装）
 * @returns 成功投递条数（0 表示无待发条目或主通道仍不通）
 */
export async function drainDiaryOutbox(
  emit: (entry: DiaryEntry) => Promise<void>,
): Promise<number> {
  const list = readDiaryOutbox();
  if (list.length === 0) return 0;
  let sent = 0;
  for (const entry of list) {
    try {
      await emit(entry);
      sent++;
    } catch {
      break;
    }
  }
  writeDiaryOutbox(list.slice(sent));
  return sent;
}

/**
 * 测试钩子：抹掉 outbox（生产无此需求）。刻意做成显式钩子而非让 drain 顺带清，
 * 以免「测试清理」与「业务清理」共用一条路径——后者是 drain 的成功语义本身。
 */
export function __resetDiaryOutboxForTest(): void {
  writeDiaryOutbox([]);
}
