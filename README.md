# ONO3Pro 德国站投影仪内容库

ONO3Pro（ASIN `B0HFHN24F1`）与德国站 €200–€400 价格带投影仪的公开网页版产品研究库。

在线浏览：<https://spotlight520a-ai.github.io/ono3pro-beamer-research/>

## 内容

- 1 个自有产品基准：ONOAYO ONO3Pro
- 15 个来自 BSR Top 100 的竞品
- 16 个产品、14 个品牌
- 404 张本地图片：127 张 Listing 主副图、277 张 A+ 图
- 五点德语原文、中文译文、核心卖点、规格及逐图内容提炼
- ONO3Pro 图片与五点专项审计：与 15 个竞品对比、8 张 Listing 逐图诊断、17 张商品 A+ 取舍及五点重建建议
- 搜索、筛选、排序、最多 4 项产品对比
- 文字和图片可编辑，支持本地版本保存、历史恢复、CSV 导出与 JSON 备份

## ONO3Pro 改版分析

首页“查看完整竞品对比”可打开专项分析，也可以直接访问：

<https://spotlight520a-ai.github.io/ono3pro-beamer-research/?audit=1>

分析包含五个部分：

- 结论与建议图片顺序
- 8 张 Listing 图逐图诊断
- 17 张商品 A+ 图逐图取舍
- 五点卖点重建框架
- 发布前必须核实的事实与授权风险

这些内容是优化建议，没有直接修改 Amazon Listing。重量、投距、原生分辨率、自动校正时间、Netflix / Chromecast 授权、测试依据与保修服务口径仍未完成业务核实，发布前应按页面中的核实清单逐项确认。

## 本地打开

克隆仓库后双击 `index.html` 即可离线使用；也可以从仓库根目录启动任意静态网页服务器。

编辑内容和版本记录保存在当前浏览器的本地存储中。换电脑、换浏览器或清理浏览器数据前，请先在页面中导出完整 JSON 备份。

## 数据口径

- ONO3Pro 是定向补充的自有产品，不属于本次 BSR Top 100 文件；自有产品和竞品在表格中有明确来源标识。
- 价格、评分、评价数、销量和 BSR 来自 Amazon.de 页面快照，只代表采集时状态。
- 亮度保留品牌页面口径，ANSI、ISO 与普通“流明”不能直接等值换算。
- 图片文字由 OCR 识别，复杂排版可能有误，请以原图为准。
- 第三方商标、商品图片和 Listing 文案的权利归各自权利人。本项目仅用于公开信息的产品研究与内容结构演示，不代表获得第三方素材的商业再发布授权。

## 文件结构

```text
index.html              页面入口
styles.css              页面样式
app.js                  筛选、编辑、版本和备份逻辑
data/app-data.js        页面加载的完整内容数据
data/app-data.json      可复核的结构化数据
data/audit-analysis.js  ONO3Pro 图片与五点专项审计数据
assets/images/<ASIN>/   Listing 与 A+ 本地图片
德国站_200-400欧投影仪_产品表.csv
使用说明.md
```
