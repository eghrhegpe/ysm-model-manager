# ADR-316：WASI 解码器生产化：wazero 纯 Go 宿主退役 Node 子进程桥

- **状态**：✅ 已采纳（2026-09-27 拍板）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-27
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：知识卡 `docs/knowledge/ysm-wasi.md`（构建 recipe + 陷阱清单 + 实施进度）；`docs/knowledge/ysm-wasm.md`（被退役对象）；ADR-314 前后文（`docs/adr/` 索引）

---

## 1. 背景（Context）

<!-- ⚠️ 本节是「决策当时」的状态快照，ADR 落地后此处的病灶可能已治愈；评估「现在是否还这样」以当前源码树 + 知识卡实施进度为准，勿把本节当现状。 -->

Go 侧解 .ysm 现走 `internal/app/wasm_decoder.go` 的 `decodeYSMViaNodeJS`：起 Node 子进程跑 YSMParser 的 JS WASM 桥，经「临时目录 + MEMFS + stdout JSON」搬运产物。代价：分发拖着 Node 运行时；Android 分支 `findNodeJS` 恒空（加密模型解码能力缺失）；进程边界搬运是性能与复杂度双重负担。

2026-09-27 spike（`go/wasispike/`，知识卡 `ysm-wasi.md`）验证：YSMParser 以 emscripten standalone（非真 WASI 目标）+ `-fignore-exceptions` 编译成 905KB wasm，imports 闭集仅 10 个 wasi 标准函数 + 4 个 env 垫片，wazero 纯 Go 运行时内存直解 12 个真实 .ysm（11×V3 + 1×V2）全部成功，产物与 Node 桥同构。新增 vendored 改动 `collectToMemory()` 虚函数 + 桥接导出 `ysm_decode_to_memory`（产物从 wasm 堆序列化，零文件系统依赖）。

## 2. 决策（Decision）

1. **解码执行面统一**：Go 侧 .ysm 解码从 Node 子进程桥迁移到 wazero 内存直解（`wasm_decoder.go` 生产路径替换）；前端 Three.js 预览继续吃 JS 版 WASM——同一 Parser 源、两个构建目标，由统一构建脚本产出双目标 + parity 测试锁同构（先例：`container_parity_test.go`）。
2. **异常语义短期接受 noeh + abort**：wazero v1.12 的 native EH（exnref）验证器 panic，实测不成熟；`-fignore-exceptions` 下 happy path 零 throw，畸形文件从「返回失败」退化为「abort」。abort 必须接环形日志面板做诊断（wazero 可恢复），错误码体系等 wazero EH 成熟后再补。
3. **导入闭集契约化**：4 个 env 垫片是 happy-path 闭集而非永久契约，须以 imports 枚举写契约测试（tests/*.ts 体系 / Go 侧测试），上游 Parser 更新导致导入集变化时先红再修——与 binding-check 同构思路。
4. **vendored 重放策略**：`collectToMemory` 是 vendored 副本改动，上游 Parser 版本更新时重放（维护者评估过收敛条件后可尝试推上游）。
5. **Android 一并切换**：替换生产路径时退役 Android 分支的 Node 探测，安卓首次获得加密模型解码能力。

## 3. 后果（Consequences）

**正面**：单二进制、零子进程、跨平台一致；CLI 与批量扫描去进程边界；Android 补齐解码能力；解码收进 Go 进程与「类型判定归 Go、前端只读」红线同向收紧。

**负面 / 已知遗留**：① wazero 依赖入 go.mod（v1.12.0）；② 错误路径语义降级为 abort，依赖环形日志兜底；③ wazero 在部分平台退 interpreter（性能差一个量级），Android 上线前须 bench；④ 内存上限护栏（maxOutput → maxHeap/产物总量上限）需重设计；⑤ 双构建目标的漂移维护成本。

**替代方案（否决理由）**：rustbridge 全量 Rust 化——能力最强但重写面最大，与 vendored C++ Parser 双轨漂移；维持 Node 桥——现状痛点（分发/Android/进程搬运）一个都不解。

## 4. 数据溯源

- spike 源码：`go/wasispike/main.go`（Go 探针）、`go/wasispike/probe.mjs`（Node 交叉验证）
- 构建命令与陷阱清单：知识卡 `docs/knowledge/ysm-wasi.md`
- 验证数据：12 个真实 .ysm（11×V3 + 1×V2）内存直解成功，产物与 Node 桥同构

<!-- 文件名: wasi-wazero-go-node.md → 实际文件 ADR-316-wasi-wazero-go-node.md -->
