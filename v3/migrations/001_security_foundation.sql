-- ETEC Web v3.0 — 001: auditoria operacional.
-- Escopo simplificado: sem MFA/TOTP, bootstrap institucional ou homologacao institucional.
-- A autenticacao admin por senha e seus controles permanecem no servidor v2.
-- Executar APENAS no PostgreSQL de testes ate validacao tecnica.
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
CREATE INDEX IF NOT EXISTS etec_v3_audit_subject_idx
  ON etec_v3_audit_events(subject_type,subject_id,occurred_at DESC);
CREATE INDEX IF NOT EXISTS etec_v3_audit_actor_idx
  ON etec_v3_audit_events(actor_identity,occurred_at DESC);
-- Eventos operacionais de reconciliacao; nao armazenar arquivos nem credenciais.
CREATE TABLE IF NOT EXISTS etec_v3_operational_incidents (
  id uuid PRIMARY KEY,
  incident_kind text NOT NULL,
  subject_type text NOT NULL,
  subject_id text NOT NULL,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','UNDER_REVIEW','RESOLVED')),
  summary text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX IF NOT EXISTS etec_v3_incident_status_idx
  ON etec_v3_operational_incidents(status,created_at DESC);
COMMIT;
