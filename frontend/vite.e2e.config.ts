import { defineConfig, mergeConfig } from "vite";
import baseConfig from "./vite.config.js";
import { wasmDataStubs } from "./vite-wasm-data-stubs.ts";

export default mergeConfig(baseConfig, defineConfig({ plugins: [wasmDataStubs()] }));
