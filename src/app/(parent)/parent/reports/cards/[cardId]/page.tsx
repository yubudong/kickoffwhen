import { notFound } from "next/navigation";

import { getCardHistory } from "@/modules/reports/card-history";
import { CardHistoryView } from "@/modules/reports/components";
import { requireReportsPageActor } from "@/modules/reports/page-access";

export default async function CardReportPage({
  params,
  searchParams,
}: PageProps<"/parent/reports/cards/[cardId]">) {
  const actor = await requireReportsPageActor();
  const [{ cardId }, query] = await Promise.all([params, searchParams]);
  if (typeof query.childId !== "string") notFound();
  let history;
  try {
    history = await getCardHistory(actor, query.childId, cardId);
  } catch (error) {
    if (error instanceof Error && error.message === "REPORT_NOT_FOUND") notFound();
    throw error;
  }
  return (
    <main className="page-shell reports-shell">
      <div className="reports-card">
        <p className="eyebrow">单词详情</p>
        <h1>{history.answerText}</h1>
        <CardHistoryView history={history} />
      </div>
    </main>
  );
}
