// Hermes Agent — bounded retry helper for Photon inbound attachment reads.
//
// Spectrum may surface a fully hydrated attachment whose backing download
// transiently resets. Retrying the content reader keeps that temporary upstream
// failure from degrading a voice note to metadata-only input (and losing STT).

export const INBOUND_ATTACHMENT_READ_ATTEMPTS = 3;

export function attachmentReadStreamError(error) {
  const result = error instanceof Error ? error : new Error(String(error));
  result.retryPhotonInboundStream = true;
  return result;
}

const defaultSleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Read inbound attachment bytes with bounded exponential retry.
 *
 * @param {() => Promise<Uint8Array | Buffer>} read
 * @param {{attempts?: number, delayMs?: number, sleep?: (ms: number) => Promise<void>}} options
 * @returns {Promise<Uint8Array | Buffer>}
 */
export async function readInboundAttachmentWithRetry(read, options = {}) {
  const attempts = Math.max(1, options.attempts ?? INBOUND_ATTACHMENT_READ_ATTEMPTS);
  const delayMs = Math.max(0, options.delayMs ?? 250);
  const sleep = options.sleep ?? defaultSleep;
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await read();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await sleep(delayMs * attempt);
      }
    }
  }

  throw lastError;
}
