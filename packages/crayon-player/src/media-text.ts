/** Bound small playlist/JSON reads while video bytes remain streamed. */
export async function readMediaText(response: Response, limit = 4 * 1024 * 1024, timeout = 15000) {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  let expired = false;
  const timer = setTimeout(() => { expired = true; void reader.cancel().catch(() => undefined); }, timeout);
  try {
    let doneReading = false;
    while (!doneReading) {
      const { done, value } = await reader.read();
      if (expired) throw new Error('Media playlist read timed out');
      if (done) { doneReading = true; break; }
      size += value.byteLength;
      if (size > limit) throw new Error('Media playlist is too large');
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    clearTimeout(timer);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
