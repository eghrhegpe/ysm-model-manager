// 生成版本状态统计 HTML（用于头部显示）
function renderVersionStats(status, counts) {
  let parts = [];
  if (counts.synced > 0) parts.push(`✅${counts.synced}`);
  if (counts.missing > 0) parts.push(`⬇️${counts.missing}`);
  if (counts.disabled > 0) parts.push(`⚠️${counts.disabled}`);
  if (counts.extra > 0) parts.push(`📤${counts.extra}`);
  return parts.join(" ") || "✅ 完整";
}

function updateVersionStats(instances, statuses, entries) {
  const insList = instances || [];
  const stsList = statuses || [];
  const entList = entries || [];

  const enabledModels = entList.filter((e) => !isBannedEntry(e)).length;
  const sRepo = document.getElementById("s-repo");
  if (sRepo) {
    sRepo.textContent = `${enabledModels}/${entList.length}`;
    sRepo.style.cursor = "pointer";
    sRepo.title = "点击聚焦仓库树";
    sRepo.onclick = () => {
      document.querySelector(".main-header-row .toggle-btn")?.click(); // 展开预览
      document.querySelector("#search-input")?.focus();
      // 如果左侧栏折叠则展开
      if (document.querySelector(".sidebar")?.style.overflow === "hidden") {
        document.querySelector("#btn-toggle-sidebar")?.click();
      }
    };
  }

  const ysmInstances = insList.filter((_, i) => stsList[i]?.HasYSM);
  const sVer = document.getElementById("s-ver");
  if (sVer) {
    sVer.textContent = `${ysmInstances.length}/${insList.length}`;
    sVer.style.cursor = "pointer";
    sVer.title = "点击聚焦版本列表";
    sVer.onclick = () => {
      document.querySelector("#ver-search")?.focus();
    };
  }

  const ok = stsList.filter(
    (s) =>
      s.HasYSM &&
      (!s.Missing || s.Missing.length === 0) &&
      (!s.Extra || s.Extra.length === 0),
  ).length;
  const sOk = document.getElementById("s-ok");
  const sTot = document.getElementById("s-tot");
  if (sOk) sOk.textContent = ok;
  if (sTot) sTot.textContent = stsList.filter((s) => s.HasYSM).length;

  // 待上传模型：整合包中有但仓库没有的模型
  let pendingCount = 0;
  const repoNames = new Set(entList.map((e) => e.Name));
  stsList.forEach((s) => {
    if (s.Extra) {
      s.Extra.forEach((name) => {
        if (!repoNames.has(name)) pendingCount++;
      });
    }
  });
  const sPending = document.getElementById("s-pending");
  if (sPending) {
    sPending.textContent = pendingCount;
    if (pendingCount > 0) {
      sPending.style.cursor = "pointer";
      sPending.title = "点击转到上传按钮";
      sPending.onclick = () => {
        document.querySelector("#btn-upload")?.click();
      };
    } else {
      sPending.style.cursor = "default";
      sPending.onclick = null;
    }
  }
}
