# 开发进度与新窗口交接

更新时间：2026-10-13（Asia/Singapore）。用户：Tom，默认用中文沟通。

## 当前结论

2026-10-13 12:13（Asia/Singapore），听写回听、从头重新听写及家长照片逐词批改已部署到 https://kickoffwhen.com/。正式镜像 `family-learning:20261013-dictation-parent1`，Web healthy、Worker running，数据库迁移0000–0023共24条。

已从当前生产运行容器取得完整源码，保留首页双登录、教材按课批量布置、拼音语境、任务撤回、加练与待办凭证/积分审核等既有功能，再合入本轮改动。原开发树 `/Users/yubudong/.codex/worktrees/1540/学习管理网站` 的其他工作未覆盖。

## 2026-10-13 本轮交付

- 听写中保留重听当前词，新增回听上一个词、从本轮第一个词重新听写。重开需要确认，回到准备页后主动开始；逐题已批记录保留，不重复记分或更新FSRS。
- 发布任务可选孩子自批或家长批改，支持教材批量与单独加练。旧任务默认self。
- 家长批改任务听完上传1至4张照片（JPG/PNG/WebP，每张最多8MB），家长通过“听写批改”逐词判对错，错词订正后再次拍照；孩子端不显示标准答案。
- 听写完成后保留原待办凭证提交和家长积分审核；上传批改照片不会自动发分。报告区分批改来源，保留首轮结果。
- AI只预留 `DictationGradingProvider.propose` 接口，未接入外部AI。
- 245项单元测试、160项集成测试、28项Chrome/WebKit浏览器用例通过；lint/typecheck与服务器生产构建通过。构建保留8条原有媒体追踪警告。
- 切换前已备份数据库、私有媒体、配置；完成隔离恢复与迁移演练，原40张表内容指纹不变。正式迁移后逐表核对通过；原54个媒体文件完整且哈希一致。
- 正式域名使用临时家庭跑通发布、配对、回听记录、重开、两轮照片家长批改、订正、报告、自批和照片鉴权；临时家庭/作业/媒体已精确清理，没有发邮件或外部TTS/AI调用。
- 发布和回退细节见 [本次发布记录](runbooks/dictation-parent-release.md)，使用与接口见 [功能交接](runbooks/dictation-parent-grading.md)。

## 已交付功能

- 家长注册、邮箱验证、登录及密码重置；SMTP2GO 邮件与 Azure Speech 已配置，Tom 已实际使用。
- 今日待办支持任务名称、要求及操作；今日听写自动进入孩子待办，原学习内容录入整合进今日听写。
- 孩子可不上传资料，或上传图片、音频、视频；支持网页直接录音、停止、试听、重新录制和提交，录音最多 5 分钟、8MB。
- 提交后显示勾选、任务删除线和待审核；审核退回不发分，可重新提交；审核通过后孩子可见通过状态，即时发基础 1 分加家长手动填写的奖励积分。
- 首页并列显示家长登录与孩子登录。孩子列表默认隐藏，点击孩子登录才展开本浏览器已配对且获授权的孩子；仅一个孩子也需主动选择，设置了儿童口令则继续校验。未配对时显示配对入口。
- 家长已登录时仍可访问首页并选择孩子入口。

## 2026-10-12 首页上线记录（历史）

- SSH 别名：`hetzner`。
- 当前记录的正式镜像：`family-learning:20261012-home-login1`。
- 上一版及回退镜像：`family-learning:20261004-report-9c21f32`。
- 发布目录：`/root/family-learning/releases/20261012-home-login1/`。
- 正式 Compose 目录：`/root/family-learning/releases/20260922-recording1/ops`。
- 上线前备份：`/root/backups/kickoffwhen/20261012/`。
- 本次首页上线无数据库迁移；待办的 0019 迁移已在此前部署执行。
- 上一轮验证：168 项单元测试、lint、typecheck、生产构建通过；线上 ready 200、首页双入口、未配对 API 和浏览器展开提示检查通过，服务日志无异常。
- 线上真实已配对设备的孩子选择流程，等待 Tom 使用确认；此前待办下发、孩子登录及录音已获 Tom 使用反馈。

## 新窗口接手注意

1. 最新完整发布源码：`/Users/yubudong/code/学习管理网站/.worktrees/release-20261013-dictation-parent1`，来源及操作状态见 `docs/runbooks/deployment-20261013-state.md`。原1540工作树落后于本次对齐结果，不能再全量覆盖线上。
2. 原工作区有用户未提交工作，不能清理、覆盖或打包无关改动。正式Compose仍在 `/root/family-learning/releases/20260922-recording1/ops`，只切换APP_IMAGE。
3. 不打印密码、密钥、Cookie或生产环境文件内容。生产env及备份文件保持0600。
4. 本次部署、迁移和验证已经Tom授权且已执行，不要重复部署。后续生产变更需按新的用户要求处理。
5. 仍请Tom使用真实手机照片与实际朗读音频验收；自动化使用合成的短静音与测试照片，不代表真实照片清晰度或设备扬声器体验。

## 相关文档

- [听写与家长批改发布记录](runbooks/dictation-parent-release.md)
- [功能与AI接口交接](runbooks/dictation-parent-grading.md)
- [首页双登录上线与回退](runbooks/home-login-release.md)
- [网页录音发布记录](runbooks/recording-release.md)
- [今日待办发布记录](runbooks/daily-todos-release.md)
- [部署操作说明](runbooks/kickoffwhen-deployment.md)
