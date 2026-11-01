import { phoneRoute } from "@/lib/features/guest/phone-auth";
export const dynamic = "force-dynamic";
export const GET = (request: Request) => phoneRoute("session", request);
