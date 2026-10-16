# CrayonTV

CrayonTV 取意于蜡笔与影视，界面融入小新、春日部防卫队、爆米花和手绘彩色蜡笔的元素。保留原有搜索、播放、收藏、管理及存储行为。

Logo 以粗眉、红衣、暖黄色圆形和爆米花表达小新与电影元素。由内置 image_gen 工具生成，保留透明背景，再制作网站需要的图标尺寸。

- 网站 Logo：`public/logo.png`（512 × 512，透明 PNG）。
- 浏览器图标：`public/favicon.ico`（16、32、48、64 像素）。
- 桌面安装图标：`public/icons/icon-192x192.png`、`icon-256x256.png`、`icon-384x384.png`、`icon-512x512.png`。
- 默认名称、配色、文案与图标版本：`src/lib/branding.json`。

站点管理面板中的名称仍可自定义。动态 `/manifest.webmanifest` 使用站点运行配置，保持网页标题、苹果桌面名称和 PWA 名称一致。`scripts/generate-manifest.js` 继续生成兼容的静态 `/manifest.json`。图标 URL 带版本参数，帮助浏览器更新原有图标。

## Logo 生成提示词

使用内置 image_gen，`transparent_background=true`，最终提示词如下：

```text
Use case: logo-brand. Asset type: production website logo and app icon for a Chinese movie streaming site named 春日放映室, subtly inspired by Kasukabe and Crayon Shin-chan. Create one polished, charming, highly legible square emblem, no lettering at all. Subject: recognizable Crayon Shin-chan / Shinnosuke Nohara, black closely cropped hair, iconic very thick short black eyebrows, mischievous sidelong eyes, peach round cheeks, small playful smile, red shirt. Tight head-and-shoulders portrait with a tiny cinema popcorn tub near his chest, head large and dominant so readable at 32 pixels. Flat clean Japanese cartoon / sticker drawing, bold smooth dark brown outlines, restrained warm yellow, tomato red, peach and cream palette. Behind the character a simple warm sunshine yellow circular disc, with a small red movie-play triangle worked into the disc near the lower right. Centered composition with generous safe margins, all artwork within the middle 78 percent of the square so it survives circular and rounded-square icon masks. True transparent background outside the circular emblem. No text, no watermark, no mockup, no sheet of variants, no gradients, no photorealism, no extra people. Final single clean square logo asset.
```

## 防卫队界面主题

新增 `public/icons/kasukabe-squad.webp`（1200 × 800，透明 WebP），用于首页观影横幅与登录页插画。内置 image_gen 工具生成，最终压缩后约 195 KB；图像文件从本站静态资源加载。

- 全站：奶油色纸张底、深色模式、暖色边框、蜡笔红主操作色。
- 登录页：防卫队观影海报、胶带与电影票细节、手绘描边的登录按钮。
- 首页：防卫队横幅、搜索与动漫入口、彩色章节标记、收藏空状态。
- 导航与分类：防卫队五色蜡笔、纸片式选中状态、统一红色交互。
- 搜索与播放：搜片任务引导、输入框、影片卡片及选集控件统一主题。
- 手机：紧凑的品牌页头、堆叠式首页横幅、保留横向滚动的底部导航。
- 减少动态效果：尊重 `prefers-reduced-motion`。

### 防卫队插画最终提示词

使用内置 image_gen，`transparent_background=true`：

```text
Use case: illustration-story. Asset type: one transparent wide illustration for CrayonTV, a joyful Crayon Shin-chan / Kasukabe Defense Force themed movie website. Draw the five recognizable Kasukabe Defense Force children sitting together enjoying a cinema night: Shinnosuke Nohara at center in his red shirt and yellow shorts with his iconic black hair and thick eyebrows, Kazama with blue hair and blue outfit, Nene with orange twin ponytails and pink outfit, Masao with round shaven head and green outfit, Bo-chan with his calm face and yellow outfit. Include the small white dog Shiro beside them. They are sharing popcorn, two with drinks, relaxed playful expressions, looking forward as if watching a film. Exactly five children plus one dog. Clean bold dark ink cartoon outlines, warm flat color with subtle colored-pencil paper texture. Friendly charming classic Japanese cartoon illustration. Composition: compact horizontal group, characters in one row arranged around a single small popcorn tub, full figures, all faces clear, no background scene. Small scattered hand-drawn stars in red, yellow, sky blue and mint around the group, a tiny clapperboard at one side. Transparent background everywhere outside figures and small stars, no white rectangular panel. Wide landscape composition about 3:2, keep all characters in the central area with safe clear space at all edges. No letters, no words, no text, no typography, no watermark, no logos. Not 3D, not realistic, no photographic textures.
```
