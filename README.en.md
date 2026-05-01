# AIGC Gallery

AIGC Gallery is a local-first desktop gallery for managing AI-generated PNG images with embedded generation metadata. It is built with Tauri 2 and React. Images, thumbnails, and the SQLite database are stored by default in a portable `gallery-data` directory next to the application.

> Current version: `0.1.0`

## Features

- PNG import: select multiple files, recursively import folders, or drag and drop PNG files.
- Metadata extraction for A1111 / Forge, ComfyUI, NovelAI, plus lightweight C2PA / GPT-image detection.
- Local managed library with SHA-256 deduplication and generated JPG thumbnails.
- Import strategies:
  - `copy`: copy files into the managed library.
  - `hardlink_then_copy`: try hardlink first, then fall back to copy.
- Gallery browsing with pagination, virtualized grid, thumbnails, and full-size preview.
- SQLite FTS5 search across prompts, negative prompts, file names, and selected metadata fields.
- Model statistics, tags, favorites, and editable prompts.
- NSFW filtering and manual hide support.
- Chinese / English UI switching.
- Civitai lookup by model hash with trusted Civitai URL opening.
- ZIP-based gallery backup export/import.

## Screenshots

> Replace these placeholders with real screenshots later.

![Gallery placeholder](docs/images/gallery-placeholder.png)

![Detail placeholder](docs/images/detail-placeholder.png)

![Settings placeholder](docs/images/settings-placeholder.png)

## Tech Stack

- Desktop shell: Tauri 2
- Backend: Rust 2021
- Frontend: React 18, TypeScript, Vite 6
- UI / styling: Tailwind CSS, PostCSS, Autoprefixer
- Database: SQLite via `rusqlite` with bundled SQLite and FTS5
- Image processing: Rust `image` crate
- Network lookup: `reqwest` with rustls
- Credential storage: `keyring`
- Packaging: Tauri bundler, Windows x64 MSI / NSIS in CI

## Installation and Development

### Requirements

- Node.js 20
- npm
- Rust stable
- Tauri 2 system prerequisites for your platform
- On Windows, MSVC Build Tools / Windows SDK / WebView2 environment for packaging

### Install dependencies

```bash
npm install
cd frontend
npm ci
```

The root workspace mainly installs the Tauri CLI. Frontend dependencies are managed under `frontend/`.

### Run in development

```bash
npm run tauri dev
```

Tauri starts the frontend dev server at `http://localhost:5173`.

You can also run only the frontend:

```bash
npm run dev
```

### Frontend build

```bash
npm run build
```

This enters `frontend/`, runs `tsc -b && vite build`, and outputs to `frontend/dist`.

## Data Directory

Default storage root: `gallery-data`.

```text
gallery-data/
  config.json
  gallery.db
  images/
  thumbnails/
  gallery.db.bak
```

Rules:

- Development mode uses `<repo>/gallery-data/` when the executable is under `src-tauri/target/debug`.
- Packaged releases use `gallery-data/` next to the executable by default.
- Custom storage can be configured in app settings.
- Absolute custom paths are used as-is; relative paths are resolved under the default `gallery-data` directory.

## Import and Export

### Image import

Supported import methods:

1. Select multiple PNG files.
2. Select a folder and recursively import PNG files.
3. Drag PNG files onto the app window.

Import flow:

- Non-PNG files are skipped.
- SHA-256 hash is computed for deduplication and managed file naming.
- PNG metadata is parsed.
- The file is copied or hardlinked into `images/` according to the import strategy.
- A record is written to SQLite.
- A thumbnail is generated under `thumbnails/`.

### Backup export

The settings panel can export a ZIP containing:

- `config.json`
- `gallery.db`
- `images/`
- `thumbnails/`

### Backup import

Import restores data into the current storage directory:

- `gallery.db` is restored after backing up the current DB to `gallery.db.bak`.
- `images/` and `thumbnails/` entries are restored.
- Existing image/thumbnail files are skipped.
- `config.json` in the ZIP is skipped and does not overwrite current settings.
- The database connection is reinitialized after import.

## Civitai Lookup

AIGC Gallery can query Civitai by checkpoint hash or LoRA hash.

Supported base URLs:

- `https://civitai.com`
- `https://civitai.green`
- `https://civitai.red`

The optional API key is stored in the OS credential store using service `aigc-gallery` and user `civitai-api-key`.

Lookup uses:

```text
/api/v1/model-versions/by-hash/{hash}
```

Returned results include model/version IDs, names, model type, trained words, NSFW value, raw JSON, and a page URL. Opening links is restricted to the supported Civitai domains.

## Build Windows MSI

Local Windows build:

```bash
cd frontend
npm ci
npm run build
cd ..
npm run tauri build -- --target x86_64-pc-windows-msvc
```

Or let Tauri run the frontend build:

```bash
npm run tauri build -- --target x86_64-pc-windows-msvc
```

Typical output paths:

```text
src-tauri/target/x86_64-pc-windows-msvc/release/bundle/msi/*.msi
src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/*.exe
```

## Release Tags

GitHub Actions workflow: `.github/workflows/build.yml`

It triggers on:

- tags matching `v*`
- manual `workflow_dispatch`

Current enabled matrix:

- `windows-latest`
- `x86_64-pc-windows-msvc`

The workflow installs Node.js 20, Rust stable, frontend dependencies, Wix Toolset, builds the frontend, runs Tauri packaging, creates a draft release, and uploads MSI / NSIS artifacts.

Recommended release flow:

```bash
git tag v0.1.0
git push origin v0.1.0
```

After CI completes, review the GitHub Release draft and publish it manually.

## Known Limitations

- The app is currently primarily validated on Windows.
- Only PNG import is supported.
- PNG files without parsable metadata may be skipped.
- Backup import replaces `gallery.db`; a `gallery.db.bak` backup is created first.
- Civitai lookup depends on network availability, domain reachability, and API limits.
- System credential storage may not be available in all environments.
- Full-size preview uses Base64 data URIs in the WebView; extremely large images may still affect memory usage.
- Search currently covers prompts, negative prompts, file names, and selected metadata fields rather than a full structured query language.
