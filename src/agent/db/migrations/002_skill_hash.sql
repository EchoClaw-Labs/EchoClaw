-- Add content hash for change detection on skill references
ALTER TABLE skill_references ADD COLUMN IF NOT EXISTS content_hash TEXT;
CREATE INDEX IF NOT EXISTS idx_skills_hash ON skill_references(content_hash);
