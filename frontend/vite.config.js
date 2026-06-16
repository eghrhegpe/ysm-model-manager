import { defineConfig } from "vite";

export default defineConfig({
  root: ".",
  build: {
    outDir: "dist",
  },
  test: {
    include: ["js/**/*.test.js"],
    environment: "jsdom",
  },
});
