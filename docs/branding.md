# 春日放映室

名称取意于《蜡笔小新》中的春日部，以日常、轻松的观影氛围表达主题，不直接使用角色名作为站名。

Logo 以粗眉、红衣、暖黄色圆形和爆米花表达小新与电影元素。由内置 image_gen 工具生成，保留透明背景，再制作网站需要的图标尺寸。

- 网站 Logo：`public/logo.png`（512 × 512，透明 PNG）。
- 浏览器图标：`public/favicon.ico`（16、32、48、64 像素）。
- 桌面安装图标：`public/icons/icon-192x192.png`、`icon-256x256.png`、`icon-384x384.png`、`icon-512x512.png`。
- 默认名称、配色、文案与图标版本：`src/lib/branding.json`。

站点管理面板中的名称仍可自定义。动态 `/manifest.webmanifest` 使用站点运行配置，保持网页标题、苹果桌面名称和 PWA 名称一致。`scripts/generate-manifest.js` 继续生成兼容的静态 `/manifest.json`。图标 URL 带版本参数，帮助浏览器更新原有图标。

## 生成提示词

使用内置 image_gen，`transparent_background=true`，最终提示词如下：

```text
Use case: logo-brand. Asset type: production website logo and app icon for a Chinese movie streaming site named 春日放映室, subtly inspired by Kasukabe and Crayon Shin-chan. Create one polished, charming, highly legible square emblem, no lettering at all. Subject: recognizable Crayon Shin-chan / Shinnosuke Nohara, black closely cropped hair, iconic very thick short black eyebrows, mischievous sidelong eyes, peach round cheeks, small playful smile, red shirt. Tight head-and-shoulders portrait with a tiny cinema popcorn tub near his chest, head large and dominant so readable at 32 pixels. Flat clean Japanese cartoon / sticker drawing, bold smooth dark brown outlines, restrained warm yellow, tomato red, peach and cream palette. Behind the character a simple warm sunshine yellow circular disc, with a small red movie-play triangle worked into the disc near the lower right. Centered composition with generous safe margins, all artwork within the middle 78 percent of the square so it survives circular and rounded-square icon masks. True transparent background outside the circular emblem. No text, no watermark, no mockup, no sheet of variants, no gradients, no photorealism, no extra people. Final single clean square logo asset.
```
