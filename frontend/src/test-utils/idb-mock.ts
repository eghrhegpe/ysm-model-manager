// ===== 共享 IDB mock 类型化访问（test-setup.ts 注入的 __YSM_TEST_IDB__）=====
// 背景（2026-08-17）：isolate:false 共享模块图下，web-fs.ts 首次求值会捕获先运行文件的
// per-file vi.mock 绑定 → 写入/读取错位。解法是把唯一 store 放 setup 层挂 globalThis，
// 所有测试文件共用（见 test-setup.ts §0）。
//
// 本模块收敛此前散落在 10 个测试文件的重复类型声明。那些声明字段清单已漂移
// （backend 契约族只列 6 字段，漏 idbTx / idbGetAllMetadata），与 setup 实际注入的
// 8 字段形态存在「声明子集 ≠ 实际形态」的隐性裂缝——将来若新增 idb 原语，
// 声明不全的文件拿不到类型提示，只能靠 as 断言或运行时才炸。统一到此单一事实源。
//
// 用法（测试文件顶部，setupFiles 已保证 __YSM_TEST_IDB__ 就绪）：
//   import { getIdbMock } from "@/test-utils/idb-mock.ts";
//   const idbMock = getIdbMock();
//   beforeEach(() => { idbMock._store.clear(); });
import type { Mock } from "vitest";

/**
 * test-setup.ts §0 注入的 IDB 共享 mock 形态（单一事实源）。
 * 字段与 test-setup.ts 的 `g.__YSM_TEST_IDB__ = {...}` 一一对应，改一处须同步此处。
 */
export interface IdbMock {
  idbGet: Mock;
  idbSet: Mock;
  idbKeys: Mock;
  idbGetAll: Mock;
  idbGetAllMetadata: Mock;
  idbDel: Mock;
  idbTx: Mock;
  /** 内存后端（Map 语义）；测试可直灌数据 / clear() 清空。 */
  _store: Map<string, unknown>;
}

/**
 * 取 setup 层注入的 IDB 共享 mock（类型化）。
 * 在模块顶层调用即可——setupFiles 先于测试文件执行，全局已就绪。
 */
export function getIdbMock(): IdbMock {
  return (globalThis as unknown as { __YSM_TEST_IDB__: IdbMock }).__YSM_TEST_IDB__;
}
