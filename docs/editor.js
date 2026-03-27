(() => {
  const CATEGORIES = ["Space", "Saturation", "Dynamic", "Frequency", "Synthesizer", "Modulation", "Misc"];
  const OVERRIDES_KEY = "vstinder.simple.overrides.v1";
  const ADDED_PLUGINS_KEY = "vstinder.simple.added.plugins.v1";
  const DELETED_PLUGIN_IDS_KEY = "vstinder.simple.deleted.plugin.ids.v1";
  const TEMPLATE_LABELS = ["插件名稱", "品牌", "功能", "特點", "分類"];
  const EDIT_RULES = Object.freeze({
    purposeMinLength: 24,
    purposeStrongLength: 60,
    featureTotalMinLength: 36,
    featureTotalStrongLength: 120,
    longFeatureLength: 18,
    longFeatureMinCount: 2,
    longFeatureStrongCount: 3
  });

  const rawPlugins = Array.isArray(window.VSTINDER_PLUGINS) ? window.VSTINDER_PLUGINS.slice() : [];
  const basePlugins = dedupeArchitectureVariants(rawPlugins);
  const basePluginById = new Map(basePlugins.map((item) => [item.id, item]));

  let allPlugins = [];
  let pluginById = new Map();
  let pluginsByNameKey = new Map();

  const state = {
    overrides: {},
    addedPlugins: loadAddedPlugins(),
    deletedPluginIds: loadDeletedPluginIds(),
    selectedId: null,
    search: "",
    categoryFilter: "all",
    onlyEdited: false,
    onlyUnedited: false,
    filteredIds: []
  };

  const summaryEl = document.getElementById("editor-summary");
  const listEl = document.getElementById("plugin-list");
  const emptyDetailEl = document.getElementById("empty-detail");
  const formEl = document.getElementById("editor-form");
  const saveStatusEl = document.getElementById("save-status");

  const searchInput = document.getElementById("search-input");
  const categoryFilterSelect = document.getElementById("category-filter");
  const onlyEditedInput = document.getElementById("only-edited");
  const onlyUneditedInput = document.getElementById("only-unedited");

  const nameInput = document.getElementById("plugin-name");
  const categoryInput = document.getElementById("plugin-category");
  const vendorInput = document.getElementById("plugin-vendor");
  const purposeInput = document.getElementById("plugin-purpose");
  const featuresInput = document.getElementById("plugin-features");
  const addPluginNameInput = document.getElementById("add-plugin-name");
  const addPluginVendorInput = document.getElementById("add-plugin-vendor");
  const addPluginCategoryInput = document.getElementById("add-plugin-category");

  const quickPasteInput = document.getElementById("quick-paste-input");

  init();

  function init() {
    rebuildPluginCaches();
    saveAddedPlugins();
    saveDeletedPluginIds();
    state.overrides = loadOverrides();
    fillCategoryOptions();

    searchInput.addEventListener("input", () => {
      state.search = searchInput.value.trim().toLowerCase();
      renderList();
    });

    categoryFilterSelect.addEventListener("change", () => {
      state.categoryFilter = categoryFilterSelect.value;
      renderList();
    });

    onlyEditedInput.addEventListener("change", () => {
      state.onlyEdited = onlyEditedInput.checked;
      renderList();
    });

    onlyUneditedInput.addEventListener("change", () => {
      state.onlyUnedited = onlyUneditedInput.checked;
      renderList();
    });

    listEl.addEventListener("click", onListClick);

    document.getElementById("copy-name-btn").addEventListener("click", () => {
      if (!state.selectedId) return;
      const plugin = pluginById.get(state.selectedId);
      if (!plugin) return;
      const merged = getMergedPlugin(plugin);
      const name = merged.name || plugin.name || "";
      copyText(name);
      setStatus(`已複製名稱：${name}`);
    });

    document.getElementById("save-btn").addEventListener("click", () => {
      saveCurrent(false);
    });

    document.getElementById("save-next-btn").addEventListener("click", () => {
      saveCurrent(true);
    });

    document.getElementById("reset-btn").addEventListener("click", () => {
      resetCurrent();
    });

    document.getElementById("delete-current-btn").addEventListener("click", () => {
      deleteCurrentPlugin();
    });

    document.getElementById("add-plugin-btn").addEventListener("click", () => {
      addPluginFromForm();
    });

    document.getElementById("clear-add-plugin-btn").addEventListener("click", () => {
      clearAddPluginForm();
      setStatus("已清空新增欄位");
    });

    document.getElementById("export-overrides").addEventListener("click", () => {
      downloadJson("manual_overrides.json", state.overrides);
    });

    document.getElementById("export-merged-json").addEventListener("click", () => {
      const merged = allPlugins.map((item) => getMergedPlugin(item));
      downloadJson("plugins.manual.merged.json", merged);
    });

    document.getElementById("export-merged-datajs").addEventListener("click", () => {
      const merged = allPlugins.map((item) => getMergedPlugin(item));
      const payload = `window.VSTINDER_PLUGINS = ${JSON.stringify(merged, null, 2)};\n`;
      downloadText("data.manual.js", payload, "application/javascript");
    });

    document.getElementById("export-csv").addEventListener("click", () => {
      const rows = allPlugins.map((item) => {
        const merged = getMergedPlugin(item);
        return {
          id: item.id,
          name: item.name || "",
          category: merged.category || "",
          vendor: merged.vendor || "",
          purpose: merged.purpose || "",
          features: Array.isArray(merged.features) ? merged.features.join(" | ") : ""
        };
      });

      const csv = buildCsv(rows, ["id", "name", "category", "vendor", "purpose", "features"]);
      downloadText("manual_enrichment.csv", `\uFEFF${csv}`, "text/csv;charset=utf-8");
      setStatus("已匯出 manual_enrichment.csv");
    });

    document.getElementById("apply-paste-current").addEventListener("click", applyFixedTemplateToCurrent);
    document.getElementById("apply-paste-by-name").addEventListener("click", applyFixedTemplateByName);

    document.getElementById("import-overrides-input").addEventListener("change", onImportOverrides);
    document.getElementById("import-csv-input").addEventListener("change", onImportCsv);

    renderList();

    if (allPlugins.length > 0) {
      state.selectedId = allPlugins[0].id;
      renderEditor();
    }
  }

  function fillCategoryOptions() {
    categoryFilterSelect.innerHTML = `<option value="all">全部分類</option>${CATEGORIES.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("")}`;
    categoryInput.innerHTML = CATEGORIES.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
    addPluginCategoryInput.innerHTML = CATEGORIES.map((c) => `<option value="${escapeHtml(c)}"${c === "Misc" ? " selected" : ""}>${escapeHtml(c)}</option>`).join("");
  }

  function buildPluginNameIndex(list) {
    const index = new Map();
    for (const plugin of list) {
      const key = normalizePluginName(plugin.name);
      if (!key) continue;
      if (!index.has(key)) {
        index.set(key, []);
      }
      index.get(key).push(plugin);
    }
    return index;
  }

  function findPluginByName(name) {
    const key = normalizePluginName(name);
    if (!key) return null;

    const matches = pluginsByNameKey.get(key) || [];
    if (matches.length === 0) return null;
    if (matches.length === 1) return matches[0];

    const exact = matches.find((item) => item.name === name);
    if (exact) return exact;

    for (const item of allPlugins) {
      const merged = getMergedPlugin(item);
      if (normalizePluginName(merged.name || item.name) === key) {
        return item;
      }
    }

    return matches[0];
  }

  function rebuildPluginCaches() {
    const normalizedAdded = normalizeAddedPlugins(state.addedPlugins);
    state.addedPlugins = normalizedAdded;

    const deletedIds = new Set(
      Array.from(state.deletedPluginIds).filter((id) => basePluginById.has(id))
    );
    state.deletedPluginIds = deletedIds;

    const visibleBase = basePlugins.filter((item) => !state.deletedPluginIds.has(item.id));
    allPlugins = visibleBase.concat(state.addedPlugins);
    pluginById = new Map(allPlugins.map((item) => [item.id, item]));
    pluginsByNameKey = buildPluginNameIndex(allPlugins);
  }

  function loadAddedPlugins() {
    try {
      const raw = localStorage.getItem(ADDED_PLUGINS_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return normalizeAddedPlugins(Array.isArray(parsed) ? parsed : []);
    } catch {
      return [];
    }
  }

  function saveAddedPlugins() {
    localStorage.setItem(ADDED_PLUGINS_KEY, JSON.stringify(state.addedPlugins));
  }

  function loadDeletedPluginIds() {
    try {
      const raw = localStorage.getItem(DELETED_PLUGIN_IDS_KEY);
      if (!raw) return new Set();
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return new Set();
      const filtered = parsed
        .map((id) => String(id || "").trim())
        .filter((id) => basePluginById.has(id));
      return new Set(filtered);
    } catch {
      return new Set();
    }
  }

  function saveDeletedPluginIds() {
    const ids = Array.from(state.deletedPluginIds).sort();
    localStorage.setItem(DELETED_PLUGIN_IDS_KEY, JSON.stringify(ids));
  }

  function normalizeAddedPlugins(list) {
    const usedIds = new Set(basePlugins.map((item) => String(item.id || "").trim()).filter(Boolean));
    const seenNameKeys = new Set(basePlugins.map((item) => normalizePluginName(item.name)).filter(Boolean));
    const out = [];

    for (const item of list) {
      if (!item || typeof item !== "object") continue;

      const name = cleanupSingleLine(item.name);
      if (!name) continue;

      const nameKey = normalizePluginName(name);
      if (!nameKey || seenNameKeys.has(nameKey)) {
        continue;
      }

      const idSeed = cleanupSingleLine(item.id) || name;
      const id = generateUniquePluginId(idSeed, usedIds);
      const category = normalizeCategory(item.category) || "Misc";
      const vendor = cleanupSingleLine(item.vendor) || "Unknown";
      const purpose = cleanupPurposeText(item.purpose);
      const features = Array.isArray(item.features)
        ? dedupeKeepOrder(item.features.map((entry) => cleanupFeatureText(entry)).filter(Boolean))
        : [];

      out.push({
        id,
        name,
        category,
        vendor,
        purpose,
        features
      });

      usedIds.add(id);
      seenNameKeys.add(nameKey);
    }

    return out;
  }

  function loadOverrides() {
    try {
      const raw = localStorage.getItem(OVERRIDES_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return {};
      }
      return normalizeOverrides(parsed);
    } catch {
      return {};
    }
  }

  function saveOverrides() {
    localStorage.setItem(OVERRIDES_KEY, JSON.stringify(state.overrides));
  }

  function normalizeOverrides(raw) {
    const output = {};
    for (const [id, value] of Object.entries(raw)) {
      if (!pluginById.has(id)) continue;
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;

      const plugin = pluginById.get(id);
      const candidate = {};

      if (typeof value.name === "string") {
        const name = cleanupSingleLine(value.name);
        if (name) {
          candidate.name = name;
        }
      }

      if (typeof value.category === "string") {
        const normalizedCategory = normalizeCategory(value.category);
        if (normalizedCategory) {
          candidate.category = normalizedCategory;
        }
      }

      if (typeof value.vendor === "string") {
        const vendor = value.vendor.trim();
        if (vendor) {
          candidate.vendor = vendor;
        }
      }

      if (typeof value.purpose === "string") {
        const purpose = cleanupPurposeText(value.purpose);
        if (purpose) {
          candidate.purpose = purpose;
        }
      }

      if (Array.isArray(value.features)) {
        const features = dedupeKeepOrder(value.features.map((item) => cleanupFeatureText(item)).filter(Boolean));
        if (features.length > 0) {
          candidate.features = features;
        }
      }

      const finalOverride = finalizeOverride(plugin, candidate);
      if (Object.keys(finalOverride).length > 0) {
        output[id] = finalOverride;
      }
    }

    return output;
  }

  function getMergedPlugin(plugin) {
    const override = state.overrides[plugin.id];
    if (!override) {
      return plugin;
    }

    const merged = { ...plugin };

    if (override.name) merged.name = override.name;
    if (override.category) merged.category = override.category;
    if (override.vendor) merged.vendor = override.vendor;
    if (override.purpose) merged.purpose = override.purpose;
    if (Array.isArray(override.features) && override.features.length > 0) {
      merged.features = override.features.slice();
    }

    return merged;
  }

  function getEditStatus(plugin, merged) {
    const hasOverride = Boolean(state.overrides[plugin.id]);

    const purposeText = normalizeTextForEditJudge(merged.purpose);
    const purposeLength = purposeText.length;

    const features = Array.isArray(merged.features) ? merged.features : [];
    const normalizedFeatures = features
      .map((item) => normalizeTextForEditJudge(cleanupFeatureText(item)))
      .filter(Boolean);

    const featureTotalLength = normalizedFeatures.reduce((sum, text) => sum + text.length, 0);
    const longFeatureCount = normalizedFeatures.filter((text) => text.length >= EDIT_RULES.longFeatureLength).length;

    const hasRichPurpose = purposeLength >= EDIT_RULES.purposeMinLength;
    const hasStrongPurpose = purposeLength >= EDIT_RULES.purposeStrongLength;
    const hasRichFeatures = featureTotalLength >= EDIT_RULES.featureTotalMinLength || longFeatureCount >= EDIT_RULES.longFeatureMinCount;
    const hasStrongFeatures = featureTotalLength >= EDIT_RULES.featureTotalStrongLength || longFeatureCount >= EDIT_RULES.longFeatureStrongCount;

    const isRich = (hasRichPurpose && hasRichFeatures) || hasStrongPurpose || hasStrongFeatures;
    const isEdited = hasOverride || isRich;

    return {
      isEdited,
      hasOverride,
      isRich,
      purposeLength,
      featureTotalLength,
      longFeatureCount
    };
  }

  function normalizeTextForEditJudge(input) {
    return String(input || "").replace(/[\s\r\n\t]+/g, "").trim();
  }

  function renderList() {
    const search = state.search;
    const filtered = [];

    const editedOnly = state.onlyEdited && !state.onlyUnedited;
    const uneditedOnly = state.onlyUnedited && !state.onlyEdited;

    let editedCount = 0;
    let overrideCount = 0;

    for (const plugin of allPlugins) {
      const merged = getMergedPlugin(plugin);
      const editStatus = getEditStatus(plugin, merged);

      if (editStatus.isEdited) {
        editedCount += 1;
      }
      if (editStatus.hasOverride) {
        overrideCount += 1;
      }

      if (editedOnly && !editStatus.isEdited) {
        continue;
      }

      if (uneditedOnly && editStatus.isEdited) {
        continue;
      }

      if (state.categoryFilter !== "all" && merged.category !== state.categoryFilter) {
        continue;
      }

      if (search && !String(merged.name || "").toLowerCase().includes(search)) {
        continue;
      }

      filtered.push({ plugin, merged, editStatus });
    }

    filtered.sort((a, b) => String(a.merged.name || "").localeCompare(String(b.merged.name || "")));
    state.filteredIds = filtered.map((item) => item.plugin.id);

    summaryEl.textContent = `共 ${allPlugins.length} 筆插件（原始 ${basePlugins.length} + 手動新增 ${state.addedPlugins.length}，已刪除 ${state.deletedPluginIds.size}），已編輯判定 ${editedCount} 筆（手動 Override ${overrideCount} 筆），目前列表 ${filtered.length} 筆。判定依據：功能 >= ${EDIT_RULES.purposeMinLength} 字 且 特點總長 >= ${EDIT_RULES.featureTotalMinLength} 字（或內容特別完整）。`;

    if (filtered.length === 0) {
      listEl.innerHTML = `<div class="empty-state"><h3>沒有符合項目</h3><p>調整搜尋或篩選條件。</p></div>`;
      return;
    }

    listEl.innerHTML = filtered
      .map(({ plugin, merged, editStatus }) => {
        const active = plugin.id === state.selectedId ? "active" : "";
        const uneditedClass = editStatus.isEdited ? "" : "unedited";
        const statusText = editStatus.isEdited ? "已編輯" : "未編輯";
        return `
          <article class="plugin-row ${active} ${uneditedClass}" data-id="${escapeHtml(plugin.id)}">
            <button class="row-main" type="button" data-action="select" data-id="${escapeHtml(plugin.id)}">
              <strong>${escapeHtml(merged.name || plugin.name || "")}</strong>
              <span>${escapeHtml(merged.category)} · ${statusText}</span>
            </button>
            <button class="row-copy" type="button" data-action="copy" data-name="${escapeHtml(merged.name || plugin.name || "")}">複製</button>
            <button class="row-delete" type="button" data-action="quick-delete" data-id="${escapeHtml(plugin.id)}" aria-label="刪除 ${escapeHtml(merged.name || plugin.name || "")}" title="刪除此插件">刪</button>
          </article>
        `;
      })
      .join("");
  }

  function onListClick(event) {
    const btn = event.target.closest("button[data-action]");
    if (!btn) return;

    const action = btn.getAttribute("data-action");
    if (action === "copy") {
      const name = btn.getAttribute("data-name") || "";
      copyText(name);
      setStatus(`已複製名稱：${name}`);
      return;
    }

    if (action === "quick-delete") {
      const id = btn.getAttribute("data-id");
      if (!id || !pluginById.has(id)) return;
      deletePluginById(id);
      return;
    }

    if (action === "select") {
      const id = btn.getAttribute("data-id");
      if (!id || !pluginById.has(id)) return;
      state.selectedId = id;
      renderList();
      renderEditor();
      setStatus("");
    }
  }

  function renderEditor() {
    const plugin = state.selectedId ? pluginById.get(state.selectedId) : null;
    if (!plugin) {
      emptyDetailEl.classList.remove("hidden");
      formEl.classList.add("hidden");
      return;
    }

    emptyDetailEl.classList.add("hidden");
    formEl.classList.remove("hidden");

    const merged = getMergedPlugin(plugin);

    nameInput.value = merged.name || plugin.name || "";
    categoryInput.value = CATEGORIES.includes(merged.category) ? merged.category : plugin.category;
    vendorInput.value = merged.vendor || "";
    purposeInput.value = merged.purpose || "";
    featuresInput.value = Array.isArray(merged.features) ? merged.features.join("\n") : "";
  }

  function saveCurrent(selectNext) {
    const plugin = state.selectedId ? pluginById.get(state.selectedId) : null;
    if (!plugin) return;

    const candidate = {};

    const renamed = cleanupSingleLine(nameInput.value);
    if (!renamed) {
      setStatus("儲存失敗：Plugin 名稱不能為空");
      nameInput.focus();
      return;
    }

    if (hasNameConflict(plugin.id, renamed)) {
      setStatus(`儲存失敗：名稱重複（${renamed}）`);
      nameInput.focus();
      return;
    }
    candidate.name = renamed;

    const normalizedCategory = normalizeCategory(categoryInput.value);
    if (normalizedCategory) {
      candidate.category = normalizedCategory;
    }

    const vendor = vendorInput.value.trim();
    if (vendor) {
      candidate.vendor = vendor;
    }

    const purpose = cleanupPurposeText(purposeInput.value);
    if (purpose) {
      candidate.purpose = purpose;
    }

    const features = dedupeKeepOrder(
      featuresInput.value
        .split(/\r?\n/g)
        .map((item) => cleanupFeatureText(item))
        .filter(Boolean)
    );
    if (features.length > 0) {
      candidate.features = features;
    }

    const changed = setOverrideForPlugin(plugin, candidate);

    saveOverrides();
    renderList();

    if (selectNext) {
      selectNextPlugin(plugin.id);
    } else {
      renderEditor();
    }

    const currentName = getMergedPlugin(plugin).name || plugin.name || "";
    if (changed) {
      setStatus(`已儲存：${currentName}`);
    } else {
      setStatus(`資料無變更：${currentName}`);
    }
  }

  function selectNextPlugin(currentId) {
    if (state.filteredIds.length === 0) {
      return;
    }

    const index = state.filteredIds.indexOf(currentId);
    if (index < 0) {
      return;
    }

    const nextId = state.filteredIds[index + 1];
    if (!nextId) {
      renderEditor();
      return;
    }

    state.selectedId = nextId;
    renderList();
    renderEditor();
  }

  function resetCurrent() {
    const plugin = state.selectedId ? pluginById.get(state.selectedId) : null;
    if (!plugin) return;

    const existed = Boolean(state.overrides[plugin.id]);
    delete state.overrides[plugin.id];

    saveOverrides();
    renderList();
    renderEditor();

    if (existed) {
      setStatus(`已清除手動設定：${plugin.name}`);
    } else {
      setStatus(`目前無手動設定：${plugin.name}`);
    }
  }

  function addPluginFromForm() {
    const name = cleanupSingleLine(addPluginNameInput.value);
    if (!name) {
      setStatus("新增失敗：請先輸入 Plugin 名稱");
      addPluginNameInput.focus();
      return;
    }

    const existing = findPluginByName(name);
    if (existing) {
      state.selectedId = existing.id;
      renderList();
      renderEditor();
      setStatus(`名稱已存在，已跳轉到：${existing.name}`);
      return;
    }

    const normalizedName = normalizePluginName(name);
    const deletedBaseMatch = basePlugins.find(
      (item) => state.deletedPluginIds.has(item.id) && normalizePluginName(item.name) === normalizedName
    );

    if (deletedBaseMatch) {
      state.deletedPluginIds.delete(deletedBaseMatch.id);

      const candidate = state.overrides[deletedBaseMatch.id] ? { ...state.overrides[deletedBaseMatch.id] } : {};
      const restoredVendor = cleanupSingleLine(addPluginVendorInput.value);
      const restoredCategory = normalizeCategory(addPluginCategoryInput.value);

      if (restoredVendor) {
        candidate.vendor = restoredVendor;
      }
      if (restoredCategory) {
        candidate.category = restoredCategory;
      }
      setOverrideForPlugin(deletedBaseMatch, candidate);

      saveDeletedPluginIds();
      saveOverrides();
      rebuildPluginCaches();

      state.selectedId = deletedBaseMatch.id;
      clearAddPluginForm();
      renderList();
      renderEditor();
      setStatus(`已恢復插件：${deletedBaseMatch.name}`);
      return;
    }

    const newId = generateUniquePluginId(name);
    const vendor = cleanupSingleLine(addPluginVendorInput.value) || "Unknown";
    const category = normalizeCategory(addPluginCategoryInput.value) || "Misc";

    state.addedPlugins.push({
      id: newId,
      name,
      category,
      vendor,
      purpose: "",
      features: []
    });

    saveAddedPlugins();
    rebuildPluginCaches();

    state.selectedId = newId;
    clearAddPluginForm();
    renderList();
    renderEditor();
    setStatus(`已新增插件：${name}`);
  }

  function deleteCurrentPlugin() {
    const plugin = state.selectedId ? pluginById.get(state.selectedId) : null;
    if (!plugin) {
      setStatus("請先選擇要刪除的插件");
      return;
    }

    deletePluginById(plugin.id);
  }

  function clearAddPluginForm() {
    addPluginNameInput.value = "";
    addPluginVendorInput.value = "";
    addPluginCategoryInput.value = "Misc";
  }

  function deletePluginById(pluginId) {
    const plugin = pluginById.get(pluginId);
    if (!plugin) {
      setStatus("刪除失敗：找不到插件");
      return;
    }

    const currentId = plugin.id;
    const currentName = getMergedPlugin(plugin).name || plugin.name || currentId;
    const isAdded = state.addedPlugins.some((item) => item.id === currentId);

    if (isAdded) {
      state.addedPlugins = state.addedPlugins.filter((item) => item.id !== currentId);
      saveAddedPlugins();
    } else if (basePluginById.has(currentId)) {
      state.deletedPluginIds.add(currentId);
      saveDeletedPluginIds();
    } else {
      setStatus(`刪除失敗：找不到插件 ${currentName}`);
      return;
    }

    delete state.overrides[currentId];
    saveOverrides();

    rebuildPluginCaches();
    state.selectedId = null;
    renderList();
    if (state.filteredIds.length > 0) {
      state.selectedId = state.filteredIds[0];
      renderList();
    }
    renderEditor();
    setStatus(`已刪除插件：${currentName}`);
  }

  function applyFixedTemplateToCurrent() {
    const plugin = state.selectedId ? pluginById.get(state.selectedId) : null;
    if (!plugin) {
      setStatus("請先在左側選擇插件");
      return;
    }

    const blocks = parseFixedTemplateBlocks(quickPasteInput.value);
    if (blocks.length === 0) {
      setStatus("解析失敗：請貼上固定格式內容");
      return;
    }

    const first = blocks[0];
    const changed = applyPatchToPlugin(plugin, first);

    saveOverrides();
    renderList();
    renderEditor();

    const pastedName = first.name || "";
    const sameName = !pastedName || normalizePluginName(pastedName) === normalizePluginName(plugin.name);

    let message = `已套用到目前插件：${plugin.name}`;
    if (!sameName) {
      message += `（注意：貼上內容名稱為 ${pastedName}）`;
    }
    if (blocks.length > 1) {
      message += `；偵測到 ${blocks.length} 筆，僅套用第一筆`;
    }
    if (!changed) {
      message += "（資料無變更）";
    }

    setStatus(message);
  }

  function applyFixedTemplateByName() {
    const blocks = parseFixedTemplateBlocks(quickPasteInput.value);
    if (blocks.length === 0) {
      setStatus("解析失敗：請貼上固定格式內容");
      return;
    }

    let changedCount = 0;
    let matchedCount = 0;
    let skippedCount = 0;

    for (const block of blocks) {
      if (!block.name) {
        skippedCount += 1;
        continue;
      }

      const plugin = findPluginByName(block.name);
      if (!plugin) {
        skippedCount += 1;
        continue;
      }

      matchedCount += 1;
      if (applyPatchToPlugin(plugin, block)) {
        changedCount += 1;
      }
    }

    saveOverrides();
    renderList();
    renderEditor();

    setStatus(`自動套用完成：解析 ${blocks.length} 筆，匹配 ${matchedCount} 筆，實際更新 ${changedCount} 筆，未匹配 ${skippedCount} 筆`);
  }

  function applyPatchToPlugin(plugin, patch) {
    const candidate = state.overrides[plugin.id] ? { ...state.overrides[plugin.id] } : {};

    const category = normalizeCategory(patch.category);
    if (category) {
      candidate.category = category;
    }

    const vendor = typeof patch.vendor === "string" ? patch.vendor.trim() : "";
    if (vendor) {
      candidate.vendor = vendor;
    }

    const purpose = cleanupPurposeText(patch.purpose);
    if (purpose) {
      candidate.purpose = purpose;
    }

    if (Array.isArray(patch.features) && patch.features.length > 0) {
      const features = dedupeKeepOrder(patch.features.map((item) => cleanupFeatureText(item)).filter(Boolean));
      if (features.length > 0) {
        candidate.features = features;
      }
    }

    return setOverrideForPlugin(plugin, candidate);
  }

  function setOverrideForPlugin(plugin, candidate) {
    const before = JSON.stringify(state.overrides[plugin.id] || {});
    const finalized = finalizeOverride(plugin, candidate);

    if (Object.keys(finalized).length === 0) {
      delete state.overrides[plugin.id];
    } else {
      state.overrides[plugin.id] = finalized;
    }

    const after = JSON.stringify(state.overrides[plugin.id] || {});
    return before !== after;
  }

  function finalizeOverride(plugin, candidate) {
    const out = {};

    const name = cleanupSingleLine(candidate.name);
    if (name && name !== cleanupSingleLine(plugin.name || "")) {
      out.name = name;
    }

    const category = normalizeCategory(candidate.category);
    if (category && category !== plugin.category) {
      out.category = category;
    }

    const vendor = typeof candidate.vendor === "string" ? candidate.vendor.trim() : "";
    if (vendor && vendor !== (plugin.vendor || "")) {
      out.vendor = vendor;
    }

    const purpose = cleanupPurposeText(candidate.purpose);
    if (purpose && purpose !== cleanupPurposeText(plugin.purpose || "")) {
      out.purpose = purpose;
    }

    if (Array.isArray(candidate.features) && candidate.features.length > 0) {
      const features = dedupeKeepOrder(candidate.features.map((item) => cleanupFeatureText(item)).filter(Boolean));
      const baseFeatures = dedupeKeepOrder((plugin.features || []).map((item) => cleanupFeatureText(item)).filter(Boolean));
      const sameFeatures = JSON.stringify(features) === JSON.stringify(baseFeatures);

      if (features.length > 0 && !sameFeatures) {
        out.features = features;
      }
    }

    return out;
  }

  function parseFixedTemplateBlocks(input) {
    const text = String(input || "").replace(/\r\n/g, "\n").trim();
    if (!text) {
      return [];
    }

    let blocks = text
      .split(/(?=^\s*插件名稱\s*[:：])/gm)
      .map((item) => item.trim())
      .filter(Boolean);

    if (blocks.length === 0) {
      blocks = [text];
    }

    const parsed = [];
    for (const block of blocks) {
      const item = parseFixedTemplateBlock(block);
      if (item && item.name) {
        parsed.push(item);
      }
    }

    return parsed;
  }

  function parseFixedTemplateBlock(blockText) {
    const block = String(blockText || "");

    const name = cleanupSingleLine(extractSection(block, "插件名稱"));
    const vendor = cleanupSingleLine(extractSection(block, "品牌"));
    const purpose = cleanupPurposeText(extractSection(block, "功能"));
    const category = normalizeCategory(cleanupSingleLine(extractSection(block, "分類")));

    const featuresSection = extractSection(block, "特點");
    const features = parseFeaturesSection(featuresSection);

    return {
      name,
      vendor,
      purpose,
      category,
      features
    };
  }

  function extractSection(source, label) {
    const text = String(source || "").replace(/\r\n/g, "\n");
    const otherLabels = TEMPLATE_LABELS.filter((item) => item !== label).join("|");
    const pattern = new RegExp(`(?:^|\\n)\\s*${label}\\s*[:：]\\s*([\\s\\S]*?)(?=\\n\\s*(?:${otherLabels})\\s*[:：]|$)`);
    const match = text.match(pattern);
    return match ? String(match[1] || "").trim() : "";
  }
  function parseFeaturesSection(input) {
    const raw = String(input || "").replace(/\r\n/g, "\n").trim();
    if (!raw) {
      return [];
    }

    let rows = raw.split(/\n+/g).map((item) => item.trim()).filter(Boolean);
    if (rows.length === 1 && rows[0].includes("|")) {
      rows = rows[0].split("|").map((item) => item.trim()).filter(Boolean);
    }

    const cleaned = rows
      .map((line) => line.replace(/^[-*•]\s*/, "").replace(/^\d+[.)]\s*/, ""))
      .map((line) => cleanupFeatureText(line))
      .filter(Boolean);

    return dedupeKeepOrder(cleaned);
  }

  function cleanupSingleLine(input) {
    const line = String(input || "").split(/\r?\n/g)[0] || "";
    return stripMarkdown(line).trim();
  }

  function cleanupPurposeText(input) {
    const lines = String(input || "")
      .replace(/\r\n/g, "\n")
      .split("\n")
      .map((line) => stripMarkdown(line).trim())
      .filter(Boolean);

    return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  function cleanupFeatureText(input) {
    return stripMarkdown(String(input || ""))
      .replace(/^[-*•]\s*/, "")
      .replace(/^\d+[.)]\s*/, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  function stripMarkdown(input) {
    return String(input || "")
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/__(.*?)__/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\*\*/g, "")
      .replace(/__/g, "");
  }

  function normalizeCategory(input) {
    const raw = cleanupSingleLine(input);
    if (!raw) {
      return "";
    }

    if (CATEGORIES.includes(raw)) {
      return raw;
    }

    const lower = raw.toLowerCase();
    const map = {
      space: "Space",
      saturation: "Saturation",
      dynamic: "Dynamic",
      frequency: "Frequency",
      synthesizer: "Synthesizer",
      synthesiser: "Synthesizer",
      synthsiser: "Synthesizer",
      modulation: "Modulation",
      misc: "Misc",
      空間: "Space",
      飽和: "Saturation",
      動態: "Dynamic",
      頻率: "Frequency",
      合成器: "Synthesizer",
      調變: "Modulation",
      其他: "Misc"
    };

    return map[lower] || map[raw] || "";
  }

  async function copyText(text) {
    const value = String(text || "");
    if (!value) return;

    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(value);
        return;
      } catch {
        // fallback below
      }
    }

    const ta = document.createElement("textarea");
    ta.value = value;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }

  function onImportOverrides(event) {
    const file = event.target.files && event.target.files[0];
    event.target.value = "";
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const raw = JSON.parse(String(reader.result || "{}"));
        const normalized = normalizeOverrides(raw);
        state.overrides = normalized;
        saveOverrides();
        renderList();
        renderEditor();
        setStatus(`匯入完成，共 ${Object.keys(normalized).length} 筆 override`);
      } catch {
        setStatus("匯入失敗：JSON 格式錯誤");
      }
    };
    reader.readAsText(file);
  }

  function onImportCsv(event) {
    const file = event.target.files && event.target.files[0];
    event.target.value = "";
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const csvText = String(reader.result || "");
        const rows = parseCsv(csvText);
        if (rows.length < 2) {
          setStatus("CSV 匯入失敗：沒有可用資料列");
          return;
        }

        const header = rows[0].map((item) => normalizeHeader(item));
        const indexMap = makeIndexMap(header);

        if (indexMap.id === undefined && indexMap.name === undefined) {
          setStatus("CSV 匯入失敗：需要 id 或 name 欄位");
          return;
        }

        let updated = 0;
        let skipped = 0;

        for (let i = 1; i < rows.length; i += 1) {
          const row = rows[i];
          if (row.length === 0 || row.every((cell) => !String(cell || "").trim())) {
            continue;
          }

          const idCell = readCell(row, indexMap.id);
          const nameCell = readCell(row, indexMap.name);

          let plugin = null;
          if (idCell && pluginById.has(idCell)) {
            plugin = pluginById.get(idCell);
          } else if (nameCell) {
            plugin = findPluginByName(nameCell);
          }

          if (!plugin) {
            skipped += 1;
            continue;
          }

          const candidate = state.overrides[plugin.id] ? { ...state.overrides[plugin.id] } : {};

          const category = normalizeCategory(readCell(row, indexMap.category));
          if (category) {
            candidate.category = category;
          }

          const vendor = readCell(row, indexMap.vendor).trim();
          if (vendor) {
            candidate.vendor = vendor;
          }

          const purpose = cleanupPurposeText(readCell(row, indexMap.purpose));
          if (purpose) {
            candidate.purpose = purpose;
          }

          const featuresRaw = readCell(row, indexMap.features);
          if (featuresRaw) {
            const parsedFeatures = dedupeKeepOrder(
              featuresRaw
                .split(/\s*\|\s*|\r?\n/g)
                .map((item) => cleanupFeatureText(item))
                .filter(Boolean)
            );

            if (parsedFeatures.length > 0) {
              candidate.features = parsedFeatures;
            }
          }

          if (setOverrideForPlugin(plugin, candidate)) {
            updated += 1;
          }
        }

        saveOverrides();
        renderList();
        renderEditor();
        setStatus(`CSV 匯入完成：更新 ${updated} 筆，略過 ${skipped} 筆（找不到插件）`);
      } catch {
        setStatus("CSV 匯入失敗：格式解析錯誤");
      }
    };

    reader.readAsText(file);
  }

  function buildCsv(rows, columns) {
    const lines = [];
    lines.push(columns.join(","));

    for (const row of rows) {
      const values = columns.map((column) => csvEscape(row[column] ?? ""));
      lines.push(values.join(","));
    }

    return lines.join("\n");
  }

  function csvEscape(value) {
    const text = String(value ?? "");
    if (!/[",\r\n]/.test(text)) {
      return text;
    }
    return `"${text.replace(/"/g, '""')}"`;
  }

  function parseCsv(content) {
    const text = String(content || "").replace(/^\uFEFF/, "");
    const rows = [];
    let row = [];
    let cell = "";
    let i = 0;
    let inQuotes = false;

    while (i < text.length) {
      const ch = text[i];
      const next = text[i + 1];

      if (inQuotes) {
        if (ch === '"' && next === '"') {
          cell += '"';
          i += 2;
          continue;
        }

        if (ch === '"') {
          inQuotes = false;
          i += 1;
          continue;
        }

        cell += ch;
        i += 1;
        continue;
      }

      if (ch === '"') {
        inQuotes = true;
        i += 1;
        continue;
      }

      if (ch === ',') {
        row.push(cell);
        cell = "";
        i += 1;
        continue;
      }

      if (ch === '\n') {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
        i += 1;
        continue;
      }

      if (ch === '\r') {
        i += 1;
        continue;
      }

      cell += ch;
      i += 1;
    }

    row.push(cell);
    rows.push(row);

    return rows;
  }

  function normalizeHeader(value) {
    const key = String(value || "").trim().toLowerCase().replace(/\s+/g, "");

    const alias = {
      id: "id",
      pluginid: "id",
      plugin_id: "id",
      name: "name",
      pluginname: "name",
      plugin名稱: "name",
      插件名稱: "name",
      plugin: "name",
      category: "category",
      分類: "category",
      種類: "category",
      vendor: "vendor",
      品牌: "vendor",
      purpose: "purpose",
      功能: "purpose",
      features: "features",
      feature: "features",
      特點: "features"
    };

    return alias[key] || key;
  }

  function makeIndexMap(header) {
    const out = {};
    for (let i = 0; i < header.length; i += 1) {
      const key = header[i];
      if (key && out[key] === undefined) {
        out[key] = i;
      }
    }
    return out;
  }

  function readCell(row, index) {
    if (index === undefined || index < 0 || index >= row.length) {
      return "";
    }
    return String(row[index] || "").trim();
  }

  function dedupeArchitectureVariants(list) {
    const bestByFamily = new Map();

    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const familyKey = normalizePluginName(item.name);
      if (!familyKey) continue;

      const current = bestByFamily.get(familyKey);
      if (!current) {
        bestByFamily.set(familyKey, item);
        continue;
      }

      const nextRank = getArchitectureRank(item.name);
      const currentRank = getArchitectureRank(current.name);
      if (nextRank < currentRank) {
        bestByFamily.set(familyKey, item);
        continue;
      }
      if (nextRank > currentRank) {
        continue;
      }

      const nextScore = getPluginDetailScore(item);
      const currentScore = getPluginDetailScore(current);
      if (nextScore > currentScore) {
        bestByFamily.set(familyKey, item);
      }
    }

    const selectedIds = new Set(
      Array.from(bestByFamily.values()).map((item) => String(item.id || ""))
    );

    return list.filter((item) => selectedIds.has(String(item && item.id || "")));
  }

  function getArchitectureRank(name) {
    const raw = String(name || "").trim();
    if (/\(?\s*(?:x64|64[\s-]*bit)\s*\)?\s*$/i.test(raw)) return 1;
    if (/\(?\s*(?:x86|32[\s-]*bit)\s*\)?\s*$/i.test(raw)) return 2;
    return 0;
  }

  function getPluginDetailScore(item) {
    if (!item || typeof item !== "object") return 0;

    let score = 0;
    const vendor = String(item.vendor || "").trim();
    const purpose = String(item.purpose || "").trim();
    const features = Array.isArray(item.features) ? item.features : [];

    if (vendor && vendor.toLowerCase() !== "unknown") score += 1;
    if (purpose) score += 2;
    score += Math.min(features.length, 4);

    return score;
  }
  function normalizePluginName(input) {
    const raw = String(input || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");

    return raw
      .replace(/\s*(?:[-_])?\s*(?:\(?\s*(?:x64|x86|64[\s-]*bit|32[\s-]*bit)\s*\)?)\s*$/i, "")
      .trim();
  }

  function hasNameConflict(pluginId, name) {
    const targetKey = normalizePluginName(name);
    if (!targetKey) return true;

    for (const item of allPlugins) {
      if (!item || item.id === pluginId) continue;
      const merged = getMergedPlugin(item);
      const key = normalizePluginName(merged.name || item.name || "");
      if (key && key === targetKey) {
        return true;
      }
    }

    return false;
  }

  function generateUniquePluginId(input, usedSeed) {
    const used = usedSeed instanceof Set
      ? usedSeed
      : new Set(allPlugins.map((item) => String(item.id || "").trim()).filter(Boolean));

    const base = toPluginSlug(input) || "plugin";
    let candidate = base;
    let index = 2;

    while (used.has(candidate)) {
      candidate = `${base}-${index}`;
      index += 1;
    }

    used.add(candidate);
    return candidate;
  }

  function toPluginSlug(input) {
    return String(input || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function downloadJson(filename, data) {
    downloadText(filename, JSON.stringify(data, null, 2), "application/json");
  }

  function downloadText(filename, content, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function setStatus(message) {
    saveStatusEl.textContent = message;
  }

  function escapeHtml(input) {
    return String(input || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function dedupeKeepOrder(items) {
    const seen = new Set();
    const out = [];
    for (const item of items) {
      const normalized = String(item || "").trim();
      if (!normalized) continue;
      const key = normalized.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(normalized);
    }
    return out;
  }
})();






