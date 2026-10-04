# Hetzner 生产功能与五年级听写整合手册（2026-09-22）

## 2026-10-04 新备份执行前核查（只读历史记录）

- 执行当天新备份前，`/root/backups/kickoffwhen/` 中可核实的最新数据库与媒体备份是 2026-09-24 09:46（北京时间）的 `20260924-evidence-library1` 发布前快照；当时未找到该目录中覆盖之后新增资料的备份。下文的旧快照恢复演练只证明历史快照可恢复；当天稍后已另行制作并验证当前快照。
- root crontab 无有效任务；现有 systemd timers 中未找到家庭学习站备份任务。9 月 23 日的 `deploy-approved.sh` 是发布时一次性备份脚本，未发现定期调度或自动轮转配置。已有 9 月 22、23、24 日备份目录，但没有可证实的保留策略。
- 本次未查看 Hetzner 控制台或其他主机，因此服务器级快照、异机备份状态均**未证实**，不能据此断言其不存在。Tom 随后授权当前数据库与媒体的同一时点备份及隔离恢复验证，执行结果见下一节；定期备份、保留策略和异机保存仍待决定。不得用旧快照覆盖生产。

## 2026-10-04 当前数据库与媒体备份及隔离恢复验证

- Tom 授权后，于北京时间 21:33:24–21:33:32 短暂停止原 Web/Worker 写入，数据库保持运行；Web/Worker 停止后生成数据库与媒体归档，21:33:25 完成快照，随后立即启动原容器，停写窗口约 8 秒。未部署新版本、执行迁移或恢复到生产。
- 新备份位于 `/root/backups/kickoffwhen/current-20261004T133324Z-521ec7d9/`，目录权限 `0700`，两份归档权限 `0600`：`database.dump` 为 225,545 bytes，SHA-256 `765370a870732a5196190d71e0a8d46872ce03dea10b3e9eaa74583365a001a8`；`media.tar.gz` 为 3,411,199 bytes，SHA-256 `8532101442836e7b8e3d08050ffb42fd309e86c310aacad675b5cf9cc85ba958`。演练前后散列一致。
- 在独立 internal 网络、独立数据库及媒体卷中恢复，未发布端口、未启动 Worker、未加载生产 env。`pg_restore --exit-on-error --no-owner --no-privileges` 退出 0；恢复库有 40 张 public 表、23 条迁移（最新 id 23）、312 条内置词、73 个外键、0 个未验证约束。42 个媒体文件共 3,814,285 bytes，恢复文件集合、大小及逐文件 SHA-256 与归档一致。
- 隔离应用检查为 ready=200、`/sign-in`=200、未登录家长待办=401、家长页面=307、测试邮件入口=404；未发信或调用 TTS。北京时间 21:36:09 按资源 ID、唯一标签和独立挂载核对后，仅清理本次 2 个临时容器、2 个临时卷、1 个临时网络，同标签资源剩余 0。
- 原生产 DB/Web/Worker 的容器 ID、镜像、挂载和端口前后未变，均运行、重启计数为 0；DB/Web healthy，公网 `/api/health/ready` 为 `ready/200`。此验证证明本次服务器本地快照可恢复；不等于已建立定期备份、轮转或异机副本，也未验证登录后业务、邮件/TTS、异机灾难切换及 RTO/RPO。

## 2026-10-04 隔离备份恢复演练与发布收尾

- Tom 已反馈真实设备上的听写完整流程验收无问题。当天公网 `/api/health/ready` 复查为 `ready/200`；本地单元测试 204/204 通过。本机 Docker daemon 未运行，因此未重跑集成及浏览器测试。
- 使用 **2026-09-24 发布前快照** `/root/backups/kickoffwhen/20260924-evidence-library1/` 进行真实恢复演练，而非操作当前生产库。临时资源统一使用 `drill-20261004-6c9ed201` 前缀：internal 网络、无发布端口、独立数据库和媒体卷、只读挂载备份；没有连接生产网络或卷，没有加载生产环境文件或密钥，也没有启动 Worker、执行新迁移或切换应用。
- `pg_restore --exit-on-error --no-owner --no-privileges` 退出 0。恢复库有 40 张 public 表、23 条迁移（最新 id 23）、312 条内置词条和 73 个外键，未验证约束为 0。媒体归档内 42 个常规文件共 3,814,285 bytes，恢复后的文件集合及逐文件 SHA-256 均与归档一致。
- 临时 Web healthy、重启 0；ready=200、`/sign-in`=200、未登录家长待办接口=401、家长页面=307、测试邮件接口=404。清理前按资源 ID、标签及挂载核对，仅删除本次创建的 2 个临时容器、2 个临时卷和 1 个临时网络；清理后同前缀资源为 0。生产 DB/Web/Worker 的容器 ID、镜像、运行状态、端口和重启计数前后未变，生产 DB/Web healthy，公网 ready 仍为 200。
- 原备份保留且前后散列一致：`before-release.dump` SHA-256 `2d0e3deaeac8e89afc515f8ecd693c386057ac8975c5f534e24b6bae6cbf7c97`；`before-release-media.tar.gz` SHA-256 `5110bd18b6f109ac556e0a459feb4e956eb4ec5807115399af1dd48f62ba0560`。本演练证明该次快照可恢复，不证明之后新增资料的备份完整性，也未演练异机灾难切换、登录后业务、邮件/TTS 或 RTO/RPO。
- [PR #1](https://github.com/yubudong/kickoffwhen/pull/1) 当天核查时仍为 Open，当时最新提交 `03b09e7` 没有自动检查结果；未合并。本文档记录不改变已上线应用镜像。

## 2026-09-24 听写凭证与教材内容库发布记录

- Tom 授权推送并部署。现有 PR #1 的 `codex/replace-with-learning-site` 分支已推送功能源码提交 `86b2898`；新镜像 `family-learning:20260924-evidence-library1` 从该提交的纯源码归档构建，发布目录为 `/root/family-learning/releases/20260924-evidence-library1`。源码归档传输前后 SHA-256 一致，镜像标记同一完整提交号，镜像内没有 `.env` 文件。
- 本次没有新增数据库迁移，也没有重新导入词库。生产迁移账本仍为 23 条、最新 id 为 23；内置词条 312 条，其中教材词语表必留词 247 条。
- 切换前短暂停止 Web/Worker，将 PostgreSQL 与媒体卷备份到 `/root/backups/kickoffwhen/20260924-evidence-library1/`。备份文件为 `0600`，数据库归档可列目录，媒体归档可列目录，并记录了 SHA-256；旧镜像、旧发布目录和原有受管 Compose/env 均保留。
- 新镜像的生产配置预检通过。切换后 Web 健康、Worker 运行，二者重启计数均为 0；公网 ready 为 200、登录页为 200、未登录家长待办为 401、未登录家长页面重定向为 307、测试邮件读取接口为 404，`www` 保留路径及查询参数跳转到根域。未更改 DNS、Cloudflare Pages 或共享 Caddy。
- 本地发布前验证：204 项单元测试、153 项集成测试、Chromium/WebKit 共 26 项浏览器测试全部通过；lint、typecheck 和生产构建通过。构建仍有 8 条既有的私有媒体动态目录追踪警告。真实设备的拍照提交、听写语音与家长审核仍需 Tom 人工验收。
- 仅回退应用时使用 `APP_IMAGE=family-learning:20260923-tasktree1 sh /root/family-learning/releases/20260923-tasktree1/compose-current.sh up -d --no-deps web worker`；不回滚或覆盖上线后新增的数据库及媒体资料。旧版会恢复听写完成自动提交等旧行为，回退后应暂停使用本次新增的手动提交入口。

## 2026-09-23 分层布置发布记录

- Tom 确认后，已把候选快进推送到现有 [PR #1](https://github.com/yubudong/kickoffwhen/pull/1)；生产镜像源码提交为 `2b701a2`，镜像 `family-learning:20260923-tasktree1`，发布目录 `/root/family-learning/releases/20260923-tasktree1`。PR 尚未合并；既有 Cloudflare 与共享 Caddy 配置未改。
- 迁移 `0021_previous_bushwacker.sql` 与 `0022_free_sebastian_shaw.sql` 已从生产原 `0020` 顺序执行。最新迁移 id 为 23，hash 为 `a46f392509b66c1470cdc5d8cc51941a019b46a28179b261dbc0bcc5a137a397`。旧任务保留默认来源 `manual`；新迁移不删除任务、审核、积分或媒体。
- 发布前用独立数据库演练 0000→0022，原任务、待办、奖励不变。生产停写后备份数据库和媒体到 `/root/backups/kickoffwhen/20260923-tasktree1/`；目录为 0700、备份为 0600，归档可列出且 SHA-256 校验通过，尚未做完整恢复演练。
- 生产迁移前后计数相同：监护人 1、孩子 3、学习任务 5、待办 6、奖励 2、私有词条 11。内置词条仍为 312，其中教材词语表必留词 247。Web 镜像健康、Worker 运行，公网 ready 与登录页均返回 200，受保护的家长/孩子待办接口在未登录时返回 401。
- 本地验证：单元测试 51 文件/193 项、独立测试库集成测试 25 文件/146 项、Chromium 9/9、WebKit 9/9；lint、typecheck、build 成功。构建仍有 8 条既有的 `src/modules/media/store.ts` 动态目录追踪警告。独立代码复审未发现 P1/P2 阻断项。
- Worker 每分钟检查一次，到北京时间 06:00 后按孩子和科目至多生成当天一项到期复习，最多 20 词。任务撤回将学习任务与待办软标记 `cancelled`；已审核通过或有奖励行的任务拒绝撤回。真实设备上的整单元按课布置、继续听写、撤回进行中任务、审核积分及真实 TTS 仍需 Tom 手动验收。
- 管理命令：`sh /root/family-learning/releases/20260923-tasktree1/compose-current.sh ...`，使用受管旧 Compose/env 与新镜像。若要仅回退应用：`APP_IMAGE=family-learning:20260923-dictation1 sh /root/family-learning/releases/20260923-tasktree1/compose-current.sh up -d --no-deps web worker`。不回滚数据库或覆盖切换后的数据；旧版本不认识新增 `cancelled` / `manual_review`，回退后应暂停新的听写布置与批改。

## 2026-09-23 历史整合状态与边界

以下至“2026-09-23 正式发布记录”的整合、候选验证和部署前步骤均是当时的过程记录，不适用于当前生产操作。现行发布、备份恢复演练及应用回退以本文件顶部 2026-10-04、2026-09-24 记录为准；不得重复执行旧迁移、词库导入或旧版切换步骤。

- 2026-09-23 经 Tom 明确确认，候选已更新 PR #1 并部署到 Hetzner；0020 已执行，312 条词库已导入。PR 尚未合并。以下本地验证记录保留为发布前证据。
- 听写分支起点为 `a9cd2d7`，已上线生产源为 Hetzner release `20260922-recording1`，两者共同代码基线为 `ad1f066`。
- 生产源 worktree 全程只读。未读取或复制生产环境文件、密钥、媒体或家庭数据；未发信，未调用真实 TTS。
- 线上只读 SHA-256 核对确认 release 中 209 个 `src`/`scripts`/`drizzle` 文件及列举的包、Docker 和 Compose 文件与本地部署源一致；扩展整合保留检查共对照 212 个生产文件，194 个完全一致，18 个差异均是原 `a9cd2d7` 听写修改覆盖的共享文件，无其他遗漏。

## 整合方式与冲突裁定

1. 以 `ad1f066` 为父提交，把只读部署源的已跟踪变更和明确相关的未跟踪源码、测试、部署模板与 runbook 组装成临时 Git 快照。排除 `.DS_Store`、`.pnpm-store`、`node_modules` 和构建产物。
2. 在听写分支执行 `--no-commit` 三方合并。Git 标出 4 处冲突：`drizzle/meta/0019_snapshot.json`、`drizzle/meta/_journal.json`、`src/app/globals.css`、`src/components/dictation/audio-sequence.tsx`。
3. `audio-sequence` 保留听写分支已拆出的 `AudioPlayback` 状态机，因为它承载暂停、等待、重听、取消旧 run 和题号同步。生产的语速修复改落到 `audio-playback.ts`：Azure 合成已包含任务语速，浏览器只以 `1` 倍播放。
4. `globals.css` 同时保留听写提示/重听样式和每日待办/录音样式。任务服务保留科目筛选，同时在创建与完成事务中创建/提交待办。schema 同时导出 todos 和 `textbookSections`。
5. 孩子首页保持已上线的 `TodoBoard` 交互：标题为“今日待办”，听写待办使用“开始听写”进入或恢复会话。`/child/tasks` 仍是独立听写任务页。

## 迁移顺序与不变性

- 已上线 `0019_bizarre_venus.sql` SHA-256 为 `b478fa8a1b690f45ffd74953316e5cd11f68f8e9ad31395c076cd0d9d85d41f8`；`0019_snapshot.json` SHA-256 为 `b33652b5f21b403f7079a788bc1f14f3e98b25441a7c062d0d4df30631560ae0`。SQL、快照与 journal 的 0019 项保持生产字节不变。
- 生产 `drizzle.__drizzle_migrations` 只读核对的最新记录为 id 20，hash 与上述 0019 SQL 一致，`created_at=1790067178775`。
- 旧听写 `0019_textbook_sections_and_card_metadata.sql` 从候选分支删除（原提交仍可追溯）。从包含 39 张生产表与听写 schema 的完整 schema 重新生成 `0020_textbook_sections_and_card_metadata.sql` 及 0020 快照，journal 时间戳 `1790088568814` 大于 0019。
- 0020 只新建 `textbook_sections`，为 `learning_cards` 新增 `pinyin_text`、`curriculum_source`、`source_order`、`section_id`，并增加相关外键、索引和检查约束。它不创建或删除 todo 表，也不重复执行 0019 的待办回填。
- 独立容器 `grade5-dictation-integration-db`（`127.0.0.1:55432`）中已验证 0000→0019→0020。迁移记录数 20→21；在 0019 后插入的 `learning_tasks`/`todo_tasks` 升级后仍为 `active`/`open`，待办数仍为 1。

## 本地验证证据

- 音频 RED：聚焦单测修复前 2 个断言分别观测到 `0.85` 和 `1.25`，应为 `1`。GREEN：`audio-sequence` + `audio-playback` 2 文件 11 项全通过。
- Unit：49 文件、190 项通过。Integration：20 文件、140 项通过。带 `subject` 的听写创建同步生成待办，听写完成同一事务内生成提交。
- `pnpm lint` 和 `pnpm typecheck` 通过。完整测试环境构建 exit 0，编译、TypeScript、40 页静态生成全部成功。仍有 8 处既有 `src/modules/media/store.ts` 动态文件追踪警告，本次无新增构建错误。
- `pnpm seed:content --validate-only` 通过：中文 8 单元、22 小节、312 卡。247 必留；41 个原辅助词中替换 12 个；223 个所属课次写字字符位无缺失。
- 在同一新建本地测试库中两次执行真实 312 条 seed CLI：首次 `inserted=312/updated=0`，第二次 `inserted=0/updated=312`，验证幂等更新；英语为 0。未连接真实 TTS 或生产库。
- 听写 E2E 使用静音夹具，Chromium 2/2、WebKit 2/2，合计 4/4 通过；播放倍率唯一观测值为 `[1]`。
- 最终审查修复中，`.dockerignore` 增加 `**/.env*`，以防止 `COPY . .` 接收任意嵌套
  的环境文件。`scripts/check-docker-context.sh` 用 `FROM scratch` 和固定假字符串验证根目录、
  `ops/` 与更深层 env 全部排除，普通 marker 仍会进入上下文。该 `.dockerignore`
  现有意与生产快照不同；本次未读取真实 env，也未访问生产环境。

## 2026-09-22 历史部署前事项（已过时，不得作为当前操作清单）

1. 必须再次获得 Tom 明确部署确认；本地候选不等于已上线。
2. 新建唯一版本 release 目录和镜像，保留 `20260922-recording1`、当前 Compose 配置和 Caddy 备份。不复制或打印密钥。
3. 在停写窗口前备份 PostgreSQL 和 media；先核对生产已有 0019 hash，只应用 0020，再同时切换 web/worker。
4. 运行 ready、登录/白名单、待办、听写建任务/完成自动提交、内置词库幂等导入验收。候选内置 key 与线上现有 builtin 只读检查无身份冲突，但正式导入仍需处于明确授权的部署窗口。
5. 真实 Azure TTS 发音和音质未在本次本地候选中调用；部署后需用授权账号完成小规模人工试听。

## 2026-09-22 历史候选回退方案（当前回退以 2026-09-24 发布记录为准）

- 如应用切换失败，只回退 web/worker 到 `20260922-recording1`，保留已执行的 0019/0020、todo 表、`textbook_sections`、卡片元数据、待办/提交/审核/积分历史和媒体。
- 不通过恢复旧数据库覆盖切换后新写入，不删除新表、新词条或历史。`20260922-recording1` 仍保留听写待办的创建/提交联动，但没有新小节、拼音、语境和科目筛选能力；回退后仍需验收既有待办链路。

## 2026-09-23 正式发布记录

- 源码提交 `7b0913c`，PR 快照 `44aac5d`；镜像 `family-learning:20260923-dictation1`，发布目录 `/root/family-learning/releases/20260923-dictation1`。真实环境文件未进入新源码目录或镜像。
- 先完成服务器镜像构建，再停止 web/worker 写入，备份数据库与媒体到 `/root/backups/kickoffwhen/20260923-dictation1/`。目录 0700、备份 0600；数据库归档目录可读、媒体压缩包可列出，尚未进行完整恢复演练。
- 原 0019 hash 已匹配；0020 迁移成功，词库审计通过，正式导入 `inserted=312 / updated=0`。迁移前后账号、孩子、学习任务、待办和私有词条数量完全一致。
- 正式库 312 条逐项比对源码：词语、播报文本、拼音、语境、来源、单元和小节一致；247 必留词保留，拼音/语境/小节无缺失，播报文本不包含语境。
- 公网 ready=200，登录页=200，未登录待办接口=401，未登录家长布置页=307。首次 ready 请求在切换期间为 503，随后公网及容器内部均恢复 200。保留录音 microphone=(self)。
- 本次未更改 DNS、Cloudflare Pages 或共享 Caddy；未发送邮件、未操作家庭任务或调用真实 TTS。真实设备上的发音、暂停/重听和完整任务流程仍需 Tom 试听验收；英语教材内容仍待提供。
- 管理命令：`sh /root/family-learning/releases/20260923-dictation1/compose-current.sh ...`，默认使用新镜像及既有受管 Compose/env。不要直接运行新源码目录的 Compose，也不要裸用旧 Compose 的旧 APP_IMAGE 默认值。
- 应用回退命令：`APP_IMAGE=family-learning:20260922-recording1 sh /root/family-learning/releases/20260923-dictation1/compose-current.sh up -d --no-deps web worker`。保留数据库、媒体、新词条和全部历史，不恢复旧库覆盖新写入。
