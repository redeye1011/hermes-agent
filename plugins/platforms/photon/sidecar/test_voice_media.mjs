import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { prepareVoiceMedia } from "./voice-media.mjs";

async function fakeFfmpeg(dir, exitCode = 0) {
  const path = join(dir, "fake-ffmpeg.mjs");
  await writeFile(
    path,
    `#!/usr/bin/env node\nimport { copyFile } from "node:fs/promises";\nconst input = process.argv[process.argv.indexOf("-i") + 1];\nconst output = process.argv.at(-1);\n${exitCode ? `process.exit(${exitCode});` : "await copyFile(input, output);"}\n`,
  );
  await chmod(path, 0o755);
  return path;
}

test("converts MP3 voice media to M4A and cleans up", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hermes-photon-voice-test-"));
  try {
    const input = join(dir, "reply.mp3");
    await writeFile(input, "mp3-bytes");
    const media = await prepareVoiceMedia({
      path: input,
      name: "reply.mp3",
      mimeType: "audio/mpeg",
      ffmpegPath: await fakeFfmpeg(dir),
    });

    assert.match(media.path, /\.m4a$/);
    assert.equal(media.name, "reply.m4a");
    assert.equal(media.mimeType, "audio/mp4");
    assert.equal((await readFile(media.path)).toString(), "mp3-bytes");

    await media.cleanup();
    await assert.rejects(readFile(media.path));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("keeps compatible M4A voice media without stale metadata", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hermes-photon-voice-test-"));
  try {
    const input = join(dir, "reply.m4a");
    await writeFile(input, "m4a-bytes");
    const media = await prepareVoiceMedia({
      path: input,
      name: "reply.mp3",
      mimeType: "audio/mpeg",
      ffmpegPath: join(dir, "must-not-run"),
    });

    assert.equal(media.path, input);
    assert.equal(media.name, "reply.m4a");
    assert.equal(media.mimeType, "audio/mp4");
    await media.cleanup();
    assert.equal((await readFile(input)).toString(), "m4a-bytes");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("fails conversion without leaving a temporary M4A", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hermes-photon-voice-test-"));
  try {
    const input = join(dir, "reply.mp3");
    await writeFile(input, "mp3-bytes");
    await assert.rejects(
      prepareVoiceMedia({
        path: input,
        ffmpegPath: await fakeFfmpeg(dir, 1),
      }),
      /voice conversion failed/,
    );
    assert.deepEqual(
      (await (await import("node:fs/promises")).readdir(dir)).filter((name) => name.endsWith(".m4a")),
      [],
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
