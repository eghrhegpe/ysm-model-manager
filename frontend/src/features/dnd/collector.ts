// ===== DnD 文件收集器（桌面 webkitGetAsEntry 路径）=====
// 被 import-dnd.ts（仓库页全局拖拽）与 import-queue-data.ts（导入页队列拖拽）共用，
// 消除 ADR-060 立项前的两套收集器漂移问题。

/** 收集结果条目（唯一事实源；shared.ts / import-executor.ts 经 re-export 消费 — ADR-187 D4） */
export interface CollectedEntry {
  file: File;
  relPath: string;
}

const FILE_ENTRY_TIMEOUT = 5000;
const READ_ENTRIES_TIMEOUT = 3000;
const MAX_DEPTH = 10;

/** 把 FileSystemFileEntry 转为 Promise<File>，带超时兜底 */
function getFileFromEntry(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("getFileFromEntry timeout"));
    }, FILE_ENTRY_TIMEOUT);
    entry.file(
      (f) => {
        clearTimeout(timer);
        resolve(f);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/**
 * 递归收集 DataTransferItem[] 或 FileSystemEntry[] 中的文件。
 * - isEntryArray=true 时 items 为 FileSystemEntry[]（递归子目录场景）
 * - isEntryArray=false 时 items 为 DataTransferItem[]（顶层 drop 场景）
 * - depth 为当前目录深度，depth >= MAX_DEPTH 时停止递归防卡顿
 * - readEntries 3s 超时防 WebView2 卡死（settle 后立即 clearTimeout，不滞留定时器）
 */
export async function collectFiles(
  items: DataTransferItem[] | FileSystemEntry[],
  isEntryArray: boolean,
  basePath = "",
  depth = 0,
): Promise<CollectedEntry[]> {
  const result: CollectedEntry[] = [];
  for (const item of items) {
    if (!item) continue;
    if (!isEntryArray && (item as DataTransferItem).kind !== "file") continue;
    const entry =
      (item as DataTransferItem).webkitGetAsEntry?.() ||
      (isEntryArray ? (item as FileSystemEntry) : null);
    if (entry?.isDirectory) {
      const subPath = basePath ? basePath + "/" + entry.name : entry.name;
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      const batch = await readAllDirEntries(reader, entry.name);
      if (batch.length && depth < MAX_DEPTH) {
        const deeper = await collectFiles(batch, true, subPath, depth + 1);
        result.push(...deeper);
      }
    } else if (entry?.isFile) {
      const relPath = basePath ? basePath + "/" + entry.name : entry.name;
      try {
        result.push({
          file: await getFileFromEntry(entry as FileSystemFileEntry),
          relPath,
        });
      } catch (e) {
        console.warn("[dnd-collector] 单文件读取失败，已跳过:", relPath, e);
      }
    } else if ((item as DataTransferItem).getAsFile) {
      // fallback: 浏览器不支持 webkitGetAsEntry 时用 getAsFile
      const f = (item as DataTransferItem).getAsFile();
      if (f) result.push({ file: f, relPath: f.name });
    }
  }
  return result;
}

/**
 * 分页读取目录全部条目。Web 标准 FileSystemDirectoryReader.readEntries 单次最多
 * 返回 100 条，必须循环调用直到返回空数组才读完目录——单次调用会静默漏掉
 * >100 条目目录的第 101+ 个文件/子目录（codereview P2）。
 * 带 READ_ENTRIES_TIMEOUT 超时兜底防 WebView2 卡死；settle 后立即 clearTimeout。
 * @param entryName 目录名（错误日志用）
 */
function readAllDirEntries(
  reader: FileSystemDirectoryReader,
  entryName: string,
): Promise<FileSystemEntry[]> {
  return new Promise((resolve) => {
    const all: FileSystemEntry[] = [];
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(all);
    };
    // 兜底定时器：先武装再调 readEntries，防 readEntries 同步回调 done 时 timer 仍为
    // undefined（clearTimeout 空操作）→ 3s 兜底定时器滞留为 no-op（codereview P3）
    timer = setTimeout(finish, READ_ENTRIES_TIMEOUT);
    const readBatch = (): void => {
      reader.readEntries(
        (entries) => {
          const batch = entries || [];
          if (!batch.length) {
            finish(); // 空批次 = 目录读完
            return;
          }
          all.push(...batch);
          readBatch(); // 继续读下一批（每批 ≤100 条）
        },
        () => {
          console.warn("[dnd-collector] 目录读取失败，跳过:", entryName);
          finish();
        },
      );
    };
    readBatch();
  });
}
