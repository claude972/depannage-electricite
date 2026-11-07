import { read, write } from "@/lib/features/provider-teams/http";
export const dynamic = "force-dynamic";
export const GET = (request: Request) => read(request, "invitations");
export const POST = (request: Request) => write(request, "invitation");
