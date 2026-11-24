import { useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";

import { BatchGrader } from "../../src/components/dictation/batch-grader";
import type { GradingSessionView } from "../../src/modules/dictation/child-view-types";

const familyId = "11111111-1111-4111-8111-111111111111";
const childId = "22222222-2222-4222-8222-222222222222";
const sessionId = "33333333-3333-4333-8333-333333333333";
const firstId = "44444444-4444-4444-8444-444444444444";
const secondId = "55555555-5555-4555-8555-555555555555";

export function gradingSession(roundNumber: number, version: number): GradingSessionView {
  return {
    sessionId,
    taskId: "66666666-6666-4666-8666-666666666666",
    familyId,
    childId,
    version,
    phase: "grading",
    mode: "continuous_batch",
    roundNumber,
    itemCount: 2,
    playedItemIds: [firstId, secondId],
    intervalSeconds: 2,
    repeatCount: 1,
    speechRate: 1,
    allowManualReplay: false,
    gradingMode: "self",
    items: [
      { itemId: firstId, position: 0, answerText: "桂花" },
      { itemId: secondId, position: 1, answerText: "故乡" },
    ],
  };
}

type HarnessState = { round: number; version: number; pending: boolean };
const submitted: Array<Array<{ itemId: string; correct: boolean }>> = [];
let root: Root | null = null;

function App() {
  const [current, setCurrent] = useState<HarnessState>({ round: 1, version: 3, pending: false });
  useEffect(() => {
    Object.assign(window, {
      setGraderState(next: Partial<HarnessState>) {
        setCurrent((previous) => ({ ...previous, ...next }));
      },
    });
  }, []);
  return (
    <BatchGrader
      session={gradingSession(current.round, current.version)}
      pending={current.pending}
      onDirtyChange={() => undefined}
      onSubmit={async (marks) => {
        submitted.push(marks);
        throw new Error("isolated save failed");
      }}
    />
  );
}

Object.assign(window, { submitted });
root = createRoot(document.getElementById("root")!);
root.render(<App />);
