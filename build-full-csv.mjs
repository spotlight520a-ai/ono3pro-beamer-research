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
const priceByAsin = new Map(
  currentPrices.products.map((row) => [String(row.asin).toUpperCase(), row]),
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

const headers = [
  "BSR",
  "产品来源",
  "资料深度",
  "品牌",
  "型号",
  "ASIN",
  "父ASIN",
  "原表价格带",
  "原表价格(EUR)",
  "价格状态",
  "当前Amazon售价(EUR)",
  "页面原价(EUR)",
  "页面折扣",
  "优惠券/活动原文",
  "优惠类型",
  "优惠条件",
  "预计券后价(EUR)",
  "价格采集时间",
  "价格来源字段",
  "价格说明",
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
  return [
    product.rank,
    product.manualFocus ? "自有产品" : "BSR 竞品",
    coverageLabel(product),
    product.brand,
    modelOf(product),
    product.asin,
    product.parentAsin,
    product.metrics?.priceBand || "",
    product.sourcePrice,
    priceStatusLabel(price),
    price.currentPrice ?? "",
    price.listPrice ?? "",
    price.discountText || "",
    price.coupon || "",
    price.type || "",
    price.condition || price.couponDescription || "",
    price.estimatedCouponPrice ?? "",
    price.timestamp || currentPrices.meta.observedAt,
    price.sourceField || "",
    price.priceNote || "",
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
const priceIndex = deepHeaders.indexOf("价格(EUR)");
if (priceIndex < 0) throw new Error("Deep CSV price column not found");
const priceColumns = [
  "当前Amazon售价(EUR)",
  "价格状态",
  "页面原价(EUR)",
  "页面折扣",
  "优惠券/活动原文",
  "优惠类型",
  "优惠条件",
  "预计券后价(EUR)",
  "价格采集时间",
  "价格来源字段",
  "价格说明",
];
const expandedDeepHeaders = [
  ...deepHeaders.slice(0, priceIndex),
  ...priceColumns,
  ...deepHeaders.slice(priceIndex + 1),
];
const expandedDeepRows = deepRows.map((row) => {
  const asin = row[deepHeaders.indexOf("ASIN")];
  const price = priceByAsin.get(String(asin).toUpperCase());
  if (!price) throw new Error(`No current price for deep CSV ${asin}`);
  return [
    ...row.slice(0, priceIndex),
    price.currentPrice ?? "",
    priceStatusLabel(price),
    price.listPrice ?? "",
    price.discountText || "",
    price.coupon || "",
    price.type || "",
    price.condition || price.couponDescription || "",
    price.estimatedCouponPrice ?? "",
    price.timestamp || currentPrices.meta.observedAt,
    price.sourceField || "",
    price.priceNote || "",
    ...row.slice(priceIndex + 1),
  ];
});
const deepCsv = [expandedDeepHeaders, ...expandedDeepRows]
  .map((row) => row.map(csvCell).join(","))
  .join("\r\n");
fs.writeFileSync(deepCsvPath, `\uFEFF${deepCsv}`, "utf8");

console.log(
  `WROTE=${outputPath} ROWS=${rows.length}; WROTE=${deepCsvPath} ROWS=${expandedDeepRows.length}`,
);
