//! SQLite 数据库模块
//!
//! 负责图片记录、标签、收藏的持久化存储，以及基于 FTS5 的全文检索。
//! 使用 user_version PRAGMA 管理 schema 迁移，确保新旧数据库平滑升级。

use std::collections::HashMap;
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};

/// 图片记录，映射到 images 表的一行。
/// 包含文件信息、生成参数、元数据 JSON 及关联标签，
/// 直接序列化后通过 Tauri 命令传递给前端。
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

impl Database {
    pub fn new() -> Result<Self, String> {
        let db_path = crate::utils::paths::db_path();
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;

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
                             COALESCE(json_extract(new.metadata_json, '$.characters[*].text'), '') || ' ' ||
                             COALESCE(json_extract(new.metadata_json, '$.model'), ''));
                 END;
                 CREATE TRIGGER IF NOT EXISTS images_ad AFTER DELETE ON images BEGIN
                     INSERT INTO images_fts(images_fts, rowid, prompt, negative_prompt, file_name, metadata_content)
                     VALUES ('delete', old.id, old.prompt, old.negative_prompt, old.file_name,
                             COALESCE(json_extract(old.metadata_json, '$.characters[*].text'), '') || ' ' ||
                             COALESCE(json_extract(old.metadata_json, '$.model'), ''));
                 END;
                 CREATE TRIGGER IF NOT EXISTS images_au AFTER UPDATE ON images BEGIN
                     INSERT INTO images_fts(images_fts, rowid, prompt, negative_prompt, file_name, metadata_content)
                     VALUES ('delete', old.id, old.prompt, old.negative_prompt, old.file_name,
                             COALESCE(json_extract(old.metadata_json, '$.characters[*].text'), '') || ' ' ||
                             COALESCE(json_extract(old.metadata_json, '$.model'), ''));
                     INSERT INTO images_fts(rowid, prompt, negative_prompt, file_name, metadata_content)
                     VALUES (new.id, new.prompt, new.negative_prompt, new.file_name,
                             COALESCE(json_extract(new.metadata_json, '$.characters[*].text'), '') || ' ' ||
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

    pub fn image_exists(&self, file_hash: &str) -> Result<bool, String> {
        let count: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM images WHERE file_hash = ?1",
            params![file_hash],
            |row| row.get(0),
        ).map_err(|e| e.to_string())?;
        Ok(count > 0)
    }

    fn row_to_image(row: &rusqlite::Row) -> rusqlite::Result<ImageRecord> {
        Ok(ImageRecord {
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
        })
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

    pub fn get_images(&self, offset: i64, limit: i64, search: Option<&str>) -> Result<Vec<ImageRecord>, String> {
        if let Some(q) = search {
            let fts_query = Self::build_fts_query(q);
            let pattern = format!("%{}%", q);
            let mut stmt = self.conn.prepare(
                "SELECT i.id, i.file_path, i.file_name, i.file_hash, i.width, i.height,
                        i.prompt, i.negative_prompt, i.metadata_json, i.created_at,
                        i.source_type, i.stored_path, i.thumbnail_path, i.storage_mode,
                        CASE WHEN f.image_id IS NOT NULL THEN 1 ELSE 0 END as is_favorite
                 FROM images i
                 LEFT JOIN favorites f ON i.id = f.image_id
                 WHERE i.id IN (SELECT rowid FROM images_fts WHERE images_fts MATCH ?1)
                    OR i.negative_prompt LIKE ?2
                    OR json_extract(i.metadata_json, '$.characters[*].text') LIKE ?2
                    OR json_extract(i.metadata_json, '$.model') LIKE ?2
                 ORDER BY i.created_at DESC LIMIT ?3 OFFSET ?4"
            ).map_err(|e| e.to_string())?;

            let rows = stmt.query_map(params![fts_query, pattern, limit, offset], |row| {
                Self::row_to_image(row)
            }).map_err(|e| e.to_string())?;
            let mut images: Vec<ImageRecord> = rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
            self.fill_batch_tags(&mut images)?;
            return Ok(images);
        }

        let mut stmt = self.conn.prepare(
            "SELECT i.id, i.file_path, i.file_name, i.file_hash, i.width, i.height,
                    i.prompt, i.negative_prompt, i.metadata_json, i.created_at,
                    i.source_type, i.stored_path, i.thumbnail_path, i.storage_mode,
                    CASE WHEN f.image_id IS NOT NULL THEN 1 ELSE 0 END as is_favorite
             FROM images i
             LEFT JOIN favorites f ON i.id = f.image_id
             ORDER BY i.created_at DESC LIMIT ?1 OFFSET ?2"
        ).map_err(|e| e.to_string())?;

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
        Ok(img)
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
             ORDER BY i.created_at DESC LIMIT ?2 OFFSET ?3"
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
             ORDER BY f.created_at DESC LIMIT ?1 OFFSET ?2"
        ).map_err(|e| e.to_string())?;

        let rows = stmt.query_map(params![limit, offset], |row| {
            Ok(ImageRecord {
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
            })
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
}
