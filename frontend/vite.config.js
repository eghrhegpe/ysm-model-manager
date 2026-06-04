import { defineConfig } from "vite";

export default defineConfig({
  root: ".", // 正确：以frontend目录为根
  build: {
    outDir: "dist", // 输出到项目根目录下的html文件夹
  },
});
