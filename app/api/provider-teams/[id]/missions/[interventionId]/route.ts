import { read, type Context } from "@/lib/features/provider-teams/http";
export const dynamic = "force-dynamic";
export const GET = (request: Request, context: Context) =>
  read(request, "mission", context);
