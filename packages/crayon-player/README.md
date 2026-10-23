# Crayon Player

Crayon Player 是支持投屏、触屏手势和 HLS 的可嵌入 TypeScript 视频播放器。可独立运行，也可接入现有视频网站，无需 React、数据库或后台服务。

## 启动示例

```sh
npm ci
npm run dev
```

打开终端输出的本地网址。`npm run build` 生成可嵌入的 CommonJS 包和类型声明；`npm run build:demo` 生成 `demo-dist/` 静态示例，可部署到任何静态托管。仓库创建不会自动发布 npm 包或上线网站。

## 功能

- MP4 / HLS、自定义控制栏与设置、0.5–3 倍速、画中画、网页全屏、系统全屏、自动横屏、锁屏和播放时保持屏幕常亮（平台支持时）。
- 画面分为三等份：双击左侧快退 10 秒、中间暂停/继续、右侧快进 10 秒；长按 500ms 临时至少 2 倍速，松手恢复原速度。首次触屏播放显示操作提示。
- 右侧上下滑动调节音量；设置 → 音量可打开手动滑块。画面横向滑动、底部进度条触摸拖动和鼠标拖动均实时同步进度条，左上角按“当前进度 / 总时长”显示，例如 `1小时2分钟3秒 / 2小时0分钟0秒`；进度条支持方向键、Home / End。单击显隐控制栏，设置面板与控制栏同步收起。已移除亮度手势。
- 设置 → 迷你进度条，可在控制栏隐藏时保留视频底边的细进度条，默认关闭，自动记住选择。
- 锁屏、双指操作、触摸取消、失焦和换源会取消拖动与手势并恢复临时速度，控制按钮保持独立操作。
- AirPlay / 系统远程播放、Chromecast 选择入口。Google Cast SDK 预加载，点击时直接调用设备选择；配置清单适配后发送过滤后的 HTTP(S) 清单，并将原片进度换算为接收端时间；成功后暂停本地。切源/销毁期间未完成的会话请求不会加载旧片源。
- HLS 广告分片过滤、AES-128 隐式 IV 修复、原片/过滤后时间轴转换；复杂/直播清单保守透传。配置 `prepareMedia` 后，原生 HLS、HLS.js 及 AirPlay 备用源统一使用服务端过滤清单；支持原生 HLS 的设备优先原生播放，即使它同时支持 MSE/MMS。准备失败时提示重试，不回退到含广告的原始清单。
- 按影片独立的断点续播、片头片尾设置、下一集回调、进度回调。网站原有收藏、换源、影视目录与外部巨量播放器继续由网站管理。

## 嵌入

先 `npm run build`，在自己的前端项目中通过本地路径安装此仓库：

```sh
npm install /path/to/CrayonPlayer
```

```ts
import { createCrayonPlayer } from '@swebersmith/crayon-player';

const player = createCrayonPlayer({
  container: '#player', // 容器需显式高度，例如 aspect-ratio: 16/9
  url: 'https://your-media.example/movie.m3u8',
  title: '我的视频',
  storageKey: 'movie-123:episode-1',
  skip: { enabled: true, intro: 60, outro: 90 }, // outro 为片尾秒数
  onNext: () => openNextEpisode(),
  onProgress: (time, duration) => saveProgress(time, duration),
});
// 换集时销毁并以新的影片 storageKey 创建实例；卸载时也调用 destroy。
player.destroy();
```

已有 ArtPlayer 项目可以只使用插件，保留自己的 HLS、记录、片头片尾、选集等实现：

如需统一的 Crayon Player 标识和初始化入口，可调用 `createCrayonPlayerCore(artplayerOptions, enhancements)`；该入口保留传入的 HLS 加载器、设置和控制按钮，统一安装投屏与手势，用于与现有视频网站集成。

```ts
import Artplayer from 'artplayer';
import { crayonPlayerPlugin, vodSourceTime } from '@swebersmith/crayon-player';

new Artplayer({
  container: '#player', url: mediaUrl,
  gesture: false, fastForward: false,
  plugins: [crayonPlayerPlugin({
    gestures: { seekSeconds: 10, holdDelay: 500, holdRate: 2 },
    casting: {
      getSource: () => ({ url: currentMediaUrl, title: currentTitle,
        currentTime: vodSourceTime(currentVideo) }),
    },
  })],
});
```

`gestures: false` 关闭手势，`casting: false` 关闭投屏，`casting.chromecast: false` 不加载 Google SDK；配置这些参数位于工厂的 `enhancements` 中，或直接传给插件。

## 设备与片源限制

iOS 等平台可能限制程序音量，界面会提示使用设备音量键。系统原生视频全屏由系统接管，使用网页全屏可保留网页手势。

投屏需要设备/浏览器支持并在同一网络。电视必须能直接访问原始片源及分片、密钥，依赖网站 Cookie、Referer、自定义请求头、私有代理或设备不支持的编码可能失败。配置 `prepareMedia` 或 `casting.prepareSource` 可让原生 HLS、AirPlay 和 Chromecast 使用服务端已过滤的清单，并换算投屏进度；仅浏览器内的 blob 清单无法供电视读取。接入网站已提供带签名的服务端清单与分片转发。未配置服务端适配时仍使用原片源。投屏不继承片头片尾自动跳过；Chromecast 使用其原生控制界面控制/停止，不同步电视播放进度回网站，不自动向电视推送下一集。SDK 不可达会显示提示，本地播放仍可使用。投屏无法承诺兼容所有 DLNA 电视。

实现参考 [Google Cast Web Sender 官方文档](https://developers.google.com/cast/docs/web_sender/integrate)、[Remote Playback API](https://developer.mozilla.org/en-US/docs/Web/API/RemotePlayback/prompt) 和 [Apple 播放设备选择接口](https://developer.apple.com/documentation/webkitjs/htmlmediaelement/1632172-webkitshowplaybacktargetpicker)。

## 验证

```sh
npm run check
```

测试涵盖手势冲突、取消与速度恢复、控制条保护、投屏调用/原始 URL 与时间、延迟请求失效和原有 HLS 过滤回归。浏览器与真实电视的最终连通性需要对应设备验证。

`docs/ci-example.yml` 提供 GitHub Actions 配置示例。当前上传凭据没有 `workflow` 权限，因此未启用远程 Actions；拥有该权限后可将示例复制到 `.github/workflows/check.yml`。

网站使用 `packages/crayon-player/src` 中的相同源文件。修改独立仓库后，在网站目录运行 `node scripts/sync-crayon-player.mjs` 同步，避免网站和独立包行为分叉。

沿用原项目 CC BY-NC-SA 4.0，详见 [LICENSE](LICENSE) 和 [NOTICE.md](NOTICE.md)。

## 服务端清单适配

`prepareMedia(url, blockAds)` 返回 `{ url, type, filter }`，其中 `url` 为接收端可访问的 HTTP(S) 清单，`filter` 使用导出的 `VodAdFilterResult` 结构。配置后，开启去广告的所有 HLS 播放路径会等待准备完成再加载同一过滤清单，HLS.js 不再重复过滤；原片时间换算仍使用服务端返回的元数据。更新 HTTP 备用源时保留 MMS 的 blob source。主站的 `/api/player/prepare` 在登录验证后签发有有效期、绑定具体资源的链接；电视不需要网站 Cookie。清单、分片与密钥带 CORS，二进制分片流式返回；多轨/复杂清单仍采用保守透传，避免音画错位。此方案兼容支持相应 HLS/编码的设备，不能移除已压入正片画面的广告，也不保证识别所有片源的插播规则。参考 [WebKit 的 MSE / AirPlay 片源说明](https://webkit.org/blog/15036/how-to-use-media-source-extensions-with-airplay/) 和 [Google Cast 对自适应流 CORS 的要求](https://developers.google.com/cast/docs/web_sender/advanced)。
