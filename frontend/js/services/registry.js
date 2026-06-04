// ===== 服务注册表 =====
// 只注册"有替换价值"的依赖：数据加载、全局配置、bus
// 渲染/模板/纯函数直接 import，不走注册表

const services = new Map();

/** 注册一个服务 */
export function register(name, impl) {
  services.set(name, impl);
}

/** 获取一个服务 */
export function get(name) {
  const s = services.get(name);
  if (!s) throw new Error(`[registry] Service not found: ${name}`);
  return s;
}

/** 检查服务是否已注册 */
export function has(name) {
  return services.has(name);
}

/** 注销（测试用） */
export function unregister(name) {
  services.delete(name);
}

/** 清空所有（测试用） */
export function clear() {
  services.clear();
}
