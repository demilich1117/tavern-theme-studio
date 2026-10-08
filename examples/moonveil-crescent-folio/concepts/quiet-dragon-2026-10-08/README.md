# 银龙与阅读空间 · 视觉概念

## 最新电脑单独修订

[电脑端原设银龙 · 美漫睡姿 v2](desktop-rock-sleep-original-comic-v2.png) 是最新桌面视觉参考。用户确认上一张的位置后，本轮以最初定稿的 `examples/moonveil-covenant/assets/night/dragon-user-final-v3.original.png` 为角色参考，重绘右下趴睡银龙：保留刀锋状头冠、紫色鼻甲、紫晶爪尖与紫翼，采用用户指定的 Marvel Rivals 美式漫画与二次元结合的轮廓、分块明暗和笔触。右下岩面位置、趴睡姿态、正文与输入栏布局沿用上一张；滚动轨道书签保留，背景不增加巨龙。

此图使用内置 ImageGen，已目视检查原设特征、闭眼睡姿和阅读区域。仅为桌面视觉概念，尚未替换主题素材或修改 CSS，也不作为真实酒馆验证结果。手机端继续参考下方合并 v2 的 LINE 风格趴睡 Q 龙方向，后续实现时进一步细化可爱感。完整生成提示词见 [desktop-original-comic-sleep.prompt.md](desktop-original-comic-sleep.prompt.md)。

上一轮 [右下位置参考 v1](desktop-rock-sleep-concept-01.png) 与其 [提示词](desktop-rock-sleep.prompt.md) 保留作位置演进记录；该图的偏写实龙造型现由上方原设美漫画风版本取代。两版均直接伏睡在岩面，没有书本、枕垫或独立垫台。

## 最新合并修订

[电脑与手机合并参考 v2](combined-rail-and-sleep-v2.png) 是上一轮合并视觉稿：第二组书签龙融入滚动轨道，取消背景中的所有巨龙；第一组右下伏睡方案改为桌面成年银龙收翼趴睡、手机 LINE 贴图风格 Q 版小龙趴睡。桌面龙的位置与承托方式现以本页上方电脑单独修订图为准。

桌面局部另修正一次，恢复输入栏连续的水平上沿，将龙和书堆放在书写区域后方。手机造型和其余阅读布局保留。此图使用内置 ImageGen 生成并已目视检查，仍为概念阶段，未修改现有主题实现。

完整提示词：[合并提示词](combined-rail-and-sleep.prompt.md)、[局部修订提示词](combined-rail-and-sleep.refinement.prompt.md)。初稿 `combined-rail-and-sleep-draft.png` 仅留作过程记录，后续应以 v2 为参考。

## 原始三组方向

日期：2026-10-08。使用内置 ImageGen，以 2.2.1 公开桌面与手机演示截图作为实际图像参考。三个独立方向，每张图左侧为电脑端、右侧为手机端。编号按本轮在聊天中实际展示的顺序。

本轮仅生成视觉参考，等待用户选择或继续混合细化；没有改动主题 CSS、主题 JSON、构建清单或正在使用的酒馆外观。

| 展示编号 | 原图 | 方向 | 完整提示词 |
| --- | --- | --- | --- |
| 1 | [quiet-dragon-option-01.png](quiet-dragon-option-01.png) | 蜷眠守卷：近处收翼蜷眠，远景山脊中沉睡的巨龙 | [sleeping-bookkeeper.prompt.md](sleeping-bookkeeper.prompt.md) |
| 2 | [quiet-dragon-option-02.png](quiet-dragon-option-02.png) | 侧边书签：小龙移到滚动轨道边，远处巨龙在云层中滑翔 | [margin-bookmark.prompt.md](margin-bookmark.prompt.md) |
| 3 | [quiet-dragon-option-03.png](quiet-dragon-option-03.png) | 银饰龙扣：小龙融入书写栏银饰，巨龙成为远景城堡与岩壁的一部分 | [dragon-clasp.prompt.md](dragon-clasp.prompt.md) |

共同目标：保留月牙菜单、阅读宽度和正文优先级；通过低反差远景维持巨龙气势，把近景银光、展翼范围与手机装饰体量收紧。图片均已目视检查，文本输入与发送按钮可见，远景龙的头部避开主要段落。

这些是生成概念图，中文文字与控件细节是视觉近似；后续实现继续使用 2.2.1 的原生控件和已验证布局。提示词期望画板为 2304×1152，实际生成图为 1774×887；没有通过程序拉伸图片。具体尺寸与文件哈希见 [manifest.json](manifest.json)。
