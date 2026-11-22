import { checkoutAvailability, createQuoteCheckout } from "@/lib/features/payments/checkout";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = checkoutAvailability;
export const POST = createQuoteCheckout;
