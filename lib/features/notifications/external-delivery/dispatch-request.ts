const maxBytes = 64;

/** pg_net sends an empty JSON object, and Next can represent an empty POST as a stream. */
export async function hasEmptyDispatchBody(request: Request): Promise<boolean> {
  if (request.body === null) return true;
  if (Number(request.headers.get("content-length")) > maxBytes) return false;

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let body = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return /^[ \t\r\n]*(?:\{[ \t\r\n]*\})?[ \t\r\n]*$/.test(body + decoder.decode());
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        void reader.cancel().catch(() => {});
        return false;
      }
      body += decoder.decode(value, { stream: true });
    }
  } catch {
    return false;
  } finally {
    reader.releaseLock();
  }
}
