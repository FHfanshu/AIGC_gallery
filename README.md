# AIGC Gallery

AIGC Gallery is a local-first desktop gallery for AI-generated PNG images. It imports images, reads embedded generation metadata, stores searchable records in SQLite, and keeps managed copies plus thumbnails in a portable `gallery-data` folder.

> Current app version: `0.1.0`

## Screenshots

_Add screenshots here once the UI stabilizes._

```md
![Gallery grid](docs/screenshots/gallery.png)
![Image detail](docs/screenshots/detail.png)
```

## Features

- Import individual PNG files, drag-and-drop PNGs, or recursively import a folder.
- Extract and display embedded prompt / negative prompt metadata from PNG files.
- Search gallery records and browse with a virtualized grid for larger libraries.
- View image details, edit prompt text, mark favorites, and filter NSFW content.
- Tag images and browse by tags.
- Store managed image copies or use `hardlink_then_copy` where supported.
- Generate thumbnails in the background.
- Export/import gallery backups as `.zip` archives.
- Look up Civitai model-version details by model file hash.
- English and Chinese UI locale files are included.

## Tech stack

- **Desktop shell:** Tauri 2
- **Backend:** Rust 2021, SQLite via `rusqlite`, `image`, `reqwest`, `keyring`, `zip`
- **Frontend:** React 18, TypeScript, Vite 6, Tailwind CSS
- **UI/runtime helpers:** `@tauri-apps/api`, Tauri dialog/fs plugins, `@tanstack/react-virtual`
- **Release automation:** GitHub Actions + `tauri-apps/tauri-action`

## Prerequisites

- Node.js 20+
- npm
- Rust stable toolchain
- Tauri 2 system prerequisites for your OS: <https://tauri.app/start/prerequisites/>

For Windows release builds, install the Microsoft C++ Build Tools / Visual Studio Build Tools with the Windows SDK.

## Install

Install JavaScript dependencies from both workspaces:

```bash
npm install
cd frontend
npm install
```

The Rust dependencies are fetched automatically by Cargo/Tauri during development or build.

## Development

Run the full Tauri app in development mode:

```bash
npm run tauri dev
```

Run only the frontend Vite server:

```bash
npm run dev
```

Useful frontend commands:

```bash
cd frontend
npm run build      # type-check and build the web UI
npm run preview    # preview the built frontend
npm run tauri dev  # Tauri dev from frontend workspace
```

## Build

Build the frontend only:

```bash
npm run build
```

Build distributable desktop bundles:

```bash
npm run tauri build
```

Tauri outputs bundles under `src-tauri/target/<target>/release/bundle/` or `src-tauri/target/release/bundle/`, depending on the command and target.

## Data storage and backups

AIGC Gallery is local-first. It does not require a hosted database.

Default storage:

- In development: `<repo>/gallery-data/`
- In packaged releases: `gallery-data/` next to the executable

The storage root contains:

- `gallery.db` — SQLite database with image records, tags, favorites, metadata, and paths
- `images/` — managed imported PNG files, named by SHA-256 hash
- `thumbnails/` — generated JPEG thumbnails
- `config.json` — app settings such as custom storage path, import strategy, and Civitai base URL

Storage can be changed from the app settings. Relative custom paths are resolved inside the default `gallery-data` directory; absolute paths are used as-is.

Backup notes:

- Use the app's export action to create a `.zip` containing `gallery.db`, `images/`, `thumbnails/`, and `config.json`.
- Importing a backup restores files into the current storage directory.
- Existing image/thumbnail files are skipped on restore.
- Before replacing `gallery.db`, the current database is copied to `gallery.db.bak`.
- For manual backup, copy the entire active storage root while the app is closed.

## Civitai lookup

AIGC Gallery can query Civitai model-version metadata by model file hash using:

```text
GET /api/v1/model-versions/by-hash/{hash}
```

Supported base URLs are normalized to:

- `https://civitai.com`
- `https://civitai.green`
- `https://civitai.red`

The Civitai API key is optional. If set, it is stored in the operating system credential store through Rust `keyring` under service `aigc-gallery` and user `civitai-api-key`; it is not stored in `gallery.db`.

Lookup returns model/version IDs, names, type, trained words, NSFW value, raw JSON, and a Civitai page URL. Opening URLs is restricted to the supported Civitai domains above.

## Windows MSI release workflow

The repository includes `.github/workflows/build.yml`, which builds on `windows-latest` for `x86_64-pc-windows-msvc` when a tag matching `v*` is pushed or when manually dispatched.

Release checklist:

1. Update the version in all relevant files:
   - `src-tauri/tauri.conf.json`
   - `src-tauri/Cargo.toml`
   - `frontend/package.json`
2. Commit the version bump.
3. Create and push a matching tag:

   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```

4. GitHub Actions builds the frontend and Tauri app, then creates a **draft** GitHub Release named `AIGC Gallery <tag>`.
5. Download artifacts from the workflow run or publish the draft release after checking the attached assets.

Expected Windows assets include:

- `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/msi/*.msi`
- `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/*.exe`

Optional signing secrets used by the workflow:

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

macOS and Linux matrix entries are present but commented out in the workflow.

## Current limitations

- Import and metadata extraction are currently PNG-focused; non-PNG files are skipped.
- The app stores managed copies/hardlinks plus thumbnails, so disk usage can grow quickly.
- Civitai lookup requires network access and depends on Civitai API/domain availability.
- Backup import skips existing files and replaces the database; close or avoid concurrent app activity during restore.
- Releases are currently configured for Windows x64 only; macOS/Linux builds need workflow matrix entries and platform validation.
- The Tauri config currently has `csp: null`; review the content security policy before distributing broadly.
