# AGENTS.md — AIGC Gallery

> AI agent guide for working in this codebase.

## Project Overview

**AIGC Gallery** is a Tauri 2 desktop application for browsing and managing AI-generated images (Stable Diffusion, NovelAI, ComfyUI, etc.). It auto-extracts PNG metadata (prompt, model, sampler, seed) on import and provides full-text search, tagging, and favorites.

- **Version**: 0.1.0
- **Platform**: Windows / macOS / Linux (Tauri 2)

## Architecture

```
┌──────────────────────────────────────────────┐
│                  Frontend (React)             │
│  React 18 + TypeScript + Tailwind CSS 3      │
│  @tanstack/react-virtual for virtual scroll  │
│  @tauri-apps/plugin-dialog, plugin-fs        │
│  i18n: en / zh                               │
│  Design: Neumorphic (custom neu-* palette)   │
│  Fonts: Plus Jakarta Sans (display)          │
│          DM Sans (body)                       │
├──────────── invoke() / Tauri IPC ────────────┤
│                  Backend (Rust)               │
│  Tauri 2 + rusqlite (bundled) + image crate  │
│  sha2 + chrono + base64 + walkdir + dirs-next│
└──────────────────────────────────────────────┘
```

**Data flow**: Frontend calls `invoke('command_name', { args })` → Tauri dispatches to `#[tauri::command]` in Rust → `commands.rs` reads/writes `AppState` (Mutex-wrapped `Database`) → returns `Result<T, String>` serialized to JSON.

## Directory Structure

```
AIGC_gallery/
├── frontend/                     # React frontend
│   ├── src/
│   │   ├── components/
│   │   │   ├── gallery/          # GalleryGrid, ImageCard, ImageDetail
│   │   │   ├── layout/           # Sidebar, Header
│   │   │   └── ui/               # NeuButton, NeuCard, NeuInput, NeuTextarea, NeuTag
│   │   ├── hooks/                # useGallery, useTags, useFavorites, useStats
│   │   ├── i18n/                 # I18nProvider, locales/{en,zh}.ts
│   │   ├── lib/
│   │   │   ├── tauri.ts          # api wrapper — all invoke() calls defined here
│   │   │   └── utils.ts          # cn(), getImageSrc(), parseMetadata(), etc.
│   │   ├── types/index.ts        # Shared TS interfaces
│   │   ├── App.tsx               # Root component, orchestrates all hooks/views
│   │   ├── main.tsx              # ReactDOM entry, wraps with I18nProvider
│   │   └── index.css             # Global + neumorphic utility classes
│   ├── tailwind.config.js        # Custom neu-* color/border/font tokens
│   ├── vite.config.ts            # Vite 6, port 5173, Tauri env prefix
│   └── package.json
├── src-tauri/                    # Rust backend
│   ├── src/
│   │   ├── main.rs               # Entry point, calls lib::run()
│   │   ├── lib.rs                # AppState, plugin registration, invoke_handler
│   │   ├── commands.rs           # All #[tauri::command] functions (IPC boundary)
│   │   ├── db.rs                 # SQLite schema, migrations, all queries
│   │   ├── metadata.rs           # PNG chunk parser (A1111, ComfyUI, NovelAI)
│   │   ├── config.rs             # JSON config load/save, storage dir resolution
│   │   └── utils/
│   │       ├── mod.rs            # Module re-exports
│   │       ├── paths.rs          # app_data_dir, db_path, images_dir, thumbnails_dir
│   │       └── thumbnail.rs      # JPEG thumbnail generation (Lanczos3, 512px)
│   ├── capabilities/default.json # Tauri permission grants (dialog, fs scopes)
│   ├── tauri.conf.json           # App config, window size, build commands
│   └── Cargo.toml                # Rust dependencies
└── AGENTS.md                     # ← You are here
```

## Key Files to Know

| File | Role |
|------|------|
| `src-tauri/src/lib.rs` | App bootstrap: registers all commands, manages AppState |
| `src-tauri/src/commands.rs` | **The IPC boundary** — every function the frontend can call |
| `src-tauri/src/db.rs` | SQLite schema + migrations (user_version), all SQL queries |
| `src-tauri/src/metadata.rs` | PNG tEXt/iTXt parser, auto-detects A1111 / ComfyUI / NovelAI |
| `src-tauri/src/config.rs` | App config (storage_dir), stored at `%APPDATA%/aigc-gallery/config.json` |
| `src-tauri/src/utils/paths.rs` | Path resolution: DB in app_data_dir, images in storage_root |
| `frontend/src/lib/tauri.ts` | **All frontend→backend API calls** — add new IPC wrappers here |
| `frontend/src/types/index.ts` | Shared TypeScript interfaces mirroring Rust structs |
| `frontend/src/App.tsx` | Root component — view routing, event orchestration |
| `frontend/src/hooks/useGallery.ts` | Core hook: pagination, search (FTS), tag filtering, debounce |

## Database Schema (SQLite)

Four tables managed via `PRAGMA user_version` migrations in `db.rs`:

```sql
images       — id, file_path (UNIQUE), file_name, file_hash, width, height,
               prompt, negative_prompt, metadata_json, created_at,
               source_type, stored_path, thumbnail_path
tags         — id, name (UNIQUE), color
image_tags   — image_id, tag_id (composite PK, cascading FKs)
favorites    — image_id (PK, cascading FK), created_at
images_fts   — FTS5 virtual table (prompt, negative_prompt, file_name, metadata_content)
               with INSERT/UPDATE/DELETE triggers for auto-sync
```

Current user_version: **2** (includes FTS5 full-text search).

## Storage Layout

- **DB + config**: `%APPDATA%/aigc-gallery/` (or `dirs_next::data_dir()`)
- **Images + thumbnails**: `<exe_dir>/gallery-data/` by default (configurable via `set_storage_dir`)
  - `images/{hash}.png` — imported copies
  - `thumbnails/{stem}_thumb.jpg` — 512px max, JPEG quality 80

## Build & Run

```bash
# Install frontend deps
cd frontend && npm install

# Development (runs both Vite dev server + Tauri)
cd .. && cargo tauri dev

# Production build
cargo tauri build
```

- Frontend: Vite 6 dev server on `localhost:5173`
- Backend: Rust compiled by Tauri CLI
- Node scripts are in `frontend/package.json`, run from `frontend/` directory

## Conventions & Patterns

### Code Style Constraints (MUST follow)

#### 文件行数限制
- **单个源文件不得超过 1000 行**（含空行和注释）
- 接近 800 行时应主动规划拆分
- 超过 1000 行必须拆分，拆分原则：
  - 按功能职责分离（如命令处理、数据库操作、工具函数）
  - 保持模块内聚，避免碎片化
  - 拆分后通过 `mod.rs` 或 `index.ts` 统一导出

#### DAG 依赖规则（有向无环图）
- **严禁循环引用**：模块间依赖必须是单向的
- 依赖关系必须形成有向无环图（DAG）
- Rust 模块依赖方向：
  ```
  main.rs → lib.rs → commands.rs → db.rs
                              ↓         ↑
                         metadata.rs    |
                              ↓         |
                         utils/* ───────┘
                              ↑
                          config.rs
  ```
- 前端模块依赖方向：
  ```
  main.tsx → App.tsx → components/* → hooks/* → lib/tauri.ts
                                    → lib/utils.ts
                                    → types/index.ts
                 ↑
            i18n/*
  ```
- 如果发现循环依赖，必须通过提取共享类型/接口到独立模块来打破循环

#### 注释规范
- **Rust 代码**：使用中文注释，文件头用 `//!` 说明模块职责，函数用 `///` 文档注释
- **TypeScript/TSX 代码**：使用中文注释，文件头注释说明模块职责，关键逻辑用行内注释
- 注释应说明"为什么"而非"做了什么"，避免对显而易见的代码重复解释

### Adding a New Tauri Command

1. **Rust**: Add `#[tauri::command]` function in `src-tauri/src/commands.rs`
2. **Register**: Add to `tauri::generate_handler![]` in `lib.rs`
3. **Frontend API**: Add wrapper in `frontend/src/lib/tauri.ts` using `invoke()`
4. **TypeScript type**: Add/update interface in `frontend/src/types/index.ts` if needed
5. **Hook/UI**: Consume from a hook in `frontend/src/hooks/` or directly in a component

### Adding a New Hook

- Place in `frontend/src/hooks/`
- Export from `frontend/src/hooks/index.ts`
- Follow the pattern in `useGallery.ts`: state + refs for stable callbacks, debounced search

### UI Components

- **Neumorphic design system**: All custom UI primitives are `Neu*` prefixed in `components/ui/`
- Use Tailwind classes with the `neu-*` color tokens defined in `tailwind.config.js`
- Global neumorphic CSS utilities are in `index.css` (e.g., `neu-flat`, `neu-pressed`, `neu-inset`)

### Rust Code Style

- Error handling: `Result<T, String>` for all commands (Tauri serializes `Err` as JS exception)
- DB access: `state.db.lock().map_err(|e| e.to_string())?`
- Use `params![]` macro for all SQL parameters
- Migrations: check `PRAGMA user_version` and increment after each migration block

### Image Import Flow

1. User selects files/folder or drag-drops → frontend filters `.png` only
2. `import_images` / `import_folder` command invoked
3. For each file: read bytes → SHA256 hash → check duplicate → parse PNG metadata → copy to `images/` → generate thumbnail → INSERT into DB
4. Returns `ImportResult { success, skipped, errors }`

### Metadata Source Detection

The parser auto-detects based on PNG tEXt/iTXt chunk keys:
- **A1111 / Forge**: `parameters` key present
- **ComfyUI**: `prompt` or `workflow` key present
- **NovelAI**: `Description` or `Comment` key present
- **Fallback**: raw key-value stored, prompt = concatenated values

## Important Notes

- **PNG only**: Import currently rejects non-PNG files (`commands.rs:34`)
- **FTS5 search**: Uses `MATCH` query with `*` wildcard prefix matching per word; also falls back to `LIKE` for negative_prompt and metadata JSON fields
- **Image display**: Uses `get_image_base64` command to return base64 data URIs (avoids Tauri asset protocol issues); alternatively `convertFileSrc()` for direct file paths
- **No tests**: No test suite exists yet — verify changes by running `cargo tauri dev` and testing manually
- **No CI/CD**: No pipeline configured
- **No CLAUDE.md**: Not present in the project

## Known Limitations

- Single-window only (no multi-window support)
- No image editing — purely a viewer/manager
- No cloud sync — fully local
- FTS5 rebuild on migration may be slow for large databases
- Thumbnail generation is synchronous (blocks the import command)
