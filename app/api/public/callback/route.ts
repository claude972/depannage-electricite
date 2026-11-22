import { getPublicCallback, postPublicCallback } from "@/lib/features/public-callback/handlers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const GET = getPublicCallback;
export const POST = postPublicCallback;
