# YSM 模型管理器 — UI 翻译计划

## 概述

本计划概述了 YSM 模型管理器前端界面的翻译/I18n 实施方案，包括翻译工作范围、实施方案、文件结构和集成步骤。

## 背景

当前 YSM 模型管理器前端界面包含大量英文文本，包括按钮标签、状态信息、工具提示和错误消息。这些文本需要支持多种语言以满足全球用户的需求。

## 翻译工作范围

### 需要翻译的文本类型

1. **组件文本** - 所有 UI 标签、按钮、提示信息
2. **状态文本** - 空状态、加载状态、错误消息
3. **工具提示** - 悬停提示、工具提示
4. **图标标签** - 图标的文本标签（如 "📦 推送"）
5. **右键菜单文本** - 上下文菜单项
6. **错误消息** - 用户可见的错误信息
7. **成功消息** - 操作成功提示
8. **表单标签** - 输入字段标签
9. **导航文本** - 导航菜单项

### 需要翻译的组件

1. **app-sync-manager** - 所有 UI 文本
2. **app-content** - 创作者频道 UI 文本
3. **app-sidebar** - 导航和侧栏文本
4. **app-preview** - 预览 UI 文本
5. **app-toast** - 通知文本
6. **context-menu** - 右键菜单文本
7. **app-tree** - 树状UI 文本
8. **app-nav** - 导航栏文本

## 翻译实施方案

### 方案 A：嵌入式翻译
- 在每个组件中添加翻译字典
- 运行时根据语言选择文本
- 优点：简单，控制精准
- 缺点：重复代码，维护困难

### 方案 B：集中式翻译
- 创建全局翻译字典
- 所有组件导入并使用
- 优点：DRY，一致性好
- 缺点：需要协调所有组件

### 方案 C：动态加载翻译
- 根据语言加载不同的翻译文件
- 按需加载，减少初始负担
- 优点：性能好，模块化
- 缺点：实现复杂，需要处理语言切换

**推荐方案：集中式翻译 + 动态加载**

## 翻译文件结构

```
frontend/
├── js/
│   ├── i18n.js          # 翻译初始化和工具
│   └── locales/          # 翻译文件
│       ├── en.json      # 英语（默认）
│       ├── zh-CN.json   # 简体中文
│       ├── zh-TW.json   # 繁体中文
│       ├── ja.json      # 日语
│       └── es.json      # 西班牙语
```

### 翻译文件示例

#### frontend/js/locales/zh-CN.json
```json
{
  "sync-manager": {
    "push": "推送",
    "pull": "拉取",
    "all": "全部",
    "synced": "已同步",
    "missing": "待推送",
    "disabled": "已禁用",
    "optional": "可拉取",
    "legacy": "旧仓库遗留",
    "empty": "该整合包暂无资源文件",
    "loading": "加载中..."
  },
  "buttons": {
    "push": "推送",
    "pull": "拉取",
    "selectAll": "全选",
    "pushSelected": "推送所选",
    "pullSelected": "拉取所选"
  }
}
```

## 翻译工具函数

### i18n.js
```javascript
// i18n.js
export const i18n = {
  currentLang: 'zh-CN',
  translations: {},
  
  init(lang) {
    this.currentLang = lang;
    this.loadTranslations(lang);
  },
  
  t(key, params = {}) {
    let text = this.getTranslation(key) || key;
    // 替换参数
    Object.keys(params).forEach(k => {
      text = text.replace(`{${k}}`, params[k]);
    });
    return text;
  },
  
  getTranslation(key) {
    return this.translations[key]?.[this.currentLang] || 
           this.translations[key]?.['en'] || '';
  },
  
  loadTranslations(lang) {
    // 动态加载翻译文件
    fetch(`/locales/${lang}.json`)
      .then(response => response.json())
      .then(data => {
        this.translations = { ...this.translations, ...data };
      })
      .catch(error => {
        console.error('Failed to load translations:', error);
      });
  }
};
```

## 翻译集成

### 1. 修改 app-sync-manager

**tpl.js** - 将硬编码文本替换为翻译键：
```javascript
// 旧版本
'<button class="sm-item-btn" data-action="push">推送</button>'

// 新版本
'<button class="sm-item-btn" data-action="push">' + i18n.t('sync-manager.push') + '</button>'
```

**index.js** - 导入 i18n 并初始化：
```javascript
import { i18n } from "../../i18n.js";

// 在组件初始化时
i18n.init('zh-CN'); // 根据用户偏好设置语言
```

### 2. 修改 app-content

**content-css.js** - 将 CSS 中的文本内容替换为翻译键
**tpl.js** - 更新所有 UI 文本

### 3. 修改其他组件

所有需要翻译的组件都遵循相同的模式：
1. 导入 i18n
2. 初始化翻译
3. 用翻译键替换硬编码文本

## 翻译支持功能

### 1. 语言切换
- 用户可以从设置页面切换语言
- 语言偏好保存到本地存储
- 页面即时更新

### 2. 默认语言
- 根据浏览器语言设置自动检测
- 用户可以覆盖默认语言设置
- 提供语言选择器

### 3. 翻译持久化
- 将用户语言偏好保存到 localStorage
- 应用重启时恢复语言设置
- 支持多设备同步

### 4. 翻译热更新
- 支持不重载更新翻译文件
- 缓存翻译数据以提高性能
- 提供翻译更新通知

### 5. 翻译降级
- 如果翻译文件加载失败，回退到英语
- 提供离线翻译支持
- 确保基本功能可用

## 翻译文件管理

### 翻译文件版本控制
- 每种语言都有独立的翻译文件版本
- 跟踪翻译文件的更改历史
- 提供翻译文件恢复功能

### 翻译质量控制
- 建立翻译审核流程
- 提供翻译质量检查工具
- 建立翻译反馈机制

### 翻译更新流程
1. 翻译文件更新
2. 翻译质量检查
3. 翻译文件合并
4. 翻译文件部署
5. 翻译文件测试

## 翻译测试

### 需要测试的内容

1. 所有翻译键都已定义
2. 所有组件都能正确显示翻译文本
3. 语言切换功能正常工作
4. 翻译参数替换正确
5. 翻译文件格式正确
6. 翻译热更新功能
7. 翻译降级功能

### 测试工具

**翻译测试脚本：**
```javascript
// test-i18n.js
import { i18n } from './i18n.js';

function testTranslations() {
  // 测试所有翻译键
  const allKeys = getAllTranslationKeys();
  
  allKeys.forEach(key => {
    const translation = i18n.getTranslation(key);
    if (!translation) {
      console.error(`Missing translation for key: ${key}`);
    }
  });
  
  // 测试语言切换
  i18n.init('en');
  console.log('Current language:', i18n.currentLang);
  
  // 测试参数替换
  const text = i18n.t('sync-manager.push', { count: 5 });
  console.log('Translated text:', text);
}
```

## 实施步骤

### 阶段 1：基础设施建设
1. 创建 i18n 系统
2. 创建基础翻译文件
3. 修改 app-sync-manager
4. 测试翻译功能

### 阶段 2：组件翻译
1. 翻译 app-content
2. 翻译 app-sidebar
3. 翻译 app-preview
4. 翻译其他组件

### 阶段 3：功能完善
1. 实现语言切换
2. 实现翻译持久化
3. 实现翻译热更新
4. 实现翻译降级

### 阶段 4：质量保证
1. 翻译质量检查
2. 翻译文件测试
3. 翻译文件版本控制
4. 翻译文件更新流程

## 资源

### 翻译资源
- 专业翻译服务
- 翻译记忆库
- 术语表
- 翻译工具

### 技术资源
- 翻译管理平台
- 翻译文件版本控制系统
- 翻译测试工具
- 翻译更新流程

## 附录

### 翻译键命名规范
- 使用 kebab-case 命名法
- 避免使用特殊字符
- 保持键的唯一性
- 提供清晰的键描述

### 翻译文件格式
- 使用 JSON 格式
- 支持嵌套结构
- 支持参数替换
- 支持默认语言

### 翻译更新流程
1. 翻译文件更新
2. 翻译质量检查
3. 翻译文件合并
4. 翻译文件部署
5. 翻译文件测试

## 总结

UI 翻译是 YSM 模型管理器国际化进程的重要组成部分。通过建立集中式的翻译系统和动态加载机制，可以高效地支持多种语言，为全球用户提供更好的体验。