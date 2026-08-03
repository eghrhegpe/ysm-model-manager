// ===== 服务注册表（类型化版 — ADR-014 P1 渐进迁移）=====
// 只注册"有替换价值"的依赖：数据加载、全局配置、bus
// 渲染/模板/纯函数直接 import，不走注册表
//
// 类型化策略（中庸方案）：
// - register/get 泛型化，.ts 调用方可声明/断言 impl 类型，同型返回
// - 不反向 import 组件类型（registry 是基础设施，避免耦合组件层）
// - 未来若需严格 schema：扩展 `RegistrySchema` 接口 + name 收窄为 keyof

export interface RegistrySchema {
  // 已知服务（运行时由 app-modules.js 注册）：
  //   loadInstances / loadEntries — 数据加载函数
  // 扩展方式：在此加 `服务名: 类型`，再把 register/get 的 name 参数收窄为 keyof RegistrySchema
}

type Service = unknown;

const services = new Map<string, Service>();

/** 注册一个服务（.ts 调用方：register("name", impl as X) 声明类型） */
export function register<T extends Service = Service>(name: string, impl: T): void {
  services.set(name, impl);
}

/** 获取一个服务（.ts 调用方：get<X>("name") 断言期望类型） */
export function get<T extends Service = Service>(name: string): T {
  const s = services.get(name);
  if (!s) throw new Error(`[registry] Service not found: ${name}`);
  return s as T;
}

/** 检查服务是否已注册 */
export function has(name: string): boolean {
  return services.has(name);
}

/** 注销（测试用） */
export function unregister(name: string): void {
  services.delete(name);
}

/** 清空所有（测试用） */
export function clear(): void {
  services.clear();
}
