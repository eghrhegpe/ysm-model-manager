# 📦 v1.6.0 发布指南

## ✅ 已完成的工作

- [x] 代码优化（8 次提交）
- [x] 构建验证（Wails build -clean）
- [x] 文档完善（v1.6.0.md）
- [x] Git Tag 创建并推送（v1.6.0）

---

## 🚀 GitHub Release 发布步骤

### 方法一：使用 GitHub Web 界面（推荐）

1. **访问 Releases 页面**
   ```
   https://github.com/eghrhegpe/ysm-model-manager/releases
   ```

2. **点击 "Draft a new release"**

3. **填写发布信息**
   - **Tag version:** `v1.6.0`（从下拉列表选择）
   - **Release title:** `v1.6.0 - UI 系统全面优化`
   - **Description:** 复制 `RELEASE_NOTES_GITHUB.md` 的内容

4. **上传二进制文件**
   - 点击 "Attach binaries by dropping them here or selecting them"
   - 上传：`build/bin/YSM-Model-Manager.exe` (18.1 MB)

5. **发布**
   - 勾选 "Set as the latest release"
   - 点击 "Publish release"

---

### 方法二：使用 GitHub CLI（如果已安装）

```bash
# 安装 gh CLI（如果还没有）
# winget install GitHub.cli

# 创建 Release
gh release create v1.6.0 \
  --title "v1.6.0 - UI 系统全面优化" \
  --notes-file RELEASE_NOTES_GITHUB.md \
  --latest \
  build/bin/YSM-Model-Manager.exe

# 验证发布
gh release view v1.6.0
```

---

## 📋 发布后检查清单

- [ ] Release 页面显示正常
- [ ] 二进制文件可以下载
- [ ] Release 描述格式正确
- [ ] Tag 关联正确
- [ ] 标记为 "Latest release"

---

## 🔗 相关链接

- **Releases 页面:** https://github.com/eghrhegpe/ysm-model-manager/releases
- **Tag 页面:** https://github.com/eghrhegpe/ysm-model-manager/tree/v1.6.0
- **完整文档:** docs/release-notes/v1.6.0.md

---

## 💡 提示

1. **Release 描述支持 Markdown**
   - 可以使用标题、列表、代码块等
   - 图片会被自动渲染

2. **预发布版本**
   - 如果需要测试，可以勾选 "Set as a pre-release"
   - 正式稳定后再取消勾选

3. **自动生成更新日志**
   - GitHub 可以基于 commits 自动生成
   - 但手动编写更清晰

4. **附件大小限制**
   - GitHub Releases 单个文件最大 2GB
   - 当前 exe 文件 18.1 MB，完全没问题

---

## 🎯 下一步

发布完成后，你可以：

1. **分享 Release 链接**
   - 在社区、论坛分享
   - 通知用户更新

2. **收集反馈**
   - 关注 Issues 和 Discussions
   - 记录用户反馈的问题

3. **规划下一个版本**
   - 根据反馈确定优先级
   - 开始 v1.6.1 或 v1.7.0 的开发

---

**祝发布顺利！🎉**
