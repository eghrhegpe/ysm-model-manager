// 右键菜单 - 整合包版本卡片
function showVersionContextMenu(e, vh) {
  e.preventDefault();
  closeContextMenu();
  const insName = vh.dataset.insName;
  contextMenu = createMenu(e.clientX, e.clientY);
  const items = [
    { label: "📋 复制整合包名称", action: () => copyToClipboard(insName) },
    {
      label: "📂 打开 custom 目录",
      action: () => {
        const ins = instances.find((x) => x.Name === insName);
        if (ins) window.go.main.App.OpenFolder(ins.CustomDir);
      },
    },
    {
      label: "🗑️ 卸载所有模型",
      action: async () => {
        const ins = instances.find((x) => x.Name === insName);
        if (!ins) return;
        if (
          !(await showConfirm(
            `确定要删除 ${insName} 中的模型？\n已在仓库的模型将直接删除（本体还在仓库），不在仓库的模型会被保留。`,
          ))
        )
          return;
        st.textContent = "⏳ 卸载中...";
        try {
          const n = await window.go.main.App.ClearCustomDir(ins.CustomDir);
          if (n > 0) {
            st.textContent = `✅ 已卸载 ${n} 个模型`;
            showSummaryDialog(
              "🗑️ 卸载完成",
              0,
              0,
              0,
              `已从整合包删除 ${n} 个模型（放心，本体还在仓库）`,
            );
          } else {
            st.textContent = "ℹ️ 没有模型需要卸载";
          }
          await refreshAll();
        } catch (e) {
          showToast("❌ 卸载失败: " + (e.message || e));
          st.textContent = "❌ 卸载失败";
        }
      },
    },
    {
      label: "🔁 去重此整合包模型",
      action: async () => {
        const ins = instances.find((x) => x.Name === insName);
        if (!ins) return;
        st.textContent = "⏳ 扫描中...";
        try {
          const result = await window.go.main.App.DeduplicateCustomDir(ins.CustomDir);
          const totalDups = result[0];
          const moved = result[1];
          if (totalDups === 0) {
            showToast("✅ 无重复文件");
            st.textContent = "就绪";
          } else {
            showToast(`✅ 去重完成：${moved} 个重复文件已移入回收站`);
            st.textContent = `✅ 去重 ${moved}/${totalDups}`;
            showSummaryDialog("🔁 整合包去重完成", moved, totalDups - moved, 0, `共发现 ${totalDups} 个重复，${moved} 个已移入回收站`);
            entries = await window.go.main.App.ScanModelEntries(repoRoot);
            buildTree();
            await refreshAll();
          }
        } catch (e) {
          showToast("❌ 去重失败: " + (e.message || e));
          st.textContent = "❌ 失败";
        }
      },
    },
    {
      label: "📤 上传新模型到仓库",
      action: async () => {
        const ins = instances.find((x) => x.Name === insName);
        if (!ins || !repoRoot) {
          showToast("❌ 请先选择仓库目录");
          return;
        }
        if (!(await showConfirm(`确定将 ${insName} 中的新模型上传到仓库吗？`)))
          return;
        st.textContent = "⏳ 上传中...";
        try {
          const n = await window.go.main.App.SyncCustomToRepo(
            ins.CustomDir,
            repoRoot,
          );
          showSummaryDialog("✅ 上传完成", n, 0, 0);
          entries = await window.go.main.App.ScanModelEntries(repoRoot);
          buildTree();
          await refreshAll();
        } catch (e) {
          showToast("❌ 上传失败: " + (e.message || e));
        }
      },
    },
  ];
  renderMenuItems(items);
  document.body.appendChild(contextMenu);
}
