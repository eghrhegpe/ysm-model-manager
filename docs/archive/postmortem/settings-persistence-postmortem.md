# 设置页路径持久化 Debug 记录（2026-06-12）

## 症状

设置页 MMD/VRChat 等派生路径：

1. 点击选择目录后 toast 提示"✅ 路径已设置"
2. 但页面显示的是 mcRoot 派生路径，不是自定义路径
3. 切换页面后自定义路径丢失

## 排查链路

### 第一轮：路径保存链路

1. 前端 `bindDerived` → `SetResourceRoot(rtype, dir)` → Go 端
2. 检查 `SetResourceRoot` ✅ —— 正确设置 `cfg.MmdRoot = path`
3. 检查 `saveConfig` ✅ —— JSON 写入 `ysm_config.json`
4. 用户确认 `ysm_config.json` 有 `"mmdRoot": "C:\\a建模2"` ✅
5. 检查 `LoadAppConfig` ✅ —— 每次都读文件，返回全量配置

**结论：保存端没问题。**

### 第二轮：路径读取链路

1. 设置页 `initSettings` → `LoadAppConfig()` → `cfg` 对象
2. `bindDerived` 的 `refresh()` 读 `cfg[key]`
3. `key = rtypeKeyMap["mmd-skin"]` = `"MmdRoot"` ❌ **首字母大写**
4. 但 `LoadAppConfig` 返回的 JSON 键是小写 `"mmdRoot"`
5. `cfg["MmdRoot"]` → `undefined` → 走 fallback 显示派生路径

**修复：`rtypeKeyMap` 改成小写 key `"mmdRoot"`。**

### 第三轮：`GetRepoRoot` 不读自定义路径

1. 资源库页 `<app-tree root="mmd-skin">` → `GetRepoRoot("mmd-skin")`
2. 检查 Go 代码：`mmd-skin` case 直接 `cfg.McRoot + "/3d-skin/EntityPlayer"`
3. **跳过了 `cfg.MmdRoot` 检查**

**修复：加上 `if cfg.MmdRoot != "" { return cfg.MmdRoot }`。**

### 第四轮：Tab 切换不重载

1. 资源库 tab 点击事件有 `if (rtype === cur) return;`
2. 从设置页回来点同一个 tab 不触发重新加载

**修复：去掉跳过逻辑，每次点击都重建组件。**

## 根因总结

| 问题                   | 层级 | 原因                                                   |
| ---------------------- | ---- | ------------------------------------------------------ |
| 设置页不显示自定义路径 | 前端 | `rtypeKeyMap` 键名大写 vs JSON 小写                    |
| 资源库页不读自定义路径 | Go   | `GetRepoRoot` 的 case 漏了 `cfg.MmdRoot`/`cfg.VrcRoot` |
| 切 tab 看不到变化      | 前端 | `rtype === cur` 跳过了重复点击                         |

## 设置流程优化分析

### 当前流程

```
用户点击路径 → SelectDirectory → SetResourceRoot(rtype, dir) → saveConfig → refresh()
                                                                    ↓
                                                              cfg[key] = dir
```

### 痛点

1. **路径保存后无视觉确认** — toast 一闪而过，用户不确定是否生效
2. **派生路径和自定义路径视觉无区分** — 长得一样，看不出当前是自定义还是派生
3. **资源库 tab 不会自动刷新** — 用户必须手动切 tab 才能看到变化
4. **多次重复设置路径产生噪音**

### 优化建议

**短期（当天可做）：**

- 设置页保存后 emit `config:updated`，资源库页监听此事件并重载当前 tab
- 自定义路径的卡片加个标记（如小绿点）表示"已自定义"

**中期：**

- 路径卡片显示"当前值"和"默认值"两行，清楚展示自定义 vs 派生
- 加一个"恢复默认"按钮，清空自定义路径

**长期：**

- 统一配置面板不按资源类型平铺，改为按"根路径"分组（所有派生路径在 MC 根目录卡片内展示为子项）
