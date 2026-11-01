import { addressResponse } from "@/lib/features/addresses/server";
export const dynamic = "force-dynamic";
export function GET(request: Request) { return addressResponse(request, "search"); }
