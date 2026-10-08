# 素材来源与处理

2.2.4 不生成或修改任何图片，只调整电脑端银龙的 CSS 比例、位置、图层和局部阅读底色；图片与 2.2.2、2.2.3 完全一致。

2.2.2 更新传统伏睡成年银龙、手机 Q 版睡龙和滚动书签，月链及其余素材沿用 2.2.1。插画均由内置 ImageGen 生成，透明素材保留真实 Alpha；生产处理只做透明边裁切、缩放和 WebP 编码，参数保存在 `assets/encoding.json`。

| 文件 | 用途 | 提示词 |
| --- | --- | --- |
| castle-folio.webp | 月夜城堡、山谷、书册与晶簇背景 | castle-folio.prompt.txt |
| sleeping-dragon-desktop.webp | 传统成年银龙趴睡，美漫与二次元结合画风 | sleeping-dragon-desktop.prompt.txt |
| sleeping-dragon-mobile.webp | LINE 贴图风格 Q 版睡龙 | sleeping-dragon-mobile.prompt.txt |
| writing-frame.webp | 输入区银饰，透明九切片 | writing-frame.prompt.txt |
| lunar-arc-balanced.webp | 对称银链、中央月牙及容纳原生设置图标的空心银环 | lunar-arc-balanced.prompt.txt、lunar-arc-balanced.revision.prompt.txt |
| nav-pendant.webp | 原生图标吊坠 | nav-pendant.prompt.txt |
| violet-slip.webp | 用户紫色便笺，九切片填充 | violet-slip.prompt.txt |
| quote-quill.webp | 引用羽毛装饰 | quote-quill.prompt.txt |
| scroll-dragon-bookmark.webp | 原生滚动滑块上的银龙月纹书签 | scroll-dragon-bookmark.prompt.txt |

`avatar-talons.webp`、`lunar-wax-seal.webp`、`silver-frame.webp` 复用同项目已生成素材；后者只用于设置抽屉。演示的 `dragon-portrait.webp`、`traveler-portrait.webp` 也是项目既有虚构头像，主题不会替换用户头像。

新月链原图 1774×887，裁切范围 x32/y298/w1710/h342，生产图 1710×342。中央银环在图内约 x854.5/y269；CSS 据此放置原生图标。银链的左右几何由 ImageGen 重绘，未用程序镜像或涂改图片。旧 `lunar-arc.webp` 留在历史版本，发行包仅包含本版实际引用的素材。

成年银龙以已确认的传统睡龙概念为参考生成独立透明素材；手机小龙与书签分别独立生成。生产图仅裁切真实 Alpha 边界并等比编码。旧 `folio-dragon.webp` 和 `scroll-jewel.webp` 不再参与本版构建。

`fa-solid-900.woff2` 只供离线演示使用，许可证为同目录 `Font-Awesome-LICENSE.txt`。真实酒馆继续使用宿主字体图标。正文使用系统字体，无远程字体依赖。

原始 PNG 与未删改的生成提示词保存在源工程 `assets/originals/`。发行包仅包含生产图片和提示词，避免重复携带大幅原图；只将提示词记录中的机器路径元数据改为可分发引用，生成提示词正文保持原样。
