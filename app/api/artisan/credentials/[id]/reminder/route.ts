import {
  read,
  write,
  type Context,
} from "@/lib/features/operational-reminders/http";
export const dynamic = "force-dynamic";
export const GET = (r: Request, c: Context) => read(r, c, "credential");
export const POST = (r: Request, c: Context) => write(r, c, "credential");
