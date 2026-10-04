import { sql } from "drizzle-orm";

import { env } from "@/config/runtime";
import { db } from "@/db/client";
import { checkReadiness } from "@/modules/operations/health";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await checkReadiness({
      checkDatabase: async () => {
        await db.execute(sql`select 1`);
      },
      mediaRoot: env.mediaRoot,
    });
    return Response.json(result);
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503 });
  }
}
