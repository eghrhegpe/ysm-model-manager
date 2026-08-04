// ===== Playwright 全局 setup — 启动 vite dev 服务器 =====
// 在所有测试开始前启动 vite dev，等待就绪后返回服务器实例。
// 测试完成后由 global-teardown 关闭。
import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import http from "node:http";

const FE_DIR = resolve(__dirname, "..");
let server: ChildProcess | null = null;

/** 轮询等待 vite dev 就绪 */
function waitForVite(url: string, timeout = 30000): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeout;
    const poll = () => {
      if (Date.now() > deadline) {
        reject(new Error(`vite dev 启动超时 (${timeout}ms)`));
        return;
      }
      http
        .get(url, (res) => {
          if (res.statusCode === 200) resolve();
          else setTimeout(poll, 500);
        })
        .on("error", () => setTimeout(poll, 500));
    };
    poll();
  });
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  return new Promise((resolve, reject) => {
    server = spawn("npx", ["vite", "--port", "5173", "--host", "127.0.0.1"], {
      cwd: FE_DIR,
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
    });

    // 收集启动日志，超时用
    let output = "";
    server.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      // Vite 输出 "ready in" 表示就绪
      if (output.includes("Local:")) {
        waitForVite("http://127.0.0.1:5173")
          .then(() => {
            console.log("[e2e] vite dev 已就绪");
            // 返回 teardown 函数
            resolve(async () => {
              if (server) {
                server.kill("SIGTERM");
                server = null;
                console.log("[e2e] vite dev 已关闭");
              }
            });
          })
          .catch(reject);
      }
    });

    server.stderr?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });

    server.on("error", reject);
    server.on("exit", (code) => {
      if (code !== 0 && code !== null) {
        reject(new Error(`vite dev 异常退出，code=${code}，输出: ${output}`));
      }
    });

    // 30s 超时保护
    setTimeout(() => {
      if (!output.includes("Local:")) {
        reject(new Error(`vite dev 启动超时，输出: ${output.slice(0, 500)}`));
      }
    }, 30000);
  });
}