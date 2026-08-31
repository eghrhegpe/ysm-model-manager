# babylon-mmd Parser（vendor）

**来源**：babylon-mmd@1.3.0（npm 包，@moeru/three-mmd 的解析内核），MIT License（见本目录 LICENSE）。

**抽取范围**：仅 PMX 解析最小依赖闭包（约 1249 行，无 three/DOM 依赖，可在 Web Worker 运行）：

| 文件 | 说明 |
|------|------|
| `endianness.js` | 大小端工具 |
| `mmdDataDeserializer.js` | DataView 包装（MMD 数据读取） |
| `ILogger.js` | 日志接口（ConsoleLogger） |
| `mmdTypes.js` | 类型聚合占位 |
| `pmxObject.js` | PMX 数据结构定义（PmxObject） |
| `pmxReader.js` | **PMX 解析器（PmxReader，权威口径）** |

**用途**：Web Worker 内权威 PMX 解析，替代自研 PmxReader——消除「自研解析器 vs 主线程 MMDLoader」双轨口径漂移（历史 4 个真实模型 bug 的根源）。主线程构建仍走 @moeru/three-mmd（MMDLoader 完整路径）。

**同步上游**：`npm pack babylon-mmd@1.3.0` → 解压 `package/esm/Loader/Parser/` 对应文件覆盖本目录。
