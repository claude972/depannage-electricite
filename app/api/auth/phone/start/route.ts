// Native builds already delivered only (see lib/features/guest/native-phone-auth.ts). Browsers get 410.
import { nativePhoneRoute } from "@/lib/features/guest/native-phone-auth";
export const dynamic = "force-dynamic";
export const POST = (request: Request) => nativePhoneRoute("start", request);
