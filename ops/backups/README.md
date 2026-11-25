# 自动备份与 Mac 异机副本

本轮采用现有Hetzner + 用户Mac，不购买新存储，不向第三方发送真实家庭数据。age v1.3.2官方二进制按GitHub发布资产SHA-256校验后安装到本站专用目录，不覆盖系统工具。

## 实际布局

- 服务器脚本：`/root/family-learning/backup/bin`，加密工具`/root/family-learning/backup-tools/age-v1.3.2`。
- 服务器配置：`/etc/family-learning/backup.json`，只有公钥recipient、工具和目录信息，不保存私钥。
- 加密备份：`/root/backups/kickoffwhen/automatic`，目录0700、文件0600。
- systemd：`family-learning-backup.timer`，每天18:15 UTC，即Asia/Singapore次日02:15；失败10分钟后重试，小时内最多3次。
- Mac私有目录：`~/.local/share/kickoffwhen-backups`，目录0700。
- **私钥**：上述目录的`identity.txt`，0600，仅Mac持有；不得提交Git、上传服务器或在日志/聊天输出。请妥善保存该密钥，丢失会使对应加密副本无法解密。历史服务器手动备份不被本任务删除。
- Mac加密副本在`snapshots`，配置在`config.json`，最近同步状态在`snapshots/status.json`，恢复验证状态在`restore-status.json`。
- Mac用户LaunchAgent：`~/Library/LaunchAgents/com.kickoffwhen.backup-sync.plist`，登录加载及每小时执行一次。Mac睡眠或离线时不能实时同步，在线后按下一次任务补拉。

## 一致性与保留

服务器仅短暂停止原本运行的本站Web/Worker，数据库不停，dump与媒体/配置/哈希取同一时点。finally恢复原本运行的服务，然后用公钥age加密并原子发布。只轮转有完整元数据的专用自动备份，保留14个每日恢复点和8个每周恢复点，至少保留最新两份；不清理发布/手动备份。

Mac仅经现有SSH拉取加密`.tar.age`，校验密文SHA-256并用本地私钥做认证解密校验，输出丢弃，不将明文留盘。成功后才发布完成标记和轮转，保留30个每日与12个月度恢复点。同步失败不删除旧副本。

备份内包含custom数据库dump、媒体归档、原env/Compose/Caddy、表内容指纹与媒体/文件SHA-256。真实恢复演练在Mac受保护临时目录解密，在`--network none`且不发布端口的临时PostgreSQL17中恢复，逐表、逐媒体比对；不启动Web/Worker、不调用邮件或TTS/AI，finally删除临时容器/匿名卷及明文目录。

## 命令

服务器状态与手动执行（SSH hetzner）：

```sh
systemctl status family-learning-backup.timer
systemctl start family-learning-backup.service
python3 /root/family-learning/backup/bin/server_backup.py status
journalctl -u family-learning-backup.service --since today
```

Mac同步/恢复验证：

```sh
/usr/bin/python3 ~/.local/share/kickoffwhen-backups/bin/pull_backup.py
/usr/bin/python3 ~/.local/share/kickoffwhen-backups/bin/verify_restore.py
launchctl print gui/$(id -u)/com.kickoffwhen.backup-sync
```

恢复验证只验证独立副本，不覆盖生产。真正故障恢复需要先保护生产新增记录、明确目标库和媒体卷，并按发布手册操作，不将练习命令当成生产还原。

部署和人工停写应使用同一把锁，避免与夜间自动备份重叠：

```sh
flock /run/lock/family-learning-backup.lock python3 /root/family-learning/releases/<release>/deploy.py cutover
```

首次实际验证：2026-11-25 03:37 UTC在Mac成功恢复服务器快照（28条迁移、50张表、444媒体，逐项一致，网络none，明文已清理）。新功能上线后的再验证结果见本轮正式发布记录。此方案不保证Mac全天在线、异地机房可用或固定RTO/RPO。
