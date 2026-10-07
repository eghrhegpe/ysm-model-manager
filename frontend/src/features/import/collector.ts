// ===== DnD 文件收集器（桌面 webkitGetAsEntry 路径）=====
// 被 import-dnd.ts（仓库页全局拖拽）与 import-queue-data.ts（导入页队列拖拽）共用，
// 消除 ADR-060 立项前的两套收集器漂移问题。

/** 收集结果条目（唯一事实源；shared.ts / import-executor.ts 直引消费 — ADR-187 D4） */
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
    await collectOneItemInto(result, entry, item as DataTransferItem, basePath, depth);
  }
  return result;
}

/** 单条目三分支派发：目录递归 / 文件读取 / getAsFile 兜底 */
async function collectOneItemInto(
  result: CollectedEntry[],
  entry: FileSystemEntry | null | undefined,
  item: DataTransferItem,
  basePath: string,
  depth: number,
): Promise<void> {
  if (entry?.isDirectory) {
    result.push(...(await collectDirectory(entry as FileSystemDirectoryEntry, basePath, depth)));
  } else if (entry?.isFile) {
    const collected = await collectFileItem(entry as FileSystemFileEntry, basePath);
    if (collected) result.push(collected);
  } else if (typeof (item as DataTransferItem).getAsFile === "function") {
    // fallback: 浏览器不支持 webkitGetAsEntry 时用 getAsFile（isEntryArray 路径的
    // FileSystemEntry 无此方法 → 守卫跳过，防对未知条目调 getAsFile 抛错）
    const collected = collectFallbackItem(item);
    if (collected) result.push(collected);
  }
}

/** 目录分支：读出全部条目后递归收集子文件（depth 上限防卡顿） */
async function collectDirectory(
  entry: FileSystemDirectoryEntry,
  basePath: string,
  depth: number,
): Promise<CollectedEntry[]> {
  const subPath = basePath ? `${basePath}/${entry.name}` : entry.name;
  const batch = await readAllDirEntries(entry.createReader(), entry.name);
  if (batch.length && depth < MAX_DEPTH) {
    return collectFiles(batch, true, subPath, depth + 1);
  }
  return [];
}

/** 文件分支：读单个文件，失败跳过（console.warn 留痕，不阻断整批） */
async function collectFileItem(
  entry: FileSystemFileEntry,
  basePath: string,
): Promise<CollectedEntry | null> {
  const relPath = basePath ? `${basePath}/${entry.name}` : entry.name;
  try {
    return { file: await getFileFromEntry(entry), relPath };
  } catch (e) {
    console.warn("[dnd-collector] 单文件读取失败，已跳过:", relPath, e);
    return null;
  }
}

/** getAsFile 兜底分支：无 webkitGetAsEntry 的浏览器路径 */
function collectFallbackItem(item: DataTransferItem): CollectedEntry | null {
  const f = item.getAsFile();
  return f ? { file: f, relPath: f.name } : null;
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
