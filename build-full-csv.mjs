import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(
  fs.readFileSync(path.join(root, "data", "app-data.json"), "utf8"),
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
  return product.keySpecs?.find((item) => item.label === label)?.value || "";
}

function csvCell(value) {
  let text = String(value ?? "");
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
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
  "页面优惠",
  "评分",
  "评价数",
  "月销量",
  "月销售额",
  "大类BSR",
  "子类BSR",
  "配送方式",
  "上架时间",
  "亮度（页面口径）",
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
    product.live?.coupon || "",
    product.live?.rating || product.metrics?.rating || "",
    product.live?.reviewsCount || product.metrics?.reviews || "",
    product.metrics?.monthlySales || "",
    product.metrics?.monthlyRevenue || "",
    product.metrics?.majorBsr || "",
    product.metrics?.subcategoryBsr || "",
    product.metrics?.fulfillment || product.live?.fulfillment || "",
    product.metrics?.launchDate || product.live?.launchDate || "",
    specOf(product, "亮度"),
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
console.log(`WROTE=${outputPath} ROWS=${rows.length}`);
