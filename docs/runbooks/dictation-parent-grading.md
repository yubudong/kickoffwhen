# 听写回听、重新听写与家长照片批改

开发日期：2026-10-13（Asia/Singapore）。已部署至 kickoffwhen.com，正式镜像 `family-learning:20261013-dictation-parent1`；详见 [发布记录](dictation-parent-release.md)。

## 使用流程

- 发布“今日听写”时选择“孩子自己批改”或“提交给家长批改”。已有任务默认沿用孩子自批，新选项不会修改旧任务。
- 听写中可暂停、回听上一个词、从头重新听写。回听会停止正在播放的音轨，听完回到“继续听写”；继续时从尚未完成的词开始。
- “从头重新听写”需要确认，确认后回到准备页，由孩子再次点击“开始听写”。重听从本轮第一个词开始；订正轮只包含该轮错词。
- 逐题练习中已经批过的词会重新播放，保留原批改，不再要求重复批改。重开和回听不会覆盖首轮成绩或重复更新 FSRS。
- 家长批改任务听完后，孩子上传1至4张 JPG、PNG 或 WebP 照片，每张不超过8MB。孩子端不显示标准答案，也不能调用自批接口绕过家长。
- 家长进入导航中的“听写批改”，对照照片逐词选择“正确 / 错了”，全部标记后保存。照片可打开原图查看；桌面版长词表滚动时照片保持可见。
- 有错词则孩子继续本轮错词订正，重新上传照片，再交家长批改；全对后完成听写。等待页每5秒自动检查进度，也可手动刷新。
- 今日待办显示听写待批状态和批改入口。听写全部完成后仍沿用原来的待办积分审核，不因上传照片就发放积分。
- 学习报告区分孩子自批与家长照片批改，保留首轮正确率和订正事实。

## 数据与权限

- `learning_tasks.grading_mode` 只接受 `self / parent`，默认 `self`。
- 新表 `dictation_submissions` 保存每次提交的照片元数据、内容哈希、轮次、批改结果、家长身份及时间。
- `awaiting_parent` 表示已经提交，等待家长批改。此阶段禁止孩子重开覆盖待批作业。
- 命令使用会话行锁、版本检查及稳定命令 ID。相同照片的重试根据内容哈希识别；新生成但未使用的文件会清理，提交失败也清理尚未绑定的文件。
- 上传在读取文件前校验孩子对会话的权限，限制请求体（含无 Content-Length 的流式上传）、照片数量、大小与文件头。
- 照片复用现有私有附件存储，磁盘位置为 `MEDIA_ROOT/todo/<uuid>`；访问统一走 `/api/dictation-photos/<id>`，校验家长家庭或孩子归属，返回 private/no-store。
- 等待页使用串行轮询、取消在途请求和版本比较，避免慢响应把新进度覆盖为旧状态。

## AI 批改预留

接口定义在 [`src/modules/dictation/grading-types.ts`](../../src/modules/dictation/grading-types.ts) 的 `DictationGradingProvider.propose`：输入照片字节及本轮标准词语，输出逐词判断、置信度、说明、供应商和模型；无法判定时可返回 `correct: null`。

目前没有 AI 实现、配置、后台任务或外部调用，也没有可选的 AI 批改入口。后续接入先产出建议，再由已认证家长确认后走统一批改服务；AI 不直接修改首轮事实或完成任务。

## 主要变更位置

- 播放控制：`src/modules/dictation/audio-controller.ts`、`audio-playback.ts`、`session-machine.ts`、`src/components/dictation/audio-sequence.tsx`。
- 会话与任务：`src/modules/dictation/session-service.ts`、`task-service.ts`、相关 types/schema/view，以及发布任务表单。
- 上传与权限：`submission-http.ts`、孩子 submission API、`/api/dictation-photos/[id]`。
- 家长批改：`src/components/dictation/parent-review-board.tsx`、`/parent/dictation-reviews` 及配套 API。
- 待办状态、报告批改来源、导航和样式同步更新。
- 回归测试：听写状态机、音轨中断、发布选项、文件提交、跨家庭访问、幂等、逐题中途重开、家长批改完成报告，以及 Chrome/WebKit 的完整照片批改流程。

## 验证与发布

2026-10-13，完整生产基线对齐后的候选版本：

- 245项单元测试、160项隔离数据库集成测试通过。
- 28项Chrome/WebKit浏览器用例通过，覆盖注册登录、教材批量布置、设备切换、旧听写/待办凭证、新照片批改；新流程检查桌面与390px手机宽度截图。
- lint、typecheck、服务器生产镜像构建通过。构建保留8条既有媒体动态文件系统追踪警告；构建上下文仅白名单源码，无env、媒体和本机文件。
- 0023从线上完整0022快照重新生成；0000–0022迁移哈希逐一对齐生产。空库、生产备份恢复库及正式库均应用成功，原40张表的历史内容不变。
- 先备份、隔离恢复/迁移/闭环演练，再正式切换；正式域名API闭环与权限检查通过。临时测试家庭及媒体清理完毕，原54个媒体文件哈希一致。
- AI未启用，验证未发送邮件或调用外部TTS。真实音频及手机照片体验仍需实际使用验收。

验证命令使用项目Node24环境，直接运行本地工具：`node node_modules/vitest/vitest.mjs run tests/unit`；`node node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts tests/integration --no-file-parallelism`；`node node_modules/@playwright/test/cli.js test --workers=1`。测试数据库必须为隔离库，禁止指向生产。

详细镜像、备份位置、数据保留证据和回退限制见 [发布记录](dictation-parent-release.md)。
