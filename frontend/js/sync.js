// 辅助：显示进度条 + 文字
function updateSyncProgress(current, total, statusText, ok, fail) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  // 查找或创建进度条
  let barWrap = document.querySelector(".progress-bar-wrap");
  if (!barWrap) {
    barWrap = document.createElement("div");
    barWrap.className = "progress-bar-wrap";
    barWrap.innerHTML = '<div class="progress-bar-fill"></div>';
    // 插入到状态栏旁边（#st 后面）
    const st = document.getElementById("st");
    if (st) {
      st.parentNode?.insertBefore(barWrap, st.nextSibling);
    }
  }
  const fill = barWrap.querySelector(".progress-bar-fill");
  if (fill) fill.style.width = pct + "%";
  const errorInfo = fail > 0 ? " ❌" + fail : "";
  const st = document.getElementById("st");
  if (st)
    st.textContent =
      statusText + " (" + current + "/" + total + " ✅" + ok + errorInfo + ")";
}

// 辅助：清除进度条
function clearSyncProgress() {
  const barWrap = document.querySelector(".progress-bar-wrap");
  if (barWrap) barWrap.remove();
}

// 全部同步
// entriesParam / instancesParam / statusesParam 可选，默认使用全局变量
async function doSyncAll(entriesParam, instancesParam, statusesParam) {
  if (syncing) return;
  syncing = true;
  const _entries = entriesParam || entries;
  const _instances = instancesParam || instances;
  const _statuses = statusesParam || statuses;
  if (!(await showConfirm("将仓库所有模型同步到所有整合包？"))) {
    syncing = false;
    return;
  }
  let ok = 0,
    fail = 0,
    skip = 0;
  const totalFiles = _entries.filter((e) => !isBannedEntry(e)).length;
  let done = 0;
  const detailList = [];
  let lastError = "";

  // 计算需要同步的整合包数量
  const validInstances = _instances.filter((_, vi) => {
    const sts = _statuses.find((s) => s.Name === _instances[vi].Name);
    return sts && sts.HasYSM;
  });
  const totalPacks = validInstances.length;

  for (let vi = 0; vi < _instances.length; vi++) {
    const ins = _instances[vi];
    const sts = _statuses.find((s) => s.Name === ins.Name);
    if (!sts || !sts.HasYSM) {
      skip++;
      continue;
    }
    for (const e of _entries) {
      if (isBannedEntry(e)) continue;
      try {
        await safeCall(() =>
          window.go.main.App.InstallModelTo(e.Path, ins.CustomDir),
        );
        ok++;
        detailList.push({ name: e.Name + " → " + ins.Name, type: "success" });
      } catch (err) {
        fail++;
        const errMsg = err.message || String(err);
        detailList.push({
          name:
            e.Name +
            " → " +
            ins.Name +
            (errMsg.includes("超时") ? " ⏱️ 超时" : ""),
          type: "fail",
        });
        lastError = errMsg;
        console.error("安装失败:", e.Name, "→", ins.Name, err);
      }
      done++;
      const packIdx = vi - skip + 1;
      updateSyncProgress(
        done,
        totalFiles * totalPacks,
        "📦[" + packIdx + "/" + totalPacks + "] " + ins.Name,
        ok,
        fail,
      );
    }
  }
  if (fail > 0)
    showToast("❌ " + fail + " 个安装失败\n" + lastError.substring(0, 80));
  showSummaryDialog("🔄 同步完成", ok, skip, fail, null, detailList);
  await refreshAll();
  clearSyncProgress();
  syncing = false;
}

// 安装缺失
// entriesParam / instancesParam / statusesParam 可选，默认使用全局变量
async function doSyncMissing(entriesParam, instancesParam, statusesParam) {
  if (syncing) return;
  syncing = true;
  const _entries = entriesParam || entries;
  const _instances = instancesParam || instances;
  const _statuses = statusesParam || statuses;
  let total = _statuses.reduce(
    (s, x) => s + (x.Missing ? x.Missing.length : 0),
    0,
  );
  if (!total) {
    showToast("所有整合包已完整");
    syncing = false;
    return;
  }
  if (!(await showConfirm("将 " + total + " 个缺失模型安装到对应整合包？"))) {
    syncing = false;
    return;
  }
  let ok = 0,
    fail = 0;
  let done = 0;
  const detailList = [];
  let lastError = "";

  for (let si = 0; si < _statuses.length; si++) {
    const s = _statuses[si];
    if (!s.HasYSM) continue;
    for (const n of s.Missing || []) {
      const e = _entries.find((x) => x.Name === n);
      if (!e) continue;
      try {
        await safeCall(() =>
          window.go.main.App.InstallModelTo(e.Path, s.CustomDir),
        );
        ok++;
        detailList.push({ name: e.Name + " → " + s.Name, type: "success" });
      } catch (err) {
        fail++;
        const errMsg = err.message || String(err);
        detailList.push({
          name:
            e.Name +
            " → " +
            s.Name +
            (errMsg.includes("超时") ? " ⏱️ 超时" : ""),
          type: "fail",
        });
        lastError = errMsg;
        console.error("补缺失败:", e.Name, "→", s.Name, err);
      }
      done++;
      updateSyncProgress(
        done,
        total,
        "📦[" + (si + 1) + "/" + _statuses.length + "] " + s.Name,
        ok,
        fail,
      );
    }
  }
  if (fail > 0)
    showToast("❌ " + fail + " 个安装失败\n" + lastError.substring(0, 80));
  showSummaryDialog("🔄 补缺安装完成", ok, 0, fail, null, detailList);
  await refreshAll();
  clearSyncProgress();
  syncing = false;
}

// 去重
// entriesParam 可选，默认使用全局 entries
async function doDeduplicate(entriesParam) {
  if (syncing) return;
  syncing = true;
  const _entries = entriesParam || entries;
  try {
    const hashFiles = {};
    for (const e of _entries) {
      if (!e.Hash) continue;
      hashFiles[e.Hash] = hashFiles[e.Hash] || [];
      hashFiles[e.Hash].push(e);
    }
    let dupCount = 0;
    for (const h in hashFiles) {
      if (hashFiles[h].length > 1) dupCount += hashFiles[h].length - 1;
    }
    if (dupCount === 0) {
      syncing = false;
      showToast("没有重复文件");
      return;
    }
    if (
      !(await showConfirm("移动 " + dupCount + " 个重复文件到 🗑️ 回收站？"))
    ) {
      syncing = false;
      return;
    }
    st.textContent = "⏳ 去重中...";
    let del = 0,
      fail = 0;
    const detailList = [];
    let lastError = "";
    for (const h in hashFiles) {
      const files = hashFiles[h];
      if (files.length <= 1) continue;
      for (let i = 1; i < files.length; i++) {
        try {
          await safeCall(() => window.go.main.App.MoveToRecycle(files[i].Path));
          del++;
          detailList.push({ name: files[i].Name, type: "success" });
        } catch (err) {
          fail++;
          const errMsg = err.message || String(err);
          detailList.push({
            name: files[i].Name + (errMsg.includes("超时") ? " ⏱️ 超时" : ""),
            type: "fail",
          });
          lastError = errMsg;
          console.error("去重移动失败:", files[i].Name, err);
        }
      }
    }
    if (fail > 0)
      showToast("❌ " + fail + " 个移动失败\n" + lastError.substring(0, 80));
    showSummaryDialog("🔄 去重完成", del, 0, fail, null, detailList);
    entries = await window.go.main.App.ScanModelEntries(repoRoot);
    buildTree();
    if (mcRoot) await refreshAll();
  } finally {
    syncing = false;
  }
}
