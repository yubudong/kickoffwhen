# Hetzner 生产功能与五年级听写整合手册（2026-09-22）

## 当前状态与边界

- 本文档记录的是本地候选，尚未推送、合并或部署，也未写入正式数据库。
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

## 部署前事项

1. 必须再次获得 Tom 明确部署确认；本地候选不等于已上线。
2. 新建唯一版本 release 目录和镜像，保留 `20260922-recording1`、当前 Compose 配置和 Caddy 备份。不复制或打印密钥。
3. 在停写窗口前备份 PostgreSQL 和 media；先核对生产已有 0019 hash，只应用 0020，再同时切换 web/worker。
4. 运行 ready、登录/白名单、待办、听写建任务/完成自动提交、内置词库幂等导入验收。候选内置 key 与线上现有 builtin 只读检查无身份冲突，但正式导入仍需处于明确授权的部署窗口。
5. 真实 Azure TTS 发音和音质未在本次本地候选中调用；部署后需用授权账号完成小规模人工试听。

## 回退

- 如应用切换失败，只回退 web/worker 到 `20260922-recording1`，保留已执行的 0019/0020、todo 表、`textbook_sections`、卡片元数据、待办/提交/审核/积分历史和媒体。
- 不通过恢复旧数据库覆盖切换后新写入，不删除新表、新词条或历史。`20260922-recording1` 仍保留听写待办的创建/提交联动，但没有新小节、拼音、语境和科目筛选能力；回退后仍需验收既有待办链路。
