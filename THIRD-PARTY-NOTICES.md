# 代码与素材许可范围

本项目原创工作台代码、连接器、通用起点主题及专用虚构 fixture 的 SVG 示例采用根目录 MIT License。连接器用于 SillyTavern；没有将酒馆核心代码打包进发行物。

运行依赖（版本与完整性见 package-lock.json）：

| 包 | 许可 | 用途 |
| --- | --- | --- |
| css-tree 3.1.0 | MIT | 服务端 CSS 依赖解析；不注入酒馆 |
| mdn-data | CC0-1.0 | css-tree 的 CSS 语法数据 |
| source-map-js | BSD-3-Clause | css-tree 的传递依赖 |

核心 ZIP 保留这些包各自的 LICENSE 文件。依赖许可不因本项目采用 MIT 而改变。

`examples/moonveil-*`、`public/folio-art/`、`public/moonveil*` 以及相关主题发行包中的装饰图、字体和第三方资源不自动套用代码 MIT 许可。它们的来源、生成过程及已有第三方声明见对应示例 README 和 THIRD-PARTY-NOTICES。Font Awesome 字体/图标依其随包声明使用。示例素材包公开分发前须逐项确认权利；核心工具 ZIP 不包含这些大型示例素材或主题包。

用户导入的主题、上传素材、Source Hub 素材和小票证据由原权利人保留权利。工作台的缓存、哈希验证或导出成功不代表取得素材再分发许可。

## DOUBLECHEESE 说明漫画

`docs/assets/doublecheese/01-getting-started.jpg` 和 `02-advanced.jpg` 用于本项目入门与进阶说明，也随核心安装包提供。DOUBLECHEESE 的角色参考由用户提供；两页原稿使用内置 imagegen 生成，最终配图采用用户修正手部后提供的版本。

`docs/assets/doublecheese/03-co-design.png` 为新增的从零共创说明，以既有第二页漫画作为角色与画风参考，使用内置 imagegen 生成；前两页保持原样。共创篇及其提示词同样随核心包提供。

角色与参考图的权利归原权利人，漫画图片不自动套用代码的 MIT 许可。来源、提示词及文件校验记录见 [漫画制作记录](docs/assets/doublecheese/GENERATION.md)。
