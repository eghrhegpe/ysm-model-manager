// ===== preview 渲染层 =====

/** 更新所有统计 DOM */
export function updateDisplay(root, stats) {
  const $ = (id) => root.getElementById(id);
  if ($("s-repo")) $("s-repo").textContent = stats.repo;
  if ($("s-ver")) $("s-ver").textContent = stats.ver;
  if ($("s-ok")) $("s-ok").textContent = stats.ok;
  if ($("s-tot")) $("s-tot").textContent = stats.tot;
  if ($("s-pending")) $("s-pending").textContent = stats.pending;
}
