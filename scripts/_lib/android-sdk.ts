#!/usr/bin/env node
/**
 * Android SDK 定位共享模块（android-build.ts / android-install.ts 单一事实源）。
 * 立因（2026-10-10 锐评）：两脚本各有一份 SDK 探测逻辑且已分叉——build 走
 * 「进程级 env → User 级 registry → LOCALAPPDATA 兜底」三级链，install 的 findAdb
 * 只看进程级 env，新开 PowerShell（Android Studio 只写 User 级）即报"未检测到设备"
 * 且错误信息误导"请设置 ANDROID_HOME（未设置）"。归属统一归本模块。
 * 子进程走 proc.ts run()（数组参数，无 shell 拼接，ADR-043）。
 */
import fs from "node:fs";
import path from "node:path";
import { run } from "./proc.ts";

/** Windows 读 User 级环境变量（新开终端不继承，显式读 registry；非 Windows 直接返回空） */
export function readUserEnv(name: string) {
  if (process.platform !== "win32") return "";
  try {
    const r = run("reg", ["query", "HKCU\\Environment", "/v", name]);
    if (!r.ok) return "";
    // reg query 输出为 tab/多空格分隔的三列：值名 类型(REG_EXPAND_SZ) 值。
    // 末列即值（值内可含空格，逐列拆分后取末段最稳）。类型列是第二列，永不混入。
    for (const l of r.out.split(/\r?\n/)) {
      const cols = l.trim().split(/\s+/);
      if (cols.length >= 3) return cols.slice(2).join(" "); // 第 3 列起都是该 REG 值
    }
    return "";
  } catch {
    return "";
  }
}

/**
 * 定位 Android SDK 根：进程级 ANDROID_HOME/ANDROID_SDK_ROOT → User 级同名 →
 * %LOCALAPPDATA%\Android\Sdk（Android Studio 默认安装位）——空串 = 未找到。
 * 2026-10-06 技术债审计：禁止硬编码开发者本机路径（如 C:\Android\Sdk），
 * 真正单一事实源是 ANDROID_HOME 环境变量，LOCALAPPDATA 只是候选探测兜底。
 */
export function findSdkRoot(): string {
  const sdk =
    process.env.ANDROID_HOME ||
    process.env.ANDROID_SDK_ROOT ||
    readUserEnv("ANDROID_HOME") ||
    readUserEnv("ANDROID_SDK_ROOT") ||
    (process.env.LOCALAPPDATA &&
    fs.existsSync(path.join(process.env.LOCALAPPDATA, "Android", "Sdk"))
      ? path.join(process.env.LOCALAPPDATA, "Android", "Sdk")
      : "");
  // REG_EXPAND_SZ 从 registry 读回可能带残留引号
  return sdk.replace(/"/g, "");
}

/** NDK 目录名版本比较（语义序，非字符串序）："26.3.11579264" vs "26.10.x" 须 26.10 更晚。
 *  字符串序在 minor 达两位数（NDK r26.10+）时 `"26.3"` > `"26.10"` 判反，会选中旧 NDK。
 *  每段只取数字前缀（patch 段 `11579264` 是构建哈希，按数值参与兜底比较）。 */
export function compareNdkVersion(a: string, b: string): number {
  const key = (name: string) =>
    name.split(".").map((seg) => {
      const m = /^\d+/.exec(seg.trim());
      return m ? Number.parseInt(m[0], 10) : 0;
    });
  const ka = key(a);
  const kb = key(b);
  for (let i = 0; i < Math.max(ka.length, kb.length); i++) {
    const d = (ka[i] ?? 0) - (kb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** SDK 根下按语义序取最新 NDK 版本目录；未装返回 "" */
export function findNdkInSdk(sdkRoot: string): string {
  if (!sdkRoot) return "";
  const ndkDir = path.join(sdkRoot, "ndk");
  if (!fs.existsSync(ndkDir)) return "";
  const versions = fs
    .readdirSync(ndkDir)
    .filter((d) => fs.statSync(path.join(ndkDir, d)).isDirectory())
    .sort(compareNdkVersion);
  if (versions.length === 0) return "";
  return path.join(ndkDir, versions[versions.length - 1] ?? "");
}

/** 定位 adb 可执行：SDK/platform-tools/adb[.exe] → PATH 兜底（返回 "adb"） */
export function findAdb(): string {
  const sdk = findSdkRoot();
  if (sdk) {
    const exe = process.platform === "win32" ? "adb.exe" : "adb";
    const candidate = path.join(sdk, "platform-tools", exe);
    if (fs.existsSync(candidate)) return candidate;
  }
  return "adb"; // 交给 PATH
}
