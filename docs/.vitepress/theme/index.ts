// 自定义主题入口：扩展 VitePress 默认主题，仅注入品牌样式。
// VitePress 自动发现 .vitepress/theme/index.ts，无需在 config 中显式 import。
import DefaultTheme from 'vitepress/theme'
import './style.css'

export default DefaultTheme
