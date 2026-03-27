(() => {
  const CATEGORIES = ["Space", "Saturation", "Dynamic", "Frequency", "Synthesizer", "Modulation", "Misc"];
  const OVERRIDES_KEY = "vstinder.simple.overrides.v1";
  const SAVED_KEY = "vstinder.simple.saved.v1";
  const SWIPE_THRESHOLD = 110;
  const SWIPE_OUT_X = 620;
  const SWIPE_OUT_ROTATE = 22;

  const rawPlugins = Array.isArray(window.VSTINDER_PLUGINS) ? window.VSTINDER_PLUGINS : [];
  const basePlugins = dedupeArchitectureVariants(rawPlugins);
  const pluginImages = window.VSTINDER_PLUGIN_IMAGES || {};
  const plugins = applyOverrides(basePlugins);
  const basePluginIdSet = new Set(basePlugins.map((item) => String(item.id || "")));

  const state = {
    category: null,
    indexByCategory: {},
    saved: loadSaved(),
    drag: {
      active: false,
      pointerId: null,
      startX: 0,
      x: 0
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

  document.getElementById("back-to-categories").addEventListener("click", showCategories);
  document.getElementById("save-current").addEventListener("click", saveCurrentCard);
  document.getElementById("open-saved").addEventListener("click", showSaved);
  document.getElementById("back-to-swipe").addEventListener("click", showSwipe);
  document.getElementById("back-to-categories-from-saved").addEventListener("click", showCategories);

  deck.addEventListener("click", onDeckClick);
  savedList.addEventListener("click", onSavedListClick);

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
    `;

    categoryView.querySelectorAll(".category-btn").forEach((el) => {
      el.addEventListener("click", () => {
        state.category = el.getAttribute("data-category");
        state.indexByCategory[state.category] = 0;
        showSwipe();
      });
    });
  }

  function showCategories() {
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

    categoryView.classList.add("hidden");
    swipeView.classList.remove("hidden");
    savedView.classList.add("hidden");
    swipeHeaderActions.classList.remove("hidden");

    renderSwipeDeck();
  }

  function showSaved() {
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

    const card = event.currentTarget;
    card.classList.add("dragging");

    state.drag.active = true;
    state.drag.pointerId = event.pointerId;
    state.drag.startX = event.clientX;
    state.drag.x = 0;

    card.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event) {
    if (!state.drag.active || state.drag.pointerId !== event.pointerId || state.animating) {
      return;
    }

    const dx = event.clientX - state.drag.startX;
    state.drag.x = dx;
    applyCardTransform(event.currentTarget, dx);
  }

  function onPointerUp(event) {
    if (!state.drag.active || state.drag.pointerId !== event.pointerId || state.animating) {
      return;
    }

    const card = event.currentTarget;
    try {
      card.releasePointerCapture(event.pointerId);
    } catch {
      // ignore
    }

    const x = state.drag.x;
    resetDragState();

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
    const card = event.currentTarget;
    if (state.drag.active && state.drag.pointerId === event.pointerId) {
      try {
        card.releasePointerCapture(event.pointerId);
      } catch {
        // ignore
      }
    }

    resetDragState();
    resetCardPosition(card);
  }

  function applyCardTransform(card, x) {
    const rotate = (x / 240) * SWIPE_OUT_ROTATE;
    card.style.transform = `translate3d(${x}px, 0, 0) rotate(${rotate}deg)`;

    const likeBadge = card.querySelector('[data-badge="like"]');
    const passBadge = card.querySelector('[data-badge="pass"]');

    const likeOpacity = clamp((x - 30) / 120, 0, 1);
    const passOpacity = clamp((-x - 30) / 120, 0, 1);

    if (likeBadge) likeBadge.style.opacity = String(likeOpacity);
    if (passBadge) passBadge.style.opacity = String(passOpacity);
  }

  function resetCardPosition(card) {
    card.classList.remove("dragging");
    card.style.transition = "transform 170ms ease";
    card.style.transform = "translate3d(0, 0, 0) rotate(0deg)";

    const likeBadge = card.querySelector('[data-badge="like"]');
    const passBadge = card.querySelector('[data-badge="pass"]');
    if (likeBadge) likeBadge.style.opacity = "0";
    if (passBadge) passBadge.style.opacity = "0";

    window.setTimeout(() => {
      card.style.transition = "transform 170ms ease, opacity 170ms ease";
      card.classList.remove("dragging");
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
    state.drag.active = false;
    state.drag.pointerId = null;
    state.drag.startX = 0;
    state.drag.x = 0;
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










