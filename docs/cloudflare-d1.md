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

## 启用 D1

本仓库支持 D1 和 KV 两种存储。启用 D1 需要按下面步骤绑定数据库并迁移数据。建议保留旧 KV 绑定用于回退。`cf:build` 从 `wrangler.jsonc` 读取存储类型，避免旧的构建环境变量把应用重新编译为 KV；代码更新不会自动创建数据库或复制已有数据。

1. 安装依赖并登录正确的 Cloudflare 账号：

   ```sh
   pnpm install --frozen-lockfile
   pnpm exec wrangler login
   pnpm exec wrangler d1 create lunatv
   ```

2. 将创建结果中的真实数据库 ID 添加到 `wrangler.jsonc` 的顶层，保留原有字段：

   ```jsonc
   "d1_databases": [
     {
       "binding": "LUNATV_D1",
       "database_name": "lunatv",
       "database_id": "填写上一步创建的真实 ID",
       "migrations_dir": "migrations"
     }
   ]
   ```

3. 在切换存储类型之前创建表：

   ```sh
   pnpm exec wrangler d1 migrations apply LUNATV_D1 --remote
   ```

4. 如需保留已有账户、配置、收藏和进度，先执行下一节的迁移。迁移期间暂停网站访问和定时任务，避免复制后旧 KV 继续收到更新；在完成校验之前不要切换到 D1。

5. 在 `wrangler.jsonc` 的 `vars` 中设置 `NEXT_PUBLIC_STORAGE_TYPE=cloudflare-d1`，保持原来的 `USERNAME`、`PASSWORD` 等配置。提交真实绑定配置后重新构建部署（`pnpm cf:deploy`）；`cf:build` 自动同步构建变量。如果绕过此构建脚本直接运行 `next build`，必须自行设置同名构建变量。`NEXT_PUBLIC_` 变量会参与前端构建，只改运行变量不足以完成切换。

6. 验证站长和普通用户登录、播放进度、收藏、搜索历史及跳过片头片尾设置。在 D1 的 Metrics → Row Metrics 核对用量。确认无误后可以移除 `LUNATV_KV` 绑定；先保留旧命名空间作为回退副本。

如需定时刷新，设置 Worker 的 `CRON_SECRET` secret，调用方发送相同的 Bearer 密钥。建议每天一次；不需要刷新时无需配置。此 HTTP 接口不是 Cloudflare 的原生 Cron Trigger，原生触发器需要另外的 `scheduled` 处理器。

## 从当前 KV 无损复制到 D1

迁移脚本在本机运行，通过 Cloudflare 官方 API 读取 KV 和写入 D1，不向 Worker 添加 API Token，也不产生任何 KV 写入或删除。与仅导出页面数据不同，它直接保留已有密码哈希。迁移只识别 `admin:config` 和 `u:*:pwd/pr/fav/sh/skip`，忽略缓存和无关条目。

准备只作用于目标账号的临时 API Token，权限为 **Workers KV Storage Read** 和 **D1 Edit**。在本地终端设置以下环境变量，禁止把 Token 写入代码或提交到仓库：

- `CLOUDFLARE_API_TOKEN`：临时迁移 Token。
- `CLOUDFLARE_ACCOUNT_ID`：当前账号 ID。
- `CLOUDFLARE_KV_NAMESPACE_ID`：当前 `LUNATV_KV` 绑定 ID，可在 `wrangler.jsonc` 中找到。
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

保留旧 KV 时，可将 `wrangler.jsonc` 的 `vars.NEXT_PUBLIC_STORAGE_TYPE` 改回 `cloudflare-kv`，通过 `pnpm cf:deploy` 重新构建部署。切换后新产生的 D1 数据不会自动复制回 KV，回退前应保留 D1 数据。不要直接删除任何旧数据库或命名空间。
