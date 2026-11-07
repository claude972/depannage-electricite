import {
  read,
  write,
  type Context,
} from "@/lib/features/advanced-approvals/http";
export const dynamic = "force-dynamic";
export const GET = (r: Request, c: Context) => read(r, c, "workflow");
export const POST = (r: Request, c: Context) => write(r, c, "workflow");
