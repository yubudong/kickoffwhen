# kickoffwhen.com 家庭试用部署手册

本手册用于将家庭学习网站部署到现有 Hetzner，并通过共享 Caddy 接入
`kickoffwhen.com`。生产配置只允许指定家庭邮箱注册。

## 安全边界

- `.env.production` 权限设为 `0600`，不得提交到 Git 或写入日志。
- PostgreSQL 仅连接 Compose 内部网络，不映射宿主机端口。
- Web 通过既有 `ecomsellerkit_internal` 网络接入共享 Caddy。
- 不覆盖共享 Caddyfile；只追加 `ops/Caddyfile.kickoffwhen` 的站点块。
- 切换前分别备份旧站 Git、当前 DNS 记录、共享 Caddyfile和 Pages 部署标识。

## SMTP2GO 接入

在 SMTP2GO 中验证发信域名后，将 SMTP 用户名和密码进行 URL 编码，再只写入服务器上的
`SMTP_URL`。发件人写入 `SMTP_FROM`，必须属于已验证域名。聊天、Git、终端回显和部署记录中
不得出现 SMTP 密码。

Hetzner 实测到 SMTP2GO 的 465 端口超时，2525 和 587 可连接。当前使用
`mail.smtp2go.com:2525`，并设置 `requireTLS=true`，禁止降级为明文连接。

## 2026-09-22 部署状态

- Web/Worker 当前目录：`/root/family-learning/releases/20260922-tts-ratefix1`。
- Web/Worker 当前镜像：`family-learning:20260922-tts-ratefix1`；数据库迁移已执行。
- 上一版目录和镜像 `20260922-ad1f066-prep5` 保留，可用于应用版本回退。
- Web、Worker 已加载 SMTP 配置并重启；生产环境文件权限为 `0600`。
- SMTP 身份验证通过；向部署授权的收件地址发送一封测试邮件，SMTP2GO 活动显示
  `Delivered`。此项验证邮件传输，不等同于已验证应用注册和重置密码的完整流程。
- 旧站 Git bundle、源码候选包、DNS 导出及原 Caddyfile 已备份到
  `/root/backups/kickoffwhen/20260922/`，传输后已校验 SHA-256。
- 共享 Caddy 已加载该备份目录中的 `Caddyfile.candidate`。
- 约北京时间 10:43 完成域名切换和 HTTPS 验收；根域及 `www` 的源站证书均通过
  `curl --resolve` 的系统信任链和主机名校验，未跳过证书验证。
- 公网健康接口返回 `{"status":"ready"}`，登录及注册页返回 200，白名单外注册返回
  403，未登录的家长页面返回 307 到 `/sign-in`，测试邮件读取接口返回 404。
- `www` 以 301 跳转到根域，保留路径和查询参数。同服务器的 `ecomsellerkit.com`
  切换后返回 200。
- 用户已确认家庭账户注册、邮件验证、家长登录、孩子配对登录和任务下发正常；完整听写、报告以及备份恢复演练仍待验收。
- 首次家庭注册被白名单拒绝：初始配置只包含域名联系邮箱。经用户明确授权，已追加
  用户指定的家庭邮箱并重启 Web、Worker。公网使用过短测试密码验证，新允许的邮箱
  已进入密码长度校验，返回 `PASSWORD_TOO_SHORT`；白名单外邮箱仍返回 403。
  本次验证未创建账号或发送验证邮件，实际注册由用户完成。
- 用户完成密码重置后仍不能登录：核对发现密码凭据已更新，邮箱尚未验证；登录页
  将所有认证错误均误报为密码错误。`auth-feedback1` 修复错误分类，并使重置邮件
  请求失败时显示失败而非发送成功，补充投递延迟提示。未修改账号密码或验证状态。
  五项针对性测试、lint、类型检查、生产镜像构建及上线后健康检查通过。

### 切换前旧站版本

- Pages 项目：`kickoffwhen`。
- 当前生产部署：`f832f03b-a981-4ad6-b25e-08c7e57c6aa2`。
- 部署访问地址：`https://f832f03b.kickoffwhen.pages.dev`。
- Git 提交：`7e330298f4851f29b2a4285af3113b14fd3d8e21`。
- 原 DNS：根域及 `www` 均为代理开启的 CNAME，指向 `kickoffwhen.pages.dev`。
- 已切换：根域为代理开启的 A 记录 `178.104.2.101`，`www` CNAME 为
  `kickoffwhen.com`。根域记录类型替换已获用户即时确认。
- 保留旧 Pages 项目及上述部署；未删除旧部署或其源码。

### www 证书验证与边缘跳转

旧 Cloudflare 规则 `www to apex 301` 会将证书验证请求重定向到根域，导致
`www` 证书验证失败。规则 ID：`88249d3d497a4069b144c3f282ff1843`。

原匹配条件：`(http.host eq "www.kickoffwhen.com")`。

现匹配条件：

```text
(http.host eq "www.kickoffwhen.com" and not starts_with(http.request.uri.path, "/.well-known/acme-challenge/"))
```

目标表达式仍为 `concat("https://kickoffwhen.com", http.request.uri.path)`，301，
保留查询字符串。此例外使 Caddy 可以正常签发及续期 `www` 证书。

## 候选部署

1. 将源码放入新的只读版本目录，构建带唯一版本号的镜像。
2. 在新的纯源码目录构建镜像，不复制真实 env 到该目录或 Docker build context。
   部署时继续使用既有受管目录中的 Compose 文件及其相邻、权限为 `0600` 的
   `.env.production`，只切换 `APP_IMAGE`。`-f` 指向既有 Compose 文件；service 的
   `env_file: .env.production` 仍相对该文件解析。CLI `--env-file` 仅提供变量插值，
   不会改写 service 的 `env_file` 路径。仓库 `.dockerignore` 同时排除
   根目录与任意嵌套层级的 `.env*`；匹配规则见 [Docker build context 文档](https://docs.docker.com/build/concepts/context/#matching)。
3. 先启动数据库，执行一次迁移，再启动 Web 和 Worker。
4. 从共享 Caddy 容器内请求 `http://family-learning-web:3000/api/health/ready`。
5. 将 Caddy 站点块追加到现有配置，用 `caddy validate` 验证后 reload。
6. 在切换 DNS 前通过固定 Host 头验证页面、注册限制和健康检查。

## 切换与验收

记录切换前 DNS 值和 Cloudflare Pages 部署标识，再将根域与 `www` 指向 Hetzner。验收：

- HTTPS 和 `www` 跳转；
- 白名单外邮箱不能注册；
- 白名单家庭邮箱能收到验证和重置密码邮件；
- 家长登录、创建孩子、设备配对、切换孩子、听写和报告；
- 数据库和媒体卷不对公网开放；
- 数据库及媒体备份可在隔离位置恢复。

真实 Azure TTS 尚未接线时，不把听写语音标记为生产可用。

## 回退

1. 恢复切换前 DNS 记录，使流量回到 Cloudflare Pages；Pages 自定义域名可能需要重新
   验证并恢复 Active，不能仅凭 DNS 保存成功判断回退完成。
2. 恢复共享 Caddyfile 备份并 reload。
3. 停止 `family-learning` Compose 项目；保留数据库和媒体卷，避免丢失试用数据。
4. 用旧站 Git bundle 或原 Git 远端核对旧站源代码；用记录的 Pages 部署标识确认回退版本。
5. 若需完全恢复原边缘跳转规则，将上方匹配条件恢复为原值。

## Azure Speech F0 接入上线（2026-09-22）

- Azure 订阅已开通；资源 `kickoffwhen-speech`，资源组 `kickoffwhen-family`，区域 `eastus`，定价层 Free F0。
- 候选发布目录：`/root/family-learning/releases/20260922-tts1`；镜像 `family-learning:20260922-tts1`。
- Worker 使用 `AZURE_SPEECH_ENABLED=true` 显式启用；同时需要 `AZURE_SPEECH_ENDPOINT=https://eastus.tts.speech.microsoft.com` 和 `AZURE_SPEECH_KEY`。
- 密钥只写入服务器权限为 0600 的环境文件，不写源码、命令参数或日志。
- 仅运行一个 Worker。语音请求完成后至少间隔 3100ms（失败也限速），适配 F0 每 60 秒 20 次请求上限；已有媒体缓存和任务重试保持生效。
- OCR 仍未启用。本次不创建 Azure Vision 资源。
- 本地验证：lint、typecheck、144 项单元测试通过；服务器生产镜像构建成功。
- 用户通过隐藏输入完成密钥配置。真实合成中文与英文分别返回 11520、12672 字节 MP3。
- 仅切换 Worker 至 tts1，Web 保持 auth-feedback1。已有 3 条 generate_tts 任务全部 succeeded，3 个音频缓存共 49536 字节，无 last_error，公网 ready 健康检查通过。
- 孩子设备上的实际播放与完整听写流程待用户验收。截图出现过误粘贴到命令行的密钥片段，已提醒用户轮换；文档不记录密钥。
- 回退：以旧目录 `20260922-auth-feedback1` 的原 Compose/env 重建 Worker 即可停止新语音调用；保留数据库与音频卷。

## 语速修复（2026-09-22）

- 用户确认听到语音后反馈偏快。根因：Azure SSML 的 `100%` 表示相对加速 100%，原实现错误地把倍率转成百分比；播放器又重复应用任务速度。
- 合成改用数值倍率（1 正常，0.85 略慢），播放保持 1 倍，避免重复变速。默认任务速度仍为 1。
- 150 项单元测试、lint、typecheck 和生产构建通过。相同测试词语自然语速 MP3：中文 21888 字节，英文 24192 字节，明显长于旧实现。
- 数据库备份：`/root/backups/kickoffwhen/20260922/before-speech-ratefix.dump`，权限受限。
- 一次性修复脚本：`/root/backups/kickoffwhen/20260922/repair-speech-rate.ts`。旧音频保留，其 dedupe_key 前缀为 `legacy-rate-percent:`；新音频接替原键，任务与学习进度不变，重新获取任务即可使用新音频 URL。
- 上线前已修复 4 条旧音频；Web、Worker 均启动成功且健康。用户须刷新孩子页面后试听自然语速。
- 回退须同时回退 Web 到 auth-feedback1、Worker 到 tts1，并按旧音频前缀恢复缓存键；不要直接恢复数据库覆盖之后新增的学习记录。

## 今日待办发布（2026-09-22）
Tom 明确确认后，正式 web/worker 更新为 `family-learning:20260922-todos1`，目录 `/root/family-learning/releases/20260922-todos1`。数据库迁移 0019 已完成，历史听写回填遗漏为 0，不追溯发分。健康接口 ready；未登录待办接口返回 401。上线前数据库与媒体备份为 `before-todos.dump`、`before-todos-media.tar.gz`（0600），位于原备份目录。旧镜像和旧发布目录保留，具体回退见 `daily-todos-release.md`。

## 网页录音发布（2026-09-22）
Tom 确认后已发布 `family-learning:20260922-recording1`，web/worker 健康。目录 `/root/family-learning/releases/20260922-recording1`。本站 Permissions-Policy 的 microphone 更新为 self；Caddy 备份 `before-recording.Caddyfile`（0600）。无数据库迁移，旧 todos1 镜像及目录保留。公网 ready、未登录待办401；具体验收及回退见 `recording-release.md`。
