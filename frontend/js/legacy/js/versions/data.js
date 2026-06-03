// 过滤实例（搜索 + YSM 筛选）
function filterInstances(instances, verKeyword, ysmOnlyChecked) {
  let result = instances;
  if (verKeyword) {
    const kw = verKeyword.toLowerCase();
    result = result.filter((ins) => ins.Name.toLowerCase().includes(kw));
  }
  if (ysmOnlyChecked) {
    result = result.filter((_, idx) => {
      // 注意：这里用 result[idx] 而不是 instances[idx]，因为 result 可能已被搜索过滤
      const sts = statuses.find((s) => s.Name === result[idx].Name);
      return sts && sts.HasYSM;
    });
  }
  return result;
}

// 排序实例（YSM 优先 → 缺失数升序）
function sortInstances(instances, statuses) {
  return [...instances].sort((a, b) => {
    const stsA = statuses.find((s) => s.Name === a.Name) || { Missing: [] };
    const stsB = statuses.find((s) => s.Name === b.Name) || { Missing: [] };
    if (stsA.HasYSM && !stsB.HasYSM) return -1;
    if (!stsA.HasYSM && stsB.HasYSM) return 1;
    return (stsA.Missing?.length || 0) - (stsB.Missing?.length || 0);
  });
}

// 计算版本状态计数（同步/禁用/缺失/额外）
function calcVersionCounts(entries, status, repoRoot) {
  let synced = 0,
    disabled = 0,
    missing = 0,
    extra = 0;
  const syncedRows = [],
    disabledRows = [],
    missingRows = [],
    extraRows = [];

  entries.forEach((e) => {
    const rel = repoRoot
      ? e.Path.substring(repoRoot.length).replace(/^[\\\/]/, "")
      : e.Name;
    const baseName = stripBan(e.Name);
    const isBanned = isBannedEntry(e);

    if (isBanned) {
      if (status.Disabled.includes(baseName)) {
        disabled++;
        disabledRows.push({ rel, entry: e, name: baseName });
      }
      return;
    }

    const isInstalled = status.Missing.indexOf(e.Name) === -1;
    if (isInstalled) {
      synced++;
      syncedRows.push({ rel, entry: e, name: baseName });
    } else {
      missing++;
      missingRows.push({ rel, entry: e, name: baseName });
    }
  });

  status.Extra.forEach((name) => {
    extra++;
    extraRows.push({ name });
  });

  return {
    synced,
    disabled,
    missing,
    extra,
    syncedRows,
    disabledRows,
    missingRows,
    extraRows,
  };
}
