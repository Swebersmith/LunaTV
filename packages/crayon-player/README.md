# Crayon Player

可独立部署，也可嵌入网页的 HTML5 视频播放器。支持 MP4 / HLS、投屏、触屏手势、拖动进度、断点续播、片头片尾和广告分片过滤。

Crayon Player 是独立播放器。影片目录、账户、选集和选择其他播放器属于宿主网站；宿主可以把 Crayon 与其他播放器作为并列选项。独立运行不需要任何指定视频网站的代码、账户、数据库或接口。`prepareMedia` 是可选的通用接入配置，未配置时可使用静态演示与本地分片过滤；需要投屏过滤时可部署本仓库自带的服务。

## 选择使用方式

- **打开播放器看视频**：运行本地演示，或把 `demo-dist/` 上传到 HTTPS 静态托管。无需数据库。
- **接入自己的网页**：安装 npm 压缩包，或直接引入 `dist/crayon-player.iife.js`；无需额外引入播放器 CSS。
- **让 AirPlay 和 Chromecast 也使用去广告清单**：部署配套服务，并设置 `prepareMedia`。纯静态部署无法向电视提供本地过滤清单。

仓库不包含影片目录、片源订阅、账户数据库或部署凭据。请使用自己有权访问的视频地址。去广告是对已识别 HLS 插播分片的过滤，不处理压进正片画面的广告，也不保证识别所有片源。

## 安装和本地运行

只需现成文件时，可在 [Releases](https://github.com/Swebersmith/CrayonPlayer/releases) 下载 `crayon-player-static-版本.tar.gz`（解压后上传静态网站）、`crayon-player-browser-版本.tar.gz`（嵌入网页的脚本与模块）或 npm `.tgz` 安装包。压缩包附带许可文件，`SHA256SUMS.txt` 可用于核对文件完整性。

需要 Node.js 22 或更新版本、npm。Windows、macOS 和 Linux 使用相同 npm 命令。

```sh
git clone https://github.com/Swebersmith/CrayonPlayer.git
cd CrayonPlayer
npm ci
npm run dev
```

打开终端显示的地址，粘贴 MP4 或 M3U8 地址后点击「载入视频」。默认视频是公开测试流。私有仓库需要 GitHub 访问权限；安装不会把仓库或视频公开。

`npm ci` 按锁文件安装依赖并准备发行文件。修改源码后运行 `npm run check`，检查类型、功能、演示构建和真实 npm 压缩包。打包检查使用系统 `tar` 命令，Windows 10/11、macOS 和常见 Linux 发行版均提供。

## 部署静态演示

```sh
npm run build:demo
npm run preview
```

确认预览正常后，把 **`demo-dist/` 内的全部文件** 上传到静态托管，入口为 `index.html`。构建使用相对资源路径，可放在网站子目录；不要只上传 HTML，也不要双击本地 HTML 代替 HTTP(S) 部署。

此方式提供播放器、手势、设置、记录和设备支持的投屏入口。本地 HLS 使用 Crayon 内的 HLS.js（MSE/MMS）过滤与播放；电视端过滤需要下一节的服务。缺少 MSE/MMS 的浏览器会明确提示不支持，不切换到系统 HLS。演示会显示当前部署模式。

### 配套服务与页面一起部署到 Cloudflare Workers

此方案把页面、签名清单、分片和密钥转发部署到同一 HTTPS 站点，不需要其他视频网站、数据库或 KV/D1。配置在 `wrangler.jsonc`，默认 Worker 名称为 `crayon-player`，首次部署前可改为自己的名称。

```sh
npx wrangler login
npx wrangler secret put MEDIA_SECRET
npx wrangler secret put VIEWER_PASSWORD
npm run deploy:check
npm run deploy
```

- `MEDIA_SECRET`：签名随机密钥，建议至少 32 字符。可在自己的终端运行 `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` 生成，再在 secret 提示中输入。不能放进前端、Git 或 `vars`。
- `VIEWER_PASSWORD`：访问页面和准备接口的口令，建议使用长的随机英文数字口令。浏览器弹出登录框时，用户名填写 **`crayon`**，密码填写该口令。
- `secret put` 会修改远端 Worker；先确认 Cloudflare 账户和 Worker 名称。后续更新通常只需 `npm ci` 和 `npm run deploy`，不要重设密钥，否则旧投屏链接会失效。
- `deploy:check` 只构建并打包检查，`deploy` 才发布。Workers Builds 可使用构建命令 `npm ci && npm run build:hosted`、部署命令 `npx wrangler deploy`，并配置上述两个 secret。
- 此模式自动启用 `prepareMedia: '/api/player/prepare'`。页面和准备接口需要登录；电视读取的媒体链接只验证签名，无需网页口令，默认有效 8 小时。请勿公开转发这些临时链接。
- 服务会转发视频流量，平台请求量、带宽策略、CPU 和上游连通性限制仍然适用。不要把准备接口改成匿名开放代理。

本地验证完整部署：在仓库根目录创建未提交的 `.dev.vars`，写入 `MEDIA_SECRET=自己的测试密钥` 和 `VIEWER_PASSWORD=自己的测试口令`，运行 `npm run dev:hosted`。改动 Worker 配置后运行 `npm run worker:types`。本地口令、生成类型和 `.wrangler/` 不进入版本库或 npm 包。

依据：[Workers 静态资源路由](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/)、[Wrangler 安装](https://developers.cloudflare.com/workers/wrangler/install-and-update/)、[Secrets 配置](https://developers.cloudflare.com/workers/configuration/secrets/)。

## 接入自己的网页

### 安装 npm 压缩包

在播放器仓库运行：

```sh
npm run check
npm pack
```

得到 `swebersmith-crayon-player-0.2.0.tgz`，在自己的前端项目安装该文件：

```sh
npm install /path/to/swebersmith-crayon-player-0.2.0.tgz
```

拥有仓库访问权限时，也可 `npm install github:Swebersmith/CrayonPlayer`，安装会自动构建。不要求该名称已发布到 npm 公共仓库，不能直接假定 `npm install @swebersmith/crayon-player` 可用。

```html
<div id="player" style="width:100%;aspect-ratio:16/9"></div>
```

```ts
import { createCrayonPlayer } from '@swebersmith/crayon-player';

const player = createCrayonPlayer({
  container: '#player',
  url: 'https://media.example/episode.m3u8',
  title: '第一集',
  storageKey: 'series-123:episode-1',
  autoplay: false,
  blockAds: true,
  prepareMedia: '/api/player/prepare', // 部署同源服务后启用；纯静态接入请删掉此项
  skip: { enabled: true, intro: 60, outro: 90 },
  onNext: () => openNextEpisode(),
  onProgress: (sourceTime, sourceDuration) => saveProgress(sourceTime, sourceDuration),
  player: { theme: '#22c55e', volume: 0.7 },
});

// 卸载、换集或换播放器时销毁；下一集使用新的 storageKey 创建实例。
player.destroy();
```

`openNextEpisode`、`saveProgress` 由宿主实现，不需要时删掉相应配置。`outro` 表示距结尾多少秒，不是片尾开始的绝对时间。`storageKey` 必须按影片和集数区分。断点、回调和片头片尾使用原片时间轴，界面显示过滤后的实际时长。

在浏览器 DOM 已创建后初始化。在 React / Vue 等框架的挂载回调创建、卸载回调销毁；服务端渲染时不要提前创建实例。ESM、CommonJS 和类型声明均随包提供。

### 直接通过 script 接入

运行 `npm run build`，将 `dist/crayon-player.iife.js`、`LICENSE`、`NOTICE.md` 和 `THIRD_PARTY_LICENSES/` 放入自己的静态资源目录：

```html
<div id="player" style="width:100%;aspect-ratio:16/9"></div>
<script src="/assets/crayon-player.iife.js"></script>
<script>
  const player = CrayonPlayer.createCrayonPlayer({
    container: '#player',
    url: 'https://media.example/episode.m3u8',
    storageKey: 'series-123:episode-1',
    // prepareMedia: '/api/player/prepare',
  });
  window.addEventListener('pagehide', () => player.destroy());
</script>
```

浏览器全局名为 `CrayonPlayer`，无需其他脚本或 CSS。完整示例见 [examples/embed.html](examples/embed.html)。不要把 CommonJS 文件当浏览器脚本引入；直接 ESM 导入使用 `dist/crayon-player.mjs`。

### 接入现有服务端

`prepareMedia` 可填同源接口地址，也可提供异步函数：

```ts
prepareMedia: async (url, blockAds) => {
  const response = await fetch('/my-media/prepare', {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, blockAds }),
  });
  if (!response.ok) throw new Error('播放清单准备失败');
  return response.json();
}
```

返回 `{ url, type?, filter, expiresAt? }`：`url` 是接收端可访问的 HTTP(S) 地址；`filter` 为 `{ playlist, originalDuration, removed, reason }`，`removed` 为原片时间轴上的 `{ start, end }[]`，`reason` 为 `filtered`、`no-match` 或 `unsupported`。`expiresAt` 为毫秒时间戳。示例服务的 `playlist` 留空，清单由签名 URL 读取。

也可使用 `createMediaPreparer('/api/player/prepare')`，取得有限缓存、过期检测与失败重试的适配器。播放器与投屏共用它；配置服务并开启去广告时，只播放准备成功的过滤清单。服务不可达、请求 20 秒无响应、上游请求失败或返回数据无效时，停止加载并显示具体错误；不自动改用原片、本地过滤或其他播放器。失败缓存会清除，恢复服务后可重新选集或载入视频。

服务端独立入口：

```ts
import { handleMediaRelay } from '@swebersmith/crayon-player/server';

const response = await handleMediaRelay(request, {
  secret: process.env.MEDIA_SECRET || '', // 缺少密钥时服务返回 503
  authorize: async request => verifyYourLogin(request),
});
// 非 /api/player/prepare、/api/player/media 请求返回 null，交给宿主路由。
```

需要 Fetch API、Web Crypto 和流式响应。认证由宿主提供，密钥仅存服务端；应沿用宿主的访问频率控制。协议保留 CORS、Range、密钥状态、AES-128 IV 和原片时间映射，二进制分片不会整段读入内存。

高级接入可用 `createCrayonPlayerCore(options, enhancements)` 保留自有加载器、设置和按钮，或用 `crayonPlayerPlugin`。低层插件要求关闭宿主重复的 `gesture`、`fastForward`；不要同时安装插件和工厂。推荐高级配置字段为 `player`；早期的 `artplayer` 字段仍兼容，同时传入以 `player` 为准。

程序控制全屏可调用 `await toggleCrayonFullscreen(player)`（由主入口导出），或设置 `player.fullscreenWeb = true` 使用网页全屏。前者请求整个 Crayon 界面的元素全屏，保留播放器控件，不调用视频元素的系统播放界面。

## 操作与默认行为

- 画面三等分：左侧双击快退 10 秒，中间双击暂停/继续，右侧双击快进 10 秒；跨区域两次点击不合并为双击。
- 长按 500ms，临时至少 2 倍速；松手、取消触摸、失焦、锁屏或换源后恢复原倍速。原来超过 2 倍不会降速。
- 画面左右滑动、底部进度条触摸拖动和鼠标拖动均调节进度，超出边界限制在 0 与总时长之间。进度条聚焦后可用方向键、Home / End。
- 左上角显示「当前进度 / 总时长」，如 `59秒`、`1分钟0秒`、`1小时2分钟3秒`；拖动时进度条立即同步。
- 右侧上下滑调节音量；设置 → 音量提供手动滑块。没有亮度调节。
- 单击显隐控制栏，设置与控制栏一起隐藏，播放中闲置约 3 秒收起；拖动期间保持可见。
- 设置 → 迷你进度条默认关闭，开启后保留视频底边细条，并记住选择。
- 首次触屏播放显示提示。双指操作和锁屏不触发普通手势。
- 保留倍速、画中画、全屏、网页全屏、自动横屏和平台支持时的屏幕常亮。“全屏”按钮和桌面双击优先让整个 Crayon 界面进入设备全屏，保留控制栏、设置与手势；元素全屏不可用时使用网页全屏。“网页全屏”另有独立入口。高级接入可通过 `player.fullscreen`、`player.fullscreenWeb` 分别配置。

## 去广告、设备与投屏注意事项

- **统一网页播放**：手机、平板和电脑本地 HLS 均使用 Crayon 的 HLS.js 路径；关闭系统控制条，设置 `playsinline` 和 `webkit-playsinline`。MMS 播放不提供原生 HTTP 备用源；仅在手动选择投屏时安装电视地址。
- **支持范围**：本地 HLS 需要 MSE/MMS；即使浏览器能原生播放 HLS，缺少这些接口时也不会自动切换系统播放器。Crayon 通过网页视频 API 解码，宿主浏览器强制接管视频的行为仍受宿主控制，网页无法保证禁止所有内置浏览器的接管。
- **纯静态部署**：未配置 `prepareMedia` 时，从开始就使用本地分片过滤；这是独立的部署方式，要求片源满足 CORS、HTTPS 和编码条件。配置服务后不会因服务失败切换到这种方式。投屏去广告需要可用的服务端清单。
- **时长**：「已过滤」对应的清单应不再有广告 URI，界面时长会缩短；记录保留原片时间，便于开关过滤后恢复。
- **复杂格式**：多轨音频/字幕、直播、LL-HLS、字节范围、fMP4 MAP、DRM 和无法可靠解析的清单保守保留，避免音画错位或无法解密。未命中规则不等于没有广告。
- **音量和自动播放**：部分 iOS 浏览器限制网页音量，需要设备音量键；浏览器可能要求点击播放才能出声，不能绕过系统限制。
- **投屏条件**：设备需满足发现条件，通常在同一网络；电视需支持对应编码、HTTPS 和 HLS。Google SDK 需可访问官方域名，SDK 不可达不影响本地播放。
- **接收端功能**：手动点击投屏后，配套服务支持 AirPlay、Chromecast 的清单过滤；投屏不继承本地片头片尾跳过，不自动推送下一集，不将电视进度同步回网页。Google Cast 使用其控制界面，这里不提供通用 DLNA 控制器。
- **视频地址**：使用媒体地址，不能用需登录的播放网页代替。HTTPS 页面不应加载 HTTP 片源。静态模式需要片源提供所需 CORS。依赖特殊 Cookie、Referer、地区网络或私有地址的上游不保证可用；服务不转发网站 Cookie/Authorization。
- **升级**：覆盖整套静态文件，关闭旧播放页再打开；宿主有 Service Worker/CDN 时更新相应缓存。全屏切换只调整展示方式，不改变播放来源或去广告方式。

## 常见问题

**黑屏或一直加载**：先用公开测试流确认播放器可运行，再检查地址、容器高度、HTTPS、CORS 和编码。不要把 HTML 播放页当 M3U8。

**iPad 检测到广告却还在播放**：确认使用新发行文件，且正在使用 Crayon 的 MSE/MMS 路径。自建加载器不要把原片 `<source>` 加回视频，也不要删除 MMS 的 blob source。配置服务时应实际播放服务准备的过滤清单；投屏去广告需要配套服务。

**手机一直显示加载**：网站应提供能直接调用 Crayon `play()` 的点击播放按钮，以满足有声播放的用户手势限制。准备请求超时会停止加载并提示；HLS 致命错误最多连续恢复 3 次，仍失败会停止并提示，不切换过滤方式或播放器。

**准备接口 401**：先在同源页面登录。示例 Worker 使用 `crayon` 和 `VIEWER_PASSWORD`；自定义服务的 `authorize` 应验证宿主会话，不要把签名密钥作为前端口令。

**是不是只支持某一个资源？**：不是。过滤器按 HLS 清单结构识别插播，包含通用规则与已验证的插播路径规则，不按片源名称限制播放。`no-match` 表示未识别出可安全移除的广告，`unsupported` 表示当前格式保守保留；两者都可以继续播放，不能当成“已经没有广告”。

**清单准备失败或显示 HTTP 状态**：这表示服务读取上游清单失败，可能涉及片源网络、拒绝访问、超时或返回 HTML，区别于未匹配到广告。接口返回 `{ error: { code, upstreamStatus? } }`（兼容旧版纯文本失败响应），不暴露上游地址或响应正文。播放器会区分登录失效、服务未就绪、超时和无效清单；应恢复服务或更换可读取的片源后重试。

**电视 401 或链接过期**：重新准备投屏，确认服务端时钟、有效期及签名密钥未变。电视不应跳转到网页登录页。

**本地能播，电视不能播**：检查电视能否访问签名链接、分片和密钥，以及编码支持；不要发送浏览器 blob 地址。

**换集后进度错乱**：每集使用独立 `storageKey`，销毁旧实例，不混用不同片源或过滤前后时间轴。

## 开发和发布检查

```sh
npm ci
npm run check
npm run worker:types
npm run deploy:check
npm pack
```

`npm run release` 会先完成上述构建与功能检查，再在 `release/` 生成 npm 包、静态网站包、浏览器发行包和 SHA-256 校验文件；不自动公开仓库，也不自动创建远端部署。

- `dist/`：ESM、CommonJS、浏览器脚本、服务端入口与类型声明。
- `demo-dist/`：播放器网站，`build:demo` 是纯静态模式，`build:hosted` 启用同源服务。
- `examples/cloudflare/worker.mjs`：独立部署示例；`examples/embed.html`：直接嵌入示例。
- `test/`：功能、发行文件、MSE/MMS、禁止原生回退、投屏、手势、时间映射与服务鉴权验证。
- `docs/ci-example.yml`：可复制到 `.github/workflows/check.yml` 的 Actions 模板；模板存在不代表远端检查已启用。

自动测试和部署打包不能代替所有实体设备测试。iPad、AirPlay、Chromecast 和片源网络仍需对应设备验证。

## 许可

采用 [CC BY-NC-SA 4.0](LICENSE)，分发时保留 [NOTICE.md](NOTICE.md) 和依赖许可证；商业使用应先确认所需授权。产品名称和界面统一为 Crayon Player，必要的来源与第三方归属集中在许可说明中。
