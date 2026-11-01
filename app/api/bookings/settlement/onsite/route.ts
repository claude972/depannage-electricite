import { onsiteSettlement } from "@/lib/features/guest/onsite-settlement";
export const dynamic = "force-dynamic";
export const GET = (request: Request) => onsiteSettlement(request, false);
export const POST = (request: Request) => onsiteSettlement(request, true);
