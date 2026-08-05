// ===== Playwright 全局 setup — 启动 vite dev 服务器 =====
// 在所有测试开始前启动 vite dev，等待就绪后返回服务器实例。
import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";

const FE_DIR = resolve(__dirname, "..");
const PORT = 5173;
const HOST = "127.0.0.1";

let server: ChildProcess | null = null;

export default async function globalSetup(): Promise<() => Promise<void>> {
  return new Promise((resolve, reject) => {
    server = spawn("npx", ["vite", "--port", String(PORT), "--host", HOST], {
      cwd: FE_DIR,
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
    });

    let output = "";
    let started = false;

    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      if (!started && output.includes("Local:")) {
        started = true;
        console.log(`[e2e] vite dev 已就绪 (http://${HOST}:${PORT})`);
        resolve(async () => {
          if (server) {
            server.kill("SIGTERM");
            server = null;
            console.log("[e2e] vite dev 已关闭");
          }
        });
      }
    };

    server.stdout?.on("data", onData);
    server.stderr?.on("data", onData);

    server.on("error", (err) => {
      if (!started) reject(err);
    });

    server.on("exit", (code) => {
      if (code !== 0 && code !== null && !started) {
        reject(new Error(`vite dev 异常退出，code=${code}，输出: ${output.slice(0, 500)}`));
      }
    });

    // 30s 超时保护
    setTimeout(() => {
      if (!started) {
        reject(new Error(`vite dev 启动超时，输出: ${output.slice(0, 500)}`));
      }
    }, 30000);
  });
}