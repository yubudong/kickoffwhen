# 网页录音正式版本 20260922-recording1

## 已确认方案
孩子在待办提交区选择“直接录音”，开始→停止→试听/重新录制→使用录音并提交。停止后留在浏览器内存，点击提交才上传；成功后由现有待办流程显示待审核。最多5分钟、8MB，保留文件上传和不上传选项。

## 实现
- `src/components/todos/todo-submission.tsx`：提交模式、录音UI、试听URL释放、上传失败保留录音。
- `src/modules/todos/recording.ts`：MediaRecorder生命周期、异步授权取消、5分钟/8MB停止、麦克风释放。
- `src/modules/todos/validation.ts`：规范化MIME参数，支持audio/webm及浏览器M4A。
- `src/components/todos/todo-board.tsx`：接入新提交表单，录音中限制切换日期及启动其他任务录音。
- `ops/Caddyfile.kickoffwhen`：本站microphone=(self)，仍需用户浏览器授权；其他权限保持原配置。
- 无数据库迁移。合成音验收页位于被忽略的 `.superpowers/recording-preview`，不进入镜像。

## 验证
164项单元测试、lint、typecheck和本地生产构建通过。录音专项7项覆盖生命周期、超时、超体积、权限拒绝、迟到授权取消及WebM/M4A格式。独立代码审查两项发现已修复并复核。
Chrome实际MediaRecorder使用合成测试音录制14秒，试听时间推进且无播放器错误，生成118483字节WebM，经生产附件格式校验通过。模拟上传失败后保留文件并重试成功；模拟麦克风拒绝提示通过。测试不采集真实声音。
未进行iPhone/Android真机麦克风测试；上线后需用户试录确认音质及权限流程。

## 发布准备
候选目录 `/root/family-learning/releases/20260922-recording1`；镜像 `family-learning:20260922-recording1` 已构建。独立容器启动检查 `/api/health/ready` 返回200 ready。
仅kickoffwhen.com的候选Caddy变更文件位于候选目录`ops/Caddyfile.candidate`，已用当前Caddy验证配置有效。
Tom 已确认上线；正式 web/worker 均为 `family-learning:20260922-recording1`。公网健康检查为 ready，未登录待办 API 返回401，线上响应头为 `camera=(), microphone=(self), geolocation=()`。
原 Caddy 配置备份：`/root/backups/kickoffwhen/20260922/before-recording.Caddyfile`（0600）。本次无数据库迁移。
当前验收浏览器没有正式孩子设备登录，访问孩子端正确跳转配对入口；未额外创建正式设备或采集真实麦克风。

## 上线及回退
确认后备份当前Caddy；继承todos1的生产配置（0600，不打印秘密），更新APP_IMAGE，替换web/worker；验证健康后应用候选Caddy并reload，检查线上Permissions-Policy。
回退应用到todos1，并恢复本次备份的Caddy配置。无需回退数据库；已提交音频及积分记录保留。
