import { SERVICES } from "@/components/role/public-service-catalog";

export function GET() {
  return Response.json({ items: SERVICES }, {
    headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=3600" },
  });
}
