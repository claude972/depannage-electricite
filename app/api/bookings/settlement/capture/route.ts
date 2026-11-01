import { settlementRoute } from "@/lib/features/guest/settlement";
export const dynamic = "force-dynamic";
export const POST = (request: Request) => settlementRoute(request, true);
