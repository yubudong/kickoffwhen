export type ReportAttemptRole =
  | "first_pass"
  | "continued_error"
  | "same_session_relearning";

export type ReportReviewEventType =
  | "new_first"
  | "scheduled_first"
  | "same_session_relearning";

export type SessionAttemptFact = {
  itemId: string;
  cardId: string;
  answerText: string;
  round: number;
  correct: boolean;
  eventRole: ReportAttemptRole;
  occurredAt: Date;
};

export type SessionErrorCard = {
  cardId: string;
  answerText: string;
  firstCorrect: false;
  totalErrorCount: number;
  correctionAttempts: number;
  lastErrorAt: Date;
};

export type SessionMetrics = {
  itemCount: number;
  firstPassAccuracy: number;
  finalCompletionRate: number;
  retryCount: number;
  correctionRounds: number;
  manualReplayCount: number;
  errorCards: SessionErrorCard[];
};

export type SessionReport = SessionMetrics & {
  sessionId: string;
  childId: string;
  taskId: string;
  completedAt: Date;
  selfGraded: true;
};

export type WeeklyTrendDay = {
  date: string;
  completedTasks: number;
  firstPassAccuracy: number | null;
};

export type WeakCard = {
  cardId: string;
  answerText: string;
  errorCount: number;
  latestErrorAt: Date;
};

export type WeeklyReport = {
  childId: string;
  weekStart: Date;
  weekEnd: Date;
  studyDays: number;
  completedTasks: number;
  firstPassAccuracy: number | null;
  dailyTrend: WeeklyTrendDay[];
  dueReviewsCompleted: number;
  dueReviewAccuracy: number | null;
  weakCards: WeakCard[];
  habitCompletion: { available: false; message: string };
};

export type CardHistoryAttempt = {
  occurredAt: Date;
  round: number;
  correct: boolean;
  eventRole: ReportAttemptRole;
  eventType: ReportReviewEventType | null;
  scheduledRetentionResult: boolean | null;
};

export type CardHistory = {
  childId: string;
  cardId: string;
  answerText: string;
  nextDueAt: Date | null;
  recentErrorAt: Date | null;
  attemptLimit: 100;
  attempts: CardHistoryAttempt[];
};

export type ChildReportDashboard = {
  childId: string;
  nickname: string;
  todayTaskStatus: "not_created" | "in_progress" | "completed";
  latestCompletedSessionId: string | null;
  todayWeakCards: Array<{ cardId: string; answerText: string }>;
  tomorrowDueReviewCount: number;
};

export type ReportDashboard = {
  calendar: "Asia/Shanghai";
  date: string;
  children: ChildReportDashboard[];
  pendingHabits: { available: false; message: string };
  familyRewards: { available: false; message: string };
};
