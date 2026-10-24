// mock 桥安装器:在任何 src/ 模块 import 之前把 window.go.main.App / window.runtime 装好。
// 语义与 e2e/mock-data.ts|generateMockBridgeScript 完全同源(那边生成字符串走
// page.addInitScript,harness 在页面内直接构造对象,行为等价、免 eval);
// mock 数据单一来源仍是 e2e/mock-data.ts 的 MOCK_DATA,勿在此另造数据。
import { MOCK_DATA } from "../e2e/mock-data.ts";

function installMockBridge(): void {
  const api: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
  for (const [key, value] of Object.entries(MOCK_DATA)) {
    // 与 generateMockBridgeScript 同语义:对象/数组经 JSON 往返防引用共享,
    // 字符串/undefined 直接返回原值。
    api[key] =
      typeof value === "string" || value === undefined
        ? async () => value
        : async () => JSON.parse(JSON.stringify(value));
  }
  (window as unknown as Record<string, unknown>).go = { main: { App: api } };
  (window as unknown as Record<string, unknown>).runtime = {
    Events: { On: () => () => {}, Off: () => {}, Emit: () => {} },
  };
}

installMockBridge();
