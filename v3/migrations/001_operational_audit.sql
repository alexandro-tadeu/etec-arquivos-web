-- V3: auditoria operacional simplificada; sem MFA e sem homologacao institucional.
BEGIN;
CREATE TABLE IF NOT EXISTS etec_v3_audit_events (
 id uuid PRIMARY KEY,
 event_type text NOT NULL,
 actor_identity text NOT NULL,
 subject_type text NOT NULL,
 subject_id text NOT NULL,
 details jsonb NOT NULL DEFAULT '{}'::jsonb,
 occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS etec_v3_audit_subject_idx ON etec_v3_audit_events(subject_type,subject_id,occurred_at DESC);
COMMIT;
