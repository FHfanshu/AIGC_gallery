# AIGC Gallery

[English README](README.en.md)

AIGC Gallery 是一个本地优先的 AIGC 图片图库管理桌面应用，主要用于整理带生成元数据的 PNG 图片。项目使用 Tauri 2 + React 构建，图片、缩略图和 SQLite 数据库默认保存在应用旁的 `gallery-data` 目录，尽量避免把用户图库写入系统 AppData。

> 当前版本：`0.1.0`（见 `frontend/package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`）

## 核心功能

- PNG 图片导入：支持选择多张 PNG、递归导入文件夹、拖拽导入。
- 元数据解析：支持 A1111 / Forge、ComfyUI、NovelAI，以及部分 C2PA / GPT-image 元数据检测。
- 本地图库：导入后按 SHA-256 去重，图片进入托管目录，并异步生成 JPG 缩略图。
- 两种导入策略：
  - `copy`：复制到托管目录。
  - `hardlink_then_copy`：优先硬链接，失败后复制。
- 画廊浏览：分页加载、虚拟列表/网格、缩略图展示、原图详情预览。
- 搜索与统计：基于 SQLite FTS5 对 prompt、negative prompt、文件名、部分元数据做全文检索，并统计模型使用情况。
- 标签与收藏：支持标签管理、图片标签关联、收藏列表。
- Prompt 编辑：可在详情页更新正向/反向 Prompt。
- NSFW 过滤：前端提供隐藏 NSFW 图片的筛选开关。
- 中英界面：设置面板可切换中文/英文。
- Civitai 查询：按模型 hash 查询 Civitai 模型版本信息，并打开受信任的 Civitai 域名页面。
- 数据备份：支持导出/导入图库 ZIP。

## 截图占位

> 可将实际截图放到 `docs/images/` 或仓库根目录下，再替换以下占位链接。

![画廊首页截图占位](docs/images/gallery-placeholder.png)

![图片详情截图占位](docs/images/detail-placeholder.png)

![设置与导入导出截图占位](docs/images/settings-placeholder.png)

## 技术栈

- 桌面壳：Tauri 2
- 后端：Rust 2021
- 前端：React 18、TypeScript、Vite 6
- UI / 样式：Tailwind CSS、PostCSS、Autoprefixer
- 数据库：SQLite（`rusqlite`，启用 bundled SQLite）+ FTS5
- 图片处理：Rust `image` crate
- 网络查询：`reqwest`（blocking + rustls-tls）
- 凭据存储：`keyring`（Windows native）
- 打包：Tauri bundler，当前 CI 主要构建 Windows x64 MSI / NSIS

## 安装与运行

### 环境要求

- Node.js 20（CI 使用 Node 20）
- npm（项目当前使用 `package-lock.json`）
- Rust stable
- Windows 构建需要 Tauri 2 所需的 Windows / WebView2 / MSVC 工具链环境

### 安装依赖

```bash
npm install
cd frontend
npm ci
```

说明：根目录只安装 Tauri CLI；前端依赖在 `frontend/` 下单独管理。

### 开发运行

```bash
npm run tauri dev
```

Tauri 配置会执行 `cd frontend && npm run dev`，前端开发服务地址为 `http://localhost:5173`。

也可以单独启动前端：

```bash
npm run dev
```

### 前端构建

```bash
npm run build
```

该命令会进入 `frontend/` 执行 `tsc -b && vite build`，产物输出到 `frontend/dist`。

## 数据目录

默认数据根目录为 `gallery-data`，包含：

```text
gallery-data/
  config.json        # 应用配置
  gallery.db         # SQLite 数据库
  images/            # 托管原图，文件名通常为 SHA-256 hash
  thumbnails/        # JPG 缩略图
  gallery.db.bak     # 导入备份时可能生成的旧 DB 备份
```

目录解析规则：

- 开发模式：检测到可执行文件位于 `src-tauri/target/debug` 时，使用项目根目录的 `gallery-data`，避免 `cargo clean` 删除数据。
- 发布模式：默认使用可执行文件同级目录下的 `gallery-data`。
- 可在应用设置中配置自定义存储目录：
  - 绝对路径：直接使用。
  - 相对路径：以默认 `gallery-data` 为基准解析。

`config.json` 当前包含：

- `storage_dir`：自定义图库根目录，`null` 表示默认目录。
- `import_strategy`：`copy` 或 `hardlink_then_copy`。
- `civitai_base_url`：支持 `https://civitai.com`、`https://civitai.green`、`https://civitai.red`。

## 导入导出

### 图片导入

应用支持三种图片导入方式：

1. 选择多张 PNG 文件。
2. 选择文件夹，递归扫描并导入其中所有 PNG。
3. 将 PNG 文件拖拽到窗口中。

导入流程：

- 仅处理 PNG；非 PNG 会被跳过。
- 计算文件 SHA-256，用于去重与托管文件命名。
- 解析 PNG 元数据；没有可解析元数据的 PNG 会被跳过。
- 根据导入策略复制或硬链接到 `images/`。
- 写入 SQLite。
- 后台生成 `thumbnails/` 缩略图。

### 图库备份导出

设置面板中可导出 ZIP。后端会把以下内容打包：

- `config.json`
- `gallery.db`
- `images/`
- `thumbnails/`

导出接口返回类似：`导出成功：N 个文件 → path/to/aigc-gallery-backup.zip`。

### 图库备份导入

设置面板中可选择 ZIP 导入。导入行为：

- 恢复 `gallery.db`、`images/`、`thumbnails/` 到当前图库目录。
- 替换 `gallery.db` 前会备份现有数据库为 `gallery.db.bak`。
- 已存在的图片/缩略图文件会跳过，不覆盖。
- ZIP 内的 `config.json` 会跳过，不覆盖当前用户配置。
- 导入后会重新初始化数据库连接；前端随后刷新页面。

## Civitai 查询

应用可按模型文件 hash 查询 Civitai：

- 设置面板可选择 Civitai 基础域名：`civitai.com`、`civitai.green`、`civitai.red`。
- 可保存 Civitai API Key；Key 存入系统凭据库，服务名为 `aigc-gallery`，用户名为 `civitai-api-key`。
- 详情页会在检测到 checkpoint hash 或 LoRA hash 时显示 Civitai 查询按钮。
- 查询接口：`/api/v1/model-versions/by-hash/{hash}`。
- 支持返回模型名、版本名、模型类型、训练词、NSFW 字段和页面链接。
- 打开链接时只允许以下前缀：
  - `https://civitai.com/`
  - `https://civitai.green/`
  - `https://civitai.red/`

## 构建 Windows MSI

本地构建 Windows 安装包：

```bash
cd frontend
npm ci
npm run build
cd ..
npm run tauri build -- --target x86_64-pc-windows-msvc
```

或直接让 Tauri 执行前端构建：

```bash
npm run tauri build -- --target x86_64-pc-windows-msvc
```

产物通常位于：

```text
src-tauri/target/x86_64-pc-windows-msvc/release/bundle/msi/*.msi
src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/*.exe
```

当前 `src-tauri/tauri.conf.json` 中 `bundle.targets` 为 `all`，CI 会上传 MSI 与 NSIS EXE。

## 发布 tag 说明

GitHub Actions 工作流位于 `.github/workflows/build.yml`：

- 触发条件：推送 `v*` tag，或手动 `workflow_dispatch`。
- 当前矩阵启用：`windows-latest` + `x86_64-pc-windows-msvc`。
- macOS / Linux 构建在 workflow 中保留为注释，尚未启用。
- 工作流会：
  1. Checkout。
  2. 安装 Node.js 20。
  3. 安装 Rust stable 及目标 target。
  4. 在 `frontend/` 执行 `npm ci`。
  5. 执行 `npm run build`。
  6. 使用 `tauri-apps/tauri-action@v0` 构建并创建 GitHub Release 草稿。
  7. 上传 MSI / NSIS artifacts。
- Release 默认是草稿：`releaseDraft: true`。

推荐发布流程：

```bash
git tag v0.1.0
git push origin v0.1.0
```

等待 CI 完成后，在 GitHub Releases 中检查草稿、补充 changelog，再发布。

如使用 Tauri 签名，需要在仓库 Secrets 配置：

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

## 已知限制

- 当前主要面向 Windows；CI 仅启用 Windows x64，macOS / Linux 需要额外验证与启用 workflow 矩阵。
- 仅支持导入 PNG；JPG、WebP 等格式不会进入当前导入流程。
- PNG 必须包含可解析元数据；无元数据或解析失败会被跳过。
- 删除图片当前删除数据库记录及关联数据；托管原图/缩略图文件是否物理清理需以实现和后续验证为准。
- 导入 ZIP 会替换当前 `gallery.db`，虽会生成 `gallery.db.bak`，仍建议导入前手动备份整个 `gallery-data`。
- 备份导入不会覆盖已存在的图片/缩略图文件，也不会覆盖当前 `config.json`。
- Civitai 查询依赖网络、目标域名可用性和 API 限流；部分模型 hash 可能查询不到。
- API Key 存储依赖系统凭据库；不同系统或无凭据服务环境可能不可用。
- 大图原图预览会以 Base64 传给 WebView；前端只限制原图缓存数量，极大图片仍可能带来内存压力。
- FTS 搜索目前主要覆盖 prompt、negative prompt、文件名和部分元数据字段，并非完整结构化高级查询。
