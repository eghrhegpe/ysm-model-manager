// 解析模型文件名
function parseModelName(name) {
    const result = { author: '', work: '', chara: '', date: '' };
    // [作者]【作品】角色 (日期).ext
    let m = name.match(/^\[([^\]]+)\]\s*【([^】]+)】\s*([^(]+?)(?:\s*\((\d{4}(?:[\.\/-]\d{1,2})?)\))?\.[^.]+$/);
    if (m) { result.author = m[1]; result.work = m[2]; result.chara = m[3].trim(); result.date = m[4] || ''; return result; }
    // [作者]角色 (日期).ext
    m = name.match(/^\[([^\]]+)\]\s*([^(]+?)(?:\s*\((\d{4}(?:[\.\/-]\d{1,2})?)\))?\.[^.]+$/);
    if (m) { result.author = m[1]; result.chara = m[2].trim(); result.date = m[3] || ''; return result; }
    // 角色 (日期).ext
    m = name.match(/^([^(]+?)(?:\s*\((\d{4}(?:[\.\/-]\d{1,2})?)\))?\.[^.]+$/);
    if (m) { result.chara = m[1].trim(); result.date = m[2] || ''; return result; }
    return result;
}

// HTML 转义
function esc(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// 文件大小格式化
function fmt(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    let size = bytes;
    while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
    return size.toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
}

// 判断文件是否被禁用（.ban 后缀）
function isBannedEntry(entry) {
    return entry && (entry.Name.endsWith('.ban') || entry.Path.endsWith('.ban'));
}

// 去掉 .ban 后缀
function stripBan(name) {
    return name.endsWith('.ban') ? name.slice(0, -4) : name;
}

// 统一异步调用包装（超时 + 错误处理）
const CALL_TIMEOUT = 15000; // 15 秒超时

async function safeCall(fn, ...args) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT);
    try {
        const result = await Promise.race([
            fn(...args),
            new Promise((_, reject) => {
                controller.signal.addEventListener('abort', () => {
                    reject(new Error(`操作超时（${CALL_TIMEOUT / 1000}秒）`));
                });
            })
        ]);
        clearTimeout(timer);
        return result;
    } catch (e) {
        clearTimeout(timer);
        throw e;
    }
}
