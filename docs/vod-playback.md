# 点播播放器嵌入

## Crayon Player

点播播放页使用独立站点 [Crayon Player](https://crap.webber.qzz.io/)，替换原先在站内初始化的 Crayon / ArtPlayer。直播播放器不受影响。

依据播放器网站「网页与 App 接入」说明（2026-10-24 核对），嵌入入口为：

    https://crap.webber.qzz.io/parse?url=编码后的视频直链&embed=1

- 接收 MP4 / M3U8 等 HTTP(S) 媒体直链，不解析视频网站的 HTML 播放页。
- `src/lib/vod-player.ts` 的 `buildCrayonPlayerUrl` 使用 `URLSearchParams` 编码一次，保留视频签名、中文、查询参数和已有百分号编码；拒绝无效协议和含用户名/密码的地址。已有 Crayon 播放链接会取出媒体直链，避免重复嵌套。
- `embed=1` 只显示播放器。iframe 允许 autoplay、fullscreen、picture-in-picture、encrypted-media 和 screen-wake-lock，并设置 allowFullScreen；不使用 sandbox，以支持播放器脚本、存储、登录与投屏。
- 不向播放器传入本站账户、密码、Cookie 或页面 Referer。视频直链及片源自带签名会随 url 参数交给该播放器，这属于已授权的嵌入播放流程。
- 首次使用可直接在 iframe 内输入播放器访问密码。播放器说明标注登录有效期为 12 小时，同一网站和浏览器中连续换集、刷新可复用登录；优先使用分区 Cookie，备用为播放器自身会话存储。不在本站代码或 URL 中填写访问密码。
- 若浏览器限制跨站登录或存储，可使用「独立打开」。登录状态能否保存取决于浏览器；网站不读取跨域 iframe 的登录结果。

网站继续负责影片详情、收藏、选集、换源和播放器选择。换集、换源或切换播放器时卸载旧 iframe，再加载当前链接，避免旧视频继续播放。页面焦点下保留 Alt + 左右方向键换集；播放器内部快捷键由 Crayon 自行处理。

播放进度、片头片尾、去广告、倍速和投屏由独立播放器管理。当前 iframe 接口没有提供进度/结束事件桥接，所以不向本站写入播放进度，也不在本站触发自动下一集。原有历史记录保留，可用于恢复选集；旧内置播放器保存的秒数和片头片尾配置不传给跨域播放器。需要这些联动时应另行采用 SDK 或双方约定的消息接口。

默认选择 Crayon；历史 `artplayer` 偏好自动映射为 `crayon`，既有巨量选择与入口偏好继续保留。

## 巨量播放器

播放页仍可切换到巨量播放器，沿用[巨量官方接入](https://juliang.app/docs/player)：

- 主入口 `https://jimaoys99.com/parse?url=`，备用为 `jimaoys97.com`、`jimaoys95.com`。
- 保留智能匹配开关；关闭时链接增加 `match=0`。
- 已有完整 `/s/…` 或 `/parse` 地址直接嵌入，禁用 Crayon 选项，避免将 HTML 页面当作视频。
- 巨量的进度、广告规则、匹配选线和连播由其自行管理，不与本站互通。

两种播放器都提供「独立打开」和慢连接提示。iframe 的 load 事件仅表示页面载入，不等于视频已播放、登录成功或广告已过滤。

## 本地播放器库与验证

`packages/crayon-player`、`src/lib/vod-playback.ts` 和 `/api/player/*` 保留为可复用的 SDK/媒体服务，当前点播页不再初始化它们，也不重复请求本站去广告接口。独立播放器的发布与更新由其自身部署管理；点播页面无需同步播放器源码才能获取新版本。

播放器集成测试覆盖 Crayon 嵌入、旧偏好兼容、播放器切换、换集换源释放旧 iframe、巨量备用入口、全屏权限、登录/慢连接提示和非法地址。URL 测试覆盖签名及特殊字符完整保留、重复嵌套和非法协议。实际解码、登录、投屏和全屏仍依赖播放器服务及浏览器设备。
