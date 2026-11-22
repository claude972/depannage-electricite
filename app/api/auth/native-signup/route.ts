import { signupRoute } from "@/lib/features/auth/signup";

export const dynamic = "force-dynamic";
export const POST = (request: Request) => signupRoute(request, "native");
