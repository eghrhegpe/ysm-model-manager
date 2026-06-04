// ===== 全局事件总线 =====
// 组件 import { bus } 使用，入口层可用 setBus(mockBus) 替换

let _busInstance = null;

/** 创建一个新 bus 实例 */
function createBus() {
  const listeners = {};
  return {
    on(event, fn) {
      (listeners[event] ||= []).push(fn);
      return () => this.off(event, fn);
    },
    off(event, fn) {
      const arr = listeners[event];
      if (arr) {
        const idx = arr.indexOf(fn);
        if (idx !== -1) arr.splice(idx, 1);
      }
    },
    emit(event, data) {
      (listeners[event] || []).forEach((fn) => {
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
  };
}

/** 默认实例（组件直接使用） */
const bus = _busInstance || (_busInstance = createBus());

/** 替换 bus 实例（入口层 / 测试用） */
export function setBus(newBus) {
  _busInstance = newBus;
}

export { bus };
export default bus;

// 兼容：非 module 脚本也可通过 window.bus 访问
window.bus = bus;
