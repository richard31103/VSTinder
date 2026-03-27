(() => {
  const CATEGORIES = ["Space", "Saturation", "Dynamic", "Frequency", "Synthesizer", "Modulation", "Misc"];
  const OVERRIDES_KEY = "vstinder.simple.overrides.v1";
  const ADDED_PLUGINS_KEY = "vstinder.simple.added.plugins.v1";
  const DELETED_PLUGIN_IDS_KEY = "vstinder.simple.deleted.plugin.ids.v1";
  const SAVED_KEY = "vstinder.simple.saved.v1";
  const SWIPE_THRESHOLD = 110;
  const SWIPE_OUT_X = 620;
  const SWIPE_OUT_ROTATE = 22;
  const DRAG_LOCK_THRESHOLD = 10;
  const DRAG_AXIS_RATIO = 1.15;
  const DRAG_DEAD_ZONE = 2;
  const DRAG_SMOOTHING = 0.28;

  const rawPlugins = Array.isArray(window.VSTINDER_PLUGINS) ? window.VSTINDER_PLUGINS : [];
  const dedupedBasePlugins = dedupeArchitectureVariants(rawPlugins);
  const addedPlugins = loadAddedPlugins(dedupedBasePlugins);
  const deletedPluginIds = loadDeletedPluginIds(dedupedBasePlugins);
  const basePlugins = mergePlugins(dedupedBasePlugins, addedPlugins, deletedPluginIds);
  const pluginImages = window.VSTINDER_PLUGIN_IMAGES || {};
  const plugins = applyOverrides(basePlugins);
  const basePluginIdSet = new Set(basePlugins.map((item) => String(item.id || "")));

  const state = {
    category: null,
    indexByCategory: {},
    categorySearch: {
      keyword: "",
      includeDescription: false
    },
    saved: loadSaved(),
    drag: {
      active: false,
      pointerId: null,
      startX: 0,
      startY: 0,
      x: 0,
      axisLock: null,
      rafId: null,
      pendingX: 0,
      captured: false,
      card: null,
      renderX: 0
    },
    animating: false
  };

  const categoryView = document.getElementById("category-view");
  const swipeView = document.getElementById("swipe-view");
  const savedView = document.getElementById("saved-view");

  const deck = document.getElementById("deck");
  const swipeEmpty = document.getElementById("swipe-empty");
  const swipeStatus = document.getElementById("swipe-status");
  const swipeHeaderActions = document.getElementById("swipe-header-actions");

  const openSavedBtn = document.getElementById("open-saved");
  const savedList = document.getElementById("saved-list");
  const savedCount = document.getElementById("saved-count");
  const desktopPluginList = document.getElementById("desktop-plugin-list");

  document.getElementById("back-to-categories").addEventListener("click", showCategories);
  document.getElementById("save-current").addEventListener("click", saveCurrentCard);
  document.getElementById("open-saved").addEventListener("click", showSaved);
  document.getElementById("back-to-swipe").addEventListener("click", showSwipe);
  document.getElementById("back-to-categories-from-saved").addEventListener("click", showCategories);

  deck.addEventListener("click", onDeckClick);
  savedList.addEventListener("click", onSavedListClick);
  if (desktopPluginList) {
    desktopPluginList.addEventListener("click", onDesktopPluginListClick);
  }

  renderCategories();
  renderSavedButtonLabel();
  showCategories();

  function loadSaved() {
    try {
      const raw = localStorage.getItem(SAVED_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? sanitizeSaved(parsed) : [];
    } catch {
      return [];
    }
  }
  function sanitizeSaved(list) {
    const seen = new Set();
    const out = [];

    for (const item of list) {
      if (!item || typeof item !== "object") continue;

      const id = String(item.id || "");
      if (!id || !basePluginIdSet.has(id) || seen.has(id)) {
        continue;
      }

      seen.add(id);
      out.push(item);
    }

    return out;
  }

  function saveSaved() {
    localStorage.setItem(SAVED_KEY, JSON.stringify(state.saved));
    renderSavedButtonLabel();
  }

  function renderSavedButtonLabel() {
    const label = `儲存的插件（${state.saved.length}）`;
    openSavedBtn.setAttribute("aria-label", label);
    openSavedBtn.setAttribute("title", label);
  }

  function dedupeArchitectureVariants(list) {
    const bestByFamily = new Map();

    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const familyKey = getPluginFamilyKey(item.name);
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

  function getPluginFamilyKey(name) {
    const raw = String(name || "").trim().replace(/\s+/g, " ");
    if (!raw) return "";

    const trimmed = raw
      .replace(/\s*(?:[-_])?\s*(?:\(?\s*(?:x64|x86|64[\s-]*bit|32[\s-]*bit)\s*\)?)\s*$/i, "")
      .trim();

    return (trimmed || raw).toLowerCase();
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

  function loadAddedPlugins(baseList) {
    try {
      const raw = localStorage.getItem(ADDED_PLUGINS_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return normalizeAddedPlugins(Array.isArray(parsed) ? parsed : [], baseList);
    } catch {
      return [];
    }
  }

  function loadDeletedPluginIds(baseList) {
    try {
      const raw = localStorage.getItem(DELETED_PLUGIN_IDS_KEY);
      if (!raw) return new Set();
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return new Set();

      const baseIdSet = new Set(baseList.map((item) => String(item.id || "")));
      return new Set(
        parsed.map((id) => String(id || "").trim()).filter((id) => id && baseIdSet.has(id))
      );
    } catch {
      return new Set();
    }
  }

  function mergePlugins(baseList, addedList, deletedIds) {
    const deleted = deletedIds instanceof Set ? deletedIds : new Set();
    const visibleBase = baseList.filter((item) => !deleted.has(String(item.id || "")));
    const out = visibleBase.slice();
    const seenNameKeys = new Set(visibleBase.map((item) => getPluginFamilyKey(item.name)).filter(Boolean));
    const usedIds = new Set(visibleBase.map((item) => String(item.id || "")).filter(Boolean));

    for (const item of addedList) {
      if (!item || typeof item !== "object") continue;
      const nameKey = getPluginFamilyKey(item.name);
      if (!nameKey || seenNameKeys.has(nameKey)) continue;

      let id = String(item.id || "").trim();
      if (!id) {
        id = generatePluginId(item.name, usedIds);
      } else if (usedIds.has(id)) {
        id = generatePluginId(item.name || id, usedIds);
      } else {
        usedIds.add(id);
      }

      out.push({
        id,
        name: String(item.name || "").trim(),
        category: CATEGORIES.includes(item.category) ? item.category : "Misc",
        vendor: String(item.vendor || "").trim() || "Unknown",
        purpose: String(item.purpose || "").trim(),
        features: Array.isArray(item.features)
          ? item.features.map((value) => cleanupFeatureDisplayText(value)).filter(Boolean)
          : []
      });

      seenNameKeys.add(nameKey);
    }

    return out;
  }

  function normalizeAddedPlugins(list, baseList) {
    const baseNameSet = new Set(baseList.map((item) => getPluginFamilyKey(item.name)).filter(Boolean));
    const usedIds = new Set(baseList.map((item) => String(item.id || "")).filter(Boolean));
    const out = [];

    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const name = String(item.name || "").trim();
      if (!name) continue;

      const nameKey = getPluginFamilyKey(name);
      if (!nameKey || baseNameSet.has(nameKey)) continue;

      const id = generatePluginId(String(item.id || "").trim() || name, usedIds);
      const features = Array.isArray(item.features)
        ? item.features.map((value) => cleanupFeatureDisplayText(value)).filter(Boolean)
        : [];

      out.push({
        id,
        name,
        category: CATEGORIES.includes(item.category) ? item.category : "Misc",
        vendor: String(item.vendor || "").trim() || "Unknown",
        purpose: String(item.purpose || "").trim(),
        features
      });

      baseNameSet.add(nameKey);
    }

    return out;
  }

  function generatePluginId(seed, usedIds) {
    const used = usedIds instanceof Set ? usedIds : new Set();
    const base = String(seed || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "plugin";

    let candidate = base;
    let index = 2;
    while (used.has(candidate)) {
      candidate = `${base}-${index}`;
      index += 1;
    }
    used.add(candidate);
    return candidate;
  }

  function loadOverrides() {
    try {
      const raw = localStorage.getItem(OVERRIDES_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return {};
      }
      return parsed;
    } catch {
      return {};
    }
  }

  function applyOverrides(list) {
    const overrides = loadOverrides();

    return list.map((item) => {
      const override = overrides[item.id];
      if (!override || typeof override !== "object") {
        return item;
      }

      const next = { ...item };

      if (typeof override.name === "string" && override.name.trim()) {
        next.name = override.name.trim();
      }

      if (typeof override.category === "string" && CATEGORIES.includes(override.category)) {
        next.category = override.category;
      }

      if (typeof override.vendor === "string" && override.vendor.trim()) {
        next.vendor = override.vendor.trim();
      }

      if (typeof override.purpose === "string" && override.purpose.trim()) {
        next.purpose = override.purpose.trim();
      }

      if (Array.isArray(override.features)) {
        const features = override.features.map((value) => cleanupFeatureDisplayText(value)).filter(Boolean);
        if (features.length > 0) {
          next.features = features;
        }
      }

      return next;
    });
  }

  function getSavedIdSet() {
    return new Set(state.saved.map((item) => item.id));
  }

  function getCards(category) {
    if (!category) return [];

    const savedSet = getSavedIdSet();
    return plugins.filter((item) => item.category === category && !savedSet.has(item.id));
  }

  function getCurrentIndex() {
    if (!state.category) return 0;
    const value = state.indexByCategory[state.category];
    return Number.isFinite(value) ? value : 0;
  }

  function setCurrentIndex(nextIndex) {
    if (!state.category) return;
    const cards = getCards(state.category);
    if (cards.length === 0) {
      state.indexByCategory[state.category] = 0;
      return;
    }

    const len = cards.length;
    const normalized = ((nextIndex % len) + len) % len;
    state.indexByCategory[state.category] = normalized;
  }

  function getCurrentStack() {
    const cards = getCards(state.category);

    if (cards.length === 0) {
      state.indexByCategory[state.category] = 0;
      return {
        cards,
        index: 0,
        current: null,
        next: null
      };
    }

    let index = getCurrentIndex();
    index = ((index % cards.length) + cards.length) % cards.length;
    state.indexByCategory[state.category] = index;

    return {
      cards,
      index,
      current: cards[index],
      next: cards.length > 1 ? cards[(index + 1) % cards.length] : null
    };
  }

  function renderCategories() {
    const counts = Object.fromEntries(CATEGORIES.map((category) => [category, 0]));
    const savedSet = getSavedIdSet();

    for (const item of plugins) {
      if (savedSet.has(item.id)) continue;
      if (counts[item.category] !== undefined) {
        counts[item.category] += 1;
      }
    }

    categoryView.innerHTML = `
      <div class="category-header">
        <h2>選擇分類</h2>
        <a class="btn ghost" href="./editor.html">設定頁</a>
      </div>
      <div class="category-grid">
        ${CATEGORIES.map((category) => `
          <button class="category-btn" data-category="${category}">
            <strong>${category}</strong>
            <p>${counts[category]} 張卡片</p>
          </button>
        `).join("")}
      </div>
      <section class="category-search-panel" aria-label="搜尋插件">
        <h3 class="category-search-title">搜尋插件</h3>
        <div class="category-search-controls">
          <input
            id="category-search-input"
            class="category-search-input"
            type="search"
            placeholder="輸入關鍵字（名稱 / 品牌 / 分類）"
            value="${escapeHtml(state.categorySearch.keyword)}"
          />
          <label class="inline-check category-search-toggle">
            <input id="category-search-include-desc" type="checkbox" ${state.categorySearch.includeDescription ? "checked" : ""} />
            搜尋敘述內容（功能 / 特點）
          </label>
        </div>
        <div id="category-search-result" class="category-search-result"></div>
      </section>
    `;

    categoryView.querySelectorAll(".category-btn").forEach((el) => {
      el.addEventListener("click", () => {
        state.category = el.getAttribute("data-category");
        state.indexByCategory[state.category] = 0;
        showSwipe();
      });
    });

    const searchInput = categoryView.querySelector("#category-search-input");
    const includeDescInput = categoryView.querySelector("#category-search-include-desc");
    const resultEl = categoryView.querySelector("#category-search-result");
    const searchablePool = buildCategorySearchPool();

    const renderSearchResults = () => {
      if (!searchInput || !includeDescInput || !resultEl) return;

      const keyword = String(state.categorySearch.keyword || "").trim();
      if (!keyword) {
        resultEl.innerHTML = "";
        return;
      }

      const query = keyword.toLowerCase();
      const includeDescription = Boolean(state.categorySearch.includeDescription);

      const results = searchablePool.filter((item) => {
        if (item.basicText.includes(query)) return true;
        if (includeDescription && item.descriptionText.includes(query)) return true;
        return false;
      });

      if (results.length === 0) {
        resultEl.innerHTML = `<div class="category-search-empty">找不到插件</div>`;
        return;
      }

      resultEl.innerHTML = results
        .map((item) => `
          <button
            class="category-search-item"
            type="button"
            data-action="jump-search-result"
            data-category="${escapeHtml(item.category)}"
            data-index="${item.indexInCategory}"
          >
            <span class="category-search-main">${escapeHtml(item.name || "")}</span>
            <span class="category-search-meta">${escapeHtml(item.vendor || "Unknown")} · ${escapeHtml(item.category || "")}</span>
          </button>
        `)
        .join("");
    };

    if (searchInput) {
      searchInput.addEventListener("input", () => {
        state.categorySearch.keyword = searchInput.value || "";
        renderSearchResults();
      });
    }

    if (includeDescInput) {
      includeDescInput.addEventListener("change", () => {
        state.categorySearch.includeDescription = includeDescInput.checked;
        renderSearchResults();
      });
    }

    if (resultEl) {
      resultEl.addEventListener("click", onCategorySearchResultClick);
    }

    renderSearchResults();
  }

  function buildCategorySearchPool() {
    const out = [];

    for (const category of CATEGORIES) {
      const cards = getCards(category);
      cards.forEach((plugin, indexInCategory) => {
        const features = Array.isArray(plugin.features) ? plugin.features : [];
        out.push({
          pluginId: plugin.id,
          category,
          indexInCategory,
          name: String(plugin.name || ""),
          vendor: String(plugin.vendor || "Unknown"),
          basicText: [
            plugin.name || "",
            plugin.vendor || "",
            plugin.category || ""
          ].join("\n").toLowerCase(),
          descriptionText: [
            plugin.purpose || "",
            ...features
          ].join("\n").toLowerCase()
        });
      });
    }

    return out;
  }

  function onCategorySearchResultClick(event) {
    const btn = event.target.closest("button[data-action='jump-search-result']");
    if (!btn) return;

    const category = btn.getAttribute("data-category") || "";
    const index = Number(btn.getAttribute("data-index"));
    if (!category || !Number.isFinite(index)) return;

    state.category = category;
    setCurrentIndex(index);
    showSwipe();
  }

  function showCategories() {
    resetDragState();
    categoryView.classList.remove("hidden");
    swipeView.classList.add("hidden");
    savedView.classList.add("hidden");
    swipeHeaderActions.classList.add("hidden");
    swipeStatus.textContent = "";

    renderCategories();
  }

  function showSwipe() {
    if (!state.category) {
      showCategories();
      return;
    }

    resetDragState();
    categoryView.classList.add("hidden");
    swipeView.classList.remove("hidden");
    savedView.classList.add("hidden");
    swipeHeaderActions.classList.remove("hidden");

    renderSwipeDeck();
  }

  function showSaved() {
    resetDragState();
    categoryView.classList.add("hidden");
    swipeView.classList.add("hidden");
    savedView.classList.remove("hidden");
    swipeHeaderActions.classList.add("hidden");

    renderSavedList();
  }

  function renderSavedList() {
    savedCount.textContent = `共 ${state.saved.length} 個插件`;

    if (state.saved.length === 0) {
      savedList.innerHTML = `<div class="empty-state"><h3>尚未儲存插件</h3><p>在滑卡頁按「儲存」即可加入。</p></div>`;
      return;
    }

    savedList.innerHTML = state.saved
      .map((item) => {
        const features = Array.isArray(item.features) ? item.features : [];
        const imageStyle = buildSavedImageStyle(item);

        return `
          <article class="saved-item">
            <div class="saved-image"${imageStyle}></div>
            <div class="saved-head">
              <h3>${escapeHtml(item.name || "")}</h3>
              <div class="saved-actions">
                <button class="btn ghost mini" type="button" data-action="copy-saved-name" data-name="${escapeHtml(item.name || "")}">複製</button>
                <button class="btn pass mini" type="button" data-action="remove-saved" data-id="${escapeHtml(item.id || "")}">刪除</button>
              </div>
            </div>
            <p class="saved-meta">分類：${escapeHtml(item.category || "")}</p>
            <p class="saved-meta">品牌：${escapeHtml(item.vendor || "Unknown")}</p>
            <p class="field-text purpose-text">${escapeHtml(item.purpose || "")}</p>
            <ul class="feature-list">
              ${features.map((feature) => renderFeatureItem(feature)).join("")}
            </ul>
          </article>
        `;
      })
      .join("");
  }
  function renderSwipeDeck() {
    const { cards, index, current, next } = getCurrentStack();

    renderDesktopPluginList(cards, index);

    if (!current) {
      deck.innerHTML = "";
      swipeEmpty.classList.remove("hidden");
      swipeStatus.textContent = "0/0";
      return;
    }

    const counterText = `${index + 1}/${cards.length}`;

    swipeEmpty.classList.add("hidden");
    swipeStatus.textContent = counterText;

    deck.innerHTML = `
      ${next ? renderCard(next, "card-next") : ""}
      ${renderCard(current, "card-top", counterText)}
    `;

    const topCard = deck.querySelector(".card-top");
    if (!topCard) return;

    topCard.addEventListener("pointerdown", onPointerDown);
    topCard.addEventListener("pointermove", onPointerMove);
    topCard.addEventListener("pointerup", onPointerUp);
    topCard.addEventListener("pointercancel", onPointerCancel);
  }

  function renderDesktopPluginList(cards, activeIndex) {
    if (!desktopPluginList) return;

    if (!cards || cards.length === 0) {
      desktopPluginList.innerHTML = `<div class="desktop-plugin-empty">${escapeHtml(state.category || "")} 沒有可顯示卡片</div>`;
      return;
    }

    desktopPluginList.innerHTML = cards
      .map((item, idx) => {
        const activeClass = idx === activeIndex ? "active" : "";
        return `
          <button class="desktop-plugin-item ${activeClass}" type="button" data-action="jump-card" data-index="${idx}">
            <span class="desktop-plugin-order">${idx + 1}</span>
            <span class="desktop-plugin-name">${escapeHtml(item.name || "")}</span>
          </button>
        `;
      })
      .join("");
  }

  function renderCard(card, className, counterText = "") {
    const features = Array.isArray(card.features) ? card.features : [];
    const coverStyle = buildCoverStyle(card);

    return `
      <article class="card swipe-card ${className}" data-id="${escapeHtml(card.id)}">
        ${counterText ? `<span class="card-counter">${escapeHtml(counterText)}</span>` : ""}
        <header class="card-cover"${coverStyle}>
          <span class="cover-chip">${escapeHtml(state.category || "")}</span>
          <div class="cover-title-row">
            <h3 class="cover-name">${escapeHtml(card.name || "")}</h3>
            <button class="btn ghost mini name-copy-btn" type="button" data-action="copy-name" data-name="${escapeHtml(card.name || "")}">複製</button>
          </div>
        </header>
        <div class="card-body">
          <p class="field-label">品牌</p>
          <p class="field-text">${escapeHtml(card.vendor || "Unknown")}</p>

          <p class="field-label">功能</p>
          <p class="field-text purpose-text">${escapeHtml(card.purpose || "")}</p>

          <p class="field-label">特點</p>
          <ul class="feature-list">
            ${features.map((item) => renderFeatureItem(item)).join("")}
          </ul>
        </div>
      </article>
    `;
  }

  function saveCurrentCard() {
    const { index, current } = getCurrentStack();
    if (!current) {
      return;
    }

    const exists = state.saved.some((item) => item.id === current.id);
    if (exists) {
      return;
    }

    state.saved.push({
      id: current.id,
      name: current.name,
      category: current.category,
      vendor: current.vendor,
      purpose: current.purpose,
      features: Array.isArray(current.features) ? current.features.slice() : [],
      savedAt: Date.now()
    });

    saveSaved();
    renderCategories();

    setCurrentIndex(index);
    renderSwipeDeck();
  }

  function onDeckClick(event) {
    const btn = event.target.closest("button[data-action='copy-name']");
    if (!btn) return;

    event.preventDefault();
    event.stopPropagation();

    const name = btn.getAttribute("data-name") || "";
    copyText(name);
  }

  function onDesktopPluginListClick(event) {
    const btn = event.target.closest("button[data-action='jump-card']");
    if (!btn || !state.category) return;

    const index = Number(btn.getAttribute("data-index"));
    if (!Number.isFinite(index)) return;

    setCurrentIndex(index);
    renderSwipeDeck();
  }

  function onSavedListClick(event) {
    const copyBtn = event.target.closest("button[data-action='copy-saved-name']");
    if (copyBtn) {
      const name = copyBtn.getAttribute("data-name") || "";
      copyText(name);
      savedCount.textContent = `已複製：${name}`;
      return;
    }

    const removeBtn = event.target.closest("button[data-action='remove-saved']");
    if (!removeBtn) return;

    const id = removeBtn.getAttribute("data-id") || "";
    if (!id) return;

    const before = state.saved.length;
    state.saved = state.saved.filter((item) => item.id !== id);
    if (state.saved.length === before) return;

    saveSaved();
    renderSavedList();
    renderCategories();

    if (state.category) {
      renderSwipeDeck();
    }
  }
  function onPointerDown(event) {
    if (state.animating) return;
    if (event.target.closest("button[data-action='copy-name']")) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;

    const card = event.currentTarget;
    state.drag.active = true;
    state.drag.pointerId = event.pointerId;
    state.drag.startX = event.clientX;
    state.drag.startY = event.clientY;
    state.drag.x = 0;
    state.drag.axisLock = null;
    state.drag.pendingX = 0;
    state.drag.renderX = 0;
    state.drag.captured = false;
    state.drag.card = card;
  }

  function onPointerMove(event) {
    if (!state.drag.active || state.drag.pointerId !== event.pointerId || state.animating) {
      return;
    }

    const card = state.drag.card || event.currentTarget;
    const dx = event.clientX - state.drag.startX;
    const dy = event.clientY - state.drag.startY;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    if (!state.drag.axisLock) {
      if (absDx < DRAG_LOCK_THRESHOLD && absDy < DRAG_LOCK_THRESHOLD) {
        return;
      }

      if (absDx > absDy * DRAG_AXIS_RATIO) {
        state.drag.axisLock = "x";
        card.style.transition = "transform 0ms";
        card.classList.add("dragging");
        document.body.classList.add("is-swiping");

        if (!state.drag.captured) {
          try {
            card.setPointerCapture(event.pointerId);
            state.drag.captured = true;
          } catch {
            // ignore capture errors
          }
        }
      } else if (absDy > absDx * DRAG_AXIS_RATIO) {
        state.drag.axisLock = "y";
      } else {
        return;
      }
    }

    if (state.drag.axisLock !== "x") {
      return;
    }

    event.preventDefault();
    state.drag.x = dx;
    state.drag.pendingX = absDx <= DRAG_DEAD_ZONE ? 0 : dx;
    queueDragFrame();
  }

  function onPointerUp(event) {
    if (!state.drag.active || state.drag.pointerId !== event.pointerId || state.animating) {
      return;
    }

    const card = state.drag.card || event.currentTarget;
    releaseCapturedPointer(card, event.pointerId);
    if (state.drag.rafId) {
      window.cancelAnimationFrame(state.drag.rafId);
      state.drag.rafId = null;
    }

    const axisLock = state.drag.axisLock;
    const x = state.drag.x;
    resetDragState();

    if (axisLock !== "x") {
      card.style.transition = "transform 170ms ease, opacity 170ms ease";
      card.style.transform = "translate3d(0, 0, 0) rotate(0deg)";
      return;
    }

    if (x > SWIPE_THRESHOLD) {
      animateCardOut(card, "next", 1);
      return;
    }

    if (x < -SWIPE_THRESHOLD) {
      animateCardOut(card, "prev", -1);
      return;
    }

    resetCardPosition(card);
  }

  function onPointerCancel(event) {
    const card = state.drag.card || event.currentTarget;
    if (state.drag.active && state.drag.pointerId === event.pointerId) {
      releaseCapturedPointer(card, event.pointerId);
    }

    resetDragState();
    resetCardPosition(card);
  }

  function queueDragFrame() {
    if (state.drag.rafId) return;
    state.drag.rafId = window.requestAnimationFrame(runDragFrame);
  }

  function runDragFrame() {
    state.drag.rafId = null;
    if (!state.drag.active || state.drag.axisLock !== "x" || !state.drag.card) {
      return;
    }

    const nextX = state.drag.pendingX;
    const currentX = state.drag.renderX;
    const smoothedX = currentX + (nextX - currentX) * DRAG_SMOOTHING;
    const finalX = Math.abs(nextX - smoothedX) < 0.35 ? nextX : smoothedX;

    state.drag.renderX = finalX;
    applyCardTransform(state.drag.card, finalX);

    if (Math.abs(nextX - finalX) > 0.35) {
      queueDragFrame();
    }
  }

  function releaseCapturedPointer(card, pointerId) {
    if (!state.drag.captured) return;
    try {
      if (card && card.hasPointerCapture(pointerId)) {
        card.releasePointerCapture(pointerId);
      }
    } catch {
      // ignore release errors
    }
  }

  function applyCardTransform(card, x) {
    const rotate = clamp((x / 260) * SWIPE_OUT_ROTATE, -SWIPE_OUT_ROTATE, SWIPE_OUT_ROTATE);
    card.style.transform = `translate3d(${x}px, 0, 0) rotate(${rotate}deg)`;
  }

  function resetCardPosition(card) {
    if (!card) return;
    card.classList.remove("dragging");
    card.style.transition = "transform 170ms ease";
    card.style.transform = "translate3d(0, 0, 0) rotate(0deg)";

    window.setTimeout(() => {
      card.style.transition = "transform 170ms ease, opacity 170ms ease";
      card.classList.remove("dragging");
      document.body.classList.remove("is-swiping");
    }, 170);
  }

  function animateCardOut(card, action, direction) {
    state.animating = true;
    card.classList.remove("dragging");
    card.style.transition = "transform 180ms ease, opacity 180ms ease";
    card.style.opacity = "0.2";
    card.style.transform = `translate3d(${direction * SWIPE_OUT_X}px, -20px, 0) rotate(${direction * SWIPE_OUT_ROTATE}deg)`;

    window.setTimeout(() => {
      applySwipeAction(action);
      state.animating = false;
      renderSwipeDeck();
    }, 180);
  }

  function applySwipeAction(action) {
    const { cards, index } = getCurrentStack();
    if (cards.length === 0) {
      return;
    }

    if (action === "next") {
      setCurrentIndex(index + 1);
      return;
    }

    if (action === "prev") {
      setCurrentIndex(index - 1);
    }
  }

  function resetDragState() {
    if (state.drag.rafId) {
      window.cancelAnimationFrame(state.drag.rafId);
    }

    document.body.classList.remove("is-swiping");
    state.drag.active = false;
    state.drag.pointerId = null;
    state.drag.startX = 0;
    state.drag.startY = 0;
    state.drag.x = 0;
    state.drag.axisLock = null;
    state.drag.rafId = null;
    state.drag.pendingX = 0;
    state.drag.captured = false;
    state.drag.card = null;
    state.drag.renderX = 0;
  }


  function buildCoverStyle(card) {
    const imagePath = pluginImages && card ? pluginImages[card.id] : "";
    if (!imagePath) {
      return "";
    }

    const safePath = escapeHtml(String(imagePath));
    return ` style="--cover-image: url('${safePath}');"`;
  }

  function buildSavedImageStyle(card) {
    const imagePath = pluginImages && card ? pluginImages[card.id] : "";
    if (!imagePath) {
      return "";
    }

    const safePath = escapeHtml(String(imagePath));
    return ` style="--saved-image: url('${safePath}');"`;
  }

  function cleanupFeatureDisplayText(input) {
    return String(input || "")
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/__(.*?)__/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\*\*/g, "")
      .replace(/__/g, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  function renderFeatureItem(input) {
    const text = cleanupFeatureDisplayText(input);
    if (!text) {
      return "";
    }

    const match = text.match(/^(.+?)\s*[:：]\s*([\s\S]*)$/);
    if (!match) {
      return `<li>${escapeHtml(text)}</li>`;
    }

    const title = escapeHtml(match[1].trim());
    const descRaw = cleanupFeatureDisplayText(match[2] || "");

    if (!descRaw) {
      return `<li><span class="feature-title">${title}：</span></li>`;
    }

    const desc = escapeHtml(descRaw);
    return `<li><span class="feature-title">${title}：</span><span class="feature-desc">${desc}</span></li>`;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
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

  function escapeHtml(input) {
    return String(input || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
})();













