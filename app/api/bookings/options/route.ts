import { bookingOptions } from "@/lib/features/guest/payment-options";
export const dynamic = "force-dynamic";
export async function GET() {
  return Response.json({ ...await bookingOptions(process.env), accepts_location: true }, { headers: {
    "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer",
  } });
}
