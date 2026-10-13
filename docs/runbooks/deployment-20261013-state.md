# 2026-10-13 听写功能发布执行状态

Tom已授权：对齐线上完整源码及迁移，备份后部署kickoffwhen.com，保留功能/数据并验证本次流程。

- 原开发树：`/Users/yubudong/.codex/worktrees/1540/学习管理网站`，保持原有未提交工作。
- 完整发布候选：`/Users/yubudong/code/学习管理网站/.worktrees/release-20261013-dictation-parent1`。由Git 9c21f32归档取得测试/部署配置，叠加运行容器白名单源码，再三方合入本轮功能差异。
- 已确认生产web/worker镜像：`family-learning:20261012-home-login1`；镜像ID `sha256:5a0fe4b7bd1e2232feaa9ac4cb823a470cd373b64b840b68fe56c8bdffddf709`，基线源码9c21f32加10月12日首页叠加。
- 运行源码归档 `/tmp/kickoffwhen-live-source-20261013.tgz`，SHA256 `14f622a1dca4159c483a29cfd2c742d6b6f14ecf7c29f3ba18e4498a2497620e`；仅白名单src/drizzle/scripts和包配置，未读取生产环境文件。
- 生产迁移23条（0000–0022），latest created_at=1790129006795。只读计数：40张public表、13听写任务、8会话、323词条、52媒体记录、16待办、2奖励；正式迁移尚未执行。
- 本轮0023已从线上0022完整快照重新生成，并在本地隔离空库成功执行。未部署。
- 合并冲突10个文件。子任务merge_playback处理播放器/experience保留拼音语境及完成阶段听写凭证；merge_tasks_todos处理任务/待办保留教材批量布置和凭证附件；主代理处理报告、迁移、测试、备份及发布。
- 报告合并保留withdrawn事实并区分self/parent。child-view fixture保留builtin参数并新增gradingMode参数。
- 下一步：完成冲突合并与完整验证；独立审查；服务器候选镜像构建；同一时点DB+媒体备份及隔离恢复/迁移/流程演练；正式迁移/切换/验收；保留旧镜像回退并更新记录。
- 用户已授权部署与为本次发布所必需的生产操作，不需再次询问同一授权。禁止打印密码、密钥、Cookie或私有数据。

## 验证与备份进展

- 245项unit、160项integration、lint/typecheck通过；家长照片流程Chrome/WebKit2项通过；既有全套E2E先26pass2fail（提示文案），调整后发现长流程测试提交时点击disabled切换按钮造成gate死锁，已由merge_playback只改测试断言并复跑6项。
- 独立release_review只读审查未发现P1/P2；src差异均在功能清单；scripts无差异；0022snapshot和0000–0022SQL均与线上一致。
- 新镜像family-learning:20261013-dictation-parent1服务器构建通过，ID sha256:c5ce9090ee93c529988206b2f3dc5f279e93fa646bf492d122c21cfca80ce76c。源包/tmp/kickoffwhen-release-20261013.tar.gz SHA256 78759592ba8025956e5df17e1e6b5b40f482549db3a9449344cc785bcd7092b6。
- 备份/root/backups/kickoffwhen/20261013-dictation-parent1（0700目录、0600文件）：database.dump、private-media.tar.gz、env.production、compose.production.yml、Caddyfile、baseline.json、sha256.json。暂停约4.8秒后旧服务恢复healthy。
- 已在无外网internal网络kickoffwhen-rehearsal-20261013恢复备份；原40表内容指纹/计数及54媒体文件一致；迁移0023后原40表未变，旧任务全部self。
- 隔离服务kickoffwhen-rehearsal-web-20261013+db已启动，新镜像真实production进程API闭环验证通过：家长登录/批量下发/配对/回听记录/重开/照片上传/两轮家长批改/订正/报告/self保留/照片401。仅synthetic临时家庭，finally精确清理，无email/TTS外部调用。验证脚本/tmp/kickoffwhen-verify-release.ts，服务器版本目录verify-release.ts和short-silence.mp3。
- 正式切换脚本已准备但未执行：/root/family-learning/releases/20261013-cutover.py。执行前等最后6项E2E结果。脚本停止web/worker并重做cutover时点备份，再迁移/核对原数据指纹/只切换APP_IMAGE/重建webworker/health。失败自动恢复旧APP_IMAGE，保留增量迁移。

## 最终状态

- 28E2E通过（22已通过+6听写复跑通过）；最终lint/typecheck exit0。没有修改生产播放器代码来迎合旧测试。
- 2026-10-13 04:13:22 UTC正式切换成功；新image为20261013-dictation-parent1，迁移24条，原40表迁移前后指纹一致。切换时点备份/root/backups/kickoffwhen/20261013-dictation-parent1-cutover，耗时18秒。
- 正式域名API synthetic闭环通过，清理完成，无临时user和新提交残留。原54个媒体文件hash一致、无测试媒体残留。仅设备/child_sessions.last_active_at与限流表正常变化；未改业务历史数据。
- 公网ready/home200、新批改API匿名401、ecomsellerkit200、Caddy未变，Webhealthy/Workerrunning/restarts0，错误日志指标0。
- 生产内临时验证脚本与静音文件已按root精确删除；服务器恢复演练容器/卷/网络已清理，备份保留。发布记录docs/runbooks/dictation-parent-release.md。

- 已逐一核对线上src/drizzle/scripts共241文件与本地候选，hash完全一致。将该候选保存为独立codex/dictation-parent-release-20261013分支，包含线上完整基线、本次功能与发布文档，不触碰原用户工作区索引。

- 最新已附加的托管工作树：`/Users/yubudong/.codex/worktrees/dictation-parent-release/学习管理网站`，分支codex/dictation-parent-release-20261013，源码提交1fc87954aa671cf4d2d5d75f218b50a3b1aa5305。原候选目录保留；后续开发以此托管工作树为准。原1540及主工作区未改动。演练与本地测试数据库已清理，两份生产备份、旧镜像保留。
