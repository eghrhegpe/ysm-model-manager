// ===== 存储工具 =====
const C = {
  _k: (k) => "ysm." + k,
  get(k) {
    try {
      return localStorage.getItem(this._k(k)) || "";
    } catch {
      return "";
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(this._k(k), v || "");
    } catch {}
  },
};

// ===== DOM 快捷选择 =====
const $ = (s) => document.querySelector(s);

// ===== DOM 元素引用 =====
const searchInput = $("#search-input");
const st = $("#st");
const tree = $("#tree");
const vg = $("#vg");
const sRepo = $("#s-repo");
const sVer = $("#s-ver");
const sOk = $("#s-ok");
const sTot = $("#s-tot");
const verSearch = $("#ver-search");
const sortSelect = $("#sort-select");
const ysmOnly = $("#ysm-only");

// ===== 全局状态 =====
const expandedDirs = new Set(
  JSON.parse(localStorage.getItem("expandedFolders") || "[]"),
);
let repoRoot = "";
let mcRoot = "";
let entries = [];
let instances = [];
let statuses = [];
let syncing = false;
let openName = "";
