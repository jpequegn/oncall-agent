-- Enable pgvector extension (image already includes it)
CREATE EXTENSION IF NOT EXISTS vector;

-- Store completed investigations with vector embeddings for semantic search
CREATE TABLE investigation_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Investigation metadata
  alert_id TEXT NOT NULL,
  alert_title TEXT NOT NULL,
  service TEXT NOT NULL,
  severity TEXT CHECK (severity IN ('P1', 'P2', 'P3', 'P4')),
  scenario TEXT,

  -- Investigation results
  root_cause TEXT,
  resolution TEXT,
  summary TEXT,
  hypotheses JSONB NOT NULL DEFAULT '[]',
  evidence JSONB NOT NULL DEFAULT '[]',

  -- Validation results
  top_confidence INTEGER,
  escalated BOOLEAN DEFAULT FALSE,
  validator_notes TEXT,

  -- Human feedback
  feedback TEXT CHECK (feedback IN ('confirmed', 'rejected', 'corrected')),
  correction_text TEXT,
  feedback_user TEXT,

  -- Embedding for semantic similarity search
  embedding vector(1024),

  -- Timestamps
  investigated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  feedback_at TIMESTAMPTZ,

  -- Searchable text for hybrid search (full-text + vector)
  search_text TEXT GENERATED ALWAYS AS (
    COALESCE(alert_title, '') || ' ' ||
    COALESCE(service, '') || ' ' ||
    COALESCE(root_cause, '') || ' ' ||
    COALESCE(resolution, '') || ' ' ||
    COALESCE(summary, '')
  ) STORED
);

-- Indexes for common query patterns
CREATE INDEX idx_investigation_memory_service ON investigation_memory (service);
CREATE INDEX idx_investigation_memory_feedback ON investigation_memory (feedback);
CREATE INDEX idx_investigation_memory_investigated_at ON investigation_memory (investigated_at DESC);

-- Vector similarity index (IVFFlat for fast approximate nearest neighbor)
-- Using cosine distance operator
CREATE INDEX idx_investigation_memory_embedding ON investigation_memory
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 10);

-- Full-text search index
CREATE INDEX idx_investigation_memory_search ON investigation_memory
  USING gin (to_tsvector('english', search_text));
