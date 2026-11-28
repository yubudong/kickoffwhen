# 2026-11-28 常用任务模板上线

2026-11-28 12:10:36 UTC（Asia/Singapore / 北京时间20:10:36）部署至 https://kickoffwhen.com/。

## 版本

- 镜像`family-learning:20261128-task-templates`，ID`sha256:52184feecb1ea7f0e9f16a87644ada34e609c5d222f2bfe86cd235f478290c58`。
- 功能提交`dfbc064`，[PR #9](https://github.com/yubudong/kickoffwhen/pull/9)合并main（`b70958b710bf18e3ce61213a7ac6521c75a71238`），PR与main CI通过。
- 源码包SHA-256 `6811ef0332548a80508252ff35b625243a563ec11187a2e645e4be47e6074d3c`。
- 发布目录`/root/family-learning/releases/20261128-task-templates`；上一镜像`family-learning:20261125-homework-review`保留。
- Compose/env仍在`/root/family-learning/releases/20260922-recording1/ops`，仅更新APP_IMAGE。未改Caddy、DNS、SMTP/Azure、数据库/媒体卷及其他项目。

## 使用

家长在[待办清单](https://kickoffwhen.com/parent/todos)打开“添加待办”：

1. 填写任务名称、要求、基础星币/成长值和确认方式，点“保存为常用模板”。保存模板本身不创建任务或发奖。
2. 下次添加时点选常用卡片，自动填入以上字段；孩子与日期保持当前选择，确认后“添加到清单”。本次可以临时修改要求/奖励，不更改模板。
3. 常用模板支持名称/要求搜索和管理；编辑后只影响以后选用。删除从列表移除，旧任务、作业、成绩、批注和奖励保留。
4. 模板家庭内共享，不绑定孩子和日期，不自动建立重复习惯。有效模板每家庭最多200个。

模板管理与编辑使用单独按钮及确认对话框。模板选中后可将当前内容另存为新模板；不把对本次任务的临时调整误写回原模板。

## 数据与权限

仅新增`todo_task_templates`表，迁移`0031_chemical_salo.sql`，生产迁移31→32、业务表58→59。原表/列/数据不改动，任务下发继续使用原任务创建服务及独立内容快照。

表绑定家庭和创建家长，含创建命令/指纹、revision、最后修改命令/指纹、时间与软删除标记。家庭行锁保护并发数量上限；创建/修改/删除幂等，旧revision不会覆盖新的模板。接口`/api/parent/task-templates`仅解锁家长可访问，家庭身份来自会话，不接受客户端familyId。孩子和未登录不能读取或写入。

GET响应private数据no-store，POST校验来源、体积与严格字段；模板不含孩子、日期、作业附件等任务事实。异步读取有版本保护，避免旧列表响应隐藏刚保存的模板。

## 验证

- 330单元、228集成、42项Chrome/WebKit全站浏览器、5项Python备份安全测试及typecheck/lint/生产构建通过。
- 新用例覆盖保存不创建任务/奖励、丢响应重试、字段填充、切换孩子/日期、模板修改删除后旧任务保持、200个上限、家庭/孩子权限、revision冲突及手机390px。
- 完整教材测试库包含已有词库，原多页作业、录音/音视频、纸笔/键盘听写、审核、伙伴、奖励和PWA回归通过。教材内容未变。
- 现有839生产文件与2a44a6a基线逐项核对。锁定备份后恢复到internal隔离DB/媒体卷，先验证恢复完整性，再迁移候选镜像，原58表旧列/记录指纹保持。
- 真实候选镜像API验证模板增改删/幂等/过期冲突、保存不下发、旧任务快照不变与孩子拒绝访问；同时复验原作业、听写、习惯、伙伴、奖励等全链路。
- 合成家庭仅在恢复库创建，没有向生产写入测试模板或任务；未发送真实邮件，未调用真实TTS/AI。

## 备份与生产保持

- `/root/backups/kickoffwhen/20261128-task-templates-rehearsal`
- `/root/backups/kickoffwhen/20261128-task-templates-cutover`

共享锁`/run/lock/family-learning-backup.lock`，目录0700、文件0600，保留custom dump、媒体、配置、旧表/列指纹和文件SHA-256。正式切换重新做最新时点备份。

上线时保持25,503卡片、497媒体文件、57条历史奖励/63历史积分合计、2伙伴/2记忆及旧任务、批注和复习记录。数值为快照时点，不限制后续正常学习增长。隔离容器/匿名DB卷/命名媒体卷/网络在验收后精确清理，生产与备份保留。

自动age备份和Mac在线小时同步沿用，新增表会动态纳入后续快照，私钥只在Mac。异机恢复方法与限制见[备份手册](../../ops/backups/README.md)。

847个部署生产文件与源码SHA-256一致，Web healthy、Worker running、重启0、错误日志指标0。公网检查首页/ready、匿名模板GET/POST 401、原页面访问保护、70伙伴素材和6个PWA文件哈希、Web/Worker状态与日志、ecomsellerkit.com 200、Caddy哈希不变。

## 接续

以GitHub main和`.worktrees/habits-pets`为准，不用旧主目录main覆盖线上。不要重复执行切换脚本或用旧库覆盖新学习记录。模板独立保存，不应在以后添加“自动更新已下发任务”的隐式行为。
