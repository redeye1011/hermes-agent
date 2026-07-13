---
sidebar_position: 18
---

# Photon iMessage

Connect Hermes to **iMessage** through [Photon][photon], a managed
service that handles the Apple line allocation and abuse-prevention
layer so you don't have to run your own Mac relay.

The free tier uses Photon's shared iMessage line pool — different
recipients may see different sending numbers, but each conversation
stays stable. The paid Business tier gives every user the same
dedicated number; the plugin supports both, and the free tier is the
recommended starting point.

:::info Free to start
Photon's shared-line pool is free. No subscription is required to send
your first iMessage from Hermes — just a phone number we can bind to
your account.
:::

## Architecture

Photon is a **persistent-connection** channel, like Discord or Slack —
**no webhook, no public URL, no signing secret to manage.**

The `spectrum-ts` SDK holds a long-lived **gRPC stream** to Photon for
both directions. Because the SDK is TypeScript-only, Hermes runs it in a
small supervised **Node sidecar** and talks to it over loopback:

- **Inbound** — the sidecar consumes the SDK's `app.messages` gRPC
  stream and forwards each message to the Python adapter over a loopback
  `GET /inbound` (NDJSON). The adapter dedupes and dispatches it to the
  agent, reconnecting automatically if the stream drops.
- **Outbound** — replies are loopback POSTs to the sidecar, which calls
  `space.send(...)` on the SDK.

The Python plugin starts, supervises, and shuts down the sidecar
automatically.

## Prerequisites

- A Photon account — sign up at [app.photon.codes][app]
- **Node.js 18.17 or newer** on PATH (`node --version`)
- A phone number that can receive iMessage (used to bind your account)

That's it — there is no public URL or tunnel to set up.

## First-time setup

The unified gateway wizard is the canonical Photon setup path:

```bash
hermes gateway setup
```

The wizard handles device login, Spectrum provisioning, registered-user setup,
and sidecar dependencies.

The setup, in order:

1. **Device login** (`client_id=photon-cli`) — opens
   `https://app.photon.codes/` for approval and stores the bearer token.
2. **Finds or creates** the `Hermes Agent` project on your account.
3. **Enables Spectrum**, reads the project's Spectrum id, and rotates
   the project secret.
4. **Registers your phone number** as a Spectrum user — skipped if a
   user with that number already exists, so re-running is safe.
5. **Prints your assigned iMessage line** — the number you text to reach
   your agent.
6. **Runs `npm install`** inside the plugin's sidecar directory.

Runtime credentials are written to `~/.hermes/.env`
(`PHOTON_PROJECT_ID` = the Spectrum project id, `PHOTON_PROJECT_SECRET`),
the same place every other channel keeps its token. Management metadata
(device token, dashboard project id) lives in `~/.hermes/auth.json` under
`credential_pool.photon` / `credential_pool.photon_project`.

## Authorizing users

Photon uses the same authorization model as every other Hermes
channel. Choose one approach:

**DM pairing (default).** When an unknown number messages your Photon
line, Hermes replies with a pairing code. Approve it with:

```bash
hermes pairing approve photon <CODE>
```

Use `hermes pairing list` to see pending codes and approved users.

**Pre-authorize specific numbers** (in `~/.hermes/.env`):

```bash
PHOTON_ALLOWED_USERS=+15551234567,+15559876543
```

**Open access** (dev only, in `~/.hermes/.env`):

```bash
PHOTON_ALLOW_ALL_USERS=true
```

When `PHOTON_ALLOWED_USERS` is set, unknown senders are silently
ignored rather than offered a pairing code (the allowlist signals you
deliberately restricted access).

### Require mentions in group chats

By default Hermes responds to every authorized DM and group message.
To make group chats opt-in, enable mention gating (DMs still always
work):

```yaml
gateway:
  platforms:
    photon:
      enabled: true
      require_mention: true
```

With `require_mention: true`, group-chat messages are ignored unless
they match a wake-word pattern. The defaults match `Hermes` and
`@Hermes agent` variants. For a custom agent name, set regex patterns:

```yaml
gateway:
  platforms:
    photon:
      require_mention: true
      mention_patterns:
        - '(?<![\w@])@?amos\b[,:\-]?'
```

Both keys also accept env vars (`PHOTON_REQUIRE_MENTION`,
`PHOTON_MENTION_PATTERNS`). This is the same mention-gating model the
BlueBubbles iMessage channel uses.

## Start the gateway

```bash
hermes gateway start
```

You'll see something like:

```
[photon] connected — sidecar on 127.0.0.1:8789, streaming inbound over gRPC
```

Send an iMessage to your assigned number and Hermes will reply.

## Status & troubleshooting

```bash
hermes gateway status
```

This confirms that the service-managed gateway is active. For Photon-specific
failures, inspect the gateway log after reproducing the issue:

```bash
grep -Ei 'photon|spectrum|Audio Message|voice|transcrib|failed' \
  ~/.hermes/logs/gateway.log | tail -n 100
```

Common issues:

- **Sidecar dependencies unavailable** — re-run `hermes gateway setup` and
  select Photon; it installs the sidecar dependencies.
- **Photon credentials missing** — re-run `hermes gateway setup` and complete
  the Photon device-login flow.
- **No iMessage line assigned yet** — re-run `hermes gateway setup` or check
  the [dashboard][app].
- **Sidecar won't start** — confirm `node --version` is 18.17+ and re-run the
  Photon section of `hermes gateway setup`.

## Voice notes, restarts, and updates

- Native iMessage voice notes (`Audio Message.caf`) are read by the sidecar,
  base64-forwarded to Hermes, cached, and transcribed. A transient attachment
  read is retried three times (250 ms, then 500 ms backoff) before it is
  treated as metadata-only.
- Photon replies always keep their text. Voice audio is supplementary and is
  delivered as one native M4A attachment (`audio/mp4`); MP3 input is converted
  before upload.
- A normal `hermes gateway restart` only restarts the service. Photon
  credentials and pairing state remain in `~/.hermes`, so setup is not rerun.
- Use `hermes update --check` before updating. `hermes update --backup` updates
  dependencies/configuration and restarts the gateway while preserving
  `~/.hermes` state. If this checkout has committed local source changes,
  a divergent update now refuses to hard-reset them; push or rebase those
  commits first, then rerun the update.

After a restart or update, send two short voice notes and verify each receives
complete text plus one playable M4A attachment.

## Limits today

- **Inbound attachments and voice notes** up to the inline size cap (20 MiB by
  default) are cached for the agent; larger attachments are metadata-only.
- **Outbound attachments are supported.** Hermes sends images, voice
  notes, video, and documents through spectrum-ts' `attachment()` /
  `voice()` content builders via the sidecar's `/send-attachment`
  endpoint. Captions arrive as a separate iMessage bubble after the
  media.
- **Photon's free quotas:** 5,000 messages per server per day,
  50 new-conversation initiations per shared line per day. Increases
  available — email `help@photon.codes`.

## Env vars

| Variable                  | Default            | Notes                                      |
|---------------------------|--------------------|--------------------------------------------|
| `PHOTON_PROJECT_ID`       | from `.env`        | Spectrum project id (the SDK's `projectId`); set by setup |
| `PHOTON_PROJECT_SECRET`   | from `.env`        | Project secret; set by setup               |
| `PHOTON_SIDECAR_PORT`     | `8789`             | Loopback port for the sidecar control + inbound channel |
| `PHOTON_SIDECAR_AUTOSTART`| `true`             | Whether the adapter spawns the sidecar     |
| `PHOTON_NODE_BIN`         | `which node`       | Override the Node binary path              |
| `PHOTON_HOME_CHANNEL`     | (unset)            | Default space id for cron / notifications  |
| `PHOTON_HOME_CHANNEL_NAME`| (unset)            | Human label for the home channel           |
| `PHOTON_ALLOWED_USERS`    | (unset)            | Comma-separated E.164 allowlist            |
| `PHOTON_ALLOW_ALL_USERS`  | `false`            | Dev only — accept any sender               |
| `PHOTON_REQUIRE_MENTION`  | `false`            | Require a wake word before responding in groups |
| `PHOTON_MENTION_PATTERNS` | Hermes wake words  | JSON list / comma / newline regex patterns for group mentions |
| `PHOTON_DASHBOARD_HOST`   | `app.photon.codes` | Override the dashboard / device-login host |
| `PHOTON_SPECTRUM_HOST`    | `spectrum.photon.codes` | Override the Spectrum API host |

[photon]: https://photon.codes/
[app]: https://app.photon.codes/
