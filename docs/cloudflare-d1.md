# Cloudflare 写入额度优化与 D1 迁移

## 已修复的写入来源

- 配置读取不再写回数据库，包括 Worker 冷启动和公开的 `/api/server-config` 请求。
- 直播频道数量未变化时不保存配置；无直播源时定时任务也不保存配置。
- `/api/cron` 必须携带 `Authorization: Bearer <CRON_SECRET>`，未配置密钥时关闭此接口。不要把密钥放在 URL 中。任务执行完成后才返回成功。
- KV 自动保存播放进度从 5 秒改为 120 秒；D1 为 60 秒。暂停、切集、页面隐藏仍会保存，重复的相同进度会跳过。
- KV 相同 JSON 不重复写入；D1 使用带条件的 UPSERT 跳过未变化的行，并按视频条目保存，避免整份收藏或播放记录互相覆盖。

这些代码能解释为什么没有主动观看也可能产生写入，但不能证明某天的所有写入来自哪类请求。请在 Workers Logs 中核对 `/api/server-config`、`/api/cron` 的调用量和外部监控频率。KV 额度按账号统计，同账号的其他 Worker 也可能消耗额度。

## 免费额度与适用范围

截至 2026-10-16，KV 免费额度是每天 1,000 次写入；D1 是每天 100,000 行写入、5,000,000 行读取及账号共 5 GB 存储。D1 按扫描/修改的行数计量，索引也可能增加写入量，不能把它当成 100,000 次任意 SQL 请求。

正常的个人或家庭使用，优化后的 D1 写入余量通常充足。每分钟一次的连续播放约有每小时 60 次进度保存，额外还有暂停、搜索、收藏等操作。D1 仍有每日上限，Workers 自身请求及 CPU 限额也独立计算。免费额度在 UTC 00:00（北京时间 08:00）重置。

官方说明：[KV 额度](https://developers.cloudflare.com/kv/platform/limits/)、[D1 计费与额度](https://developers.cloudflare.com/d1/platform/pricing/)、[D1 平台限制](https://developers.cloudflare.com/d1/platform/limits/)。

## 启用 D1：仅需 Cloudflare 控制台操作

仓库提供通用 Workers + D1 代码。数据库 ID、账号 ID、域名和密码都保留在 Cloudflare 中，无需手动修改 GitHub 文件。`wrangler.jsonc` 使用 Cloudflare 的 `keep_bindings` 上传元数据保留控制台配置的 D1、KV、运行变量和密钥，之后的自动部署也会保留这些设置。

1. 在 Cloudflare → **Storage & databases → D1** 创建数据库，名称可自定。
2. 打开 **Workers & Pages → 你的 Worker → Bindings → Add binding → D1 database**，变量名填 **`LUNATV_D1`**，选择数据库并部署。也兼容常见的 `DB` 名称，两者同时存在时优先使用 `LUNATV_D1`。
3. 在 **Settings → Variables and Secrets** 设置站长账号 `USERNAME`，以及 Secret 类型的 `PASSWORD`。原来已有时继续使用即可。
4. 打开网站。程序自动识别 D1，首次访问自动创建缺失的表，不需要执行 SQL、填写数据库 ID 或修改仓库。首次部署尚无 Worker 时，先从仓库部署，再添加上述绑定。

构建命令为 `pnpm cf:build`，部署命令为 `pnpm exec wrangler deploy --keep-vars`。表结构也保留在 `migrations/0001_storage.sql`，供手动初始化或离线迁移使用。自动建表只在出现应用表缺失时执行；正常读取和冷启动不重复执行建表。

`STORAGE_TYPE` 默认可以不设置；`auto` 也表示自动识别。识别到 D1 时会覆盖历史 `NEXT_PUBLIC_STORAGE_TYPE=cloudflare-kv` 构建变量。若曾手动设置私有 `STORAGE_TYPE=cloudflare-kv`，请在 Cloudflare 将它删除或改成 `auto` / `cloudflare-d1`；明确的私有选择仍优先，以便回退和兼容其他部署方式。浏览器只接收存储类型，不接收数据库 ID 或凭据。

切换到新建的空数据库不会自动复制旧数据。已有 KV 用户应先按下一节迁移，再绑定目标 D1；也可以先在管理面板导出加密备份，切换后导入。D1 支持账号与密码、播放记录、收藏（包括直播收藏）、搜索历史、片头片尾跳过设置、站点与视频源/直播源配置，以及加密备份导出和恢复。恢复保留已有密码哈希，失败时 D1 事务会回滚，避免先清空再导入失败造成数据丢失。

## 定时刷新（可选）

在 Cloudflare 中添加 Secret **`CRON_SECRET`**，然后在 Worker 的 **Settings → Triggers → Cron Triggers** 添加计划，例如每天一次 `0 0 * * *`（UTC，北京时间 08:00）。仓库已提供原生 `scheduled` 处理器，不需要修改 GitHub 或另外创建 Worker。没有需要时不配置触发器，网站不会自行定时刷新。

外部定时服务也可以调用 `/api/cron`，发送 `Authorization: Bearer <CRON_SECRET>`。不要把密钥放进 URL。原生触发器和 HTTP 调用执行相同的刷新任务；直播频道数量不变时不重复保存配置。

## 从当前 KV 无损复制到 D1

迁移脚本在本机运行，通过 Cloudflare 官方 API 读取 KV 和写入 D1，不向 Worker 添加 API Token，也不产生任何 KV 写入或删除。脚本和管理面板的备份恢复都会保留已有密码哈希。迁移只识别 `admin:config` 和 `u:*:pwd/pr/fav/sh/skip`，忽略缓存和无关条目。

准备只作用于目标账号的临时 API Token，权限为 **Workers KV Storage Read** 和 **D1 Edit**。在本地终端设置以下环境变量，禁止把 Token 写入代码或提交到仓库：

- `CLOUDFLARE_API_TOKEN`：临时迁移 Token。
- `CLOUDFLARE_ACCOUNT_ID`：当前账号 ID。
- `CLOUDFLARE_KV_NAMESPACE_ID`：当前 `LUNATV_KV` 绑定 ID，在 Cloudflare 控制台查看。
- `CLOUDFLARE_D1_DATABASE_ID`：新建 D1 的 ID。

先检查数据（默认只读，会读取 KV，并检查 D1 表已创建）：

```sh
node scripts/migrate-kv-to-d1.mjs
```

确认输出的 `keys` 和 `rows` 数量合理，再复制：

```sh
node scripts/migrate-kv-to-d1.mjs --write
```

结果仅显示计数，不输出用户名、密码或收藏内容。`inserted` 是实际新增行数；已有 D1 行会保留，中断可重复运行。不要在已投入使用的 D1 上把此脚本当作双向同步工具。再次运行 dry run 可核对源行数，随后在 D1 控制台查询 `SELECT COUNT(*) FROM users`、`SELECT kind, COUNT(*) FROM user_data GROUP BY kind`，并抽查网站数据。

迁移会消耗 KV 读取/列表额度和 D1 的读写额度，但不会消耗已用完的 KV 写入额度。迁移完成后撤销临时 Token。

## 回退

保留旧 KV 时，可在 Cloudflare 控制台私下恢复 `LUNATV_KV` 绑定，将私有 `STORAGE_TYPE` 改为 `cloudflare-kv`，再重新部署。切换后新产生的 D1 数据不会自动复制回 KV，回退前应保留 D1 数据。不要直接删除任何旧数据库或命名空间。
