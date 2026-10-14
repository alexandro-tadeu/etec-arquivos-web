-- ETEC Web v3.0 / migration 001: fundacao de governanca e MFA.
-- Somente para ambiente de teste ate homologacao. Nunca executar automaticamente em producao.
BEGIN;
CREATE TABLE IF NOT EXISTS etec_v3_admin_accounts (
  id uuid PRIMARY KEY, username text NOT NULL UNIQUE, display_name text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING_BOOTSTRAP' CHECK (status IN ('PENDING_BOOTSTRAP','ACTIVE','SUSPENDED')),
  credential_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS etec_v3_bootstrap_policies (
  id uuid PRIMARY KEY, version integer NOT NULL, institutional_approval_ref text NOT NULL,
  effective_at timestamptz NOT NULL, ttl_seconds integer NOT NULL CHECK (ttl_seconds BETWEEN 300 AND 3600),
  max_attempts integer NOT NULL CHECK (max_attempts BETWEEN 1 AND 5),
  approved_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (version)
);
CREATE TABLE IF NOT EXISTS etec_v3_bootstrap_codes (
  id uuid PRIMARY KEY, admin_id uuid NOT NULL REFERENCES etec_v3_admin_accounts(id),
  policy_id uuid NOT NULL REFERENCES etec_v3_bootstrap_policies(id),
  authorization_ref text NOT NULL, issuer_id text NOT NULL,
  code_digest char(64) NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'ISSUED'
    CHECK (status IN ('ISSUED','PENDING_RECEIPT','AVAILABLE','ACTIVATING','CONSUMED','EXPIRED','REVOKED','SUPERSEDED','LOCKED')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  delivered_at timestamptz, receipt_confirmed_at timestamptz,
  consumed_at timestamptz, revoked_at timestamptz, revocation_reason text,
  CHECK (expires_at > issued_at),
  CHECK (status <> 'REVOKED' OR revoked_at IS NOT NULL),
  CHECK (status <> 'CONSUMED' OR consumed_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS etec_v3_bootstrap_admin_idx ON etec_v3_bootstrap_codes(admin_id,issued_at DESC);
CREATE TABLE IF NOT EXISTS etec_v3_admin_mfa (
  admin_id uuid PRIMARY KEY REFERENCES etec_v3_admin_accounts(id),
  totp_secret_ciphertext text NOT NULL,
  enabled_at timestamptz,
  last_accepted_counter bigint NOT NULL DEFAULT -1
);
CREATE TABLE IF NOT EXISTS etec_v3_admin_recovery_codes (
  id uuid PRIMARY KEY, admin_id uuid NOT NULL REFERENCES etec_v3_admin_accounts(id),
  code_digest char(64) NOT NULL UNIQUE, used_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS etec_v3_admin_sessions (
  id uuid PRIMARY KEY, admin_id uuid NOT NULL REFERENCES etec_v3_admin_accounts(id),
  session_digest char(64) NOT NULL UNIQUE, mfa_verified_at timestamptz,
  credential_version integer NOT NULL,
  expires_at timestamptz NOT NULL, revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS etec_v3_bootstrap_revocation_reviews (
  id uuid PRIMARY KEY, code_id uuid NOT NULL REFERENCES etec_v3_bootstrap_codes(id),
  executor_identity text NOT NULL, revocation_reason text NOT NULL,
  reviewer_identity text, status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','IN_REVIEW','CONCLUDED')),
  review_due_at timestamptz NOT NULL, policy_reference text NOT NULL,
  reviewed_at timestamptz, outcome text, justification text,
  CHECK (reviewer_identity IS NULL OR reviewer_identity <> executor_identity),
  CHECK (status <> 'CONCLUDED' OR (reviewer_identity IS NOT NULL AND reviewed_at IS NOT NULL AND outcome IS NOT NULL AND justification IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS etec_v3_review_escalations (
  id uuid PRIMARY KEY, review_id uuid NOT NULL REFERENCES etec_v3_bootstrap_revocation_reviews(id),
  institutional_policy_version text NOT NULL, level integer NOT NULL CHECK (level >= 1),
  recipient_identity text NOT NULL, due_at timestamptz NOT NULL,
  notified_at timestamptz, status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','NOTIFIED','FAILED')),
  UNIQUE (review_id, level)
);
CREATE TABLE IF NOT EXISTS etec_v3_review_external_cases (
  id uuid PRIMARY KEY, review_id uuid NOT NULL UNIQUE REFERENCES etec_v3_bootstrap_revocation_reviews(id),
  external_procedure_ref text NOT NULL, status text NOT NULL DEFAULT 'PENDING',
  response_reference text, decision_authority_identity text,
  decision_justification text, decided_at timestamptz, recorded_at timestamptz,
  CHECK (status IN ('PENDING','RESPONSE_RECEIVED','CONCLUDED')),
  CHECK (status <> 'CONCLUDED' OR (response_reference IS NOT NULL AND decision_authority_identity IS NOT NULL AND decision_justification IS NOT NULL AND decided_at IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS etec_v3_review_rectifications (
  id uuid PRIMARY KEY, external_case_id uuid NOT NULL REFERENCES etec_v3_review_external_cases(id),
  approved_by_identity text NOT NULL, institutional_authorization_ref text NOT NULL,
  correction_reason text NOT NULL, original_reference text NOT NULL,
  corrected_reference text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS etec_v3_review_complementary_cases (
  id uuid PRIMARY KEY, parent_case_id uuid NOT NULL REFERENCES etec_v3_review_external_cases(id),
  evidence_reference text NOT NULL, description text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS etec_v3_audit_events (
  id uuid PRIMARY KEY, event_type text NOT NULL, actor_identity text NOT NULL,
  subject_type text NOT NULL, subject_id text NOT NULL,
  institutional_reference text, details jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS etec_v3_audit_subject_idx ON etec_v3_audit_events(subject_type,subject_id,occurred_at DESC);
CREATE TABLE IF NOT EXISTS etec_v3_notification_outbox (
  id uuid PRIMARY KEY, review_id uuid NOT NULL REFERENCES etec_v3_bootstrap_revocation_reviews(id),
  channel text NOT NULL, recipient_identity text NOT NULL,
  dedupe_key text NOT NULL UNIQUE, status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','IN_FLIGHT','SENT','FAILED','CANCELLED')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(), sent_at timestamptz
);
COMMIT;
