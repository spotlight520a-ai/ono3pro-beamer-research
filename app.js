(function () {
  "use strict";

  const DATA = window.BSR_DATA;
  const AUDIT = window.BSR_AUDIT;
  const STORAGE_KEY = "beamer-scout-state-v1";
  const DRAFT_KEY = "beamer-scout-draft-v1";
  const SCHEMA_VERSION = 1;
  const MAX_COMPARE = 4;
  const MAX_VERSIONS = 160;

  if (!DATA || !Array.isArray(DATA.products)) {
    document.body.innerHTML =
      '<main style="padding:48px;font-family:sans-serif"><h1>数据没有加载</h1><p>请确认 data/app-data.js 与 index.html 位于同一工具文件夹内。</p></main>';
    return;
  }

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const clone = (value) =>
    typeof structuredClone === "function"
      ? structuredClone(value)
      : JSON.parse(JSON.stringify(value));

  const escapeHTML = (value) =>
    String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  const escapeAttr = escapeHTML;
  const numberFormat = new Intl.NumberFormat("de-DE");
  const priceFormat = new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
  });
  const dateTimeFormat = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const defaultState = () => ({
    schema: SCHEMA_VERSION,
    working: {},
    versions: [],
    imageAssets: {},
    updatedAt: null,
  });

  function loadState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (!parsed || typeof parsed !== "object") return defaultState();
      return {
        schema: SCHEMA_VERSION,
        working:
          parsed.working && typeof parsed.working === "object"
            ? parsed.working
            : {},
        versions: Array.isArray(parsed.versions) ? parsed.versions : [],
        imageAssets:
          parsed.imageAssets && typeof parsed.imageAssets === "object"
            ? sanitizeImageAssets(parsed.imageAssets)
            : {},
        updatedAt: parsed.updatedAt || null,
      };
    } catch (error) {
      console.warn("Failed to read local state", error);
      return defaultState();
    }
  }

  function sanitizeImageAssets(assets) {
    const output = {};
    for (const [key, value] of Object.entries(assets || {})) {
      if (typeof value === "string" && /^data:image\//i.test(value)) {
        output[key] = value;
      }
    }
    return output;
  }

  let state = loadState();
  const baseByAsin = new Map(DATA.products.map((product) => [product.asin, product]));
  const ui = {
    query: "",
    brand: "",
    price: "",
    system: "",
    sort: "rank",
    selected: new Set(),
  };
  const detail = {
    asin: null,
    tab: "overview",
    working: null,
    dirty: false,
    returnFocus: null,
  };

  function deepEqual(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  function trimText(value, length = 100) {
    const text = String(value ?? "").replace(/\s+/g, " ").trim();
    return text.length > length ? `${text.slice(0, length - 1)}…` : text;
  }

  function debounce(fn, delay) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  }

  function createId(prefix = "id") {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function modelOf(product) {
    const fromLive = product.live?.modelNumber;
    if (fromLive) return fromLive.replace(/^ONO3\s+Pro$/i, "ONO3Pro");
    const title = product.content?.titleZh || product.sourceTitle || "";
    return title.split(/[：:]/)[0].replace(product.brand, "").trim();
  }

  function cleanSpecValue(value) {
    return String(value || "—")
      .replace(/\s+/g, " ")
      .replace(/_/g, " ")
      .trim();
  }

  function specOf(product, label, working = null) {
    return cleanSpecValue(
      product.keySpecs.find((item) => item.label === label)?.value || "—",
    );
  }

  function numericSpec(product, label) {
    const raw = specOf(product, label);
    const match = raw.match(/[\d.,]+/);
    if (!match) return 0;
    return Number(match[0].replace(/\./g, "").replace(",", ".")) || 0;
  }

  function systemOf(product) {
    const originalFeatures = (product.live?.features || []).slice(0, 6).join(" ");
    const text = [
      product.sourceTitle,
      product.content?.titleZh,
      product.content?.positioning,
      ...(product.content?.highlights || []),
      ...(product.listingBullets || []).map((item) => item.original),
      originalFeatures,
    ]
      .join(" ")
      .toLowerCase();

    if (/google\s*tv|google assistant/.test(text)) return "Google TV";
    if (/android\s*tv/.test(text)) return "Android TV";
    if (
      /linux|movin|integriertes betriebssystem|integrated operating system|vid[ae]a|whale\s*os/.test(
        text,
      )
    ) {
      return "Linux 智能系统";
    }
    if (
      product.brand === "BenQ" ||
      /(geschäft|business|meeting|dlp).*(projektor|beamer)/i.test(text)
    ) {
      return "非智能 / 商用";
    }
    if (/smart|netflix|prime video|youtube|streaming/.test(text)) {
      return "其他智能系统";
    }
    return "非智能 / 商用";
  }

  function systemClass(system) {
    if (system === "非智能 / 商用") return "is-business";
    if (system === "其他智能系统") return "is-other";
    return "";
  }

  function makeWorking(product) {
    return {
      content: {
        titleZh: product.content.titleZh || "",
        positioning: product.content.positioning || "",
        highlights: [...(product.content.highlights || [])],
        bulletTranslations: [...(product.content.bulletTranslations || [])],
      },
      listingBullets: clone(product.listingBullets || []).map((item) => ({
        index: item.index,
        label: item.label || "",
        original: item.original || "",
      })),
      imageMeta: {
        listing: (product.images.listing || []).map((image) => ({
          id: `base-listing-${image.index}`,
          sourceIndex: image.index,
          role: image.role || "",
          hidden: false,
          ocrText: image.ocrText || "",
          sellingPoint: image.sellingPoint || "",
          replacementAssetId: null,
        })),
        aplus: (product.images.aplus || []).map((image) => ({
          id: `base-aplus-${image.index}`,
          sourceIndex: image.index,
          role: image.role || "",
          hidden: false,
          ocrText: image.ocrText || "",
          sellingPoint: image.sellingPoint || "",
          replacementAssetId: null,
        })),
      },
      customImages: { listing: [], aplus: [] },
      status: { favorite: false, review: false },
      notes: "",
    };
  }

  function normalizeWorking(product, source) {
    const base = makeWorking(product);
    const working = clone(source || base);
    working.content = {
      ...base.content,
      ...(working.content || {}),
      highlights: Array.isArray(working.content?.highlights)
        ? working.content.highlights
        : base.content.highlights,
      bulletTranslations: Array.isArray(working.content?.bulletTranslations)
        ? working.content.bulletTranslations
        : base.content.bulletTranslations,
    };
    working.listingBullets = Array.isArray(working.listingBullets)
      ? working.listingBullets
      : base.listingBullets;
    working.imageMeta = working.imageMeta || {};

    for (const kind of ["listing", "aplus"]) {
      const existing = Array.isArray(working.imageMeta[kind])
        ? working.imageMeta[kind]
        : [];
      working.imageMeta[kind] = base.imageMeta[kind].map((defaults) => {
        const saved = existing.find(
          (item) => String(item.sourceIndex) === String(defaults.sourceIndex),
        );
        return {
          ...defaults,
          ...(saved || {}),
          hidden: Boolean(saved?.hidden),
          replacementAssetId:
            typeof saved?.replacementAssetId === "string" &&
            state.imageAssets[saved.replacementAssetId]
              ? saved.replacementAssetId
              : null,
        };
      });
      working.customImages = working.customImages || {};
      working.customImages[kind] = Array.isArray(
        working.customImages[kind],
      )
        ? working.customImages[kind].filter((item) =>
            Boolean(state.imageAssets[item.assetId]),
          )
        : [];
    }
    working.status = {
      favorite: Boolean(working.status?.favorite),
      review: Boolean(working.status?.review),
    };
    working.notes = String(working.notes || "");
    return working;
  }

  function workingForView(product) {
    return normalizeWorking(product, state.working[product.asin]);
  }

  function productView(product) {
    return { ...product, working: workingForView(product) };
  }

  function imageSource(image) {
    if (image.displayUrl && /^data:image\//i.test(image.displayUrl)) {
      return image.displayUrl;
    }
    if (
      image.localPath &&
      !image.localPath.includes("..") &&
      /^assets\/images\//.test(image.localPath)
    ) {
      return `./${image.localPath}`;
    }
    return "";
  }

  function imagesFor(product, working, kind) {
    const baseImages = product.images[kind] || [];
    const baseItems = (working.imageMeta[kind] || []).map((meta) => {
      const base = baseImages.find(
        (image) => String(image.index) === String(meta.sourceIndex),
      );
      const replacement = meta.replacementAssetId
        ? state.imageAssets[meta.replacementAssetId]
        : "";
      return {
        ...(base || {}),
        ...meta,
        id: meta.id || `base-${kind}-${meta.sourceIndex}`,
        origin: "base",
        displayUrl: replacement || imageSource(base || {}),
        isReplaced: Boolean(replacement),
        localPath: base?.localPath || "",
        sourceWidth: base?.sourceWidth,
        sourceHeight: base?.sourceHeight,
      };
    });
    const customItems = (working.customImages[kind] || []).map((item) => ({
      ...item,
      id: item.id || createId(`${kind}-custom`),
      origin: "custom",
      displayUrl: state.imageAssets[item.assetId] || "",
      hidden: false,
      isReplaced: false,
      categories: item.categories?.length ? item.categories : ["自建"],
    }));
    return [...baseItems, ...customItems];
  }

  function primaryImage(product, working) {
    const images = imagesFor(product, working, "listing");
    return images.find((image) => !image.hidden && image.displayUrl) || images[0];
  }

  function searchableText(product, working) {
    return [
      product.asin,
      product.brand,
      modelOf(product),
      product.sourceTitle,
      working.content.titleZh,
      working.content.positioning,
      ...working.content.highlights,
      ...working.listingBullets.flatMap((item) => [item.label, item.original]),
      ...product.keySpecs.flatMap((item) => [item.label, item.value]),
      systemOf(product),
    ]
      .join(" ")
      .toLowerCase();
  }

  function filteredProducts() {
    const query = ui.query.trim().toLowerCase();
    const list = DATA.products
      .map((product) => {
        const working = workingForView(product);
        return { product, working, system: systemOf(product) };
      })
      .filter(({ product, working, system }) => {
        if (ui.brand && product.brand !== ui.brand) return false;
        if (ui.system && system !== ui.system) return false;
        if (ui.price) {
          const [min, max] = ui.price.split("-").map(Number);
          if (product.sourcePrice < min || product.sourcePrice > max) return false;
        }
        return !query || searchableText(product, working).includes(query);
      });

    const sorters = {
      rank: (a, b) =>
        Number(Boolean(b.product.manualFocus)) -
          Number(Boolean(a.product.manualFocus)) ||
        a.product.rank - b.product.rank,
      "price-asc": (a, b) => a.product.sourcePrice - b.product.sourcePrice,
      "price-desc": (a, b) => b.product.sourcePrice - a.product.sourcePrice,
      "rating-desc": (a, b) =>
        Number(b.product.live?.rating || b.product.metrics?.rating || 0) -
        Number(a.product.live?.rating || a.product.metrics?.rating || 0),
      "sales-desc": (a, b) =>
        Number(b.product.metrics?.monthlySales || 0) -
        Number(a.product.metrics?.monthlySales || 0),
    };
    list.sort(sorters[ui.sort] || sorters.rank);
    return list;
  }

  function initFilters() {
    const brandFilter = $("#brandFilter");
    const brands = [...new Set(DATA.products.map((product) => product.brand))].sort(
      (a, b) => a.localeCompare(b),
    );
    brandFilter.insertAdjacentHTML(
      "beforeend",
      brands
        .map(
          (brand) =>
            `<option value="${escapeAttr(brand)}">${escapeHTML(brand)}</option>`,
        )
        .join(""),
    );
  }

  function updateKpis() {
    const prices = DATA.products
      .map((product) => Number(product.sourcePrice))
      .sort((a, b) => a - b);
    const median =
      prices.length % 2
        ? prices[Math.floor(prices.length / 2)]
        : (prices[prices.length / 2 - 1] + prices[prices.length / 2]) / 2;
    $("#kpiProducts").textContent = DATA.meta.products;
    $("#kpiBrands").textContent = `${DATA.meta.brands} 个品牌 · 1 个自有基准`;
    $("#kpiMedianPrice").textContent = priceFormat.format(median);
    $("#kpiMedianNote").textContent =
      `${DATA.meta.products} 个产品含税参考价`;
    $("#kpiImages").textContent = numberFormat.format(
      DATA.meta.listingImages + DATA.meta.aplusImages,
    );
    $("#kpiImageBreakdown").textContent =
      `${DATA.meta.listingImages} 张 Listing + ${DATA.meta.aplusImages} 张 A+`;
    $("#kpiOcr").textContent = numberFormat.format(DATA.meta.ocrRecognized);
  }

  function productRowTemplate(entry) {
    const { product, working, system } = entry;
    const thumb = primaryImage(product, working);
    const imageURL = thumb ? imageSource(thumb) : "";
    const saved = Boolean(state.working[product.asin]);
    const favorite = working.status.favorite;
    const selected = ui.selected.has(product.asin);
    const rating = product.live?.rating || product.metrics?.rating || "—";
    const reviews = product.live?.reviewsCount || product.metrics?.reviews || "—";
    const specs = [
      ["亮度", specOf(product, "亮度")],
      ["分辨率", specOf(product, "原生分辨率")],
    ];
    const visibleImages = imagesFor(product, working, "listing").filter(
      (image) => !image.hidden,
    ).length;
    const visibleAplus = imagesFor(product, working, "aplus").filter(
      (image) => !image.hidden,
    ).length;
    return `
      <tr data-asin="${escapeAttr(product.asin)}" class="${selected ? "is-selected" : ""} ${product.manualFocus ? "is-own-product" : ""}" tabindex="0">
        <td class="check-cell">
          <input class="row-check" type="checkbox" aria-label="选择 ${escapeAttr(product.brand)} ${escapeAttr(product.asin)}" data-action="select-product" ${selected ? "checked" : ""} />
        </td>
        <td>
          <div class="product-cell">
            <span class="product-thumb">
              ${imageURL ? `<img src="${escapeAttr(imageURL)}" alt="" loading="lazy" />` : ""}
              ${favorite ? '<span class="favorite-mark" title="已收藏">★</span>' : ""}
            </span>
            <span class="product-name">
              <strong title="${escapeAttr(working.content.titleZh)}">${escapeHTML(working.content.titleZh)}${product.manualFocus ? '<span class="own-product-mark">自有产品</span>' : ""}${saved ? '<span class="edited-mark">已编辑</span>' : ""}</strong>
              <span>${escapeHTML(product.brand)} · ${escapeHTML(modelOf(product))} · ${escapeHTML(product.asin)}</span>
            </span>
          </div>
        </td>
        <td class="price-cell">
          <strong>${priceFormat.format(product.sourcePrice)}</strong>
          <span>含税参考价</span>
        </td>
        <td>
          <div class="spec-stack">
            <strong>${escapeHTML(specs[0][1])}</strong>
            <span>${escapeHTML(specs[1][1])}</span>
          </div>
        </td>
        <td><span class="system-pill ${systemClass(system)}">${escapeHTML(system)}</span></td>
        <td class="metric-cell">
          <strong><span class="rating-star">★</span> ${escapeHTML(rating)} <span>· ${escapeHTML(numberFormat.format(Number(String(reviews).replaceAll(".", "")) || reviews))} 评</span></strong>
          <span>${product.metrics?.monthlySales ? `近 30 天 ${escapeHTML(numberFormat.format(Number(product.metrics.monthlySales)))} 件` : "近 30 天销量未提供"}</span>
        </td>
        <td class="bsr-cell">
          <strong>#${escapeHTML(product.metrics?.subcategoryBsr || product.rank)}</strong>
          <span>大类 ${escapeHTML(product.metrics?.majorBsr || "—")}</span>
        </td>
        <td>
          <span class="asset-count">
            <span><strong>${visibleImages}</strong>Listing</span>
            <span><strong>${visibleAplus}</strong>A+</span>
          </span>
        </td>
        <td>
          <button class="row-open" type="button" data-action="open-detail" aria-label="打开详情">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"></path></svg>
          </button>
        </td>
      </tr>
    `;
  }

  function mobileCardTemplate(entry) {
    const { product, working, system } = entry;
    const thumb = primaryImage(product, working);
    const imageURL = thumb ? imageSource(thumb) : "";
    const selected = ui.selected.has(product.asin);
    return `
      <article class="product-mobile-card ${selected ? "is-selected" : ""} ${product.manualFocus ? "is-own-product" : ""}" data-asin="${escapeAttr(product.asin)}">
        <input class="compare-check" type="checkbox" aria-label="选择 ${escapeAttr(product.brand)} ${escapeAttr(product.asin)}" data-action="select-product" ${selected ? "checked" : ""} />
        <span class="mobile-thumb">${imageURL ? `<img src="${escapeAttr(imageURL)}" alt="" loading="lazy" />` : ""}</span>
        <div class="mobile-copy">
          <strong>${escapeHTML(working.content.titleZh)}${product.manualFocus ? '<span class="own-product-mark">自有产品</span>' : ""}</strong>
          <span class="mobile-sub">${escapeHTML(product.brand)} · ${escapeHTML(system)}</span>
          <div class="mobile-numbers">
            <span><strong>${priceFormat.format(product.sourcePrice)}</strong></span>
            <span>★ <strong>${escapeHTML(product.live?.rating || "—")}</strong></span>
            <span>#<strong>${escapeHTML(product.metrics?.subcategoryBsr || product.rank)}</strong></span>
          </div>
        </div>
        <button class="mobile-open" type="button" data-action="open-detail" aria-label="打开详情">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m9 5 7 7-7 7"></path></svg>
        </button>
      </article>
    `;
  }

  function renderCatalog() {
    const entries = filteredProducts();
    $("#productRows").innerHTML = entries.map(productRowTemplate).join("");
    $("#productCards").innerHTML = entries.map(mobileCardTemplate).join("");
    $("#resultSummary").textContent = `显示 ${entries.length} / ${DATA.products.length} 个产品`;
    $("#emptyState").hidden = entries.length > 0;
    $(".table-wrap").hidden = entries.length === 0;
    $("#productCards").hidden = entries.length === 0;
    updateSelectionUI();
  }

  function updateSelectionUI() {
    const count = ui.selected.size;
    $("#selectionCount").textContent = `已选 ${count} / ${MAX_COMPARE} 项`;
    $("#compareButton").disabled = count < 2;
    $("#compareButton").textContent = count < 2 ? "对比所选" : `对比 ${count} 项`;
  }

  function resetFilters() {
    ui.query = "";
    ui.brand = "";
    ui.price = "";
    ui.system = "";
    ui.sort = "rank";
    $("#searchInput").value = "";
    $("#brandFilter").value = "";
    $("#priceFilter").value = "";
    $("#systemFilter").value = "";
    $("#sortFilter").value = "rank";
    renderCatalog();
  }

  function bindCatalogEvents() {
    const onSearch = debounce(() => {
      ui.query = $("#searchInput").value;
      renderCatalog();
    }, 120);
    $("#searchInput").addEventListener("input", onSearch);
    $("#brandFilter").addEventListener("change", (event) => {
      ui.brand = event.target.value;
      renderCatalog();
    });
    $("#priceFilter").addEventListener("change", (event) => {
      ui.price = event.target.value;
      renderCatalog();
    });
    $("#systemFilter").addEventListener("change", (event) => {
      ui.system = event.target.value;
      renderCatalog();
    });
    $("#sortFilter").addEventListener("change", (event) => {
      ui.sort = event.target.value;
      renderCatalog();
    });
    $("#resetFilters").addEventListener("click", resetFilters);
    $("#emptyReset").addEventListener("click", resetFilters);
    $("#compareButton").addEventListener("click", openCompareModal);
    $("#exportTableButton").addEventListener("click", exportVisibleTable);
    $("#backupButton").addEventListener("click", openBackupModal);
    $("#backupImport").addEventListener("change", importBackup);
    $("#mobileMenuButton").addEventListener("click", () => {
      const menu = $("#mobileActionMenu");
      menu.hidden = !menu.hidden;
      $("#mobileMenuButton").setAttribute("aria-expanded", String(!menu.hidden));
    });
    $("#mobileActionMenu").addEventListener("click", (event) => {
      const button = event.target.closest("[data-mobile-action]");
      if (!button) return;
      $("#mobileActionMenu").hidden = true;
      $("#mobileMenuButton").setAttribute("aria-expanded", "false");
      if (button.dataset.mobileAction === "export-table") exportVisibleTable();
      if (button.dataset.mobileAction === "backup") openBackupModal();
    });

    $("#productRows").addEventListener("click", handleCatalogClick);
    $("#productRows").addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        const row = event.target.closest("tr[data-asin]");
        if (row && !event.target.closest("button, input")) {
          event.preventDefault();
          openDetail(row.dataset.asin);
        }
      }
    });
    $("#productCards").addEventListener("click", handleCatalogClick);
  }

  function handleCatalogClick(event) {
    const actionTarget = event.target.closest("[data-action]");
    const select = event.target.closest('[data-action="select-product"]');
    if (select) {
      const card = select.closest("[data-asin]");
      toggleSelection(card.dataset.asin, select.checked);
      return;
    }
    const card = event.target.closest("[data-asin]");
    if (actionTarget?.dataset.action === "open-detail" || card) {
      if (card) openDetail(card.dataset.asin);
    }
  }

  function toggleSelection(asin, checked) {
    if (checked && ui.selected.size >= MAX_COMPARE) {
      const input = $(`[data-asin="${CSS.escape(asin)}"] [data-action="select-product"]`);
      if (input) input.checked = false;
      showToast(`最多同时对比 ${MAX_COMPARE} 个产品`, "error");
      return;
    }
    if (checked) ui.selected.add(asin);
    else ui.selected.delete(asin);
    $$(`[data-asin="${CSS.escape(asin)}"]`).forEach((item) => {
      item.classList.toggle("is-selected", checked);
      const checkbox = $('[data-action="select-product"]', item);
      if (checkbox) checkbox.checked = checked;
    });
    updateSelectionUI();
  }

  function openDetail(asin) {
    const product = baseByAsin.get(asin);
    if (!product) return;
    detail.returnFocus = document.activeElement;
    detail.asin = asin;
    detail.tab = "overview";
    detail.dirty = false;
    const saved = state.working[asin];
    detail.working = normalizeWorking(product, saved || makeWorking(product));

    try {
      const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
      const latestSavedAt = state.versions
        .filter((version) => version.asin === asin)
        .sort((a, b) => String(b.at).localeCompare(String(a.at)))[0]?.at;
      if (
        draft?.asin === asin &&
        draft.working &&
        (!latestSavedAt || String(draft.at) > String(latestSavedAt))
      ) {
        detail.working = normalizeWorking(product, draft.working);
        detail.dirty = true;
        showToast("已恢复这个产品上次未保存的草稿");
      }
    } catch (error) {
      console.warn("Failed to restore draft", error);
    }

    $("#detailOverlay").hidden = false;
    document.body.classList.add("no-scroll");
    renderDetail();
    setTimeout(() => {
      if (!$("#detailOverlay").hidden) $("#detailClose").focus();
    }, 30);
  }

  function closeDetail(force = false) {
    if (!force && detail.dirty) {
      const leave = window.confirm(
        "还有未保存的修改。关闭后内容会保留为草稿，但不会进入版本记录。确定关闭吗？",
      );
      if (!leave) return;
    }
    $("#detailOverlay").hidden = true;
    document.body.classList.remove("no-scroll");
    if (detail.dirty && !force) saveDraft();
    try {
      const clean = new URL(window.location.href);
      clean.searchParams.delete("asin");
      clean.searchParams.delete("tab");
      clean.hash = "";
      window.history.replaceState(null, "", clean.href);
    } catch (error) {
      console.warn("Failed to update detail URL", error);
    }
    detail.asin = null;
    detail.working = null;
    detail.dirty = false;
    detail.returnFocus?.focus?.();
    renderCatalog();
  }

  function renderDetail() {
    const product = baseByAsin.get(detail.asin);
    const working = detail.working;
    if (!product || !working) return;
    renderDetailHeader(product, working);
    $$(".detail-tab").forEach((button) => {
      button.classList.toggle("active", button.dataset.tab === detail.tab);
    });
    $("#listingCount").textContent =
      imagesFor(product, working, "listing").filter((image) => !image.hidden)
        .length;
    $("#aplusCount").textContent =
      imagesFor(product, working, "aplus").filter((image) => !image.hidden)
        .length;
    $("#versionCount").textContent = versionsFor(product.asin).length;
    $("#detailBody").scrollTop = 0;
    $("#detailBody").innerHTML =
      detail.tab === "overview"
        ? overviewTemplate(product, working)
        : detail.tab === "copy"
          ? copyTemplate(product, working)
          : detail.tab === "specs"
            ? specsTemplate(product)
            : detail.tab === "listing"
              ? galleryTemplate(product, working, "listing")
              : detail.tab === "aplus"
                ? galleryTemplate(product, working, "aplus")
                : versionsTemplate(product, working);
    updateSaveState();
  }

  function renderDetailHeader(product, working) {
    const image = primaryImage(product, working);
    const imageURL = image ? imageSource(image) : "";
    $("#detailHeadingMedia").innerHTML = `
      <span class="heading-thumb">${imageURL ? `<img src="${escapeAttr(imageURL)}" alt="" />` : ""}</span>
    `;
    $("#detailRank").textContent = product.manualFocus
      ? `自有产品 · BSR #${product.rank}`
      : `BSR #${product.rank}`;
    $("#detailAsin").textContent = product.asin;
    const status = working.status.favorite
      ? "★ 已收藏"
      : working.status.review
        ? "待评估"
        : "未标记";
    $("#detailStatus").textContent = status;
    $("#detailTitle").textContent = working.content.titleZh;
    $("#detailPositioning").textContent = working.content.positioning;
  }

  function statusControlsTemplate(working) {
    return `
      <div class="status-controls">
        <button class="status-toggle ${working.status.favorite ? "active" : ""}" type="button" data-action="toggle-favorite">
          <span class="status-toggle-icon">★</span>
          <span><strong>重点产品</strong><small>收藏供内部评审</small></span>
        </button>
        <button class="status-toggle ${working.status.review ? "active" : ""}" type="button" data-action="toggle-review">
          <span class="status-toggle-icon">◷</span>
          <span><strong>待评估</strong><small>标记后续内容拆解</small></span>
        </button>
      </div>
    `;
  }

  function overviewTemplate(product, working) {
    const system = systemOf(product);
    const themes = product.aplusThemes
      .map(
        (theme) =>
          `<span class="theme-chip">${escapeHTML(theme.label)} <strong>${theme.count}</strong></span>`,
      )
      .join("");
    const rating = product.live?.rating || product.metrics?.rating || "—";
    const reviews =
      product.live?.reviewsCount || product.metrics?.reviews || "—";
    const imageCount = imagesFor(product, working, "listing").filter(
      (image) => !image.hidden,
    ).length;
    const aplusCount = imagesFor(product, working, "aplus").filter(
      (image) => !image.hidden,
    ).length;
    return `
      <div class="overview-grid">
        <div class="overview-stack">
          <section class="detail-section">
            <div class="section-heading">
              <div>
                <h3>内容定位</h3>
                <p>中文标题与一句话定位会同步到产品表格，便于快速扫读。</p>
              </div>
            </div>
            <label class="editor-label">
              <span>中文标题</span>
              <input class="text-input" data-edit-field="titleZh" value="${escapeAttr(working.content.titleZh)}" />
            </label>
            <label class="editor-label">
              <span>一句话定位</span>
              <textarea class="text-area" data-edit-field="positioning">${escapeHTML(working.content.positioning)}</textarea>
            </label>
          </section>

          <section class="detail-section">
            <div class="section-heading">
              <div>
                <h3>核心卖点提炼</h3>
                <p>根据五点、规格与图片文字重新组织，可直接替换为内部选品判断。</p>
              </div>
            </div>
            <div class="highlight-editor">
              ${working.content.highlights
                .map(
                  (highlight, index) => `
                    <div class="highlight-row">
                      <span class="highlight-index">${String(index + 1).padStart(2, "0")}</span>
                      <textarea class="text-area" data-edit-highlight="${index}" aria-label="卖点 ${index + 1}">${escapeHTML(highlight)}</textarea>
                    </div>
                  `,
                )
                .join("")}
            </div>
          </section>

          <section class="detail-section">
            <div class="section-heading">
              <div>
                <h3>内部备注</h3>
                <p>记录机会点、风险、待确认参数或后续跟进动作；会进入版本备份。</p>
              </div>
            </div>
            <textarea class="text-area notes-area" data-edit-field="notes" placeholder="例如：需复核 ANSI 口径；光线较强环境下亮度是否足够；与 ONO3 Pro 对比自动校正表现…">${escapeHTML(working.notes)}</textarea>
          </section>
        </div>

        <div class="overview-stack">
          <section class="detail-section">
            <div class="section-heading">
              <div><h3>市场与 Listing</h3></div>
            </div>
            <div class="metric-grid">
              <div class="metric-item"><span>价格</span><strong>${priceFormat.format(product.sourcePrice)}</strong></div>
              <div class="metric-item"><span>用户评分</span><strong>★ ${escapeHTML(rating)}</strong><small>${escapeHTML(numberFormat.format(Number(String(reviews).replaceAll(".", "")) || reviews))} 条评价</small></div>
              <div class="metric-item"><span>近 30 天销量</span><strong>${product.metrics?.monthlySales ? escapeHTML(numberFormat.format(Number(product.metrics.monthlySales))) : "—"}</strong><small>件</small></div>
              <div class="metric-item"><span>BSR</span><strong>#${escapeHTML(product.metrics?.subcategoryBsr || product.rank)}</strong><small>大类 ${escapeHTML(product.metrics?.majorBsr || "—")}</small></div>
              <div class="metric-item"><span>系统</span><strong style="font-family:var(--font-sans);font-size:11px">${escapeHTML(system)}</strong></div>
              <div class="metric-item"><span>素材</span><strong>${imageCount} / ${aplusCount}</strong><small>Listing / A+</small></div>
            </div>
          </section>

          <section class="detail-section">
            <div class="section-heading">
              <div><h3>工作状态</h3></div>
            </div>
            ${statusControlsTemplate(working)}
          </section>

          <section class="detail-section">
            <div class="section-heading">
              <div>
                <h3>A+ 内容主题</h3>
                <p>按图片 OCR 与相关卖点自动归类，数量代表视觉投入重心。</p>
              </div>
            </div>
            <div class="theme-cloud">${themes || '<span class="theme-chip">暂无分类</span>'}</div>
          </section>

          <section class="detail-section">
            <div class="section-heading">
              <div><h3>数据口径</h3></div>
            </div>
            <div class="source-note">
              ${product.manualFocus ? `<strong>自有产品基准：</strong>${escapeHTML(product.sourceNote)}<br /><br />` : ""}
              价格为产品表中的含税参考价；页面指标来自 Amazon.de 页面快照。亮度存在
              ANSI、ISO 与普通“流明”混用，不能直接等值换算。图片文字由本机 OCR
              识别，复杂排版可能有误，请以原图为准。<br /><br />
              <a href="${escapeAttr(safeExternalUrl(product.sourceUrl))}" target="_blank" rel="noopener noreferrer">打开 Amazon.de 产品页 ↗</a>
            </div>
          </section>
        </div>
      </div>
    `;
  }

  function safeExternalUrl(url) {
    try {
      const parsed = new URL(url);
      return parsed.protocol === "https:" ? parsed.href : "#";
    } catch {
      return "#";
    }
  }

  function copyTemplate(product, working) {
    const translations = working.content.bulletTranslations;
    return `
      <section class="detail-section">
        <div class="section-heading">
          <div>
            <h3>Original Listing 五点 × 中文译文</h3>
            <p>左侧保留德语原文，右侧为中文理解。任何修改在点击“保存新版本”后进入历史记录。</p>
          </div>
          <div class="section-heading-actions">
            <span class="status-chip">${working.listingBullets.length} 条原文 / ${translations.length} 条译文</span>
          </div>
        </div>
        <div class="bullet-editor">
          ${working.listingBullets
            .map(
              (bullet, index) => `
                <article class="bullet-card">
                  <div class="bullet-number">${String(index + 1).padStart(2, "0")}</div>
                  <div class="bullet-cell">
                    <label>DE · 原始 Listing</label>
                    <input class="bullet-label-input" data-edit-bullet-label="${index}" value="${escapeAttr(bullet.label)}" aria-label="第 ${index + 1} 点小标题" />
                    <textarea class="bullet-textarea" data-edit-bullet-original="${index}" aria-label="第 ${index + 1} 点德语原文">${escapeHTML(bullet.original)}</textarea>
                  </div>
                  <div class="bullet-cell zh-cell">
                    <label>ZH · 中文译文</label>
                    <textarea class="bullet-textarea" data-edit-translation="${index}" aria-label="第 ${index + 1} 点中文译文">${escapeHTML(translations[index] || "")}</textarea>
                  </div>
                </article>
              `,
            )
            .join("")}
        </div>
        ${
          product.spreadsheetBullets?.length
            ? `
              <details class="spreadsheet-details">
                <summary>查看 BSR 表格中的原始卖点字段（${product.spreadsheetBullets.length} 条，只读）</summary>
                <div class="spreadsheet-bullet-list">
                  ${product.spreadsheetBullets
                    .map(
                      (bullet, index) => `
                        <article class="spreadsheet-bullet">
                          <span>${String(index + 1).padStart(2, "0")}</span>
                          <div>${escapeHTML(bullet.original)}</div>
                        </article>
                      `,
                    )
                    .join("")}
                </div>
              </details>
            `
            : ""
        }
      </section>
    `;
  }

  function specsTemplate(product) {
    return `
      <section class="detail-section">
        <div class="section-heading">
          <div>
            <h3>标准化规格对比</h3>
            <p>从 Amazon 产品详情中抽取常用字段；品牌参数口径不一致时保留原始写法。</p>
          </div>
        </div>
        <table class="spec-table">
          <thead><tr><th>字段</th><th>页面值</th></tr></thead>
          <tbody>
            ${product.keySpecs
              .map(
                (spec) => `
                  <tr><td>${escapeHTML(spec.label)}</td><td>${escapeHTML(cleanSpecValue(spec.value))}</td></tr>
                `,
              )
              .join("")}
          </tbody>
        </table>
      </section>
      <section class="detail-section">
        <div class="section-heading">
          <div>
            <h3>Amazon 原始详情</h3>
            <p>保留当前页面返回的全部产品参数，方便复核字段映射。</p>
          </div>
        </div>
        <div class="raw-spec-wrap">
          <table class="raw-spec-table">
            <tbody>
              ${(product.live?.productDetails || [])
                .map(
                  (item) => `
                    <tr><td>${escapeHTML(item.type)}</td><td>${escapeHTML(cleanSpecValue(item.value))}</td></tr>
                  `,
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  function imageCardTemplate(image, product, kind) {
    const url = imageSource(image);
    const role = image.role || (kind === "listing" ? "Listing 图" : "A+ 图");
    const meta = kind === "listing" ? "副图" : "A+";
    return `
      <article class="image-card ${image.hidden ? "is-hidden" : ""}" data-image-id="${escapeAttr(image.id)}" data-image-origin="${image.origin}" data-image-kind="${kind}">
        <div class="image-visual">
          ${url ? `<img src="${escapeAttr(url)}" alt="${escapeAttr(role)}" loading="lazy" />` : ""}
          <button type="button" data-action="preview-image" aria-label="放大 ${escapeAttr(role)}"></button>
          <div class="image-badge-row">
            <span class="image-badge">${escapeHTML(role)}</span>
            ${image.isReplaced ? '<span class="image-badge is-replaced">已替换</span>' : image.hidden ? '<span class="image-badge">已删除</span>' : ""}
          </div>
        </div>
        <div class="image-card-body">
          <div class="image-card-title">
            <strong>${escapeHTML(meta)} · ${escapeHTML(role)}</strong>
            <span>${image.sourceWidth ? `${image.sourceWidth}×${image.sourceHeight || ""}` : "本地上传"}</span>
          </div>
          <label class="image-card-field">
            <span>图片角色</span>
            <input class="text-input" style="min-height:32px;padding:6px 8px;font-size:10px" data-image-meta="role" value="${escapeAttr(image.role || "")}" />
          </label>
          <label class="image-card-field">
            <span>图片原文 / OCR</span>
            <textarea class="meta-textarea" data-image-meta="ocrText" placeholder="识别不到文字时可手动补充">${escapeHTML(image.ocrText || "")}</textarea>
          </label>
          <label class="image-card-field">
            <span>提炼卖点</span>
            <textarea class="meta-textarea" data-image-meta="sellingPoint">${escapeHTML(image.sellingPoint || "")}</textarea>
          </label>
          <div class="image-category-row">
            ${(image.categories || ["场景展示"]).map((category) => `<span>${escapeHTML(category)}</span>`).join("")}
          </div>
          <div class="image-card-actions">
            <button class="button button-secondary button-small" type="button" data-action="replace-image">${image.isReplaced ? "重新替换" : "替换图片"}</button>
            ${
              image.origin === "base"
                ? `<button class="button button-quiet button-small" type="button" data-action="toggle-image-hidden">${image.hidden ? "恢复显示" : "从视图删除"}</button>`
                : `<button class="button button-danger button-small" type="button" data-action="remove-custom-image">删除新增图</button>`
            }
            ${image.isReplaced ? '<button class="button button-quiet button-small" type="button" data-action="reset-image">恢复原图</button>' : ""}
          </div>
        </div>
      </article>
    `;
  }

  function galleryTemplate(product, working, kind) {
    const images = imagesFor(product, working, kind);
    const visible = images.filter((image) => !image.hidden);
    const hidden = images.filter((image) => image.hidden);
    const label = kind === "listing" ? "Listing 主副图" : "A+ 图片";
    const advice =
      kind === "listing"
        ? "主图判断产品外观，副图负责解释功能、场景与信任背书。OCR 文本可直接校正、搜索与进入备份。"
        : "A+ 图决定内容叙事顺序。逐图检查图片文字、主题与卖点，可隐藏无关素材或换成内部新图。";
    return `
      <section class="detail-section">
        <div class="section-heading">
          <div>
            <h3>${label} · ${visible.length} 张</h3>
            <p>${advice}</p>
          </div>
          <div class="section-heading-actions">
            <button class="button button-secondary button-small" type="button" data-action="add-image" data-kind="${kind}">＋ 添加图片</button>
          </div>
        </div>
        <div class="gallery-toolbar">
          <p>${kind === "listing" ? "第一张为主图，其余按 Amazon 详情顺序排列。" : "按 A+ 模块返回顺序排列；懒加载可避免一次读取全部大图。"}</p>
          <span class="status-chip">${images.filter((image) => image.ocrText).length} 张有图片文字</span>
        </div>
        <div class="image-grid ${kind}">
          ${visible.map((image) => imageCardTemplate(image, product, kind)).join("")}
        </div>
        ${
          hidden.length
            ? `
              <details class="hidden-gallery">
                <summary>已从视图删除的图片（${hidden.length}）</summary>
                <div class="image-grid ${kind}">
                  ${hidden.map((image) => imageCardTemplate(image, product, kind)).join("")}
                </div>
              </details>
            `
            : ""
        }
      </section>
    `;
  }

  function versionsFor(asin) {
    return state.versions
      .filter((version) => version.asin === asin)
      .sort((a, b) => String(b.at).localeCompare(String(a.at)));
  }

  function versionsTemplate(product, working) {
    const versions = versionsFor(product.asin);
    const bytes = new Blob([JSON.stringify(state)]).size;
    const percent = Math.min(100, Math.max(1, (bytes / (5 * 1024 * 1024)) * 100));
    return `
      <div class="version-layout">
        <div>
          <section class="detail-section">
            <div class="section-heading">
              <div>
                <h3>版本记录 · ${versions.length}</h3>
                <p>每次保存记录修改字段、时间与说明；恢复旧版本会再生成一条新记录，不会删掉历史。</p>
              </div>
              <div class="section-heading-actions">
                <button class="button button-quiet button-small" type="button" data-action="reset-product">恢复初始内容</button>
              </div>
            </div>
            ${
              versions.length
                ? `<div class="version-list">
                    ${versions
                      .map((version) => {
                        const number =
                          state.versions
                            .filter((item) => item.asin === product.asin)
                            .sort((a, b) =>
                              String(a.at).localeCompare(String(b.at)),
                            )
                            .findIndex((item) => item.id === version.id) + 1;
                        return `
                          <article class="version-item">
                            <span class="version-node">v${number}</span>
                            <div class="version-content">
                              <strong>${escapeHTML(version.title || "保存内容修改")}</strong>
                              <p>${escapeHTML(version.reason || "未填写保存说明")} · ${escapeHTML(formatDateTime(version.at))}</p>
                              <div class="version-meta">
                                ${(version.fields || []).map((field) => `<span>${escapeHTML(field)}</span>`).join("")}
                                ${version.sourceVersion ? `<span>来自 v${escapeHTML(version.sourceVersion)}</span>` : ""}
                              </div>
                            </div>
                            <div class="version-actions">
                              <button class="button button-secondary button-small" type="button" data-action="restore-version" data-version-id="${escapeAttr(version.id)}">恢复</button>
                            </div>
                          </article>
                        `;
                      })
                      .join("")}
                  </div>`
                : '<div class="version-empty">还没有保存记录。修改内容后点击“保存新版本”，或按 Ctrl / ⌘ + S。</div>'
            }
          </section>
        </div>
        <aside class="save-panel">
          <div class="detail-section">
            <h4>保存说明</h4>
            <p>建议写清楚本次调整目的，例如“重写五点译文”或“复核自动校正卖点”。</p>
            <textarea class="text-area" id="versionReason" placeholder="可选：为什么做这次修改？"></textarea>
            <button class="button button-primary" type="button" data-action="save-current">保存新版本</button>
            <div class="storage-meter"><span style="width:${percent.toFixed(1)}%"></span></div>
            <span class="storage-caption">本机内容约 ${formatBytes(bytes)} · 图片备份另计</span>
          </div>
        </aside>
      </div>
    `;
  }

  function formatDateTime(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "—" : dateTimeFormat.format(date);
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function bindDetailEvents() {
    $("#detailClose").addEventListener("click", () => closeDetail());
    $("#saveProduct").addEventListener("click", () => commitVersion());
    $("#saveProductMobile").addEventListener("click", () => commitVersion());
    $$(".detail-tab").forEach((button) => {
      button.addEventListener("click", () => {
        detail.tab = button.dataset.tab;
        renderDetail();
      });
    });

    $("#detailBody").addEventListener("input", handleDetailInput);
    $("#detailBody").addEventListener("change", handleDetailInput);
    $("#detailBody").addEventListener("click", handleDetailClick);
    $("#modalClose").addEventListener("click", closeModal);
    $("#modalOverlay").addEventListener("click", (event) => {
      if (event.target === $("#modalOverlay")) closeModal();
    });
    $("#modalBody").addEventListener("click", handleModalClick);

    document.addEventListener("keydown", (event) => {
      const command = event.ctrlKey || event.metaKey;
      if (command && event.key.toLowerCase() === "k") {
        event.preventDefault();
        $("#searchInput").focus();
        $("#searchInput").select();
      }
      if (command && event.key.toLowerCase() === "s" && detail.asin) {
        event.preventDefault();
        commitVersion();
      }
      if (event.key === "Escape") {
        if (!$("#modalOverlay").hidden) closeModal();
        else if (!$("#detailOverlay").hidden) closeDetail();
      }
    });

    window.addEventListener("beforeunload", (event) => {
      if (!detail.dirty) return;
      saveDraft();
      event.preventDefault();
      event.returnValue = "";
    });
  }

  function handleDetailInput(event) {
    if (!detail.working) return;
    const target = event.target;
    let changed = false;

    if (target.dataset.editField) {
      const field = target.dataset.editField;
      if (field === "notes") detail.working.notes = target.value;
      else detail.working.content[field] = target.value;
      if (field === "titleZh") $("#detailTitle").textContent = target.value;
      if (field === "positioning")
        $("#detailPositioning").textContent = target.value;
      changed = true;
    }

    if (target.dataset.editHighlight !== undefined) {
      const index = Number(target.dataset.editHighlight);
      detail.working.content.highlights[index] = target.value;
      changed = true;
    }

    if (target.dataset.editTranslation !== undefined) {
      const index = Number(target.dataset.editTranslation);
      detail.working.content.bulletTranslations[index] = target.value;
      changed = true;
    }

    if (target.dataset.editBulletOriginal !== undefined) {
      const index = Number(target.dataset.editBulletOriginal);
      detail.working.listingBullets[index].original = target.value;
      changed = true;
    }

    if (target.dataset.editBulletLabel !== undefined) {
      const index = Number(target.dataset.editBulletLabel);
      detail.working.listingBullets[index].label = target.value;
      changed = true;
    }

    if (target.dataset.imageMeta) {
      const card = target.closest("[data-image-id]");
      if (card) {
        const item = findImageMeta(
          card.dataset.imageKind,
          card.dataset.imageId,
          card.dataset.imageOrigin,
        );
        if (item) {
          item[target.dataset.imageMeta] = target.value;
          changed = true;
        }
      }
    }

    if (changed) markDirty();
  }

  async function handleDetailClick(event) {
    const button = event.target.closest("[data-action]");
    if (!button || !detail.working) return;
    const action = button.dataset.action;

    if (action === "toggle-favorite" || action === "toggle-review") {
      const key = action === "toggle-favorite" ? "favorite" : "review";
      detail.working.status[key] = !detail.working.status[key];
      button.classList.toggle("active", detail.working.status[key]);
      renderDetailHeader(baseByAsin.get(detail.asin), detail.working);
      markDirty();
      return;
    }

    if (action === "save-current") {
      commitVersion();
      return;
    }

    if (action === "restore-version") {
      const version = state.versions.find(
        (item) => item.id === button.dataset.versionId,
      );
      if (!version?.snapshot) return;
      const proceed = window.confirm(
        `恢复到 v${versionNumber(version)}？当前内容会先作为一条新版本保留。`,
      );
      if (!proceed) return;
      detail.working = normalizeWorking(
        baseByAsin.get(detail.asin),
        clone(version.snapshot),
      );
      detail.dirty = true;
      commitVersion({
        title: `恢复至 v${versionNumber(version)}`,
        sourceVersion: versionNumber(version),
      });
      return;
    }

    if (action === "reset-product") {
      const proceed = window.confirm(
        "将当前产品恢复为导入时的初始内容？保存后会生成一条新版本，历史不会删除。",
      );
      if (!proceed) return;
      detail.working = makeWorking(baseByAsin.get(detail.asin));
      markDirty();
      renderDetail();
      showToast("已恢复初始内容，点击“保存新版本”后生效");
      return;
    }

    if (action === "add-image") {
      await addImage(button.dataset.kind || "listing");
      return;
    }

    const card = button.closest("[data-image-id]");
    if (!card) return;
    const kind = card.dataset.imageKind;
    const origin = card.dataset.imageOrigin;
    const id = card.dataset.imageId;
    const image = findImageForCard(kind, id, origin);

    if (action === "preview-image") {
      if (image?.displayUrl) {
        showImagePreview(image, kind);
      }
      return;
    }

    if (action === "toggle-image-hidden") {
      const meta = findImageMeta(kind, id, "base");
      if (!meta) return;
      meta.hidden = !meta.hidden;
      markDirty();
      renderDetail();
      return;
    }

    if (action === "replace-image") {
      await replaceImage(kind, id, origin);
      return;
    }

    if (action === "reset-image") {
      const meta = findImageMeta(kind, id, "base");
      if (!meta) return;
      meta.replacementAssetId = null;
      markDirty();
      renderDetail();
      showToast("已恢复原图");
      return;
    }

    if (action === "remove-custom-image") {
      const list = detail.working.customImages[kind] || [];
      const index = list.findIndex((item) => item.id === id);
      if (index >= 0) {
        list.splice(index, 1);
        markDirty();
        renderDetail();
        showToast("已从当前产品删除新增图片");
      }
    }
  }

  function findImageMeta(kind, id, origin) {
    if (origin === "base") {
      return detail.working.imageMeta[kind].find((item) => item.id === id);
    }
    return detail.working.customImages[kind].find((item) => item.id === id);
  }

  function findImageForCard(kind, id, origin) {
    const product = baseByAsin.get(detail.asin);
    return imagesFor(product, detail.working, kind).find(
      (image) => image.id === id && image.origin === origin,
    );
  }

  async function addImage(kind) {
    const file = await chooseImageFile();
    if (!file) return;
    try {
      const image = await resizeImage(file);
      const assetId = createId("image");
      state.imageAssets[assetId] = image.dataUrl;
      const custom = {
        id: createId(`${kind}-custom`),
        assetId,
        role: `新增 ${kind === "listing" ? "Listing" : "A+"} 图 ${detail.working.customImages[kind].length + 1}`,
        ocrText: "",
        sellingPoint: "",
        categories: ["自建"],
        sourceWidth: image.width,
        sourceHeight: image.height,
      };
      detail.working.customImages[kind].push(custom);
      persistState();
      markDirty();
      renderDetail();
      showToast("图片已添加；保存新版本后写入历史", "success");
    } catch (error) {
      console.error(error);
      showToast(error.message || "图片处理失败", "error");
    }
  }

  async function replaceImage(kind, id, origin) {
    const file = await chooseImageFile();
    if (!file) return;
    try {
      const image = await resizeImage(file);
      const assetId = createId("image");
      state.imageAssets[assetId] = image.dataUrl;
      const meta = findImageMeta(kind, id, origin);
      if (!meta) return;
      meta.replacementAssetId = assetId;
      if (origin === "custom") {
        meta.assetId = assetId;
        meta.sourceWidth = image.width;
        meta.sourceHeight = image.height;
      }
      persistState();
      markDirty();
      renderDetail();
      showToast("图片已替换；保存新版本后写入历史", "success");
    } catch (error) {
      console.error(error);
      showToast(error.message || "图片处理失败", "error");
    }
  }

  function chooseImageFile() {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.style.display = "none";
      document.body.appendChild(input);
      input.addEventListener(
        "change",
        () => {
          const file = input.files?.[0] || null;
          input.remove();
          resolve(file);
        },
        { once: true },
      );
      input.click();
    });
  }

  function resizeImage(file) {
    if (!file.type.startsWith("image/")) {
      return Promise.reject(new Error("请选择图片文件"));
    }
    if (file.size > 20 * 1024 * 1024) {
      return Promise.reject(new Error("原图超过 20 MB，请先压缩"));
    }
    return new Promise((resolve, reject) => {
      const objectUrl = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        try {
          const maxSide = 1600;
          const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
          const width = Math.max(1, Math.round(img.width * scale));
          const height = Math.max(1, Math.round(img.height * scale));
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext("2d");
          context.fillStyle = "#ffffff";
          context.fillRect(0, 0, width, height);
          context.drawImage(img, 0, 0, width, height);
          const dataUrl = canvas.toDataURL("image/jpeg", 0.84);
          URL.revokeObjectURL(objectUrl);
          resolve({ dataUrl, width, height });
        } catch (error) {
          URL.revokeObjectURL(objectUrl);
          reject(error);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("无法读取这张图片"));
      };
      img.src = objectUrl;
    });
  }

  function markDirty() {
    detail.dirty = true;
    updateSaveState();
    scheduleDraftSave();
  }

  const scheduleDraftSave = debounce(() => {
    if (detail.dirty) saveDraft();
  }, 600);

  function saveDraft() {
    if (!detail.asin || !detail.working) return;
    try {
      localStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({
          asin: detail.asin,
          working: detail.working,
          at: new Date().toISOString(),
        }),
      );
    } catch (error) {
      console.warn("Draft save failed", error);
    }
  }

  function updateSaveState() {
    const element = $("#saveState");
    const mobileElement = $("#mobileSaveState");
    if (element) {
      element.textContent = detail.dirty ? "有未保存修改" : "已保存";
      element.classList.toggle("is-dirty", detail.dirty);
    }
    if (mobileElement) {
      mobileElement.textContent = detail.dirty
        ? "有未保存修改"
        : "所有修改已保存";
      mobileElement.classList.toggle("is-dirty", detail.dirty);
    }
    $("#saveProduct").disabled = !detail.dirty;
    $("#saveProductMobile").disabled = !detail.dirty;
  }

  function versionNumber(version) {
    return (
      state.versions
        .filter((item) => item.asin === version.asin)
        .sort((a, b) => String(a.at).localeCompare(String(b.at)))
        .findIndex((item) => item.id === version.id) + 1
    );
  }

  function diffWorking(before, after) {
    const fields = [];
    if (before.content?.titleZh !== after.content?.titleZh) fields.push("中文标题");
    if (before.content?.positioning !== after.content?.positioning)
      fields.push("定位描述");
    if (
      !deepEqual(before.content?.highlights, after.content?.highlights)
    )
      fields.push("核心卖点");
    if (
      !deepEqual(
        before.content?.bulletTranslations,
        after.content?.bulletTranslations,
      )
    )
      fields.push("五点译文");
    if (!deepEqual(before.listingBullets, after.listingBullets))
      fields.push("Listing 原文");
    if (!deepEqual(before.imageMeta, after.imageMeta)) fields.push("图片信息");
    if (!deepEqual(before.customImages, after.customImages))
      fields.push("图片增删");
    if (!deepEqual(before.status, after.status)) fields.push("工作状态");
    if (before.notes !== after.notes) fields.push("内部备注");
    return fields;
  }

  function commitVersion(options = {}) {
    if (!detail.asin || !detail.working) return;
    const product = baseByAsin.get(detail.asin);
    const before = normalizeWorking(product, state.working[detail.asin]);
    const after = normalizeWorking(product, detail.working);
    const fields = diffWorking(before, after);
    if (!fields.length && !options.force) {
      if (detail.dirty && deepEqual(before, after)) {
        detail.dirty = false;
        updateSaveState();
        localStorage.removeItem(DRAFT_KEY);
        showToast("内容与已保存版本一致");
      } else {
        showToast("没有需要保存的修改");
      }
      return;
    }

    const reason =
      ($("#versionReason")?.value || "").trim() || "保存内容修改";
    const version = {
      id: createId("version"),
      asin: detail.asin,
      at: new Date().toISOString(),
      title: options.title || "保存内容修改",
      reason,
      fields: fields.length ? fields : ["恢复内容"],
      sourceVersion: options.sourceVersion || null,
      snapshot: clone(after),
    };

    state.working[detail.asin] = clone(after);
    state.versions.push(version);
    pruneVersions();
    detail.working = after;
    detail.dirty = false;
    if (persistState()) {
      localStorage.removeItem(DRAFT_KEY);
      showToast(`已保存 v${versionNumber(version)}`, "success");
    }
    renderDetail();
    renderCatalog();
  }

  function pruneVersions() {
    if (state.versions.length <= MAX_VERSIONS) return;
    state.versions = state.versions
      .sort((a, b) => String(b.at).localeCompare(String(a.at)))
      .slice(0, MAX_VERSIONS);
  }

  function persistState() {
    state.schema = SCHEMA_VERSION;
    state.updatedAt = new Date().toISOString();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      updateStorageStatus();
      return true;
    } catch (error) {
      console.error("State save failed", error);
      showToast(
        "本机浏览器存储空间不足。请先导出备份，并减少上传图片后再保存。",
        "error",
      );
      return false;
    }
  }

  function updateStorageStatus() {
    const savedCount = Object.keys(state.working).length;
    $("#storageStatus").textContent = savedCount
      ? `已保存 ${savedCount} 个产品的本机修改`
      : "仅保存在本机浏览器";
  }

  function showImagePreview(image, kind) {
    const title = `${kind === "listing" ? "Listing" : "A+"} · ${image.role || "图片"}`;
    openModal({
      kicker: detail.asin,
      title,
      body: `<img src="${escapeAttr(image.displayUrl)}" alt="${escapeAttr(title)}" />`,
      className: "modal-image",
    });
  }

  function openCompareModal() {
    const products = [...ui.selected]
      .map((asin) => baseByAsin.get(asin))
      .filter(Boolean);
    if (products.length < 2) {
      showToast("请至少选择 2 个产品", "error");
      return;
    }
    const fields = [
      ["价格", (p, w) => priceFormat.format(p.sourcePrice)],
      ["品牌 / 型号", (p) => `${p.brand} · ${modelOf(p)}`],
      ["亮度（页面口径）", (p) => specOf(p, "亮度")],
      ["原生分辨率", (p) => specOf(p, "原生分辨率")],
      ["显示技术", (p) => specOf(p, "显示技术")],
      ["智能系统", (p) => systemOf(p)],
      ["评分 / 评价数", (p) => `★ ${p.live?.rating || "—"} / ${numberFormat.format(p.live?.reviewsCount || 0)}`],
      [
        "近 30 天销量",
        (p) =>
          p.metrics?.monthlySales
            ? `${numberFormat.format(Number(p.metrics.monthlySales))} 件`
            : "未提供",
      ],
      ["BSR", (p) => `#${p.metrics?.subcategoryBsr || p.rank} / 大类 ${p.metrics?.majorBsr || "—"}`],
      ["重量", (p) => specOf(p, "重量")],
      ["尺寸", (p) => specOf(p, "机身尺寸")],
      ["核心卖点", (p, w) => w.content.highlights.slice(0, 3).join("；")],
    ];
    const table = `
      <div class="compare-scroll">
        <table class="compare-table">
          <thead>
            <tr>
              <th>对比项</th>
              ${products
                .map((product) => {
                  const working = workingForView(product);
                  const image = primaryImage(product, working);
                  return `<th>
                    <div class="compare-product-head">
                      ${image ? `<img src="${escapeAttr(imageSource(image))}" alt="" />` : ""}
                      <div><strong>${escapeHTML(product.brand)}</strong><span>${escapeHTML(product.asin)}</span></div>
                    </div>
                  </th>`;
                })
                .join("")}
            </tr>
          </thead>
          <tbody>
            ${fields
              .map(
                ([label, getter]) => `
                  <tr>
                    <td>${escapeHTML(label)}</td>
                    ${products
                      .map((product) => {
                        const working = workingForView(product);
                        return `<td>${escapeHTML(getter(product, working) || "—")}</td>`;
                      })
                      .join("")}
                  </tr>
                `,
              )
              .join("")}
          </tbody>
        </table>
      </div>
    `;
    openModal({
      kicker: "SIDE-BY-SIDE",
      title: `产品对比 · ${products.length} 项`,
      body: table,
    });
  }

  function auditImageThumb(image, role) {
    const url = imageSource(image);
    if (!url) {
      return '<span class="audit-image-missing">无图片</span>';
    }
    return `
      <a class="audit-image-thumb" href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer" title="打开${escapeAttr(role)}原图">
        <img src="${escapeAttr(url)}" alt="${escapeAttr(role)}" loading="lazy" />
      </a>
    `;
  }

  function auditListingTable(product, working) {
    const images = imagesFor(product, working, "listing");
    return `
      <div class="audit-table-wrap">
        <table class="audit-table audit-image-table">
          <thead>
            <tr>
              <th>图片</th>
              <th>当前表达</th>
              <th>主要问题</th>
              <th>建议动作</th>
              <th>判断</th>
            </tr>
          </thead>
          <tbody>
            ${AUDIT.listing
              .map((item) => {
                const image = images.find((candidate) => candidate.index === item.index);
                return `
                  <tr>
                    <td>
                      ${image ? auditImageThumb(image, `Listing 图 ${item.index}`) : ""}
                      <strong>Listing ${item.index}</strong>
                    </td>
                    <td>${escapeHTML(item.current)}</td>
                    <td>${escapeHTML(item.issue)}</td>
                    <td>${escapeHTML(item.action)}</td>
                    <td><span class="audit-status ${item.priority === "高" || item.priority === "先核实" ? "is-warning" : ""}">${escapeHTML(item.priority)}</span></td>
                  </tr>
                `;
              })
              .join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function auditAplusTable(product, working) {
    const images = imagesFor(product, working, "aplus");
    return `
      <div class="audit-table-wrap">
        <table class="audit-table audit-image-table">
          <thead>
            <tr>
              <th>图片</th>
              <th>当前表达</th>
              <th>建议</th>
              <th>原因</th>
            </tr>
          </thead>
          <tbody>
            ${AUDIT.aplus
              .map((item) => {
                const image = images.find((candidate) => candidate.index === item.index);
                return `
                  <tr>
                    <td>
                      ${image ? auditImageThumb(image, `A+ 图 ${item.index}`) : ""}
                      <strong>A+ ${item.index}</strong>
                    </td>
                    <td>${escapeHTML(item.current)}</td>
                    <td><span class="audit-status ${/删除|替换|拆分/.test(item.decision) ? "is-warning" : ""}">${escapeHTML(item.decision)}</span></td>
                    <td>${escapeHTML(item.reason)}</td>
                  </tr>
                `;
              })
              .join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function auditMarketPanel() {
    const market = AUDIT.marketResearch;
    return `
      <section class="audit-panel" data-audit-panel="market" role="tabpanel" hidden>
        <div class="market-lead">
          <div>
            <p class="section-kicker">${escapeHTML(market.positioning.label)}</p>
            <h3>市场机会不在“功能更多”，而在“结果更确定”</h3>
            <p>${escapeHTML(market.summary)}</p>
          </div>
          <div class="market-stat-grid">
            ${market.stats
              .map(
                (stat) => `
                  <div>
                    <span>${escapeHTML(stat.label)}</span>
                    <strong>${escapeHTML(stat.value)}</strong>
                    <small>${escapeHTML(stat.note)}</small>
                  </div>
                `,
              )
              .join("")}
          </div>
        </div>

        <div class="market-positioning">
          <div class="market-positioning-main">
            <span>建议定位</span>
            <p>${escapeHTML(market.positioning.statement)}</p>
          </div>
          <dl>
            <div>
              <dt>核心人群</dt>
              <dd>${escapeHTML(market.positioning.audience)}</dd>
            </div>
            <div>
              <dt>用户承诺</dt>
              <dd>${escapeHTML(market.positioning.promise)}</dd>
            </div>
            <div>
              <dt>必须证明</dt>
              <dd>${escapeHTML(market.positioning.proof)}</dd>
            </div>
            <div>
              <dt>不要这样定位</dt>
              <dd>${escapeHTML(market.positioning.avoid)}</dd>
            </div>
          </dl>
        </div>

        <article class="market-price-callout">
          <div>
            <span class="section-kicker">PRICE POSITION</span>
            <h3>价格已经进入竞争判断</h3>
          </div>
          <p>${escapeHTML(market.priceRead)}</p>
        </article>

        <div class="audit-panel-heading market-section-heading">
          <div>
            <h3>可形成差异的四个破局点</h3>
            <p>它们不是新增功能，而是把现有能力包装成用户能验证的结果；每一项都同时写明所需证据。</p>
          </div>
        </div>
        <div class="market-breakthrough-grid">
          ${market.breakthroughs
            .map(
              (item) => `
                <article class="market-breakthrough">
                  <span class="market-breakthrough-index">${escapeHTML(item.index)}</span>
                  <h4>${escapeHTML(item.title)}</h4>
                  <dl>
                    <div><dt>用户问题</dt><dd>${escapeHTML(item.problem)}</dd></div>
                    <div><dt>建议主张</dt><dd>${escapeHTML(item.claim)}</dd></div>
                    <div><dt>证据要求</dt><dd>${escapeHTML(item.proof)}</dd></div>
                    <div><dt>为什么是 ONO3Pro</dt><dd>${escapeHTML(item.why)}</dd></div>
                  </dl>
                </article>
              `,
            )
            .join("")}
        </div>

        <div class="market-two-column">
          <section class="market-subcard">
            <h3>不能再当独占卖点</h3>
            <ul class="market-plain-list">
              ${market.nonBreakthroughs.map((item) => `<li>${escapeHTML(item)}</li>`).join("")}
            </ul>
          </section>
          <section class="market-subcard">
            <h3>当前价格带分布</h3>
            <div class="market-tier-list">
              ${market.priceTiers
                .map(
                  (tier) => `
                    <div>
                      <strong>${escapeHTML(tier.range)}</strong>
                      <span>${escapeHTML(tier.count)}</span>
                      <p>${escapeHTML(tier.role)}</p>
                    </div>
                  `,
                )
                .join("")}
            </div>
          </section>
        </div>

        <div class="audit-panel-heading market-section-heading">
          <div>
            <h3>竞品卖点表达差异</h3>
            <p>同样是系统、画质、便携和售后，不同品牌选择用参数、场景、品牌或证据抢注意力。</p>
          </div>
        </div>
        <div class="audit-table-wrap">
          <table class="audit-table market-expression-table">
            <thead>
              <tr>
                <th>表达路线</th>
                <th>代表产品</th>
                <th>怎么表达</th>
                <th>对 ONO3Pro 的启示</th>
              </tr>
            </thead>
            <tbody>
              ${market.competitorMoves
                .map(
                  (row) => `
                    <tr>
                      <td><strong>${escapeHTML(row.pattern)}</strong></td>
                      <td>${escapeHTML(row.examples)}</td>
                      <td>${escapeHTML(row.expression)}</td>
                      <td>${escapeHTML(row.implication)}</td>
                    </tr>
                  `,
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  function auditPromotionTable() {
    const promotion = AUDIT.promotions;
    const rows = [...promotion.rows].sort((a, b) => a.bdPrice - b.bdPrice);
    return `
      <section class="audit-panel" data-audit-panel="promotions" role="tabpanel" hidden>
        <div class="audit-panel-heading">
          <div>
            <h3>当前售价与促销估算</h3>
            <p>${escapeHTML(promotion.summary)}</p>
          </div>
        </div>
        <div class="promotion-note">
          <strong>${escapeHTML(promotion.asOf)}</strong>
          <span>${escapeHTML(promotion.note)}</span>
        </div>
        <div class="audit-table-wrap">
          <table class="audit-table promotion-table">
            <thead>
              <tr>
                <th>产品</th>
                <th>页面原价</th>
                <th>当前 BD 价 / 售价</th>
                <th>页面优惠</th>
                <th>估算优惠价</th>
                <th>类型与条件</th>
              </tr>
            </thead>
            <tbody>
              ${rows
                .map(
                  (row) => `
                    <tr class="${row.own ? "is-own" : ""}">
                      <td>
                        <strong>${escapeHTML(row.brand)} ${escapeHTML(row.model)}</strong>
                        <a href="https://www.amazon.de/dp/${encodeURIComponent(row.asin)}" target="_blank" rel="noopener noreferrer">${escapeHTML(row.asin)}</a>
                      </td>
                      <td class="promotion-number">${priceFormat.format(row.listPrice)}</td>
                      <td class="promotion-number is-current">${priceFormat.format(row.bdPrice)}</td>
                      <td>${escapeHTML(row.coupon)}</td>
                      <td class="promotion-number ${row.promoPrice && row.promoPrice < row.bdPrice ? "is-promo" : ""}">${row.promoPrice ? priceFormat.format(row.promoPrice) : "—"}</td>
                      <td>
                        <span class="audit-status ${/条件|赠品/.test(row.type) ? "is-warning" : ""}">${escapeHTML(row.type)}</span>
                        <small>${escapeHTML(row.condition)}</small>
                      </td>
                    </tr>
                  `,
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  function auditModalTemplate() {
    const product = baseByAsin.get(AUDIT.productAsin);
    if (!product) return '<p>没有找到 ONO3Pro 数据。</p>';
    const working = workingForView(product);
    return `
      <div class="audit-summary">
        <p>${escapeHTML(AUDIT.summary)}</p>
        <div class="audit-stat-strip">
          ${AUDIT.stats
            .map(
              (stat) => `
                <div>
                  <span>${escapeHTML(stat.label)}</span>
                  <strong>${escapeHTML(stat.value)}</strong>
                  <small>${escapeHTML(stat.note)}</small>
                </div>
              `,
            )
            .join("")}
        </div>
      </div>

      <div class="audit-tabs" role="tablist" aria-label="ONO3Pro 改版建议">
        <button class="active" type="button" role="tab" aria-selected="true" data-action="audit-tab" data-audit-tab="overview">结论与顺序</button>
        <button type="button" role="tab" aria-selected="false" data-action="audit-tab" data-audit-tab="market">市场定位</button>
        <button type="button" role="tab" aria-selected="false" data-action="audit-tab" data-audit-tab="promotions">当前促销</button>
        <button type="button" role="tab" aria-selected="false" data-action="audit-tab" data-audit-tab="listing">Listing ${AUDIT.listing.length}</button>
        <button type="button" role="tab" aria-selected="false" data-action="audit-tab" data-audit-tab="aplus">A+ ${AUDIT.aplus.length}</button>
        <button type="button" role="tab" aria-selected="false" data-action="audit-tab" data-audit-tab="copy">五点改写</button>
        <button type="button" role="tab" aria-selected="false" data-action="audit-tab" data-audit-tab="risks">发布前核实</button>
      </div>

      <section class="audit-panel" data-audit-panel="overview" role="tabpanel">
        <div class="audit-findings">
          <h3>先改这四件事</h3>
          <ul>
            ${AUDIT.findings.map((finding) => `<li>${escapeHTML(finding)}</li>`).join("")}
          </ul>
        </div>
        <div class="audit-table-wrap">
          <table class="audit-table">
            <thead>
              <tr>
                <th>卖点维度</th>
                <th>竞品常见做法</th>
                <th>ONO3Pro 当前</th>
                <th>建议优化</th>
              </tr>
            </thead>
            <tbody>
              ${AUDIT.comparison
                .map(
                  (row) => `
                    <tr>
                      <td><strong>${escapeHTML(row.theme)}</strong></td>
                      <td>${escapeHTML(row.competitors)}</td>
                      <td>${escapeHTML(row.current)}</td>
                      <td>${escapeHTML(row.action)}</td>
                    </tr>
                  `,
                )
                .join("")}
            </tbody>
          </table>
        </div>
        <div class="audit-sequence">
          <div>
            <span class="section-kicker">RECOMMENDED SEQUENCE</span>
            <h3>建议的图片叙事顺序</h3>
          </div>
          <ol>
            ${AUDIT.imageOrder.map((item) => `<li>${escapeHTML(item)}</li>`).join("")}
          </ol>
        </div>
      </section>

      ${auditMarketPanel()}
      ${auditPromotionTable()}

      <section class="audit-panel" data-audit-panel="listing" role="tabpanel" hidden>
        <div class="audit-panel-heading">
          <div>
            <h3>Listing 逐图诊断</h3>
            <p>点击左侧缩略图可打开原图。红色状态表示需要优先重做或核实。</p>
          </div>
        </div>
        ${auditListingTable(product, working)}
      </section>

      <section class="audit-panel" data-audit-panel="aplus" role="tabpanel" hidden>
        <div class="audit-panel-heading">
          <div>
            <h3>商品 A+ 逐图取舍</h3>
            <p>这里按商品 A+ 的 17 张图片判断；品牌故事素材另行管理。</p>
          </div>
        </div>
        ${auditAplusTable(product, working)}
      </section>

      <section class="audit-panel" data-audit-panel="copy" role="tabpanel" hidden>
        <div class="audit-panel-heading">
          <div>
            <h3>建议的五点结构</h3>
            <p>从“升级了什么”改成“用户得到什么”，同时减少每条承载的功能数量。</p>
          </div>
        </div>
        <div class="audit-copy-list">
          ${AUDIT.fivePoints
            .map(
              (item, index) => `
                <article class="audit-copy-item">
                  <span class="audit-copy-index">${String(index + 1).padStart(2, "0")}</span>
                  <div>
                    <h4>${escapeHTML(item.title)}</h4>
                    <strong>${escapeHTML(item.direction)}</strong>
                    <p><b>核心事实</b>${escapeHTML(item.facts)}</p>
                    <p><b>改写方法</b>${escapeHTML(item.change)}</p>
                  </div>
                </article>
              `,
            )
            .join("")}
        </div>
      </section>

      <section class="audit-panel" data-audit-panel="risks" role="tabpanel" hidden>
        <div class="audit-panel-heading">
          <div>
            <h3>发布前必须核实</h3>
            <p>这些不是文案偏好，而是可能影响转化、合规或用户信任的事实冲突。</p>
          </div>
        </div>
        <ol class="audit-risk-list">
          ${AUDIT.risks.map((risk) => `<li>${escapeHTML(risk)}</li>`).join("")}
        </ol>
      </section>
    `;
  }

  function activateAuditTab(auditTab = "overview") {
    const modalBody = $("#modalBody");
    const validTabs = new Set([
      "overview",
      "market",
      "promotions",
      "listing",
      "aplus",
      "copy",
      "risks",
    ]);
    const selected = validTabs.has(auditTab) ? auditTab : "overview";
    $$("[data-action='audit-tab']", modalBody).forEach((tab) => {
      const active = tab.dataset.auditTab === selected;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    $$("[data-audit-panel]", modalBody).forEach((panel) => {
      panel.hidden = panel.dataset.auditPanel !== selected;
    });
    modalBody.scrollTop = 0;
  }

  function openAuditModal(initialTab = "overview") {
    if (!AUDIT) {
      showToast("改版建议数据没有加载", "error");
      return;
    }
    openModal({
      kicker: AUDIT.kicker,
      title: "ONO3Pro 市场与内容改版研究",
      body: auditModalTemplate(),
      className: "modal-audit",
    });
    activateAuditTab(initialTab);
  }

  function exportVisibleTable() {
    const rows = filteredProducts();
    const headers = [
      "BSR",
      "产品来源",
      "品牌",
      "型号",
      "ASIN",
      "价格(EUR)",
      "亮度",
      "原生分辨率",
      "智能系统",
      "评分",
      "评价数",
      "月销量",
      "大类BSR",
      "子类BSR",
      "Listing图",
      "A+图",
      "中文标题",
      "定位",
      "核心卖点",
      "五点译文",
      "图片原文与卖点汇总",
      "产品链接",
    ];
    const imageSummary = (product, working) =>
      ["listing", "aplus"]
        .flatMap((kind) =>
          imagesFor(product, working, kind).map(
            (image) =>
              `${image.role || ""}｜${image.localPath || "本地上传"}｜原文：${image.ocrText || "未识别到文字"}｜卖点：${image.sellingPoint || ""}`,
          ),
        )
        .join(" || ");
    const csvRows = [
      headers,
      ...rows.map(({ product, working, system }) => [
        product.rank,
        product.manualFocus ? "自有产品" : "BSR 竞品",
        product.brand,
        modelOf(product),
        product.asin,
        product.sourcePrice,
        specOf(product, "亮度"),
        specOf(product, "原生分辨率"),
        system,
        product.live?.rating || product.metrics?.rating || "",
        product.live?.reviewsCount || product.metrics?.reviews || "",
        product.metrics?.monthlySales || "",
        product.metrics?.majorBsr || "",
        product.metrics?.subcategoryBsr || product.rank,
        imagesFor(product, working, "listing").filter((image) => !image.hidden)
          .length,
        imagesFor(product, working, "aplus").filter((image) => !image.hidden)
          .length,
        working.content.titleZh,
        working.content.positioning,
        working.content.highlights.join("；"),
        working.content.bulletTranslations.join("；"),
        imageSummary(product, working),
        product.sourceUrl,
      ]),
    ];
    const csv = csvRows
      .map((row) => row.map(csvCell).join(","))
      .join("\r\n");
    downloadBlob(
      `\uFEFF${csv}`,
      `Beamer竞品表_${new Date().toISOString().slice(0, 10)}.csv`,
      "text/csv;charset=utf-8",
    );
    showToast(`已导出当前 ${rows.length} 个产品`, "success");
  }

  function csvCell(value) {
    let text = String(value ?? "");
    if (/^[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  }

  function openBackupModal() {
    const savedCount = Object.keys(state.working).length;
    const imageAssetCount = Object.keys(state.imageAssets).length;
    const bytes = new Blob([JSON.stringify(state)]).size;
    openModal({
      kicker: "LOCAL DATA",
      title: "备份与恢复",
      className: "modal-narrow",
      body: `
        <div class="backup-layout">
          <article class="backup-card full">
            <h3>这台电脑上的编辑数据</h3>
            <p>版本与文字修改保存在当前浏览器；清理浏览器数据、换电脑或换浏览器前，请先导出完整备份。</p>
            <div class="backup-stats">
              <div><span>已编辑产品</span><strong>${savedCount}</strong></div>
              <div><span>版本记录</span><strong>${state.versions.length}</strong></div>
              <div><span>上传图片</span><strong>${imageAssetCount}</strong></div>
            </div>
          </article>
          <article class="backup-card">
            <h3>导出完整备份</h3>
            <p>包含内容修改、版本记录，以及你在工具中替换或新增的图片。原始 404 张素材已随工具文件夹保存。</p>
            <button class="button button-primary" type="button" data-action="export-backup">下载备份 JSON</button>
          </article>
          <article class="backup-card">
            <h3>从备份恢复</h3>
            <p>恢复会替换当前浏览器中的编辑数据。建议先导出当前备份，再导入另一份。</p>
            <button class="button button-secondary" type="button" data-action="import-backup">选择备份文件</button>
          </article>
          <article class="backup-card full">
            <h3>存储状态</h3>
            <p style="min-height:auto">当前文字、版本与已上传图片约 ${formatBytes(bytes)}。浏览器通常提供约 5 MB 本地空间；大量上传图片时请优先使用较小的图片。</p>
          </article>
        </div>
      `,
    });
  }

  function handleModalClick(event) {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    if (button.dataset.action === "export-backup") exportBackup();
    if (button.dataset.action === "import-backup") $("#backupImport").click();
    if (button.dataset.action === "audit-tab") {
      activateAuditTab(button.dataset.auditTab);
    }
  }

  function exportBackup() {
    const payload = {
      app: "Beamer Scout",
      schema: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      source: DATA.meta,
      data: {
        working: state.working,
        versions: state.versions,
        imageAssets: state.imageAssets,
        updatedAt: state.updatedAt,
      },
    };
    downloadBlob(
      JSON.stringify(payload, null, 2),
      `BeamerScout_完整备份_${new Date().toISOString().slice(0, 10)}.json`,
      "application/json;charset=utf-8",
    );
    showToast("完整备份已下载", "success");
  }

  async function importBackup(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text());
      const data = payload.data || payload;
      if (
        !data ||
        typeof data !== "object" ||
        (!data.working && !data.versions)
      ) {
        throw new Error("不是有效的 Beamer Scout 备份文件");
      }
      const proceed = window.confirm(
        "导入会替换当前浏览器里的编辑数据。建议先导出当前备份。继续吗？",
      );
      if (!proceed) return;
      state = {
        schema: SCHEMA_VERSION,
        working:
          data.working && typeof data.working === "object" ? data.working : {},
        versions: Array.isArray(data.versions) ? data.versions : [],
        imageAssets: sanitizeImageAssets(data.imageAssets),
        updatedAt: new Date().toISOString(),
      };
      persistState();
      localStorage.removeItem(DRAFT_KEY);
      closeModal();
      closeDetail(true);
      renderCatalog();
      showToast(
        `已恢复 ${Object.keys(state.working).length} 个产品与 ${state.versions.length} 条版本`,
        "success",
      );
    } catch (error) {
      console.error(error);
      showToast(error.message || "备份文件读取失败", "error");
    }
  }

  function downloadBlob(content, filename, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function openModal({ kicker = "", title, body, className = "" }) {
    $("#modalKicker").textContent = kicker;
    $("#modalTitle").textContent = title;
    $("#modalBody").innerHTML = body;
    $("#modalCard").className = `modal-card ${className}`.trim();
    $("#modalOverlay").hidden = false;
    setTimeout(() => $("#modalClose").focus(), 20);
  }

  function closeModal() {
    $("#modalOverlay").hidden = true;
    $("#modalBody").innerHTML = "";
  }

  function showToast(message, type = "") {
    const toast = document.createElement("div");
    toast.className = `toast ${type ? `is-${type}` : ""}`.trim();
    const icon =
      type === "success"
        ? '<path d="m5 12 4 4 10-10"></path>'
        : type === "error"
          ? '<path d="M12 8v5m0 3.2v.1"></path><circle cx="12" cy="12" r="9"></circle>'
          : '<circle cx="12" cy="12" r="9"></circle><path d="M12 11v5m0-8.2v.1"></path>';
    toast.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg><span>${escapeHTML(message)}</span>`;
    $("#toastRegion").appendChild(toast);
    setTimeout(() => {
      toast.classList.add("fade-out");
      setTimeout(() => toast.remove(), 220);
    }, 3200);
  }

  function init() {
    initFilters();
    updateKpis();
    updateStorageStatus();
    renderCatalog();
    bindCatalogEvents();
    bindDetailEvents();
    $("#openAuditButton")?.addEventListener("click", () =>
      openAuditModal("overview"),
    );
    $("#openMarketButton")?.addEventListener("click", () =>
      openAuditModal("market"),
    );

    const params = new URLSearchParams(
      window.location.search ||
        window.location.hash.replace(/^#/, "?").replaceAll("%26", "&"),
    );
    const mobileMenuButton = $("#mobileMenuButton");
    const updateMobileMenuVisibility = () => {
      mobileMenuButton.hidden = !window.matchMedia(
        "(max-width: 720px)",
      ).matches;
    };
    updateMobileMenuVisibility();
    window.addEventListener("resize", updateMobileMenuVisibility);
    const initialAsin = params.get("asin");
    const initialTab = params.get("tab");
    if (params.get("audit") === "1") {
      openAuditModal(params.get("auditTab") || "overview");
    } else if (initialAsin && baseByAsin.has(initialAsin)) {
      openDetail(initialAsin);
      if (
        initialTab &&
        ["overview", "copy", "specs", "listing", "aplus", "versions"].includes(
          initialTab,
        )
      ) {
        detail.tab = initialTab;
        renderDetail();
      }
    }
  }

  init();
})();
