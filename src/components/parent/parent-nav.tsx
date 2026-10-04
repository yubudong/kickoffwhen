import Link from "next/link";

import { ParentSignOutButton } from "./parent-sign-out-button";

export function ParentNav({
  accessMode,
}: {
  accessMode: "guardian" | "device";
}) {
  return (
    <nav aria-label="家长中心" className="parent-nav">
      <Link href="/parent">概览</Link>
      <Link href="/parent/children">孩子档案</Link>
      <Link href="/parent/todos">今日待办清单</Link>
      <Link href="/parent/tasks/new">今日听写</Link>
      <Link href="/parent/reports">学习报告</Link>
      <Link href="/parent/devices">家庭设备</Link>
      <ParentSignOutButton accessMode={accessMode} />
    </nav>
  );
}
