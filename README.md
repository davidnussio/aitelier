# Bottega

A family image studio: a local desktop app that works like a chat, but for
images. Each project keeps its own context; styles live in a shared library
(the "Stili" entry in the sidebar), with no limit on how many, and each
project uses the ones it wants. Every generation receives its style's anchor
image and description, so the images you make today and the ones you make next
month look like they came from the same hand. Images are made by OpenAI's GPT
Image models.

The app's interface is in Italian. Product spec (in Italian):
[docs/spec.md](docs/spec.md).

## Installation

Download the `.dmg` file from the latest
[release](https://github.com/davidnussio/bottega/releases/latest), open it and
drag Bottega to Applications. There are builds for Apple Silicon and Intel
Macs. On first launch you need an OpenAI API key and, for the image models, a
verified OpenAI organization.

The app is not signed with an Apple certificate, so macOS blocks it the first
time. Open System Settings › Privacy & Security and click "Open Anyway", or
run in Terminal:

```bash
xattr -dr com.apple.quarantine /Applications/Bottega.app
```

Later versions arrive automatically from this repository's releases.

## Development

```bash
bun install
bun run start          # desktop app (Electrobun), real data, needs an OpenAI key
bun run demo           # desktop app with the demo provider: no network, no cost
bun run preview        # interface in the browser at http://localhost:5292, demo data
bun run check          # typecheck + oxlint + tests
bun run build          # distribution package (stable channel)
```

Without a key the app opens Settings ("Impostazioni"): paste the key, click
"Verifica", then "Salva". The key goes into the system keychain
(`Bun.secrets`), falling back to `secrets.json` (permissions 600) in the data
folder; never into the database, the logs or the webview.

## Releasing a version

1. Update `version` in `package.json` and commit.
2. Create the tag and push:
   ```bash
   git tag -a v0.2.0 -m "Bottega 0.2.0" && git push origin main v0.2.0
   ```
3. The `Release` workflow (GitHub Actions) runs the checks, builds for Apple
   Silicon and Intel Macs and creates a **draft** release with the DMGs and the
   update files.
4. Rewrite the notes (the draft lists the commits) and publish: only then do
   installed apps receive the update.

The `Controlli` workflow runs `bun run check` on every push to `main`.

## How it is built

| Folder | Contents |
| --- | --- |
| `src/core` | All the logic, with no Electrobun imports: database (`bun:sqlite`, WAL, numbered migrations), prompt composition, OpenAI provider behind `ImageProvider`, job queue (2 in parallel, 2 retries on temporary errors only), files. |
| `src/bun` | Desktop shell: window, menu, typed RPC, keychain, logs, local image server, Save dialog. `handlers.ts` turns RPC requests into core calls. |
| `src/mainview` | React + Tailwind 4 interface in the webview. It has no access to the network, the disk or the key. |
| `src/shared` | Shared domain types and RPC schema. |
| `scripts/preview.ts` | Browser preview with the same core and the demo provider. |

Data folder: `~/Library/Application Support/ch.dambox.bottega/<channel>/`
(`BOTTEGA_HOME` to pick another one): `app.db`, `images/<thread>/<id>.png`,
`thumbs/` (WebP), `styles/<style>/` (anchors scaled down to 1024 px, plus
trial images), `logs/`, `backups/`. The installed app (`stable` channel) and
the development app (`dev` channel) use separate folders.

### Backups and log

- An automatic backup once a day (the last 10 are kept), one before every
  schema migration, and manual ones from Settings › Backup. Each backup is
  `app.db` (a consistent copy made with `VACUUM INTO`) plus the images, linked
  with hard links: it costs a few KB as long as the images stay in place.
- A restore is booked from Settings › Backup and happens at the next launch,
  before the database is opened, after a safety backup of the current state.
- Backups live in the data folder: to be safe from a disk failure, copy them
  somewhere else.
- The log is `logs/bottega.log` (rotated at 2 MB), readable from Settings ›
  Registro: generations with model, tokens, cost and timing, errors, backups.

### Style consistency

Every call sends the style's anchors (never the last generated image) and a
prompt in a fixed order: role of the images, style description in fixed
fields, project context notes, the user's request, constraints. The chat
history is not sent. Models are pinned in a project when it is created. See
`src/core/prompt.ts` and the tests in `src/core/*.test.ts`.

### Differences from the spec

- Unlimited, global styles (schema 2): instead of 3 slots per project, a shared
  library; a project uses styles through `thread_styles`. The same style
  applies in every project that uses it (the lock prevents accidental
  changes); "Duplica" makes an independent copy.
- Images reach the webview from an HTTP server on `127.0.0.1` (random port,
  session token), not from an app scheme: Electrobun 2.0 does not yet expose
  custom schemes for user files. Never base64 over RPC.
- Saving an image uses the macOS Save panel through AppleScript, because
  Electrobun 2.0 has no native Save dialog; on other systems you pick a folder.
- The cost of describing styles (text model) is not counted yet; image costs
  are, estimated from the `usage` tokens.

## Status (phase 1 of the spec)

Done: settings with key and verification, projects with context notes,
unlimited style library (from a description with 3 trials, in the chat or on
the Stili page; from an uploaded image; from an image in the chat; duplicate,
use in several projects), automatic style description, lock, generation with
anchors and 1/2/4 variants, editing an image (new version), regenerate with
the same settings, Save dialog, errors in Italian, cost per image and per
month, automatic backups and restore, readable log, app icon, automatic
updates, release builds on GitHub Actions.

To do: filterable gallery and ZIP, navigating between versions, monthly
spending cap, project export/import, signed installer, Windows and Linux
builds.

Default models (configurable): `gpt-image-2.6-flare` (fast),
`gpt-image-2.6-sunburst` (precise), `gpt-5-mini` to describe styles.
Identifiers taken from OpenAI's guide on 15 November 2026; the prices in
`src/core/pricing.ts` are those reported for GPT Image 2.5 and still need
checking.
