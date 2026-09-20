// ===== three 内部 GLSL chunk 的裸字符串导入声明（类型层补全）=====
// three 随包发布 `src/**/*.glsl.js` 原文（package.json exports 的 `"./src/*"` 允许导入，运行时 Vite 可解析），
// 但官方 @types/three 只声明 build 入口，未覆盖 src 子路径 → 裸导入报 TS7016（隐式 any）。
// 用途：light-attenuation-mirror.test.ts 需**直接读上游 GLSL 原文**（不能走被 mock 的 "three" 主入口）
// 做公式镜像守卫——three 升级若改动该 chunk，该测试转红以强制人工重审 spotDistanceAttenuation。
// 故在此补类型层声明，不触碰 three 本体。
declare module "three/src/renderers/shaders/ShaderChunk/*.glsl.js" {
  /** GLSL chunk 源码原文（随包发布的字符串） */
  const source: string;
  export default source;
}
