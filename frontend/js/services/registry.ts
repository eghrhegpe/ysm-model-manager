// ===== 服务注册表（类型化版 — ADR-014 P1 渐进迁移）=====
// 只注册"有替换价值"的依赖：数据加载、全局配置、bus
// 渲染/模板/纯函数直接 import，不走注册表
//
// 类型化策略（中庸方案）：
// - register/get 泛型化，.ts 调用方可声明/断言 impl 类型，同型返回
// - 服务名收窄为 ServiceName 联合，拼错编译期拦截
// - 不反向 import 组件类型（registry 是基础设施，避免耦合组件层）

/** 已知服务名（新服务先在 app-modules.ts 注册，再在此登记） */
export type ServiceName = "loadInstances" | "loadEntries";

type Service = unknown;

const services = new Map<ServiceName, Service>();

/** 注册一个服务（.ts 调用方：register("name", impl as X) 声明类型；重复注册覆盖旧实例并告警） */
export function register<T extends Service = Service>(name: ServiceName, impl: T): void {
  if (services.has(name)) console.warn(`[registry] 覆盖已注册服务: ${name}`);
  services.set(name, impl);
}

/** 获取一个服务（.ts 调用方：get<X>("name") 断言期望类型；未注册抛错，错误含服务名） */
export function get<T extends Service = Service>(name: ServiceName): T {
  const s = services.get(name);
  if (!s) throw new Error(`[registry] Service not found: ${name}`);
  return s as T;
}

/** 检查服务是否已注册 */
export function has(name: ServiceName): boolean {
  return services.has(name);
}

/** 注销（测试用） */
export function unregister(name: ServiceName): void {
  services.delete(name);
}

/** 清空所有（测试用） */
export function clear(): void {
  services.clear();
}
