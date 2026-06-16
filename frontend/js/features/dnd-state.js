import { bus } from "../bus.js";

let _locked = false;
let _queue = [];

export const DnDLock = {
  get locked() {
    return _locked;
  },

  acquire() {
    if (_locked) return false;
    _locked = true;
    bus.emit("dnd:lock-changed", { locked: true });
    return true;
  },

  release() {
    _locked = false;
    bus.emit("dnd:lock-changed", { locked: false });
  },
};

export const PendingImport = {
  get queue() {
    return _queue;
  },

  setQueue(files) {
    _queue = files || [];
    bus.emit("import:pending-changed", { count: _queue.length });
  },

  clear() {
    _queue = [];
    bus.emit("import:pending-changed", { count: 0 });
  },
};
