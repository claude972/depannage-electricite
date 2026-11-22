import { bookingRoute } from "@/lib/features/guest/bookings";
export const dynamic = "force-dynamic";
export const POST = (request: Request) => bookingRoute(request, "cancel");
