export interface ImageRecord {
  id: number;
  file_path: string;
  stored_path: string | null;
  file_name: string;
  file_hash: string;
  width: number;
  height: number;
  source_type: string;
  thumbnail_path: string | null;
  prompt: string;
  negative_prompt: string;
  metadata_json: string;
  created_at: string;
  tags: string[];
  is_favorite: boolean;
}

export interface TagRecord {
  id: number;
  name: string;
  color: string;
  count: number;
}

export interface ImageStats {
  total_images: number;
  total_tags: number;
  models: { model: string; count: number }[];
}

export interface ImageMetadata {
  prompt: string;
  negative_prompt: string;
  model: string;
  sampler: string;
  steps: number | null;
  cfg_scale: number | null;
  seed: number | null;
  width: number | null;
  height: number | null;
  source: string;
  characters: CharacterPrompt[];
  raw: Record<string, string>;
}

export interface CharacterPrompt {
  caption: string;
  centers: [number, number][];
}

export interface ImportResult {
  success: string[];
  skipped: string[];
  errors: string[];
}

export type ViewType = 'gallery' | 'favorites' | 'tags' | 'settings';
