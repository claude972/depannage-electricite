import { settlementRoute } from "@/lib/features/guest/settlement";
export const dynamic = "force-dynamic";
export const GET = (request: Request) => settlementRoute(request, false);
