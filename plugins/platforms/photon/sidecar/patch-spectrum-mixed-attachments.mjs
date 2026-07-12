#!/usr/bin/env node
// Patch spectrum-ts' iMessage inbound mapper until upstream preserves mixed
// text + attachment Apple events. The mapper returns only
// buildAttachmentMessage(...) whenever attachments are present, which drops
// `message.content.text` before Hermes can see it. We rewrite the two inbound
// mappers — `rebuildFromAppleMessage` (used by `space.getMessage`) and
// `toInboundMessages` (used by the live stream) — so a bubble carrying both
// text and attachment(s) surfaces as a group whose first child is the typed
// text. Paths with no text are rewritten to byte-identical behavior, so only
// mixed text+attachment messages change shape.
//
// Since spectrum-ts 5.x split the SDK into scoped packages, the iMessage mapper
// lives in `@spectrum-ts/imessage/dist/index.js` (it used to be a chunk under
// `spectrum-ts/dist`). The published output is tab-indented and uses
// `const ... = async` declarations; the anchors below match that exactly and
// fail loudly if a future spectrum-ts reshapes the mapper.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const MIXED_MARKER = "Hermes patch: Preserve mixed text + attachment iMessage payloads";
const HYDRATION_MARKER = "Hermes patch: Hydrate placeholder-only iMessage attachments";

function scriptDir() {
  return path.dirname(fileURLToPath(import.meta.url));
}

function replaceOnce(source, from, to, label) {
  const count = source.split(from).length - 1;
  if (count !== 1) {
    throw new Error(`expected exactly one ${label} match, found ${count}`);
  }
  return source.replace(from, to);
}

function replaceExactly(source, from, to, expected, label) {
  const count = source.split(from).length - 1;
  if (count !== expected) {
    throw new Error(
      `expected exactly ${expected} ${label} matches, found ${count}`
    );
  }
  return source.split(from).join(to);
}

// The text-first child of a mixed text+attachment group, indented `tabs` deep
// (the object's closing brace sits at `tabs`; its properties one level in).
function textChild(tabs) {
  const t = "\t".repeat(tabs);
  return (
    `{\n${t}\t...base,\n${t}\tid: formatChildId(0, messageGuidStr),` +
    `\n${t}\tcontent: asText(text2),\n${t}\tpartIndex: 0,` +
    `\n${t}\tparentId: messageGuidStr\n${t}}`
  );
}

function patchRebuild(source) {
  // Capture the bubble text before the attachment branches consume it. The
  // existing no-attachment branch keeps its own `const text` declaration, so a
  // distinct name avoids a redeclaration.
  source = replaceOnce(
    source,
    `\tconst attachments = messageAttachments(message);\n\tif (attachments.length === 1) {`,
    `\tconst attachments = messageAttachments(message);\n\tconst text2 = message.content.text;\n\tif (attachments.length === 1) {`,
    "rebuild text capture"
  );
  // Single attachment: when text is present, push it to slot 0 and the
  // attachment to slot 1, then wrap both in a group.
  source = replaceOnce(
    source,
    `\t\treturn buildAttachmentMessage(client, base, info, messageGuidStr, 0);`,
    `\t\tconst msg2 = await buildAttachmentMessage(client, base, info, text2 ? formatChildId(1, messageGuidStr) : messageGuidStr, text2 ? 1 : 0, text2 ? messageGuidStr : void 0);\n\t\tif (text2) {\n\t\t\tconst textMsg = ${textChild(3)};\n\t\t\treturn {\n\t\t\t\t...base,\n\t\t\t\tid: messageGuidStr,\n\t\t\t\tcontent: asProviderGroup([textMsg, msg2])\n\t\t\t};\n\t\t}\n\t\treturn msg2;`,
    "rebuild single attachment"
  );
  // Multi attachment: prepend the text child to the group's items.
  source = replaceOnce(
    source,
    `\t\treturn {\n\t\t\t...base,\n\t\t\tid: messageGuidStr,\n\t\t\tcontent: asProviderGroup(items)\n\t\t};`,
    `\t\tif (text2) {\n\t\t\titems.unshift(${textChild(3)});\n\t\t}\n\t\treturn {\n\t\t\t...base,\n\t\t\tid: messageGuidStr,\n\t\t\tcontent: asProviderGroup(items)\n\t\t};`,
    "rebuild multi attachment text child"
  );
  return source;
}

function patchInbound(source) {
  source = replaceOnce(
    source,
    `\tconst attachments = messageAttachments(event.message);\n\tif (attachments.length === 1) {`,
    `\tconst attachments = messageAttachments(event.message);\n\tconst text2 = event.message.content.text;\n\tif (attachments.length === 1) {`,
    "inbound text capture"
  );
  source = replaceOnce(
    source,
    `\t\tconst msg = await buildAttachmentMessage(client, base, info, messageGuidStr, 0);\n\t\tcacheMessage(cache, msg);\n\t\treturn [msg];`,
    `\t\tconst msg = await buildAttachmentMessage(client, base, info, text2 ? formatChildId(1, messageGuidStr) : messageGuidStr, text2 ? 1 : 0, text2 ? messageGuidStr : void 0);\n\t\tif (text2) {\n\t\t\tconst textMsg = ${textChild(3)};\n\t\t\tconst parent = {\n\t\t\t\t...base,\n\t\t\t\tid: messageGuidStr,\n\t\t\t\tcontent: asProviderGroup([textMsg, msg])\n\t\t\t};\n\t\t\tcacheMessage(cache, parent);\n\t\t\treturn [parent];\n\t\t}\n\t\tcacheMessage(cache, msg);\n\t\treturn [msg];`,
    "inbound single attachment"
  );
  source = replaceOnce(
    source,
    `\t\tconst parent = {\n\t\t\t...base,\n\t\t\tid: messageGuidStr,\n\t\t\tcontent: asProviderGroup(items)\n\t\t};`,
    `\t\tif (text2) {\n\t\t\titems.unshift(${textChild(3)});\n\t\t}\n\t\tconst parent = {\n\t\t\t...base,\n\t\t\tid: messageGuidStr,\n\t\t\tcontent: asProviderGroup(items)\n\t\t};`,
    "inbound multi attachment text child"
  );
  return source;
}

function patchRemotePlaceholderHydration(source) {
  return replaceOnce(
    source,
    `\tconst base = buildMessageBase(event.message, event.chatGuid, event.occurredAt, phone);\n\tconst messageGuidStr = event.message.guid;\n\tconst attachments = messageAttachments(event.message);\n\tconst text2 = event.message.content.text;\n\tif (attachments.length === 1) {`,
    `\tlet sourceMessage = event.message;\n\tconst isPlaceholderOnly = (message) => {\n\t\tconst text = message.content.text;\n\t\treturn typeof text === "string" && text.includes("￼") && text.split("￼").join("").trim() === "" && messageAttachments(message).length === 0;\n\t};\n\tif (isPlaceholderOnly(sourceMessage)) {\n\t\t// ponytail: bounded re-fetch closes Photon’s attachment-join race.\n\t\tlet refreshError;\n\t\tlet confirmedPlaceholder = false;\n\t\tfor (let attempt = 0; attempt < ATTACHMENT_JOIN_RETRY_LIMIT; attempt += 1) {\n\t\t\tawait setTimeout$1(ATTACHMENT_JOIN_RETRY_DELAY_MS);\n\t\t\ttry {\n\t\t\t\tconst refreshed = await client.messages.get(toMessageGuid(sourceMessage.guid));\n\t\t\t\tif (refreshed) {\n\t\t\t\t\tsourceMessage = refreshed;\n\t\t\t\t\tconfirmedPlaceholder = isPlaceholderOnly(sourceMessage);\n\t\t\t\t}\n\t\t\t} catch (error) {\n\t\t\t\trefreshError ??= error;\n\t\t\t}\n\t\t\tif (!isPlaceholderOnly(sourceMessage)) break;\n\t\t}\n\t\tif (isPlaceholderOnly(sourceMessage)) {\n\t\t\tif (refreshError && !confirmedPlaceholder) throw refreshError;\n\t\t\treturn [];\n\t\t}\n\t}\n\tconst base = buildMessageBase(sourceMessage, event.chatGuid, event.occurredAt, phone);\n\tconst messageGuidStr = sourceMessage.guid;\n\tconst attachments = messageAttachments(sourceMessage);\n\tconst text2 = sourceMessage.content.text;\n\tif (attachments.length === 1) {`,
    "remote placeholder hydration"
  );
}

// Shift attachment part indices by one when a text child occupies slot 0. The
// push line is byte-identical in both mappers, so patch both occurrences.
function patchChildIndices(source) {
  return replaceExactly(
    source,
    `items.push(await buildAttachmentMessage(client, base, info, formatChildId(i, messageGuidStr), i, messageGuidStr));`,
    `items.push(await buildAttachmentMessage(client, base, info, formatChildId(text2 ? i + 1 : i, messageGuidStr), text2 ? i + 1 : i, messageGuidStr));`,
    2,
    "multi attachment child index"
  );
}

export function patchSpectrumTs(root = scriptDir()) {
  const dist = path.join(
    root,
    "node_modules",
    "@spectrum-ts",
    "imessage",
    "dist"
  );
  if (!fs.existsSync(dist)) {
    throw new Error(`@spectrum-ts/imessage dist not found: ${dist}`);
  }
  const files = fs.readdirSync(dist)
    .filter((name) => name.endsWith(".js"))
    .map((name) => path.join(dist, name));

  for (const file of files) {
    const raw = fs.readFileSync(file, "utf8");
    if (raw.includes(HYDRATION_MARKER)) {
      return { patched: false, file, reason: "already patched" };
    }
    // Normalize to LF for matching so the patch works regardless of the
    // checkout's line-ending style (Windows git autocrlf produces CRLF,
    // which would otherwise defeat the \n-based search strings). The
    // original EOL style is restored on write. Indentation in the published
    // tarball is tabs; the anchors match that directly.
    const CR = String.fromCharCode(13);
    const CRLF = CR + "\n";
    const usedCRLF = raw.includes(CRLF);
    const original = usedCRLF ? raw.split(CRLF).join("\n") : raw;
    if (!original.includes("const toInboundMessages = async") ||
        !original.includes("const rebuildFromAppleMessage = async")) {
      continue;
    }
    let patched = original;
    if (!patched.includes(MIXED_MARKER)) {
      patched = patchRebuild(patched);
      patched = patchInbound(patched);
      patched = patchChildIndices(patched);
      patched = `// ${MIXED_MARKER}\n${patched}`;
    }
    patched = patchRemotePlaceholderHydration(patched);
    patched = `// ${HYDRATION_MARKER}\n${patched}`;
    if (usedCRLF) {
      patched = patched.split("\n").join(CRLF);
    }
    fs.writeFileSync(file, patched, "utf8");
    return { patched: true, file };
  }
  throw new Error("could not find @spectrum-ts/imessage iMessage inbound chunk to patch");
}

const _invokedDirectly =
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (_invokedDirectly) {
  try {
    const root = process.argv[2] ? path.resolve(process.argv[2]) : scriptDir();
    const result = patchSpectrumTs(root);
    const action = result.patched ? "patched" : "ok";
    console.error(`photon-sidecar: spectrum mixed attachment patch ${action}: ${result.file}`);
  } catch (err) {
    console.error(`photon-sidecar: spectrum mixed attachment patch failed: ${err?.stack || err}`);
    process.exit(1);
  }
}
