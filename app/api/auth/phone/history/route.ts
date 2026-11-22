// Native builds ≤ 11 only, bearer token (see lib/features/guest/native-phone-auth.ts). Browsers get 410.
import { nativePhoneRoute } from "@/lib/features/guest/native-phone-auth";
export const dynamic = "force-dynamic";
export const GET = (request: Request) => nativePhoneRoute("history", request);
