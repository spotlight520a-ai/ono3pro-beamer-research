import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(
  fs.readFileSync(path.join(root, "data", "app-data.json"), "utf8"),
);
const brightnessData = JSON.parse(
  fs.readFileSync(path.join(root, "data", "ansi-brightness.json"), "utf8"),
);
const brightnessByAsin = new Map(
  brightnessData.products.map((row) => [
    String(row.asin).toUpperCase(),
    row,
  ]),
);
const currentPrices = JSON.parse(
  fs.readFileSync(path.join(root, "data", "current-prices.json"), "utf8"),
);
const currentRanks = JSON.parse(
  fs.readFileSync(path.join(root, "data", "bsr-rank-audit.json"), "utf8"),
);
const priceByAsin = new Map(
  currentPrices.products.map((row) => [String(row.asin).toUpperCase(), row]),
);
const rankByAsin = new Map(
  Object.entries(currentRanks.products).map(([asin, row]) => [
    String(asin).toUpperCase(),
    row,
  ]),
);

function coverageLabel(product) {
  if (product.manualFocus || product.coverage === "own") return "自有深挖";
  return product.coverage === "base" ? "基础档案" : "深挖";
}

function modelOf(product) {
  return (
    product.live?.modelNumber ||
    (product.content?.titleZh || product.sourceTitle || "")
      .split(/[：:]/)[0]
      .replace(product.brand || "", "")
      .trim()
  );
}

function specOf(product, label) {
  if (label === "亮度") {
    const brightness = brightnessByAsin.get(
      String(product.asin).toUpperCase(),
    );
    if (brightness) {
      return brightness.primaryLabel || "—";
    }
  }
  return product.keySpecs?.find((item) => item.label === label)?.value || "";
}

function brightnessOf(product) {
  return brightnessByAsin.get(String(product.asin).toUpperCase()) || null;
}

function priceOf(product) {
  return priceByAsin.get(String(product.asin).toUpperCase()) || {};
}

const priceColumns = [
  "价格状态",
  "当前Amazon售价(EUR)",
  "页面原价(EUR)",
  "页面折扣",
  "页面优惠逐项",
  "金额优惠券",
  "折扣优惠券",
  "结账优惠",
  "多件优惠",
  "门槛优惠",
  "免费赠品",
  "优惠券/活动原文",
  "优惠类型",
  "优惠条件",
  "折后最低价活动编号",
  "折后最低价活动链接",
  "折后最低价(EUR)",
  "优惠叠加口径",
  "价格采集时间",
  "价格来源字段",
  "价格说明",
];

function offerSummary(offers = []) {
  return offers
    .map(
      (offer) =>
        `${offer.type}｜${offer.raw}｜活动编号 ${offer.activityId || "—"}｜${
          offer.singleUnitEligible &&
          Number.isFinite(Number(offer.estimatedPrice))
            ? `单独试算 EUR ${Number(offer.estimatedPrice).toFixed(2)}`
            : "不计入单件最低价"
        }｜${offer.termsUrl || ""}`,
    )
    .join("\n");
}

function priceValues(price) {
  return [
    priceStatusLabel(price),
    price.currentPrice ?? "",
    price.listPrice ?? "",
    price.discountText || "",
    offerSummary(price.allPromotions),
    offerSummary(price.amountCouponOffers),
    offerSummary(price.percentCouponOffers),
    offerSummary(price.checkoutOffers),
    offerSummary(price.multiBuyOffers),
    offerSummary(price.thresholdOffers),
    offerSummary(price.giftOffers),
    price.coupon || "",
    price.type || "",
    price.condition || price.couponDescription || "",
    price.bestPromotionActivityId || "",
    price.bestPromotionTermsUrl || "",
    price.bestPromotionPrice ?? price.estimatedCouponPrice ?? "",
    price.combinationRule || "",
    price.timestamp || currentPrices.meta.observedAt,
    price.sourceField || "",
    price.priceNote || "",
  ];
}

function priceStatusLabel(price) {
  if (price.status === "third_party") return "第三方新品起售价";
  if (price.status === "unavailable") return "当前不可售";
  return "Amazon 当前售价";
}

function csvCell(value) {
  let text = String(value ?? "");
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function parseCsv(source) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell || row.length) {
    row.push(cell.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}

function assertCsvTable(label, tableHeaders, tableRows) {
  const duplicateHeaders = tableHeaders.filter(
    (header, index) => tableHeaders.indexOf(header) !== index,
  );
  if (duplicateHeaders.length) {
    throw new Error(
      `${label} has duplicate columns: ${[...new Set(duplicateHeaders)].join(", ")}`,
    );
  }
  const invalidRows = tableRows
    .map((row, index) => ({ index, count: row.length }))
    .filter(({ count }) => count !== tableHeaders.length);
  if (invalidRows.length) {
    const preview = invalidRows
      .slice(0, 5)
      .map(({ index, count }) => `row ${index + 2}=${count}`)
      .join(", ");
    throw new Error(
      `${label} column count mismatch: expected ${tableHeaders.length}; ${preview}`,
    );
  }
}

const headers = [
  "BSR",
  "原榜BSR",
  "BSR口径",
  "产品来源",
  "资料深度",
  "品牌",
  "型号",
  "ASIN",
  "父ASIN",
  "原表价格带",
  "原表价格(EUR)",
  ...priceColumns,
  "评分",
  "评价数",
  "月销量",
  "月销售额",
  "大类BSR",
  "子类BSR",
  "配送方式",
  "上架时间",
  "亮度（页面口径）",
  "亮度来源",
  "亮度原文依据",
  "原生分辨率",
  "显示技术",
  "连接",
  "机身尺寸",
  "重量",
  "保修",
  "德文原始标题",
  "中文整理标题",
  "一句话定位",
  "中文提炼卖点",
  "德文原始卖点（全部）",
  "中文译文（已有全文）",
  "规格字段（全部已抽取）",
  "Listing图片数",
  "A+图片数",
  "Listing图片",
  "A+图片",
  "资料提示",
  "产品链接",
];

const rows = data.products.map((product) => {
  const listing = product.images?.listing || [];
  const aplus = product.images?.aplus || [];
  const brightness = brightnessOf(product);
  const price = priceOf(product);
  const rank = rankByAsin.get(String(product.asin).toUpperCase());
  return [
    rank?.currentRank ?? product.rank,
    rank?.previousRank ?? product.rank,
    rank?.rankSource === "detail-page"
      ? "详情页口径（当前榜单未收录）"
      : "当前 Top 100 榜单槽位",
    product.manualFocus ? "自有产品" : "BSR 竞品",
    coverageLabel(product),
    product.brand,
    modelOf(product),
    product.asin,
    product.parentAsin,
    product.metrics?.priceBand || "",
    product.sourcePrice,
    ...priceValues(price),
    product.live?.rating || product.metrics?.rating || "",
    product.live?.reviewsCount || product.metrics?.reviews || "",
    product.metrics?.monthlySales || "",
    product.metrics?.monthlyRevenue || "",
    product.metrics?.majorBsr || "",
    product.metrics?.subcategoryBsr || "",
    product.metrics?.fulfillment || product.live?.fulfillment || "",
    product.metrics?.launchDate || product.live?.launchDate || "",
    specOf(product, "亮度"),
    brightness?.ansiSource || brightness?.lumenSource || "",
    brightness?.evidence || "",
    specOf(product, "原生分辨率"),
    specOf(product, "显示技术"),
    specOf(product, "连接"),
    specOf(product, "机身尺寸"),
    specOf(product, "重量"),
    specOf(product, "保修"),
    product.sourceTitle,
    product.content?.titleZh || "",
    product.content?.positioning || "",
    (product.content?.highlights || []).join("\n"),
    (product.spreadsheetBullets || [])
      .map((bullet) => `${bullet.index}. ${bullet.original}`)
      .join("\n"),
    [
      ...(product.content?.bulletTranslations || []),
      ...(product.content?.spreadsheetBulletTranslations || []),
    ].join("\n"),
    (product.keySpecs || [])
      .map((spec) => `${spec.label}: ${spec.value}`)
      .join("\n"),
    listing.length,
    aplus.length,
    listing
      .map(
        (image) =>
          `${image.role || "Listing 图"} | ${
            image.remoteUrl || image.sourceUrl || image.localPath || ""
          }`,
      )
      .join("\n"),
    aplus
      .map(
        (image) =>
          `${image.role || "A+ 图"} | ${
            image.remoteUrl || image.sourceUrl || image.localPath || ""
          }`,
      )
      .join("\n"),
    product.coverageNote || product.sourceNote || "",
    product.sourceUrl,
  ];
});

assertCsvTable("Full CSV", headers, rows);
if (rows.length !== 119) {
  throw new Error(`Full CSV expected 119 products, got ${rows.length}`);
}

const csv = [headers, ...rows]
  .map((row) => row.map(csvCell).join(","))
  .join("\r\n");
const outputPath = path.join(root, "德国站_BSR_Top100_全量产品表.csv");
fs.writeFileSync(outputPath, `\uFEFF${csv}`, "utf8");

const deepCsvPath = path.join(root, "德国站_200-400欧投影仪_产品表.csv");
const deepRows = parseCsv(
  fs.readFileSync(deepCsvPath, "utf8").replace(/^\uFEFF/, ""),
);
const deepHeaders = deepRows.shift();
const obsoletePriceHeaders = new Set([
  "价格(EUR)",
  "预计券后价(EUR)",
  "预计优惠后价(EUR)",
  ...priceColumns,
]);
const baseIndexes = deepHeaders
  .map((header, index) => ({ header, index }))
  .filter(({ header }) => !obsoletePriceHeaders.has(header));
const baseDeepHeaders = baseIndexes.map(({ header }) => header);
const asinIndex = baseDeepHeaders.indexOf("ASIN");
if (asinIndex < 0) throw new Error("Deep CSV ASIN column not found");
const insertIndex = asinIndex + 1;
const expandedDeepHeaders = [
  ...baseDeepHeaders.slice(0, insertIndex),
  ...priceColumns,
  ...baseDeepHeaders.slice(insertIndex),
];
const expandedDeepRows = deepRows.map((row) => {
  const baseRow = baseIndexes.map(({ index }) => row[index] ?? "");
  const asin = baseRow[asinIndex];
  const price = priceByAsin.get(String(asin).toUpperCase());
  if (!price) throw new Error(`No current price for deep CSV ${asin}`);
  return [
    ...baseRow.slice(0, insertIndex),
    ...priceValues(price),
    ...baseRow.slice(insertIndex),
  ];
});
assertCsvTable("Deep CSV", expandedDeepHeaders, expandedDeepRows);
const deepCsv = [expandedDeepHeaders, ...expandedDeepRows]
  .map((row) => row.map(csvCell).join(","))
  .join("\r\n");
fs.writeFileSync(deepCsvPath, `\uFEFF${deepCsv}`, "utf8");

console.log(
  `WROTE=${outputPath} ROWS=${rows.length}; WROTE=${deepCsvPath} ROWS=${expandedDeepRows.length}`,
);
