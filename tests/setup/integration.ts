import { assertTestDatabaseSafety } from "@/config/test-database-guard";

assertTestDatabaseSafety(process.env, "integration");
