export function estimateReviewRefusal(error: { code?: string; message?: string } | null): Response | null {
  // The reviewed RPCs only raise this error before a new request or reservation is created.
  // Existing keys and reserved snapshots have separate conflicts and must retain their payload.
  if (error?.code !== "P0001" || error.message !== "Estimate review required") return null;
  return Response.json(
    {
      code: "estimate_review_required",
      error: "L’estimation indicative a changé. Vérifiez la nouvelle fourchette puis confirmez à nouveau.",
    },
    { status: 409, headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } },
  );
}
