import assert from "node:assert/strict";
import test from "node:test";

import { readInboundAttachmentWithRetry } from "./inbound-media.mjs";

test("retries a transient inbound attachment read and returns the bytes", async () => {
  let calls = 0;
  const delays = [];
  const bytes = await readInboundAttachmentWithRetry(
    async () => {
      calls += 1;
      if (calls < 3) throw new Error("ECONNRESET");
      return Buffer.from("caf-bytes");
    },
    {
      delayMs: 1,
      sleep: async (ms) => delays.push(ms),
    },
  );

  assert.equal(bytes.toString(), "caf-bytes");
  assert.equal(calls, 3);
  assert.deepEqual(delays, [1, 2]);
});

test("fails after a bounded number of inbound attachment-read attempts", async () => {
  let calls = 0;
  await assert.rejects(
    readInboundAttachmentWithRetry(
      async () => {
        calls += 1;
        throw new Error("ECONNRESET");
      },
      { delayMs: 1, sleep: async () => {} },
    ),
    /ECONNRESET/,
  );
  assert.equal(calls, 3);
});
