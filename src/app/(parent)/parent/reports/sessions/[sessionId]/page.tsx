import { notFound } from "next/navigation";

import { SessionReportView } from "@/modules/reports/components";
import { requireReportsPageActor } from "@/modules/reports/page-access";
import { getSessionReport } from "@/modules/reports/session-report";

export default async function SessionReportPage({
  params,
}: PageProps<"/parent/reports/sessions/[sessionId]">) {
  const actor = await requireReportsPageActor();
  const { sessionId } = await params;
  let report;
  try {
    report = await getSessionReport(actor, sessionId);
  } catch (error) {
    if (error instanceof Error && error.message === "REPORT_NOT_FOUND") notFound();
    throw error;
  }
  return (
    <main className="page-shell reports-shell">
      <div className="reports-card">
        <p className="eyebrow">单次听写</p>
        <h1>本次学习报告</h1>
        <SessionReportView report={report} />
      </div>
    </main>
  );
}
