/**
 * 延迟注入占位。
 *
 * preview-3d 中部分字段在构造期无意义、需到后续阶段（runBuild / commitSession /
 * 能力 build / bones 初始化）才赋值。这些字段的「最终」类型是非空的，但字面量构造时
 * 无法给出初始值，于是散落着 `null as unknown as T` 三连断言。
 *
 * 用 `deferred<T>()` 取代它们：运行期行为完全一致（返回经双重断言的 null），但把
 * 「延迟注入」的意图集中到单一命名点，消除可读性整改 #5 点名的魔法断言。
 *
 * 更深一层的可选整改：把字段类型改为 `T | null` 并在读取点收窄 —— 属跨文件重构，
 * 不在本次 scope。
 */
export function deferred<T>(): T {
  return null as unknown as T;
}
