// ===== DnD 锁 + 待导入队列（类型化版 — ADR-014 P3 组件层）=====
import { bus } from "../bus.ts";

let _locked = false;
let _queue: unknown[] = [];

export const DnDLock = {
  get locked(): boolean {
    return _locked;
  },

  acquire(): boolean {
    if (_locked) return false;
    _locked = true;
    bus.emit("dnd:lock-changed", { locked: true });
    return true;
  },

  release(): void {
    _locked = false;
    bus.emit("dnd:lock-changed", { locked: false });
  },
};

export const PendingImport = {
  get queue(): unknown[] {
    return _queue;
  },

  setQueue(files: unknown[]): void {
    _queue = files || [];
    bus.emit("import:pending-changed", { count: _queue.length });
  },

  clear(): void {
    _queue = [];
    bus.emit("import:pending-changed", { count: 0 });
  },
};
