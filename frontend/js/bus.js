// ===== 全局事件总线 =====
const bus = {
  _listeners: {},
  on(event, fn) {
    (this._listeners[event] = this._listeners[event] || []).push(fn);
    return () => this.off(event, fn);
  },
  off(event, fn) {
    const arr = this._listeners[event];
    if (arr) { const idx = arr.indexOf(fn); if (idx !== -1) arr.splice(idx, 1); }
  },
  emit(event, data) {
    (this._listeners[event] || []).forEach(fn => {
      try { fn(data); } catch (e) { console.error(`[bus] 事件 "${event}" 处理出错:`, e); }
    });
  },
  once(event, fn) {
    const wrapper = (data) => { fn(data); this.off(event, wrapper); };
    this.on(event, wrapper);
  }
};
