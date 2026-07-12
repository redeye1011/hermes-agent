import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join, parse } from "node:path";
import { promisify } from "node:util";
import ffmpegStatic from "ffmpeg-static";

const execFileAsync = promisify(execFile);
const IMESSAGE_VOICE_EXTENSIONS = new Set([".aac", ".m4a"]);

function m4aName(name, sourcePath) {
  const stem = parse(name || basename(sourcePath)).name || "voice";
  return `${stem}.m4a`;
}

export async function prepareVoiceMedia({ path, name, mimeType, ffmpegPath = ffmpegStatic }) {
  if (IMESSAGE_VOICE_EXTENSIONS.has(extname(path).toLowerCase())) {
    return { path, name, mimeType, cleanup: async () => {} };
  }
  if (!ffmpegPath) {
    throw new Error("Photon voice conversion failed: ffmpeg-static is unavailable");
  }

  const dir = await mkdtemp(join(tmpdir(), "hermes-photon-voice-"));
  const output = join(dir, "voice.m4a");
  try {
    await execFileAsync(ffmpegPath, [
      "-y", "-i", path, "-vn", "-c:a", "aac", "-movflags", "+faststart", output,
    ]);
  } catch {
    await rm(dir, { recursive: true, force: true });
    throw new Error("Photon voice conversion failed");
  }

  return {
    path: output,
    name: m4aName(name, path),
    mimeType: undefined,
    cleanup: async () => rm(dir, { recursive: true, force: true }),
  };
}
