---
kind: workspace-exe-write-denied
name: 仓内二进制写用户目录被静默拒绝（代理沙箱按镜像位置拦截）
tier: leaf
category: go
status: active
source_files:
  - go/fsutil/write.go
auto_fields:
  symbols_with_lines:
    - ErrChmodFailed
    - ErrCloseFailed
    - ErrRenameFailed
    - ErrSyncFailed
    - ErrTempCreateFailed
    - ErrWriteFailed
    - ReadLimitedEntry
    - SHA256File
    - WriteFileAtomic
use_when:
  - 应用日志/配置出现「创建临时文件失败 ... Access is denied」，但浏览、读取全部正常
  - wails3 dev / 仓内 bin 下 exe 写失败；同一 exe 复制到仓外跑恢复正常
pitfalls:
  - "**拦截键是 exe 镜像路径在 AI 代理工作区内，与文件名/哈希无关**（2026-09-27 四组对照实验实锤）：仓内 bin 的 exe 必失败，复制到 %TEMP% 原名跑零失败；从未被标记的探针复制进 bin 立即失败"
  - 症状极具迷惑性：读全正常 + 目录 ACL/属主全正常 + 代码就是裸 os.CreateTemp（`go/fsutil/write.go|createTempFile` = os.CreateTemp 无花样），会把排查引向「代码 bug / ACL / 目录锁 / 沙箱令牌」死胡同
  - "**火绒（HipsDaemon 在跑）是被冤枉的红鲱鱼**：其防护记录无任何 YSM 条目（仅无关 ssh.exe）；「有安全软件在跑」不等于「是它干的」，先看它的防护记录有无条目再定罪"
  - ACL 里的 CodexSandboxUsers:(RX) 继承项（Codex CLI 沙箱产物）同样是无害红鲱鱼；AI 代理 shell 令牌经 whoami /groups 核实无沙箱组，前后台任务写探测均成功
  - 变量剥离要彻底：第一次换名实验同时改变了「名字+位置」两个变量，差点把「按名字拦截」的错误结论写进卡里——**一次只动一个变量**
quick_groups:
  - 文件操作与标签
quick_intents:
  - 应用临时文件创建全部失败但功能正常
  - 同一 exe 换个位置跑行为不同
quick_risk_lines:
  - go/fsutil/write.go|createTempFile = os.CreateTemp（:44，无花样，排除代码嫌疑的锚点）
invariant_anchors:
  - go/fsutil/write.go|各阶段失败必须经 sentinel + errors.Is 判定
---

# 仓内二进制写用户目录被静默拒绝（代理沙箱按镜像位置拦截）

## 概览

2026-09-27 排查「wails3 dev 下所有临时文件创建失败（Access is denied），但浏览功能全部正常」：实锤为 **AI 代理沙箱按 exe 镜像位置拦截**——可执行文件位于代理工作区（C:\Users\...\ysm-model-manager）内的进程，写用户目录（AppData\Roaming）被静默拒绝；复制到仓外立即恢复。非代码 bug、非 ACL、非火绒。

## 实证链（对照实验 + 逐个排除）

1. 目录 ACL/属主正常（user 完全控制；CodexSandboxUsers:(RX) 为 Codex CLI 沙箱的无害继承项）；Go 语义复刻探针（os.CreateTemp 同目录）自 /tmp 运行**成功**。
2. 同一 exe 的 CLI 模式 cache-clear 删除 64 文件成功——排除二进制被整体封杀（但注意：删除与创建是不同行为类别，勿过度推论）。
3. **名字 vs 位置剥离**：原名 exe 放 %TEMP% 跑 → 零失败；改名 exe 放仓内 bin → 失败。**拦截键 = 位置，不是名字**。
4. **封口**：从未被标记的探针 exe 复制进 bin 运行 → 立即失败。纯位置因素，与二进制身份无关。
5. **规则画像**（仓内镜像探针）：Roaming/Temp/D:\ 全拒，**工作区自身 + LOCALAPPDATA 放行**——白名单形策略；非工作区用户目录（如 `~\ysm-nonworkspace-test`）镜像全放行 → 拦截器精确认得本仓目录（代理注册的工作区）。
6. **逐个排除安全软件**：卸载微软电脑管家（ahflt.sys 消失）仍失败 → 排除；退出火绒（sysdiag 仍在但防护已停）仍失败 → 排除；Sandboxie（SbieSvc 在但 SbieDrv STOPPED）排除；Defender CFA 事件日志无记录。**拦截器不在常规安全软件里，指向代理工具自身的沙箱基础设施**（机器存在 CodexSandboxUsers 受管组；本仓为 ZCode/Codex 注册的工作区）。
7. **应用侧自诊断工具（2026-09-27 曾写入、验证完成后 2026-10-04 摘除）**：`internal/app/write_diag.go`（`YSM_WRITE_DIAG=1` 启用）——失败进程自己交代多路径探测/令牌/错误码，证实令牌干净、winerr=5、新增目录（LocalAppData 探测点）可写而既有受保护目录（含系统 Temp）拒绝。摘除时平台桩 `write_diag_other.go` 一并清除；本条仅存证据链，工具本体不复存在。

## 与其他子系统关系

- go/fsutil.WriteFileAtomic（ADR-044）是全仓统一落盘口，tags/logs/配置全走它——拦截即表现为「所有临时文件创建失败」。
- 日志：「[logs] 写入日志文件失败」与绑定调用错误是唯一可见症状（拦截静默，无弹窗）。
- wails3 dev 必现的原因：构建产物 bin\ 在仓内。

## 相关

- [ysm-wasi](./ysm-wasi.md) — 同日 ADR-317 桥解码联调中首次暴露此症状，一度干扰排障方向

## 处置

- 立即恢复：把构建产物复制到仓外再跑（cp bin/xxx.exe %TEMP%/ 后运行即可全功能）
- 正式发布/安装的 exe 在仓外，终端用户不受影响；仅影响「从仓内直接运行构建产物」的开发/调试场景
- 长治：在 ZCode/Codex 应用设置中查找「工作区保护/沙箱」开关放行；或固化「仓外跑 dev 产物」工作流
- 代码侧无需也不应改动：WriteFileAtomic/CreateTemp 无问题，失败已按 ADR-044 sentinel 留痕
- ⚠️ 勿把配置目录迁去 LocalAppData 来"绕开"：Temp 被拦才是硬伤（os.CreateTemp/wails/更新器都依赖系统 Temp，绕不开），且白名单随策略版本可能变化——治本在沙箱设置不在应用代码
- 区分两类现象：仓内 exe 写被拒（本卡）≠ 未签名 exe 复制后运行弹 SmartScreen「无法验证发布者」（Mark of the Web 常规警告，见签名话题）
