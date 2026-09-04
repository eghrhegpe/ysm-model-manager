import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Plugin } from "vite";

const modules = new Map([
  ["ysm-wasm-data.js", "export function _getWasmBinary() { return new ArrayBuffer(0); }"],
  ["ysm-wasm-data-mt.js", "export function _getWasmBinaryMt() { return new ArrayBuffer(0); }"],
]);

export function wasmDataStubs(): Plugin {
  return {
    name: "wasm-data-stubs",
    enforce: "pre",
    resolveId(source, importer) {
      const name = source.split("/").at(-1);
      if (!name || !modules.has(name)) return null;
      if (importer && source.startsWith(".") && existsSync(resolve(dirname(importer), source))) {
        return null;
      }
      return `\0wasm-data-stub:${name}`;
    },
    load(id) {
      return id.startsWith("\0wasm-data-stub:")
        ? modules.get(id.slice("\0wasm-data-stub:".length))
        : null;
    },
  };
}
