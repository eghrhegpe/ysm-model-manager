# 安全策略

## 报告漏洞

**请勿在公开 Issue 中报告安全漏洞。**

通过 GitHub 私密漏洞报告渠道提交：

1. 前往仓库主页 → **Security** 标签页 → **Report a vulnerability**
2. 填写漏洞描述、复现步骤、影响范围
3. 维护者将在 72 小时内确认收到，并在 14 天内给出评估与修复计划

报告时请尽量包含：

- 受影响版本（Release tag 或 commit hash）
- 复现步骤（最小可复现示例最佳）
- 预期行为与实际行为
- 影响评估（数据泄露 / 任意代码执行 / 拒绝服务等）

## 支持的版本

本项目持续迭代，仅对**最新 Release**提供安全修复。旧版本用户请升级至最新版。

| 版本 | 支持状态 |
|------|----------|
| 最新 Release | ✅ 安全修复 |
| 历史版本 | ❌ 不维护 |

## 已知安全措施

### 文件导入校验

- **魔数验证**：ZIP（`PK`）/ 7z（`7z`）文件头校验，拒绝伪装文件
- **大小上限**：单文件 500 MB，防止内存耗尽
- **路径穿越防护**：统一 `paths.IsInside()` 用 `EvalSymlinks` 真实路径校验，拒绝 `..` 越权

### 路径安全

- 所有文件操作前进行 `EvalSymlinks` 真实路径解析
- 整合包目录、模型仓库路径、回收站路径均纳入 `IsInside()` 边界校验
- 硬链接 / 符号链接目标解析后二次校验

### 回收站安全

- 硬链接 / 符号链接识别后直接删除，不误移入 `.recycle` 目录
- 回收站恢复操作同样经过 `IsInside()` 校验
- 路径遍历攻击（`../` 越权）在入口层拦截

### 下载安全

- HTTP 客户端 `CheckRedirect` 限制最多 10 跳，防止重定向循环
- Scheme 白名单：仅允许 `http` / `https`，拒绝 `file` / `ftp` 等
- `Content-Range` 响应拒绝，防止分片下载篡改
- `Content-Type` 白名单校验
- 截断检测（`TruncationError`）：下载不完整时自动重试
- 原子写入：先写 `.part` 临时文件，校验通过后 `os.Rename` 原子替换
- 可选 SHA256 校验（`FileWithChecksum` / `FromGitHubAPIWithChecksum`）

### 关闭保护

- `shutdown` 阶段 `defer recover()` 兜底，防止窗口尺寸读取 panic 导致数据丢失
- 文件监听器优雅关闭，防止监听句柄泄漏

### YSMParser WASM 解码

- 解码**仅在本地进行**：WASM 在浏览器内运行，不联网、不存储、不导出模型文件
- 加密模型（YSGP + AES-256）解密密钥不落盘，解码后明文不持久化

## 安全开发生命周期

### 提交前门禁

- `pre-commit` 钩子：gofmt + 生成物同步 + 知识卡漂移检测
- `pre-push` 钩子：全量门禁（Go 测试 + 前端 vitest + 契约测试 + typecheck）
- `commit-with-check` 一体化：按 staged 文件裁剪门禁，验证 + 提交一步到位

### 审核流水线

- **ADR-109 Checklist**：代码审查 / 跨平台 / 前端 3D 三份 Checklist
- **防御范式**：输入校验 / 边界守护 / 错误传播 / 资源释放
- **致命陷阱手册**（`docs/pitfalls.md`）：11 条事故教训，新人必读
- **治理红线**（`docs/governance-rules.md`）：9 条规则 × 严重度 × 检测工具

### 依赖管理

- Go modules：`go.mod` 锁定版本，`go.sum` 校验完整性
- npm：`package-lock.json` 锁定版本
- 内嵌第三方代码（YSMParser / molangjs）版权声明见 `NOTICE`

## 联系方式

- 安全漏洞：GitHub Private Vulnerability Reporting（上文）
- 一般问题：[GitHub Issues](https://github.com/JiangKaslana/ysm-model-manager/issues)
- 紧急安全事项：在 Issue 标题前加 `[SECURITY]` 前缀（仅非漏洞紧急事项）

---

**本安全策略最后更新**：2026-08-30
