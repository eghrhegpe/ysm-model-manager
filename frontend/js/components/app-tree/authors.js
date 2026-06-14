// ===== 作者标签模块 =====

/**
 * 从 Go 端加载作者列表
 * @returns {Promise<Array<{Name:string, Count:number}>>}
 */
export async function loadAuthors() {
  try {
    const { ListModelAuthors } =
      await import("../../../wailsjs/go/main/App.js");
    return (await ListModelAuthors()) || [];
  } catch {
    return [];
  }
}
