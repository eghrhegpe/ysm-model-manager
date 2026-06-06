// @deprecated 已无人 import，功能不可达。如要启用需在 app-modules.js 添加入口
// ===== 创作者管理对话框 =====
// 标签系统 + 快速新增 + 🔍查看模型
import { bus } from "../bus.js";

export async function showCreatorManager(sites) {
  return new Promise((resolve) => {
    let data = [];
    let tagFilter = "";

    const overlay = document.createElement("div");
    overlay.tabIndex = 0;
    overlay.style.cssText =
      "position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center";
    overlay.onclick = (e) => {
      if (e.target === overlay) {
        overlay.remove();
        resolve(null);
      }
    };
    overlay.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        overlay.remove();
        resolve(null);
      }
    });

    const box = document.createElement("div");
    box.style.cssText =
      "background:var(--surf);border:1px solid var(--bd);border-radius:10px;padding:16px;width:580px;max-height:80vh;box-shadow:0 8px 24px rgba(0,0,0,.5);display:flex;flex-direction:column;gap:6px;overflow:hidden";

    box.innerHTML = [
      '<div style="font-size:14px;font-weight:600">✏️ 创作者管理</div>',
      '<div style="font-size:9px;color:var(--muted)">共 <span id="cm-count">0</span> 位 · workshop_creators.json</div>',
      '<div style="display:flex;gap:4px"><input id="cm-filter" placeholder="搜索作者..." style="flex:1;padding:4px 6px;border-radius:4px;border:1px solid var(--bd);background:var(--bg);color:var(--txt);font-size:11px"><button class="cm-quick-add" style="padding:3px 10px;border-radius:4px;border:1px solid var(--bd);background:transparent;color:var(--accent);cursor:pointer;font-size:10px">➕ 快速新增</button></div>',
      '<div id="cm-tags" style="display:flex;gap:4px;flex-wrap:wrap;min-height:0"></div>',
      '<div id="cm-list" style="flex:1 1 0;height:0;overflow-y:auto;display:flex;flex-direction:column;gap:2px;border:1px solid var(--bd);border-radius:6px;padding:6px;background:var(--bg)"></div>',
      '<div style="display:flex;gap:4px;border-top:1px solid var(--bd);padding-top:6px">',
      '<button class="cm-export" style="padding:3px 8px;border-radius:4px;border:1px solid var(--bd);background:transparent;color:var(--txt);cursor:pointer;font-size:10px">📤 导出</button>',
      '<button class="cm-merge" style="padding:3px 8px;border-radius:4px;border:1px solid var(--bd);background:transparent;color:var(--txt);cursor:pointer;font-size:10px">📥 合并导入</button>',
      '<button class="cm-replace" style="padding:3px 8px;border-radius:4px;border:1px solid var(--bd);background:transparent;color:#e5534b;cursor:pointer;font-size:10px">⚠️ 覆盖导入(备份)</button>',
      '<span style="flex:1"></span>',
      '<button class="cm-save" style="padding:3px 12px;border-radius:4px;border:none;background:var(--accent);color:#fff;cursor:pointer;font-size:11px">💾 保存</button>',
      '<button class="cm-cancel" style="padding:3px 12px;border-radius:4px;border:1px solid var(--bd);background:transparent;color:var(--txt);cursor:pointer;font-size:11px">取消</button>',
      "</div>",
    ].join("");

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const listEl = box.querySelector("#cm-list");
    const countEl = box.querySelector("#cm-count");
    const filterInput = box.querySelector("#cm-filter");
    const tagsEl = box.querySelector("#cm-tags");

    // 平台标签颜色
    const TAG_COLORS = {
      bilibili: "#fb7299",
      afdian: "#ff6600",
      github: "#6cc644",
      mcmod: "#7c83ff",
      curseforge: "#f16436",
      modrinth: "#1bd96a",
    };
    const tagColor = (t) => TAG_COLORS[t] || "var(--accent)";

    const loadData = async () => {
      try {
        const { LoadWorkshopCreators } =
          await import("../../wailsjs/go/main/App.js");
        data = (await LoadWorkshopCreators()) || [];
      } catch {
        data = [];
      }
      renderTags();
      renderList();
    };

    // 渲染智能标签
    const renderTags = () => {
      const allTypes = [
        ...new Set(
          data.flatMap((cr) => (cr.type || "").split(";").filter(Boolean)),
        ),
      ];
      if (!allTypes.length) {
        tagsEl.innerHTML = "";
        return;
      }
      tagsEl.innerHTML =
        '<span style="font-size:9px;color:var(--muted);align-self:center">🏷️ </span>' +
        allTypes
          .map(
            (t) =>
              '<span class="cm-tag" data-tag="' +
              esc(t) +
              '" style="display:inline-block;padding:1px 8px;border-radius:10px;font-size:10px;cursor:pointer;background:' +
              tagColor(t) +
              "22;color:" +
              tagColor(t) +
              ";border:1px solid " +
              tagColor(t) +
              "44" +
              (tagFilter === t
                ? ";box-shadow:0 0 0 2px " + tagColor(t) + "66"
                : "") +
              '">' +
              esc(t) +
              "</span>",
          )
          .join("");
      tagsEl.querySelectorAll(".cm-tag").forEach((el) => {
        el.addEventListener("click", () => {
          tagFilter = tagFilter === el.dataset.tag ? "" : el.dataset.tag;
          renderTags();
          renderList();
        });
      });
    };

    // 渲染列表（带可视化标签 + 🔍按钮）
    const renderList = () => {
      const kw = filterInput.value.trim().toLowerCase();
      let filtered = data;
      if (tagFilter)
        filtered = filtered.filter((cr) =>
          (cr.type || "").split(";").includes(tagFilter),
        );
      if (kw)
        filtered = filtered.filter(
          (cr) =>
            cr.name.toLowerCase().includes(kw) || (cr.type || "").includes(kw),
        );
      countEl.textContent = data.length;
      if (!filtered.length) {
        listEl.innerHTML =
          '<div style="color:var(--muted);font-size:10px;padding:12px;text-align:center">' +
          (kw || tagFilter ? "无匹配" : "暂无创作者") +
          "</div>";
        return;
      }
      listEl.innerHTML = filtered
        .map((cr) => {
          const i = data.indexOf(cr);
          const types = (cr.type || "").split(";").filter(Boolean);
          const tags = types
            .map(
              (t) =>
                '<span style="display:inline-block;padding:0 5px;border-radius:8px;font-size:9px;background:' +
                tagColor(t) +
                "22;color:" +
                tagColor(t) +
                ';margin-right:2px">' +
                esc(t) +
                "</span>",
            )
            .join("");
          const hasSearch =
            sites && sites.some((s) => types.includes(s.id) && s.searchUrl);
          return (
            '<div style="display:flex;align-items:center;gap:4px;padding:4px 6px;border-radius:4px;border:1px solid var(--bd);font-size:11px">' +
            "<span>🎨</span>" +
            '<input class="cm-fld" data-idx="' +
            i +
            '" data-fld="name" value="' +
            esc(cr.name) +
            '" style="flex:1;min-width:40px;padding:2px 4px;border-radius:3px;border:1px solid transparent;background:transparent;color:var(--txt);font-size:11px">' +
            '<input class="cm-fld" data-idx="' +
            i +
            '" data-fld="desc" value="' +
            esc(cr.desc || "") +
            '" style="flex:1;min-width:40px;padding:2px 4px;border-radius:3px;border:1px solid transparent;background:transparent;color:var(--muted);font-size:10px">' +
            '<span style="flex-shrink:0">' +
            tags +
            "</span>" +
            (hasSearch
              ? '<button class="cm-search" data-idx="' +
                i +
                '" style="padding:1px 5px;border-radius:3px;border:1px solid transparent;background:transparent;color:var(--accent);cursor:pointer;font-size:11px" title="查看模型">🔍</button>'
              : "") +
            '<button class="cm-del" data-idx="' +
            i +
            '" style="padding:1px 5px;border-radius:3px;border:1px solid transparent;background:transparent;color:#e5534b;cursor:pointer;font-size:10px">🗑️</button></div>'
          );
        })
        .join("");

      listEl.querySelectorAll(".cm-fld").forEach((inp) => {
        inp.addEventListener("focus", () => {
          inp.style.borderColor = "var(--bd)";
          inp.style.background = "var(--surf)";
        });
        inp.addEventListener("blur", () => {
          inp.style.borderColor = "transparent";
          inp.style.background = "transparent";
        });
        inp.addEventListener("input", () => {
          const idx = parseInt(inp.dataset.idx, 10);
          if (data[idx]) data[idx][inp.dataset.fld] = inp.value.trim();
        });
      });
      listEl.querySelectorAll(".cm-search").forEach((btn) => {
        btn.addEventListener("click", () => {
          const idx = parseInt(btn.dataset.idx, 10);
          const cr = data[idx];
          if (!cr || !sites) return;
          const types = (cr.type || "").split(";").filter(Boolean);
          // 找第一个匹配且有 searchUrl 的站点
          for (const s of sites) {
            if (types.includes(s.id) && s.searchUrl) {
              window.open(
                s.searchUrl.replace(/\{\{q\}\}/g, encodeURIComponent(cr.name)),
                "_blank",
              );
              return;
            }
          }
        });
      });
      listEl.querySelectorAll(".cm-del").forEach((btn) => {
        btn.addEventListener("click", () => {
          const idx = parseInt(btn.dataset.idx, 10);
          if (data[idx]) {
            data.splice(idx, 1);
            renderList();
            renderTags();
          }
        });
      });
    };

    filterInput.addEventListener("input", renderList);

    // 快速新增模态框
    const showQuickAdd = () => {
      const modal = document.createElement("div");
      modal.style.cssText =
        "position:fixed;inset:0;z-index:999999;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center";
      modal.innerHTML =
        '<div style="background:var(--surf);border:1px solid var(--bd);border-radius:8px;padding:14px;width:320px;display:flex;flex-direction:column;gap:6px">' +
        '<div style="font-size:13px;font-weight:600">➕ 新增创作者</div>' +
        '<input id="qa-name" placeholder="作者名" style="padding:5px 6px;border-radius:4px;border:1px solid var(--bd);background:var(--bg);color:var(--txt);font-size:11px">' +
        '<input id="qa-type" placeholder="平台（分号分隔，如 bilibili;afdian）" style="padding:5px 6px;border-radius:4px;border:1px solid var(--bd);background:var(--bg);color:var(--txt);font-size:11px">' +
        '<input id="qa-desc" placeholder="简介（可选）" style="padding:5px 6px;border-radius:4px;border:1px solid var(--bd);background:var(--bg);color:var(--txt);font-size:11px">' +
        '<div style="display:flex;gap:4px;margin-top:4px">' +
        '<button id="qa-save" style="flex:1;padding:5px;border-radius:4px;border:none;background:var(--accent);color:#fff;cursor:pointer;font-size:11px">✅ 添加</button>' +
        '<button id="qa-cancel" style="flex:1;padding:5px;border-radius:4px;border:1px solid var(--bd);background:transparent;color:var(--txt);cursor:pointer;font-size:11px">取消</button>' +
        "</div></div>";
      overlay.appendChild(modal);
      modal.onclick = (e) => {
        if (e.target === modal) modal.remove();
      };
      modal.querySelector("#qa-save").addEventListener("click", () => {
        const name = modal.querySelector("#qa-name").value.trim();
        const type = modal.querySelector("#qa-type").value.trim();
        if (!name) {
          bus.emit("toast:show", {
            msg: "请输入作者名",
            duration: 2000,
            type: "error",
          });
          return;
        }
        data.push({
          name,
          type,
          desc: modal.querySelector("#qa-desc").value.trim() || "",
        });
        modal.remove();
        renderTags();
        renderList();
        // 滚动到底部
        listEl.scrollTop = listEl.scrollHeight;
      });
      modal
        .querySelector("#qa-cancel")
        .addEventListener("click", () => modal.remove());
      // 回车保存
      modal.querySelector("#qa-name").addEventListener("keydown", (e) => {
        if (e.key === "Enter") modal.querySelector("#qa-save").click();
      });
      modal.querySelector("#qa-name").focus();
    };

    box.querySelector(".cm-quick-add").addEventListener("click", showQuickAdd);

    box.querySelector(".cm-export").addEventListener("click", async () => {
      try {
        const { SaveWorkshopCreators, ExportWorkshopCreatorsJSONFile } =
          await import("../../wailsjs/go/main/App.js");
        await SaveWorkshopCreators(data);
        bus.emit("toast:show", {
          msg: "✅ 已导出到: " + (await ExportWorkshopCreatorsJSONFile()),
          duration: 3000,
          type: "success",
        });
      } catch (e) {
        bus.emit("toast:show", {
          msg: "❌ 导出失败: " + e,
          duration: 3000,
          type: "error",
        });
      }
    });

    box.querySelector(".cm-merge").addEventListener("click", async () => {
      const inp = document.createElement("input");
      inp.type = "file";
      inp.accept = ".json";
      inp.onchange = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
          const text = await file.text();
          const { MergeWorkshopCreatorsFromJSON } =
            await import("../../wailsjs/go/main/App.js");
          const r = await MergeWorkshopCreatorsFromJSON(text);
          bus.emit("toast:show", {
            msg: "✅ 合并完成：新增 " + r[0] + " 个，更新 " + r[1] + " 个",
            duration: 3000,
            type: "success",
          });
          await loadData();
        } catch (err) {
          bus.emit("toast:show", {
            msg: "❌ 导入失败: " + err,
            duration: 3000,
            type: "error",
          });
        }
      };
      inp.click();
    });

    box.querySelector(".cm-replace").addEventListener("click", async () => {
      const { modalConfirm } = await import("../dialogs/modal.js");
      if (
        !(await modalConfirm({
          title: "覆盖导入",
          icon: "⚠️",
          message: "覆盖导入将完全替换！已自动备份。确定？",
          okText: "覆盖导入",
          danger: true,
        }))
      )
        return;
      const inp = document.createElement("input");
      inp.type = "file";
      inp.accept = ".json";
      inp.onchange = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
          const text = await file.text();
          const { ReplaceWorkshopCreatorsFromJSON } =
            await import("../../wailsjs/go/main/App.js");
          bus.emit("toast:show", {
            msg:
              "✅ 已导入 " +
              (await ReplaceWorkshopCreatorsFromJSON(text)) +
              " 个（备份已创建）",
            duration: 3000,
            type: "success",
          });
          await loadData();
        } catch (err) {
          bus.emit("toast:show", {
            msg: "❌ 导入失败: " + err,
            duration: 3000,
            type: "error",
          });
        }
      };
      inp.click();
    });

    box.querySelector(".cm-save").addEventListener("click", async () => {
      try {
        const { SaveWorkshopCreators } =
          await import("../../wailsjs/go/main/App.js");
        await SaveWorkshopCreators(data);
        bus.emit("toast:show", {
          msg: "✅ 已保存",
          duration: 2000,
          type: "success",
        });
        overlay.remove();
        resolve(true);
      } catch (e) {
        bus.emit("toast:show", {
          msg: "❌ 保存失败: " + e,
          duration: 3000,
          type: "error",
        });
      }
    });

    box.querySelector(".cm-cancel").addEventListener("click", () => {
      overlay.remove();
      resolve(null);
    });
    loadData();
  });
}

function esc(s) {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
