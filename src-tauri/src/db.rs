//! SQLite 数据库模块
//!
//! 负责图片记录、标签、收藏的持久化存储，以及基于 FTS5 的全文检索。
//! 使用 user_version PRAGMA 管理 schema 迁移，确保新旧数据库平滑升级。

use std::cmp::Ordering;
use std::collections::HashMap;
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone)]
pub struct AiTagTarget {
    pub id: i64,
    pub file_path: String,
    pub stored_path: Option<String>,
    pub thumbnail_path: Option<String>,
}

/// 图片记录，映射到 images 表的一行。
/// 包含文件信息、生成参数、元数据 JSON 及关联标签，
/// 直接序列化后通过 Tauri 命令传递给前端。
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AiAnnotation {
    pub caption_zh: String,
    pub caption_en: String,
    pub tags_zh: Vec<String>,
    pub tags_en: Vec<String>,
    pub model: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ImageRecord {
    pub id: i64,
    pub file_path: String,
    pub file_name: String,
    pub file_hash: String,
    pub width: u32,
    pub height: u32,
    pub prompt: String,
    pub negative_prompt: String,
    pub metadata_json: String,
    pub created_at: String,
    pub tags: Vec<String>,
    pub source_type: String,
    pub stored_path: Option<String>,
    pub thumbnail_path: Option<String>,
    pub storage_mode: String,
    pub is_favorite: bool,
    pub ai_annotation: Option<AiAnnotation>,
}

/// 待插入的图片记录，用于批量导入时复用事务和 prepared statement。
#[derive(Debug, Clone)]
pub struct NewImageRecord {
    pub file_path: String,
    pub file_name: String,
    pub file_hash: String,
    pub width: u32,
    pub height: u32,
    pub prompt: String,
    pub negative_prompt: String,
    pub metadata_json: String,
    pub source_type: String,
    pub stored_path: String,
    pub thumbnail_path: String,
    pub storage_mode: String,
}

/// 标签记录，包含引用计数，供前端标签管理面板排序展示。
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TagRecord {
    pub id: i64,
    pub name: String,
    pub color: String,
    pub count: i64,
}

/// 图片库统计摘要，供前端仪表盘展示总览信息。
#[derive(Debug, Serialize, Deserialize)]
pub struct ImageStats {
    pub total_images: i64,
    pub total_tags: i64,
    pub models: Vec<ModelCount>,
}

/// 模型使用次数，用于统计用户最常使用的生成模型。
#[derive(Debug, Serialize, Deserialize)]
pub struct ModelCount {
    pub model: String,
    pub count: i64,
}

/// 数据库连接封装，持有 rusqlite 连接，所有持久化操作的入口。
pub struct Database {
    conn: Connection,
}

/// 文件名自然排序：保持前端 numeric 排序语义，避免分页排序迁移到 SQL 后 10 排在 2 前面。
fn natural_file_name_cmp(left: &str, right: &str) -> Ordering {
    let left_chars: Vec<char> = left.chars().collect();
    let right_chars: Vec<char> = right.chars().collect();
    let mut left_index = 0;
    let mut right_index = 0;

    while left_index < left_chars.len() && right_index < right_chars.len() {
        let left_is_digit = left_chars[left_index].is_ascii_digit();
        let right_is_digit = right_chars[right_index].is_ascii_digit();

        if left_is_digit && right_is_digit {
            let left_start = left_index;
            let right_start = right_index;
            while left_index < left_chars.len() && left_chars[left_index].is_ascii_digit() {
                left_index += 1;
            }
            while right_index < right_chars.len() && right_chars[right_index].is_ascii_digit() {
                right_index += 1;
            }

            let left_digits: String = left_chars[left_start..left_index].iter().collect();
            let right_digits: String = right_chars[right_start..right_index].iter().collect();
            let left_significant = left_digits.trim_start_matches('0');
            let right_significant = right_digits.trim_start_matches('0');
            let left_number = if left_significant.is_empty() { "0" } else { left_significant };
            let right_number = if right_significant.is_empty() { "0" } else { right_significant };

            let number_order = left_number
                .len()
                .cmp(&right_number.len())
                .then_with(|| left_number.cmp(right_number))
                .then_with(|| left_digits.len().cmp(&right_digits.len()));
            if number_order != Ordering::Equal {
                return number_order;
            }
            continue;
        }

        let left_start = left_index;
        let right_start = right_index;
        while left_index < left_chars.len() && !left_chars[left_index].is_ascii_digit() {
            left_index += 1;
        }
        while right_index < right_chars.len() && !right_chars[right_index].is_ascii_digit() {
            right_index += 1;
        }

        let left_text: String = left_chars[left_start..left_index].iter().collect::<String>().to_lowercase();
        let right_text: String = right_chars[right_start..right_index].iter().collect::<String>().to_lowercase();
        let text_order = left_text.cmp(&right_text);
        if text_order != Ordering::Equal {
            return text_order;
        }
    }

    left_chars.len().cmp(&right_chars.len())
}

impl Database {
    pub fn new() -> Result<Self, String> {
        let db_path = crate::utils::paths::db_path();
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
        conn.create_collation("AIGC_NATURAL", natural_file_name_cmp)
            .map_err(|e| e.to_string())?;

        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS images (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                file_path TEXT NOT NULL UNIQUE,
                file_name TEXT NOT NULL,
                file_hash TEXT NOT NULL,
                width INTEGER NOT NULL,
                height INTEGER NOT NULL,
                prompt TEXT NOT NULL DEFAULT '',
                negative_prompt TEXT NOT NULL DEFAULT '',
                metadata_json TEXT NOT NULL DEFAULT '{}',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS tags (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                color TEXT NOT NULL DEFAULT '#6366f1'
            );
            CREATE TABLE IF NOT EXISTS image_tags (
                image_id INTEGER NOT NULL,
                tag_id INTEGER NOT NULL,
                PRIMARY KEY (image_id, tag_id),
                FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE,
                FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS favorites (
                image_id INTEGER PRIMARY KEY,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_images_hash ON images(file_hash);
            CREATE INDEX IF NOT EXISTS idx_images_prompt ON images(prompt);
            CREATE INDEX IF NOT EXISTS idx_images_created_at ON images(created_at);
            "
        ).map_err(|e| e.to_string())?;

        // Run migrations based on user_version
        let version: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))
            .map_err(|e| e.to_string())?;

        if version == 0 {
            let alter_statements = [
                "ALTER TABLE images ADD COLUMN source_type TEXT NOT NULL DEFAULT 'unknown'",
                "ALTER TABLE images ADD COLUMN stored_path TEXT",
                "ALTER TABLE images ADD COLUMN thumbnail_path TEXT",
            ];
            for stmt in &alter_statements {
                match conn.execute_batch(stmt) {
                    Ok(_) => {}
                    Err(e) => {
                        let msg = e.to_string();
                        if !msg.contains("duplicate column") {
                            return Err(format!("Migration error: {}", msg));
                        }
                    }
                }
            }
            conn.execute_batch("PRAGMA user_version = 1").map_err(|e| e.to_string())?;
        }

        if version < 2 {
            // Migration v2: FTS5 full-text search with triggers
            conn.execute_batch(
                "CREATE VIRTUAL TABLE IF NOT EXISTS images_fts USING fts5(
                    prompt, negative_prompt, file_name, metadata_content);
                 CREATE TRIGGER IF NOT EXISTS images_ai AFTER INSERT ON images BEGIN
                     INSERT INTO images_fts(rowid, prompt, negative_prompt, file_name, metadata_content)
                     VALUES (new.id, new.prompt, new.negative_prompt, new.file_name,
                             COALESCE(json_extract(new.metadata_json, '$.characters'), '') || ' ' ||
                             COALESCE(json_extract(new.metadata_json, '$.model'), ''));
                 END;
                 CREATE TRIGGER IF NOT EXISTS images_ad AFTER DELETE ON images BEGIN
                     INSERT INTO images_fts(images_fts, rowid, prompt, negative_prompt, file_name, metadata_content)
                     VALUES ('delete', old.id, old.prompt, old.negative_prompt, old.file_name,
                             COALESCE(json_extract(old.metadata_json, '$.characters'), '') || ' ' ||
                             COALESCE(json_extract(old.metadata_json, '$.model'), ''));
                 END;
                 CREATE TRIGGER IF NOT EXISTS images_au AFTER UPDATE ON images BEGIN
                     INSERT INTO images_fts(images_fts, rowid, prompt, negative_prompt, file_name, metadata_content)
                     VALUES ('delete', old.id, old.prompt, old.negative_prompt, old.file_name,
                             COALESCE(json_extract(old.metadata_json, '$.characters'), '') || ' ' ||
                             COALESCE(json_extract(old.metadata_json, '$.model'), ''));
                     INSERT INTO images_fts(rowid, prompt, negative_prompt, file_name, metadata_content)
                     VALUES (new.id, new.prompt, new.negative_prompt, new.file_name,
                             COALESCE(json_extract(new.metadata_json, '$.characters'), '') || ' ' ||
                             COALESCE(json_extract(new.metadata_json, '$.model'), ''));
                 END;"
            ).map_err(|e| e.to_string())?;
            // Rebuild FTS index from existing data
            conn.execute_batch("INSERT INTO images_fts(images_fts) VALUES('rebuild');").map_err(|e| e.to_string())?;
            conn.execute_batch("PRAGMA user_version = 2").map_err(|e| e.to_string())?;
        }

        if version < 3 {
            match conn.execute_batch("ALTER TABLE images ADD COLUMN storage_mode TEXT NOT NULL DEFAULT 'copy'") {
                Ok(_) => {}
                Err(e) => {
                    let msg = e.to_string();
                    if !msg.contains("duplicate column") {
                        return Err(format!("Migration error: {}", msg));
                    }
                }
            }
            conn.execute_batch("PRAGMA user_version = 3").map_err(|e| e.to_string())?;
        }

        if version < 4 {
            conn.execute_batch(
                "CREATE TABLE IF NOT EXISTS image_ai_annotations (
                    image_id INTEGER PRIMARY KEY,
                    caption_zh TEXT NOT NULL DEFAULT '',
                    caption_en TEXT NOT NULL DEFAULT '',
                    tags_zh_json TEXT NOT NULL DEFAULT '[]',
                    tags_en_json TEXT NOT NULL DEFAULT '[]',
                    model TEXT NOT NULL DEFAULT '',
                    error TEXT NOT NULL DEFAULT '',
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE
                );
                PRAGMA user_version = 4;"
            ).map_err(|e| e.to_string())?;
        }

        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS image_ai_annotations (
                image_id INTEGER PRIMARY KEY,
                caption_zh TEXT NOT NULL DEFAULT '',
                caption_en TEXT NOT NULL DEFAULT '',
                tags_zh_json TEXT NOT NULL DEFAULT '[]',
                tags_en_json TEXT NOT NULL DEFAULT '[]',
                model TEXT NOT NULL DEFAULT '',
                error TEXT NOT NULL DEFAULT '',
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE
            );"
        ).map_err(|e| e.to_string())?;

        // 修复旧版本 FTS 触发器中 SQLite 不支持的 JSON 通配符路径，避免插入图片记录时失败。
        conn.execute_batch(
            "DROP TRIGGER IF EXISTS images_ai;
             DROP TRIGGER IF EXISTS images_ad;
             DROP TRIGGER IF EXISTS images_au;
             CREATE TRIGGER images_ai AFTER INSERT ON images BEGIN
                 INSERT INTO images_fts(rowid, prompt, negative_prompt, file_name, metadata_content)
                 VALUES (new.id, new.prompt, new.negative_prompt, new.file_name,
                         COALESCE(json_extract(new.metadata_json, '$.characters'), '') || ' ' ||
                         COALESCE(json_extract(new.metadata_json, '$.model'), ''));
             END;
             CREATE TRIGGER images_ad AFTER DELETE ON images BEGIN
                 DELETE FROM images_fts WHERE rowid = old.id;
             END;
             CREATE TRIGGER images_au AFTER UPDATE ON images BEGIN
                 DELETE FROM images_fts WHERE rowid = old.id;
                 INSERT INTO images_fts(rowid, prompt, negative_prompt, file_name, metadata_content)
                 VALUES (new.id, new.prompt, new.negative_prompt, new.file_name,
                         COALESCE(json_extract(new.metadata_json, '$.characters'), '') || ' ' ||
                         COALESCE(json_extract(new.metadata_json, '$.model'), ''));
             END;
             INSERT INTO images_fts(images_fts) VALUES('rebuild');"
        ).map_err(|e| format!("FTS trigger repair error: {}", e))?;

        Ok(Self { conn })
    }

    pub fn insert_image(
        &self,
        file_path: &str,
        file_name: &str,
        file_hash: &str,
        width: u32,
        height: u32,
        prompt: &str,
        negative_prompt: &str,
        metadata_json: &str,
        source_type: &str,
        stored_path: Option<&str>,
        thumbnail_path: Option<&str>,
        storage_mode: &str,
    ) -> Result<i64, String> {
        self.conn.execute(
            "INSERT OR IGNORE INTO images (file_path, file_name, file_hash, width, height, prompt, negative_prompt, metadata_json, source_type, stored_path, thumbnail_path, storage_mode)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![file_path, file_name, file_hash, width, height, prompt, negative_prompt, metadata_json, source_type, stored_path, thumbnail_path, storage_mode],
        ).map_err(|e| e.to_string())?;

        self.conn.query_row(
            "SELECT id FROM images WHERE file_hash = ?1",
            params![file_hash],
            |row| row.get(0),
        ).map_err(|e| e.to_string())
    }

    pub fn insert_images_batch(&self, images: &[NewImageRecord]) -> Result<Vec<String>, String> {
        if images.is_empty() { return Ok(Vec::new()); }
        self.conn.execute_batch("BEGIN IMMEDIATE TRANSACTION").map_err(|e| e.to_string())?;
        let result = (|| -> Result<Vec<String>, String> {
            let mut stmt = self.conn.prepare(
                "INSERT OR IGNORE INTO images (file_path, file_name, file_hash, width, height, prompt, negative_prompt, metadata_json, source_type, stored_path, thumbnail_path, storage_mode)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)"
            ).map_err(|e| e.to_string())?;
            let mut inserted = Vec::new();
            for img in images {
                let changed = stmt.execute(params![
                    img.file_path,
                    img.file_name,
                    img.file_hash,
                    img.width,
                    img.height,
                    img.prompt,
                    img.negative_prompt,
                    img.metadata_json,
                    img.source_type,
                    img.stored_path,
                    img.thumbnail_path,
                    img.storage_mode,
                ]).map_err(|e| e.to_string())?;
                if changed > 0 {
                    inserted.push(img.file_path.clone());
                }
            }
            Ok(inserted)
        })();
        match result {
            Ok(inserted) => {
                self.conn.execute_batch("COMMIT").map_err(|e| e.to_string())?;
                Ok(inserted)
            }
            Err(e) => {
                let _ = self.conn.execute_batch("ROLLBACK");
                Err(e)
            }
        }
    }

    pub fn image_exists(&self, file_hash: &str) -> Result<bool, String> {
        let count: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM images WHERE file_hash = ?1",
            params![file_hash],
            |row| row.get(0),
        ).map_err(|e| e.to_string())?;
        Ok(count > 0)
    }

    fn row_to_image(row: &rusqlite::Row) -> rusqlite::Result<ImageRecord> {
        let mut image = ImageRecord {
            id: row.get(0)?,
            file_path: row.get(1)?,
            file_name: row.get(2)?,
            file_hash: row.get(3)?,
            width: row.get::<_, u32>(4)?,
            height: row.get::<_, u32>(5)?,
            prompt: row.get(6)?,
            negative_prompt: row.get(7)?,
            metadata_json: row.get(8)?,
            created_at: row.get(9)?,
            source_type: row.get(10)?,
            stored_path: row.get(11)?,
            thumbnail_path: row.get(12)?,
            storage_mode: row.get(13)?,
            is_favorite: row.get::<_, i64>(14)? != 0,
            tags: Vec::new(),
            ai_annotation: None,
        };
        Self::relocate_internal_paths(&mut image);
        Ok(image)
    }

    fn relocate_internal_paths(image: &mut ImageRecord) {
        image.stored_path = crate::utils::paths::relocate_gallery_file_path_string(
            image.stored_path.take(),
            "images",
        );
        image.thumbnail_path = crate::utils::paths::relocate_gallery_file_path_string(
            image.thumbnail_path.take(),
            "thumbnails",
        );
    }

    fn fill_batch_tags(&self, images: &mut [ImageRecord]) -> Result<(), String> {
        if images.is_empty() { return Ok(()); }
        let ids: Vec<i64> = images.iter().map(|i| i.id).collect();
        let placeholders: Vec<String> = ids.iter().enumerate().map(|(i, _)| format!("?{}", i + 1)).collect();
        let sql = format!(
            "SELECT it.image_id, t.name FROM image_tags it JOIN tags t ON t.id = it.tag_id WHERE it.image_id IN ({})",
            placeholders.join(",")
        );
        let mut stmt = self.conn.prepare(&sql).map_err(|e| e.to_string())?;
        let params: Vec<Box<dyn rusqlite::types::ToSql>> = ids.iter()
            .map(|id| Box::new(*id) as Box<dyn rusqlite::types::ToSql>).collect();
        let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
        let mut tag_map: HashMap<i64, Vec<String>> = HashMap::new();
        let rows = stmt.query_map(param_refs.as_slice(), |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        }).map_err(|e| e.to_string())?;
        for row in rows {
            let (image_id, tag_name) = row.map_err(|e| e.to_string())?;
            tag_map.entry(image_id).or_default().push(tag_name);
        }
        for img in images.iter_mut() {
            img.tags = tag_map.remove(&img.id).unwrap_or_default();
        }
        self.fill_batch_ai_annotations(images)?;
        Ok(())
    }

    fn fill_batch_ai_annotations(&self, images: &mut [ImageRecord]) -> Result<(), String> {
        if images.is_empty() { return Ok(()); }
        let ids: Vec<i64> = images.iter().map(|i| i.id).collect();
        let placeholders: Vec<String> = ids.iter().enumerate().map(|(i, _)| format!("?{}", i + 1)).collect();
        let sql = format!(
            "SELECT image_id, caption_zh, caption_en, tags_zh_json, tags_en_json, model, updated_at FROM image_ai_annotations WHERE image_id IN ({})",
            placeholders.join(",")
        );
        let mut stmt = self.conn.prepare(&sql).map_err(|e| e.to_string())?;
        let params: Vec<Box<dyn rusqlite::types::ToSql>> = ids.iter()
            .map(|id| Box::new(*id) as Box<dyn rusqlite::types::ToSql>).collect();
        let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
        let rows = stmt.query_map(param_refs.as_slice(), |row| {
            let tags_zh_json: String = row.get(3)?;
            let tags_en_json: String = row.get(4)?;
            Ok((row.get::<_, i64>(0)?, AiAnnotation {
                caption_zh: row.get(1)?,
                caption_en: row.get(2)?,
                tags_zh: serde_json::from_str(&tags_zh_json).unwrap_or_default(),
                tags_en: serde_json::from_str(&tags_en_json).unwrap_or_default(),
                model: row.get(5)?,
                updated_at: row.get(6)?,
            }))
        }).map_err(|e| e.to_string())?;
        let mut annotation_map = HashMap::new();
        for row in rows {
            let (image_id, annotation) = row.map_err(|e| e.to_string())?;
            annotation_map.insert(image_id, annotation);
        }
        for img in images.iter_mut() {
            img.ai_annotation = annotation_map.remove(&img.id);
        }
        Ok(())
    }

    fn build_fts_query(q: &str) -> String {
        q.split_whitespace()
            .filter(|w| !w.is_empty())
            .map(|w| {
                let clean: String = w.chars().filter(|c| *c != '"' && *c != '\'' && *c != '*').collect();
                format!("{}*", clean)
            })
            .collect::<Vec<_>>()
            .join(" OR ")
    }

    /// 根据前端白名单排序字段生成 ORDER BY，避免分页时前端只排序局部数据。
    fn image_order_clause(sort_by: &str, sort_dir: &str) -> String {
        let dir = if sort_dir.eq_ignore_ascii_case("asc") { "ASC" } else { "DESC" };
        let expr = match sort_by {
            "file_name" => "i.file_name COLLATE AIGC_NATURAL",
            "source_type" => "i.source_type COLLATE NOCASE",
            "dimensions" => "(i.width * i.height)",
            "aspect_ratio" => "CASE WHEN i.height > 0 THEN CAST(i.width AS REAL) / i.height ELSE 0 END",
            "model" => "COALESCE(json_extract(i.metadata_json, '$.model'), '') COLLATE NOCASE",
            "prompt" => "i.prompt COLLATE NOCASE",
            _ => "i.created_at",
        };
        format!("ORDER BY {} {}, i.id {}", expr, dir, dir)
    }

    pub fn get_images(&self, offset: i64, limit: i64, search: Option<&str>, sort_by: &str, sort_dir: &str) -> Result<Vec<ImageRecord>, String> {
        let order_clause = Self::image_order_clause(sort_by, sort_dir);
        if let Some(q) = search {
            let fts_query = Self::build_fts_query(q);
            let pattern = format!("%{}%", q);
            let sql = format!(
                "SELECT i.id, i.file_path, i.file_name, i.file_hash, i.width, i.height,
                        i.prompt, i.negative_prompt, i.metadata_json, i.created_at,
                        i.source_type, i.stored_path, i.thumbnail_path, i.storage_mode,
                        CASE WHEN f.image_id IS NOT NULL THEN 1 ELSE 0 END as is_favorite
                 FROM images i
                 LEFT JOIN favorites f ON i.id = f.image_id
                 LEFT JOIN image_ai_annotations a ON i.id = a.image_id
                 WHERE i.id IN (SELECT rowid FROM images_fts WHERE images_fts MATCH ?1)
                    OR i.negative_prompt LIKE ?2
                    OR json_extract(i.metadata_json, '$.characters') LIKE ?2
                    OR json_extract(i.metadata_json, '$.model') LIKE ?2
                    OR a.caption_zh LIKE ?2
                    OR a.caption_en LIKE ?2
                    OR a.tags_zh_json LIKE ?2
                    OR a.tags_en_json LIKE ?2
                 {} LIMIT ?3 OFFSET ?4",
                order_clause
            );
            let mut stmt = self.conn.prepare(&sql).map_err(|e| e.to_string())?;

            let rows = stmt.query_map(params![fts_query, pattern, limit, offset], |row| {
                Self::row_to_image(row)
            }).map_err(|e| e.to_string())?;
            let mut images: Vec<ImageRecord> = rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
            self.fill_batch_tags(&mut images)?;
            return Ok(images);
        }

        let sql = format!(
            "SELECT i.id, i.file_path, i.file_name, i.file_hash, i.width, i.height,
                    i.prompt, i.negative_prompt, i.metadata_json, i.created_at,
                    i.source_type, i.stored_path, i.thumbnail_path, i.storage_mode,
                    CASE WHEN f.image_id IS NOT NULL THEN 1 ELSE 0 END as is_favorite
             FROM images i
             LEFT JOIN favorites f ON i.id = f.image_id
             {} LIMIT ?1 OFFSET ?2",
            order_clause
        );
        let mut stmt = self.conn.prepare(&sql).map_err(|e| e.to_string())?;

        let rows = stmt.query_map(params![limit, offset], |row| {
            Self::row_to_image(row)
        }).map_err(|e| e.to_string())?;
        let mut images: Vec<ImageRecord> = rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
        self.fill_batch_tags(&mut images)?;
        Ok(images)
    }

    pub fn get_image_by_id(&self, id: i64) -> Result<ImageRecord, String> {
        let mut stmt = self.conn.prepare(
            "SELECT i.id, i.file_path, i.file_name, i.file_hash, i.width, i.height,
                    i.prompt, i.negative_prompt, i.metadata_json, i.created_at,
                    i.source_type, i.stored_path, i.thumbnail_path, i.storage_mode,
                    CASE WHEN f.image_id IS NOT NULL THEN 1 ELSE 0 END as is_favorite
             FROM images i
             LEFT JOIN favorites f ON i.id = f.image_id
             WHERE i.id = ?1"
        ).map_err(|e| e.to_string())?;

        let mut img = stmt.query_row(params![id], |row| {
            Self::row_to_image(row)
        }).map_err(|e| e.to_string())?;

        img.tags = self.get_image_tags(img.id)?;
        self.fill_batch_ai_annotations(std::slice::from_mut(&mut img))?;
        Ok(img)
    }

    pub fn get_all_image_ids(&self) -> Result<Vec<i64>, String> {
        let mut stmt = self.conn.prepare("SELECT id FROM images ORDER BY created_at DESC, id DESC")
            .map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], |row| row.get::<_, i64>(0)).map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn get_images_by_tag(&self, tag_name: &str, offset: i64, limit: i64) -> Result<Vec<ImageRecord>, String> {
        let mut stmt = self.conn.prepare(
            "SELECT i.id, i.file_path, i.file_name, i.file_hash, i.width, i.height,
                    i.prompt, i.negative_prompt, i.metadata_json, i.created_at,
                    i.source_type, i.stored_path, i.thumbnail_path, i.storage_mode,
                    CASE WHEN f.image_id IS NOT NULL THEN 1 ELSE 0 END as is_favorite
             FROM images i
             JOIN image_tags it ON i.id = it.image_id
             JOIN tags t ON it.tag_id = t.id
             LEFT JOIN favorites f ON i.id = f.image_id
             WHERE t.name = ?1
             ORDER BY i.created_at DESC, i.id DESC LIMIT ?2 OFFSET ?3"
        ).map_err(|e| e.to_string())?;

        let rows = stmt.query_map(params![tag_name, limit, offset], |row| {
            Self::row_to_image(row)
        }).map_err(|e| e.to_string())?;
        let mut images: Vec<ImageRecord> = rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
        self.fill_batch_tags(&mut images)?;
        Ok(images)
    }

    pub fn delete_image(&self, id: i64) -> Result<(), String> {
        self.conn.execute("DELETE FROM favorites WHERE image_id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        self.conn.execute("DELETE FROM image_tags WHERE image_id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        // FTS sync handled by AFTER DELETE trigger
        self.conn.execute("DELETE FROM images WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn add_tag(&self, name: &str, color: &str) -> Result<i64, String> {
        self.conn.execute(
            "INSERT OR IGNORE INTO tags (name, color) VALUES (?1, ?2)",
            params![name, color],
        ).map_err(|e| e.to_string())?;

        self.conn.query_row(
            "SELECT id FROM tags WHERE name = ?1",
            params![name],
            |row| row.get(0),
        ).map_err(|e| e.to_string())
    }

    pub fn remove_tag(&self, tag_id: i64) -> Result<(), String> {
        self.conn.execute("DELETE FROM image_tags WHERE tag_id = ?1", params![tag_id])
            .map_err(|e| e.to_string())?;
        self.conn.execute("DELETE FROM tags WHERE id = ?1", params![tag_id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_all_tags(&self) -> Result<Vec<TagRecord>, String> {
        let mut stmt = self.conn.prepare(
            "SELECT t.id, t.name, t.color, COUNT(it.image_id) as count
             FROM tags t LEFT JOIN image_tags it ON t.id = it.tag_id
             GROUP BY t.id ORDER BY count DESC"
        ).map_err(|e| e.to_string())?;

        let rows = stmt.query_map([], |row| {
            Ok(TagRecord {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
                count: row.get(3)?,
            })
        }).map_err(|e| e.to_string())?;

        let mut tags = Vec::new();
        for row in rows {
            tags.push(row.map_err(|e| e.to_string())?);
        }
        Ok(tags)
    }

    pub fn update_image_tags(&self, image_id: i64, tag_ids: &[i64]) -> Result<(), String> {
        self.conn.execute("DELETE FROM image_tags WHERE image_id = ?1", params![image_id])
            .map_err(|e| e.to_string())?;

        for &tag_id in tag_ids {
            self.conn.execute(
                "INSERT OR IGNORE INTO image_tags (image_id, tag_id) VALUES (?1, ?2)",
                params![image_id, tag_id],
            ).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    fn get_image_tags(&self, image_id: i64) -> Result<Vec<String>, String> {
        let mut stmt = self.conn.prepare(
            "SELECT t.name FROM tags t JOIN image_tags it ON t.id = it.tag_id WHERE it.image_id = ?1"
        ).map_err(|e| e.to_string())?;

        let rows = stmt.query_map(params![image_id], |row| {
            row.get::<_, String>(0)
        }).map_err(|e| e.to_string())?;

        let mut tags = Vec::new();
        for row in rows {
            tags.push(row.map_err(|e| e.to_string())?);
        }
        Ok(tags)
    }

    pub fn get_images_needing_ai_annotation(&self) -> Result<Vec<AiTagTarget>, String> {
        let mut stmt = self.conn.prepare(
            "SELECT i.id, i.file_path, i.stored_path, i.thumbnail_path
             FROM images i
             LEFT JOIN image_ai_annotations a ON i.id = a.image_id
             WHERE TRIM(COALESCE(i.prompt, '')) = ''
               AND TRIM(COALESCE(i.negative_prompt, '')) = ''
               AND (a.image_id IS NULL OR TRIM(COALESCE(a.error, '')) != '')
             ORDER BY i.created_at DESC, i.id DESC"
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], |row| Ok(AiTagTarget {
            id: row.get(0)?,
            file_path: row.get(1)?,
            stored_path: crate::utils::paths::relocate_gallery_file_path_string(row.get(2)?, "images"),
            thumbnail_path: crate::utils::paths::relocate_gallery_file_path_string(row.get(3)?, "thumbnails"),
        })).map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn upsert_ai_annotation(&self, image_id: i64, annotation: &AiAnnotation) -> Result<(), String> {
        let tags_zh_json = serde_json::to_string(&annotation.tags_zh).map_err(|e| e.to_string())?;
        let tags_en_json = serde_json::to_string(&annotation.tags_en).map_err(|e| e.to_string())?;
        self.conn.execute(
            "INSERT INTO image_ai_annotations (image_id, caption_zh, caption_en, tags_zh_json, tags_en_json, model, error, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, '', CURRENT_TIMESTAMP)
             ON CONFLICT(image_id) DO UPDATE SET
                caption_zh = excluded.caption_zh,
                caption_en = excluded.caption_en,
                tags_zh_json = excluded.tags_zh_json,
                tags_en_json = excluded.tags_en_json,
                model = excluded.model,
                error = '',
                updated_at = CURRENT_TIMESTAMP",
            params![image_id, annotation.caption_zh, annotation.caption_en, tags_zh_json, tags_en_json, annotation.model],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn upsert_ai_annotation_error(&self, image_id: i64, model: &str, error: &str) -> Result<(), String> {
        self.conn.execute(
            "INSERT INTO image_ai_annotations (image_id, model, error, updated_at)
             VALUES (?1, ?2, ?3, CURRENT_TIMESTAMP)
             ON CONFLICT(image_id) DO UPDATE SET model = excluded.model, error = excluded.error, updated_at = CURRENT_TIMESTAMP",
            params![image_id, model, error],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_stats(&self) -> Result<ImageStats, String> {
        let total_images: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM images", [], |row| row.get(0)
        ).map_err(|e| e.to_string())?;

        let total_tags: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM tags", [], |row| row.get(0)
        ).map_err(|e| e.to_string())?;

        let mut stmt = self.conn.prepare(
            "SELECT json_extract(metadata_json, '$.model') as model, COUNT(*) as cnt
             FROM images WHERE json_extract(metadata_json, '$.model') IS NOT NULL AND json_extract(metadata_json, '$.model') != ''
             GROUP BY json_extract(metadata_json, '$.model') ORDER BY cnt DESC LIMIT 20"
        ).map_err(|e| e.to_string())?;

        let models = stmt.query_map([], |row| {
            Ok(ModelCount {
                model: row.get(0)?,
                count: row.get(1)?,
            })
        }).map_err(|e| e.to_string())?;

        let mut model_list = Vec::new();
        for m in models {
            model_list.push(m.map_err(|e| e.to_string())?);
        }

        Ok(ImageStats {
            total_images,
            total_tags,
            models: model_list,
        })
    }

    pub fn toggle_favorite(&self, image_id: i64) -> Result<bool, String> {
        let exists: bool = self.conn.query_row(
            "SELECT COUNT(*) FROM favorites WHERE image_id = ?1",
            params![image_id],
            |row| Ok(row.get::<_, i64>(0)? > 0),
        ).map_err(|e| e.to_string())?;

        if exists {
            self.conn.execute(
                "DELETE FROM favorites WHERE image_id = ?1",
                params![image_id],
            ).map_err(|e| e.to_string())?;
            Ok(false)
        } else {
            self.conn.execute(
                "INSERT INTO favorites (image_id) VALUES (?1)",
                params![image_id],
            ).map_err(|e| e.to_string())?;
            Ok(true)
        }
    }

    pub fn get_favorites(&self, offset: i64, limit: i64) -> Result<Vec<ImageRecord>, String> {
        let mut stmt = self.conn.prepare(
            "SELECT i.id, i.file_path, i.file_name, i.file_hash, i.width, i.height,
                    i.prompt, i.negative_prompt, i.metadata_json, i.created_at,
                    i.source_type, i.stored_path, i.thumbnail_path, i.storage_mode,
                    1 as is_favorite
             FROM images i
             INNER JOIN favorites f ON i.id = f.image_id
             ORDER BY f.created_at DESC, i.id DESC LIMIT ?1 OFFSET ?2"
        ).map_err(|e| e.to_string())?;

        let rows = stmt.query_map(params![limit, offset], |row| {
            let mut image = ImageRecord {
                id: row.get(0)?,
                file_path: row.get(1)?,
                file_name: row.get(2)?,
                file_hash: row.get(3)?,
                width: row.get::<_, u32>(4)?,
                height: row.get::<_, u32>(5)?,
                prompt: row.get(6)?,
                negative_prompt: row.get(7)?,
                metadata_json: row.get(8)?,
                created_at: row.get(9)?,
                source_type: row.get(10)?,
                stored_path: row.get(11)?,
                thumbnail_path: row.get(12)?,
                storage_mode: row.get(13)?,
                is_favorite: true,
                tags: Vec::new(),
                ai_annotation: None,
            };
            Self::relocate_internal_paths(&mut image);
            Ok(image)
        }).map_err(|e| e.to_string())?;

        let mut images: Vec<ImageRecord> = rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
        self.fill_batch_tags(&mut images)?;
        Ok(images)
    }

    pub fn update_prompt(&self, image_id: i64, positive_prompt: &str, negative_prompt: &str) -> Result<(), String> {
        // FTS sync handled by AFTER UPDATE trigger
        self.conn.execute(
            "UPDATE images SET prompt = ?1, negative_prompt = ?2 WHERE id = ?3",
            params![positive_prompt, negative_prompt, image_id],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn update_image_metadata(
        &self,
        image_id: i64,
        width: u32,
        height: u32,
        prompt: &str,
        negative_prompt: &str,
        metadata_json: &str,
        source_type: &str,
    ) -> Result<(), String> {
        // 重新解析会改变 prompt/metadata，依赖 UPDATE trigger 同步 FTS 索引。
        self.conn.execute(
            "UPDATE images SET width = ?1, height = ?2, prompt = ?3, negative_prompt = ?4, metadata_json = ?5, source_type = ?6 WHERE id = ?7",
            params![width, height, prompt, negative_prompt, metadata_json, source_type, image_id],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }
}
