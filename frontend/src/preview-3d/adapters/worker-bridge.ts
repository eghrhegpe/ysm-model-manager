// ===== Worker 桥：通用 request/response 协议 =====
// 吞掉 nextId + pending Map + setTimeout + onmessage 分发 + onerror/超时结算。
// 支持两种语义与池：
//  - resolve-mode（pmx/fbx）：错误以 ok:false 响应回传，永远 resolve；单 worker。
//  - reject-mode（ktx2）：成功 resolve、失败 reject；worker 池 round-robin；
//    崩溃 → 终止整池 + reject 全部在途（对齐 web-stats 降级契约）。
//
// 基数约束：仅 1 请求 : 1 Promise。批量聚合（completed/total，如 texture-decoder）
// 不在此列——强行统一会污染 API（见 withEventTimeout 同一条裁决）。
//
// 历史：Step 1（pmx/fbx）抽 createResolveModeBridge；Step 2 抽通用 createWorkerBridge
// 统一两种模式，resolve-mode 降为薄封装，ktx2 委托 reject-mode 池。

/** 响应必须携带 id；resolve-mode 还需 ok 标志（错误以响应形式回传，不 reject） */
export interface ResolveModeResponse {
  id: number;
  ok: boolean;
  error?: string;
}

/** 崩溃/终止时的结算策略 */
export type WorkerErrorStrategy = "resolveAllError" | "terminatePool";

/** 编译期穷尽性检查：未来新增策略未覆盖时 TS 报错 */
function assertNever(x: never): never {
  throw new Error(`Unexpected value: ${String(x)}`);
}

export interface WorkerBridge<Req extends { id: number }, Resp, Ok> {
  /** 发请求（内部注入 id 并 round-robin 选 worker），返回结算 Promise */
  request: (reqWithoutId: Omit<Req, "id">, transfer?: Transferable[]) => Promise<Ok>;
  /** 供外部 worker.onmessage 委托 */
  handleMessage: (resp: Resp) => void;
  /** 供外部 worker.onerror 委托（按策略 resolveAllError / terminatePool） */
  handleWorkerError: () => void;
  /** 终止整池并结算在途（≈ handleWorkerError 的 terminatePool 分支） */
  dispose: () => void;
  /** 显式终止整池（ktx2 onerror 路径） */
  terminatePool: () => void;
  /** 清空在途请求（resetEncoderState 等测试钩子用） */
  clearPending: () => void;
}

export type CreateWorkerBridgeOpts<Req extends { id: number }, Resp, Ok> = {
  workers: Worker[];
  getId: (resp: Resp) => number;
  timeoutMs: number;
  timeoutMsg: string;
  pickWorker?: (id: number, workers: Worker[]) => Worker;
} & (
  | {
      // resolve-mode：settle 拿不到 reject，编译期杜绝误用；makeErrorResponse 必传
      onWorkerError: "resolveAllError";
      makeErrorResponse: (id: number, msg: string) => Resp;
      settle: (resp: Resp, api: { resolve: (v: Ok) => void }) => void;
    }
  | {
      // terminate-mode：settle 可 resolve/reject；makeErrorResponse 不允许（传了即编译错）
      onWorkerError?: "terminatePool";
      settle: (resp: Resp, api: { resolve: (v: Ok) => void; reject: (e: Error) => void }) => void;
      onPoolTerminated?: () => void;
    }
);

export function createWorkerBridge<Req extends { id: number }, Resp, Ok>(
  opts: CreateWorkerBridgeOpts<Req, Resp, Ok>,
): WorkerBridge<Req, Resp, Ok> {
  const { workers, getId, timeoutMs, timeoutMsg, settle } = opts;
  // union 分支专属字段经 in-narrowing 读取（解构会 TS2339——属性不在所有分支存在）
  const onWorkerError = opts.onWorkerError ?? "resolveAllError";
  const makeErrorResponse = "makeErrorResponse" in opts ? opts.makeErrorResponse : undefined;
  const onPoolTerminated = "onPoolTerminated" in opts ? opts.onPoolTerminated : undefined;

  // 入口契约：resolveAllError 模式必须传 makeErrorResponse，
  // 否则 settleError 兜底 reject → resolve-mode 静默变 reject-mode
  if (onWorkerError === "resolveAllError" && !makeErrorResponse) {
    throw new Error(
      "createWorkerBridge: resolveAllError 模式必须传 makeErrorResponse，" +
        "否则 worker 错误/超时静默走 reject（resolve-mode 语义反转）",
    );
  }

  let nextId = 0;
  let rr = 0;
  const pending = new Map<number, {
    resolve: (v: Ok) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  const pickWorker = opts.pickWorker ?? ((_id: number, ws: Worker[]) => ws[(rr++) % ws.length]);

  /** 单请求失败结算：超时 / dispose / onerror 复用 */
  function settleError(id: number, msg: string): void {
    const entry = pending.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(id);
    if (onWorkerError === "terminatePool") entry.reject(new Error(msg));
    else if (makeErrorResponse) entry.resolve(makeErrorResponse(id, msg) as unknown as Ok);
    else {
      // onWorkerError === "resolveAllError" 但 makeErrorResponse 缺失——
      // 入口契约（L71）已拦截，此处理论不可达；先 reject 兜底，再 assertNever 编译期穷尽
      entry.reject(new Error(msg));
      assertNever(onWorkerError as never);
    }
  }

  function handleMessage(resp: Resp): void {
    const id = getId(resp);
    const entry = pending.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(id);
    settle(resp, entry);
  }

  function clearPending(): void {
    for (const [id] of pending) settleError(id, "Worker 桥已重置");
  }

  function terminatePool(): void {
    for (const w of workers) {
      try { w.terminate(); } catch { /* 已终止 */ }
    }
    for (const [id] of pending) {
      settleError(id, onWorkerError === "terminatePool" ? "KTX2 worker 终止" : "Worker 已终止");
    }
    onPoolTerminated?.();
  }

  function handleWorkerError(): void {
    if (onWorkerError === "terminatePool") {
      terminatePool();
      return;
    }
    for (const [id] of pending) settleError(id, "Worker 错误");
  }

  function request(reqWithoutId: Omit<Req, "id">, transfer?: Transferable[]): Promise<Ok> {
    return new Promise<Ok>((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => settleError(id, timeoutMsg), timeoutMs);
      pending.set(id, { resolve, reject, timer });
      pickWorker(id, workers).postMessage({ ...reqWithoutId, id } as Req, transfer ?? []);
    });
  }

  function dispose(): void {
    terminatePool();
  }

  return { request, handleMessage, handleWorkerError, dispose, terminatePool, clearPending };
}

// ===== resolve-mode 便捷封装（pmx / fbx 同构，永远 resolve ok:false 响应）=====

export interface ResolveModeBridge<Resp extends ResolveModeResponse> {
  /** 发请求，返回该响应的 Promise（错误以 ok:false 响应形式 resolve，不 reject） */
  request: (bytes: ArrayBuffer) => Promise<Resp>;
  /** 终止 worker，在途请求以 ok:false（"Worker 已终止"）结算 */
  dispose: () => void;
}

export function createResolveModeBridge<Resp extends ResolveModeResponse>(
  workerUrl: string,
  timeoutMs: number,
  timeoutMsg: string,
): ResolveModeBridge<Resp> {
  const worker = new Worker(new URL(workerUrl, import.meta.url), { type: "module" });
  const bridge = createWorkerBridge<{ id: number; bytes: ArrayBuffer }, Resp, Resp>({
    workers: [worker],
    getId: (r) => r.id,
    timeoutMs,
    timeoutMsg,
    settle: (r, { resolve }) => resolve(r),
    onWorkerError: "resolveAllError",
    makeErrorResponse: (id, msg) => ({ id, ok: false, error: msg } as Resp),
  });
  // 消息接线必须由工厂完成：薄封装不暴露 handleMessage/handleWorkerError，
  // 若漏接，worker 响应永不结算、恒超时 ok:false 静默回退主线程
  // （回归锁：worker-bridge.test.ts「工厂内部接线」两例，409b060e 曾丢失）
  worker.onmessage = (e: MessageEvent<Resp>) => bridge.handleMessage(e.data);
  worker.onerror = () => bridge.handleWorkerError();
  return {
    request: (bytes) => bridge.request({ bytes }, [bytes]),
    dispose: () => bridge.dispose(),
  };
}
