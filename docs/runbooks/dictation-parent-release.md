# 2026-10-13 听写控制与家长照片批改发布

Tom已明确授权对齐最新线上源码/迁移、备份、部署与验证。正式切换完成于2026-10-13 04:13:22 UTC（Asia/Singapore 12:13:22）。

## 版本与来源

- 当前Web/Worker镜像：`family-learning:20261013-dictation-parent1`。
- 镜像ID：`sha256:c5ce9090ee93c529988206b2f3dc5f279e93fa646bf492d122c21cfca80ce76c`。
- 回退镜像：`family-learning:20261012-home-login1`，原镜像保留。
- 发布目录：`/root/family-learning/releases/20261013-dictation-parent1`。
- 正式Compose/env目录：`/root/family-learning/releases/20260922-recording1/ops`，只替换APP_IMAGE，继续挂载原数据库及私有媒体卷。
- 最新完整工作树：`/Users/yubudong/.codex/worktrees/dictation-parent-release/学习管理网站`。
- 本地保存分支：`codex/dictation-parent-release-20261013`；功能源码提交 `1fc87954aa671cf4d2d5d75f218b50a3b1aa5305`，尚未推送。
- 对齐方式：Git9c21f32归档补足测试与文档，叠加当前运行容器白名单源码（含10月12日首页），再三方合入本次功能。保留教材批量、拼音/语境、manual_review、撤回事实与待办凭证/积分审核。未覆盖原工作区无关改动。
- 运行源码包SHA256：`14f622a1dca4159c483a29cfd2c742d6b6f14ecf7c29f3ba18e4498a2497620e`。
- 本次构建源码包SHA256：`78759592ba8025956e5df17e1e6b5b40f482549db3a9449344cc785bcd7092b6`。

## 备份与数据保留

两份服务器本地备份均为0700目录、0600文件，保留数据库custom dump、私有媒体tar.gz、原env/Compose/Caddy、表计数和内容指纹、SHA256清单：

- 演练备份：`/root/backups/kickoffwhen/20261013-dictation-parent1`，暂停Web/Worker约4.8秒后立即恢复。
- 正式切换时点：`/root/backups/kickoffwhen/20261013-dictation-parent1-cutover`。切换至健康共约18秒。

演练在独立internal Docker网络恢复数据库和媒体，不启动Worker、不启用SMTP/外部TTS/AI。恢复后原40表内容指纹/计数一致、54媒体文件齐全；应用0023后原表指纹仍不变。演练资源已清理，备份保留。

正式迁移前后逐表内容指纹一致，旧13项听写任务全部默认self；8会话、323词卡、52媒体记录、16待办、2奖励保留。验证结束后业务表无变化，54个磁盘媒体文件哈希一致且无测试媒体残留。设备/孩子会话仅last_active_at变化；限流表因验证及自动过期清理变化，未覆盖已有用户记录。

0000–0022 SQL哈希与生产23条迁移记录逐一一致。0023从完整0022快照生成，只新增批改提交表、grading_mode默认self、扩展会话phase和命令type检查。现在迁移共24条，未删除旧列、旧表或历史作业。

## 验证结果

- 245项unit、160项integration通过，lint/typecheck通过。
- 28项Chrome/WebKit E2E通过：22项先通过，6项听写在更新旧文案断言及提交中disabled按钮断言后复跑通过；不改变生产行为或超时。新增完整照片流程2项分别已通过。
- 服务器生产构建通过，保留8条原有媒体追踪警告。未复制env、真实媒体或本机文件进构建上下文。
- 独立只读审查未发现P1/P2问题。
- 恢复库和正式域名均用独立临时家庭验证：家长登录、批量发布、孩子配对、回听记录、重开及刷新恢复、照片提交、家长逐词判对错、错词订正与第二轮提交、报告、自批保留、照片未登录401。
- 验证仅用短静音音频与测试照片，预置私有音频缓存；没有发送邮件或外部TTS/AI调用。临时家庭/作业/词卡/媒体均在finally按ID精确清理，无临时账号残留。
- 公网ready和首页200；未登录家长批改API401；Web healthy，Worker running，重启次数0，发布后日志无error/fatal/unhandled指标。
- 共享Caddy文件哈希未变；同服务器ecomsellerkit.com仍200。未改DNS或其他服务。

## 回退

旧镜像、配置和卷均保留。若必须回退应用，先停止本站Web/Worker，将正式env中的APP_IMAGE恢复为 `family-learning:20261012-home-login1`，保持其他配置/卷不变，再用既有Compose重建两服务并检查健康。

0023是增量迁移；应用回退时保留新表、新字段、提交照片和批改记录，不直接恢复整个旧数据库覆盖发布后的新增学习数据。旧应用不理解awaiting_parent等新状态，若已有新模式作业，优先修复前进；回退前必须核对受影响任务。完整数据库恢复仅用于经另行授权的数据灾难恢复。

本次切换脚本 `/root/family-learning/releases/20261013-cutover.py` 内置切换失败时恢复原APP_IMAGE；正式切换成功，未触发回退。不要重复运行迁移/切换脚本。

## 使用验收

家长在“今日听写”选择批改方式；孩子听写页可回听上一个词或确认从头重新听写；家长批改模式听完拍照，在“听写批改”页逐词批改。听写完成仍沿用原待办证据提交及积分审核。

AI仅预留建议接口，暂未接入。Tom仍可用真实手机照片与实际朗读音频验收照片清晰度、扬声器播放和操作手感。
