use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};

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
    pub is_favorite: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TagRecord {
    pub id: i64,
    pub name: String,
    pub color: String,
    pub count: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ImageStats {
    pub total_images: i64,
    pub total_tags: i64,
    pub models: Vec<ModelCount>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ModelCount {
    pub model: String,
    pub count: i64,
}

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
            "
        ).map_err(|e| e.to_string())?;

        // Run migrations based on user_version
        let version: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))
            .map_err(|e| e.to_string())?;

        if version == 0 {
            // Migration v1: Add source_type, stored_path, thumbnail_path columns
            let alter_statements = [
                "ALTER TABLE images ADD COLUMN source_type TEXT NOT NULL DEFAULT 'unknown'",
                "ALTER TABLE images ADD COLUMN stored_path TEXT",
                "ALTER TABLE images ADD COLUMN thumbnail_path TEXT",
            ];
            for stmt in &alter_statements {
                // SQLite ALTER TABLE ADD COLUMN doesn't support IF NOT EXISTS,
                // so we attempt and ignore "duplicate column" errors
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
    ) -> Result<i64, String> {
        self.conn.execute(
            "INSERT OR IGNORE INTO images (file_path, file_name, file_hash, width, height, prompt, negative_prompt, metadata_json, source_type, stored_path, thumbnail_path)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![file_path, file_name, file_hash, width, height, prompt, negative_prompt, metadata_json, source_type, stored_path, thumbnail_path],
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

    pub fn get_images(&self, offset: i64, limit: i64, search: Option<&str>) -> Result<Vec<ImageRecord>, String> {
        if let Some(q) = search {
            let pattern = format!("%{}%", q);
            let mut stmt = self.conn.prepare(
                "SELECT i.id, i.file_path, i.file_name, i.file_hash, i.width, i.height,
                        i.prompt, i.negative_prompt, i.metadata_json, i.created_at,
                        i.source_type, i.stored_path, i.thumbnail_path,
                        CASE WHEN f.image_id IS NOT NULL THEN 1 ELSE 0 END as is_favorite
                 FROM images i
                 LEFT JOIN favorites f ON i.id = f.image_id
                 WHERE i.prompt LIKE ?1 OR i.negative_prompt LIKE ?1 OR i.file_name LIKE ?1
                 ORDER BY i.created_at DESC LIMIT ?2 OFFSET ?3"
            ).map_err(|e| e.to_string())?;
            let rows = stmt.query_map(params![pattern, limit, offset], |row| {
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
                    is_favorite: row.get::<_, i64>(13)? != 0,
                    tags: Vec::new(),
                })
            }).map_err(|e| e.to_string())?;
            let mut images = Vec::new();
            for row in rows {
                let mut img = row.map_err(|e| e.to_string())?;
                img.tags = self.get_image_tags(img.id)?;
                images.push(img);
            }
            return Ok(images);
        }

        let mut stmt = self.conn.prepare(
            "SELECT i.id, i.file_path, i.file_name, i.file_hash, i.width, i.height,
                    i.prompt, i.negative_prompt, i.metadata_json, i.created_at,
                    i.source_type, i.stored_path, i.thumbnail_path,
                    CASE WHEN f.image_id IS NOT NULL THEN 1 ELSE 0 END as is_favorite
             FROM images i
             LEFT JOIN favorites f ON i.id = f.image_id
             ORDER BY i.created_at DESC LIMIT ?1 OFFSET ?2"
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
                is_favorite: row.get::<_, i64>(13)? != 0,
                tags: Vec::new(),
            })
        }).map_err(|e| e.to_string())?;

        let mut images = Vec::new();
        for row in rows {
            let mut img = row.map_err(|e| e.to_string())?;
            img.tags = self.get_image_tags(img.id)?;
            images.push(img);
        }
        Ok(images)
    }

    pub fn get_image_by_id(&self, id: i64) -> Result<ImageRecord, String> {
        let mut stmt = self.conn.prepare(
            "SELECT i.id, i.file_path, i.file_name, i.file_hash, i.width, i.height,
                    i.prompt, i.negative_prompt, i.metadata_json, i.created_at,
                    i.source_type, i.stored_path, i.thumbnail_path,
                    CASE WHEN f.image_id IS NOT NULL THEN 1 ELSE 0 END as is_favorite
             FROM images i
             LEFT JOIN favorites f ON i.id = f.image_id
             WHERE i.id = ?1"
        ).map_err(|e| e.to_string())?;

        let mut img = stmt.query_row(params![id], |row| {
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
                is_favorite: row.get::<_, i64>(13)? != 0,
                tags: Vec::new(),
            })
        }).map_err(|e| e.to_string())?;

        img.tags = self.get_image_tags(img.id)?;
        Ok(img)
    }

    pub fn get_images_by_tag(&self, tag_name: &str, offset: i64, limit: i64) -> Result<Vec<ImageRecord>, String> {
        let mut stmt = self.conn.prepare(
            "SELECT i.id, i.file_path, i.file_name, i.file_hash, i.width, i.height,
                    i.prompt, i.negative_prompt, i.metadata_json, i.created_at,
                    i.source_type, i.stored_path, i.thumbnail_path,
                    CASE WHEN f.image_id IS NOT NULL THEN 1 ELSE 0 END as is_favorite
             FROM images i
             JOIN image_tags it ON i.id = it.image_id
             JOIN tags t ON it.tag_id = t.id
             LEFT JOIN favorites f ON i.id = f.image_id
             WHERE t.name = ?1
             ORDER BY i.created_at DESC LIMIT ?2 OFFSET ?3"
        ).map_err(|e| e.to_string())?;

        let rows = stmt.query_map(params![tag_name, limit, offset], |row| {
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
                is_favorite: row.get::<_, i64>(13)? != 0,
                tags: Vec::new(),
            })
        }).map_err(|e| e.to_string())?;

        let mut images = Vec::new();
        for row in rows {
            let mut img = row.map_err(|e| e.to_string())?;
            img.tags = self.get_image_tags(img.id)?;
            images.push(img);
        }
        Ok(images)
    }

    pub fn delete_image(&self, id: i64) -> Result<(), String> {
        self.conn.execute("DELETE FROM favorites WHERE image_id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        self.conn.execute("DELETE FROM image_tags WHERE image_id = ?1", params![id])
            .map_err(|e| e.to_string())?;
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
                    i.source_type, i.stored_path, i.thumbnail_path,
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
                is_favorite: true,
                tags: Vec::new(),
            })
        }).map_err(|e| e.to_string())?;

        let mut images = Vec::new();
        for row in rows {
            let mut img = row.map_err(|e| e.to_string())?;
            img.tags = self.get_image_tags(img.id)?;
            images.push(img);
        }
        Ok(images)
    }

    pub fn update_prompt(&self, image_id: i64, positive_prompt: &str, negative_prompt: &str) -> Result<(), String> {
        self.conn.execute(
            "UPDATE images SET prompt = ?1, negative_prompt = ?2 WHERE id = ?3",
            params![positive_prompt, negative_prompt, image_id],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }
}
