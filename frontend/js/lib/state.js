// ===== 存储工具 =====
const C = {
    _k: k => 'ysm.' + k,
    get(k) { try { return localStorage.getItem(this._k(k)) || '' } catch { return '' } },
    set(k, v) { try { localStorage.setItem(this._k(k), v || '') } catch { } }
};

// ===== DOM 快捷选择 =====
const $ = s => document.querySelector(s);

// ===== DOM 元素引用 =====
export const searchInput = $('#search-input');
export const st = $('#st');
export const tree = $('#tree');
export const vg = $('#vg
