import { bookingRoute } from "@/lib/features/guest/bookings";
export const dynamic = "force-dynamic";
export const GET = (request: Request) => bookingRoute(request, "status");
