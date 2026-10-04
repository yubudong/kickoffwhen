import { authHandler, guardedAuthPost } from "@/modules/auth/server";

export const { DELETE, GET, PATCH, PUT } = authHandler;
export const POST = guardedAuthPost;
