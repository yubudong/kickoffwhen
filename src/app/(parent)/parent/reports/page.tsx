import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { ReportsOverview, WeeklyReportView } from "@/modules/reports/components";
import { getReportDashboard } from "@/modules/reports/dashboard";
import { requireReportsPageActor } from "@/modules/reports/page-access";
import {
  getWeeklyReport,
  mondayForShanghaiDate,
  shanghaiWeekFromMonday,
} from "@/modules/reports/weekly-report";

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ childId?: string | string[]; weekStart?: string | string[] }>;
}) {
  const actor = await requireReportsPageActor();
  const now = new Date();
  const dashboard = await getReportDashboard(actor, now);
  const query = await searchParams;
  const selectedId = typeof query.childId === "string"
    ? z.string().uuid().safeParse(query.childId)
    : null;
  if (query.childId !== undefined && !selectedId?.success) notFound();
  const selectedChild = selectedId?.success
    ? dashboard.children.find((child) => child.childId === selectedId.data)
    : dashboard.children[0];
  if (selectedId?.success && !selectedChild) notFound();
  const weekText = typeof query.weekStart === "string"
    ? query.weekStart
    : mondayForShanghaiDate(now);
  let weekStart: Date;
  try {
    weekStart = shanghaiWeekFromMonday(weekText).start;
  } catch {
    notFound();
  }
  const weekly = selectedChild
    ? await getWeeklyReport(actor, selectedChild.childId, weekStart)
    : null;

  return (
    <main className="page-shell reports-shell">
      <div className="reports-card">
        <p className="eyebrow">家长报告</p>
        <h1>今天先看这些</h1>
        <p>数据按上海时间统计，帮你先找到今天需要行动的地方。</p>
        <ReportsOverview dashboard={dashboard} />

        {dashboard.children.length > 0 ? (
          <nav aria-label="选择孩子周报" className="report-child-tabs">
            {dashboard.children.map((child) => (
              <Link
                aria-current={child.childId === selectedChild?.childId ? "page" : undefined}
                href={`/parent/reports?childId=${child.childId}&weekStart=${weekText}`}
                key={child.childId}
              >
                {child.nickname}
              </Link>
            ))}
          </nav>
        ) : null}
        {weekly ? <WeeklyReportView report={weekly} /> : (
          <section className="report-section"><h2>本周学习</h2><p>先创建孩子档案，完成后就能查看报告。</p></section>
        )}
      </div>
    </main>
  );
}
