import { phoneRoute } from "@/lib/features/guest/phone-auth";

export const dynamic = "force-dynamic";
export const POST = (request: Request) => phoneRoute("nativeVerify", request);
