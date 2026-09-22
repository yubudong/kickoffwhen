import Link from "next/link";

import type {
  CardHistory,
  ReportDashboard,
  SessionReport,
  WeeklyReport,
} from "./types";

function percent(value: number | null): string {
  return value === null ? "暂无数据" : `${Math.round(value * 100)}%`;
}

function shanghaiTime(value: Date): string {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Shanghai",
  }).format(value);
}

const taskLabels = {
  not_created: "今日还未创建听写",
  in_progress: "今日听写进行中",
  completed: "今日听写已完成",
} as const;

export function ReportsOverview({ dashboard }: { dashboard: ReportDashboard }) {
  return (
    <div className="report-stack">
      <section className="report-section">
        <h2>今日任务</h2>
        <div className="report-grid">
          {dashboard.children.map((child) => (
            <article className="report-card" key={child.childId}>
              <h3>{child.nickname}</h3>
              <p>{taskLabels[child.todayTaskStatus]}</p>
              {child.latestCompletedSessionId ? (
                <Link href={`/parent/reports/sessions/${child.latestCompletedSessionId}`}>查看今日听写报告</Link>
              ) : null}
            </article>
          ))}
        </div>
      </section>

      <section className="report-section">
        <h2>待处理事项</h2>
        <div className="report-grid">
          <article className="report-card is-disabled">
            <h3>习惯审核</h3>
            <p>{dashboard.pendingHabits.message}</p>
          </article>
          <article className="report-card is-disabled">
            <h3>家庭奖励</h3>
            <p>{dashboard.familyRewards.message}</p>
          </article>
        </div>
      </section>

      <section className="report-section">
        <h2>今日薄弱词</h2>
        {dashboard.children.map((child) => (
          <article className="report-card" key={child.childId}>
            <h3>{child.nickname}</h3>
            {child.todayWeakCards.length === 0 ? (
              <p>今天还没有需要特别加强的词。</p>
            ) : (
              <ul>
                {child.todayWeakCards.map((card) => (
                  <li key={card.cardId}>
                    <Link href={`/parent/reports/cards/${card.cardId}?childId=${child.childId}`}>
                      {card.answerText}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </article>
        ))}
      </section>

      <section className="report-section">
        <h2>明日预计复习</h2>
        <div className="report-grid">
          {dashboard.children.map((child) => (
            <article className="report-card" key={child.childId}>
              <h3>{child.nickname}</h3>
              <p>明天建议复习 {child.tomorrowDueReviewCount} 个词</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

export function SessionReportView({ report }: { report: SessionReport }) {
  return (
    <div className="report-stack">
      <section className="report-grid" aria-label="单次听写指标">
        <article className="report-card"><strong>{report.itemCount}</strong><span>本次词数</span></article>
        <article className="report-card"><strong>{percent(report.firstPassAccuracy)}</strong><span>首轮正确率</span></article>
        <article className="report-card"><strong>{percent(report.finalCompletionRate)}</strong><span>最终完成率</span></article>
        <article className="report-card"><strong>{report.retryCount}</strong><span>订正尝试</span></article>
        <article className="report-card"><strong>{report.correctionRounds}</strong><span>订正轮数</span></article>
        <article className="report-card"><strong>{report.manualReplayCount}</strong><span>手动重听</span></article>
      </section>
      <section className="report-section">
        <h2>需要加强的词</h2>
        {report.errorCards.length === 0 ? <p>本次首轮全部正确。</p> : (
          <ul className="report-list">
            {report.errorCards.map((card) => (
              <li key={card.cardId}>
                <Link href={`/parent/reports/cards/${card.cardId}?childId=${report.childId}`}>
                  {card.answerText}
                </Link>
                <span>错误 {card.totalErrorCount} 次，订正尝试 {card.correctionAttempts} 次</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <p>完成时间：{shanghaiTime(report.completedAt)}</p>
      <p className="report-notice">由孩子自主批改，未经机器或家长判卷</p>
    </div>
  );
}

export function WeeklyReportView({ report }: { report: WeeklyReport }) {
  return (
    <section className="report-section">
      <h2>本周学习</h2>
      <div className="report-grid">
        <article className="report-card"><strong>{report.studyDays}</strong><span>学习天数</span></article>
        <article className="report-card"><strong>{report.completedTasks}</strong><span>完成听写</span></article>
        <article className="report-card"><strong>{percent(report.firstPassAccuracy)}</strong><span>首轮正确率</span></article>
        <article className="report-card"><strong>{report.dueReviewsCompleted}</strong><span>到期复习完成</span></article>
      </div>
      <p>到期复习完成 {report.dueReviewsCompleted} 个，首次回忆正确率 {percent(report.dueReviewAccuracy)}。</p>
      <h3>每日趋势</h3>
      <ul className="report-list">
        {report.dailyTrend.map((day) => (
          <li key={day.date}><span>{day.date}</span><span>{day.completedTasks} 次 · {percent(day.firstPassAccuracy)}</span></li>
        ))}
      </ul>
      <h3>本周优先复习</h3>
      {report.weakCards.length === 0 ? <p>本周还没有需要特别加强的词。</p> : (
        <ul className="report-list">
          {report.weakCards.map((card) => (
            <li key={card.cardId}>
              <Link href={`/parent/reports/cards/${card.cardId}?childId=${report.childId}`}>下周优先复习 {card.answerText}</Link>
              <span>首轮错误 {card.errorCount} 次</span>
            </li>
          ))}
        </ul>
      )}
      <p className="report-notice">{report.habitCompletion.message}</p>
    </section>
  );
}

export function CardHistoryView({ history }: { history: CardHistory }) {
  return (
    <div className="report-stack">
      <section className="report-grid">
        <article className="report-card"><strong>{history.answerText}</strong><span>学习卡片</span></article>
        <article className="report-card"><strong>{history.nextDueAt ? shanghaiTime(history.nextDueAt) : "暂无"}</strong><span>下次复习</span></article>
        <article className="report-card"><strong>{history.recentErrorAt ? shanghaiTime(history.recentErrorAt) : "暂无"}</strong><span>最近错误</span></article>
      </section>
      <section className="report-section">
        <h2>答题记录（最近 {history.attemptLimit} 次）</h2>
        <ol className="report-list">
          {history.attempts.map((attempt, index) => {
            const label = attempt.eventRole === "first_pass"
              ? attempt.correct ? "首轮正确" : "首轮需加强"
              : attempt.eventRole === "continued_error"
                ? "本场订正仍需继续"
                : "本场订正完成";
            return (
              <li key={`${attempt.occurredAt.toISOString()}-${index}`}>
                <span>{label}</span>
                <span>第 {attempt.round} 轮 · {shanghaiTime(attempt.occurredAt)}</span>
                {attempt.scheduledRetentionResult !== null ? (
                  <span>{attempt.scheduledRetentionResult ? "到期保持成功" : "到期首次回忆需加强"}</span>
                ) : null}
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
