// ===== 全局事件总线 =====
// 组件之间不直接调用，全部通过 bus.on() / bus.emit() 通信

const bus = {
  _listeners: {},

  on(event, fn) {
    (this._listeners[event] = this._listeners[event] || []).push(fn);
    return () => this.off(event, fn);
  },

  off(event, fn) {
    const arr = this._listeners[event];
    if (arr) {
      const idx = arr.indexOf(fn);
      if (idx !== -1) arr.splice(idx, 1);
    }
  },

  emit(event, data) {
    (this._listeners[event] || []).forEach((fn) => {
      try {
        fn(data);
      } catch (e) {
        console.error(`[bus] 事件 "${event}" 处理出错:`, e);
      }
    });
  },

  once(event, fn) {
    const wrapper = (data) => {
      fn(data);
      this.off(event, wrapper);
    };
    this.on(event, wrapper);
  },
}; // ===== 全局事件总线 =====
// 组件之间不直接调用，全部通过 bus.on() / bus.emit() 通信

const bus = {
  _listeners: {},

  /** 监听事件，返回取消函数 */
  on(event, fn) {
    (this._listeners[event] = this._listeners[event] || []).push(fn);
    return () => this.off(event, fn);
  },

  /** 取消监听 */
  off(event, fn) {
    const arr = this._listeners[event];
    if (arr) {
      const idx = arr.indexOf(fn);
      if (idx !== -1) arr.splice(idx, 1);
    }
  },

  /** 派发事件 */
  emit(event, data) {
    (this._listeners[event] || []).forEach((fn) => {
      try {
        fn(data);
      } catch (e) {
        console.error(`[bus] 事件 "${event}" 处理出错:`, e);
      }
    });
  },

  /** 只监听一次 */
  once(event, fn) {
    const wrapper = (data) => {
      fn(data);
      this.off(event, wrapper);
    };
    this.on(event, wrapper);
  },
};
