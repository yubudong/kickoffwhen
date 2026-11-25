# 2026-11-25 英语纸笔与键盘听写上线

2026-11-25 11:20:31 UTC（Asia/Singapore / 北京时间19:20:31）部署至 https://kickoffwhen.com/。

## 版本

- 镜像`family-learning:20261125-keyboard-dictation`；镜像ID`sha256:b933bd7de2ec9483bf9e6a39c22b44b5ace3212efff570215b2a1f43db4af0a2`。
- 功能提交`d0da70c`，[PR #7](https://github.com/yubudong/kickoffwhen/pull/7)已合并main（`36d1d372910d982751e27590f968251226901d7e`）；PR和main CI通过。
- 源码包SHA-256 `48728847e6f3e62c5b1a542015ac8695400b6553ed33f5b341f3d52db855c738`。
- 发布目录`/root/family-learning/releases/20261125-keyboard-dictation`。Compose/env仍在`/root/family-learning/releases/20260922-recording1/ops`；仅更新APP_IMAGE，未改Caddy、DNS、SMTP、Azure、数据库/媒体卷或其他项目。
- 上一镜像`family-learning:20261125-english-multi`与旧备份保留。

## 使用

家长进入[布置听写](https://kickoffwhen.com/parent/tasks/new)，选择英语与教材/课次后，在“作答方式”二选一：

- 纸笔听写：原有连续/逐题播放、自己核对或拍照家长批改。
- 键盘听写：一题一屏，听后输入，Enter进入下一题，允许重听时Alt+R重听；手动检查全部输入并明确交卷，不以打字速度计分。

英语标准/辅助提示、速度、次数、重听权限沿用。旧任务均默认纸笔，不把进行中的旧任务强制切换成键盘。新自动创建且未指定作答方式的任务也默认纸笔。

键盘交卷前不返回目标、认可答案列表或音标。任务创建时冻结目标/规则/提示，避免词库后续更正改变已布置任务。输入按服务器草稿保存，独立版本防另一页面覆盖，按家庭/孩子/会话/轮次隔离；未保存输入留在页面内存，不进入localStorage/离线缓存。断网暂停，联网后保存，失败可重试或确认读取最新进度。

整轮交卷后核对必要大小写、空格、词形等。明确认可写法自动通过，已收录常见英美规范变体及不适合自动判分的目标进入家长复核，不把未核对的别名自动视作正确。复核只对本任务生效，原始自动判断和家长决定都保留。

家长在[键盘听写复核与报告](https://kickoffwhen.com/parent/keyboard-dictation)查看首次原始输入、每轮订正和待确认写法；家长中心与听写批改页有入口。孩子确认结果后进入仅错词的新轮次，隐藏答案并清空输入。首次错误不因订正成功而抹去；键盘表现不等于纸面书写能力。

完成后沿用手动提交家长审核任务奖励，无需纸面照片。不会因键盘速度、反复提交、重听或订正多发奖。旧纸笔/照片/自评端点拒绝为键盘任务写入成绩。

## 数据与迁移

一条新增迁移`0029_naive_jimmy_woo.sql`，生产迁移29→30，业务表51→53：

- learning_tasks新增response_mode，默认paper。
- learning_task_items新增keyboard_snapshot，旧记录null。
- 新增dictation_keyboard_drafts、dictation_keyboard_attempts，含家庭/孩子/会话/轮次外键、幂等标识与复核审计。

没有重新导入或修改教材。卡片总数25,503保持（内置语文4,940、英语20,552），原英语多版本/PEP资料保持。

## 发布验证

1. 现有806生产文件与4836f91基线逐项匹配。
2. 共享锁`/run/lock/family-learning-backup.lock`一致性备份数据库、媒体、配置、原列/记录指纹。
3. 恢复到internal隔离网络数据库和独立媒体卷，先核对恢复完整性，再运行实际候选镜像迁移。
4. 原51表旧列/记录指纹保持；旧任务全部paper、旧item快照全null；新53表/30迁移符合预期。
5. 合成家庭只在恢复库跑真实API：纸笔回归、跨出版社选材、键盘草稿/重试、兄弟姐妹隔离、整轮交卷、规范变体复核、首轮与订正、唯一完成事件、报告，以及既有习惯/钱包/伙伴/奖励/PWA。未向生产创建测试家庭，未发送真实邮件或调用真实TTS/AI。
6. 正式切换时重新备份最新数据，迁移后再次核对原事实。43条历史奖励、47历史积分合计、当前2个伙伴及444媒体保持；未重新转换历史积分。
7. 类型/lint/生产构建通过；328单元、216集成、38 Chrome/WebKit浏览器用例、5备份安全测试通过。浏览器包含保存刷新、断网、丢响应重试、首次与订正、家长复核和手机390px。构建保留既有8条媒体动态追踪警告。

## 备份与运行

- `/root/backups/kickoffwhen/20261125-keyboard-dictation-rehearsal`
- `/root/backups/kickoffwhen/20261125-keyboard-dictation-cutover`

目录0700、文件0600；数据库custom dump、媒体、env/Compose/Caddy、旧列/表指纹与文件SHA-256均保留。正式备份覆盖切换时点最新学习记录。隔离演练容器/匿名DB卷/命名媒体卷/网络精确清理，生产与备份保留。

自动age备份任务仍active，沿用每日02:15（Asia/Singapore）及Mac在线每小时异机同步，私钥仅在Mac；备份脚本动态发现业务表，新两表自动纳入后续快照。此前异机恢复见[备份手册](../../ops/backups/README.md)，本轮恢复迁移与API验证在服务器隔离库完成。

820个部署生产文件与源码SHA-256逐项一致。正式后验证首页/ready 200、家长/孩子访问边界、键盘页匿名307、API匿名401、70伙伴素材和6个PWA公共文件哈希；Web healthy、Worker running、重启0、错误日志指标0，ecomsellerkit.com 200，Caddy不变。

## 维护

以GitHub main和`.worktrees/habits-pets`为准。不要重复执行切换脚本或用旧数据库覆盖新学习记录。新增keyboard_snapshot已布置后保持不可变；规范变体复核只保存任务级决策。优先前向修复，旧镜像不理解新键盘任务，不应在已有新作答后直接回退成纸笔流程。
