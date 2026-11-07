import { read, write, type Context } from "@/lib/features/provider-teams/http";
export const dynamic = "force-dynamic";
export const GET = (request: Request, context: Context) =>
  read(request, "team", context);
export const POST = (request: Request, context: Context) =>
  write(request, "team", context);
