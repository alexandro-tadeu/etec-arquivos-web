-- ETEC Web v3 — fundacao academica, SOMENTE para banco de homologacao.
-- Pre-requisito: etec_teachers criado pela v2. Nenhuma tabela v2 e alterada.
BEGIN;
CREATE TABLE IF NOT EXISTS etec_v3_rooms (
 id uuid PRIMARY KEY,
 teacher_id text NOT NULL REFERENCES etec_teachers(id),
 title text NOT NULL CHECK (length(title) BETWEEN 3 AND 120),
 code varchar(10) NOT NULL UNIQUE,
 pin_digest char(64) NOT NULL,
 status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED','ARCHIVED')),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS etec_v3_rooms_teacher_idx ON etec_v3_rooms(teacher_id,status);
CREATE TABLE IF NOT EXISTS etec_v3_enrollments (
 id uuid PRIMARY KEY,
 room_id uuid NOT NULL REFERENCES etec_v3_rooms(id),
 full_name text NOT NULL,
 normalized_name text NOT NULL,
 rm varchar(20) NOT NULL CHECK (rm ~ '^[0-9]+$'),
 code_digest char(64) NOT NULL,
 code_version integer NOT NULL DEFAULT 1 CHECK (code_version>=1),
 active boolean NOT NULL DEFAULT true,
 current_session_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(room_id,rm)
);
CREATE INDEX IF NOT EXISTS etec_v3_enrollments_room_idx ON etec_v3_enrollments(room_id,active);
CREATE TABLE IF NOT EXISTS etec_v3_student_sessions (
 id uuid PRIMARY KEY,
 enrollment_id uuid NOT NULL REFERENCES etec_v3_enrollments(id),
 session_digest char(64) NOT NULL UNIQUE,
 code_version integer NOT NULL,
 expires_at timestamptz NOT NULL,
 revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS etec_v3_sessions_enrollment_idx ON etec_v3_student_sessions(enrollment_id,revoked_at);
CREATE TABLE IF NOT EXISTS etec_v3_activities (
 id uuid PRIMARY KEY,
 room_id uuid NOT NULL REFERENCES etec_v3_rooms(id),
 title text NOT NULL CHECK (length(title) BETWEEN 3 AND 140),
 description text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PUBLISHED','CLOSED','ARCHIVED')),
 deadline_at timestamptz NOT NULL,
 allowed_extensions text[] NOT NULL,
 accept_late boolean NOT NULL DEFAULT false,
 max_files smallint NOT NULL DEFAULT 10 CHECK (max_files BETWEEN 1 AND 10),
 max_file_bytes bigint NOT NULL DEFAULT 41943040 CHECK (max_file_bytes BETWEEN 1 AND 41943040),
 max_total_bytes bigint NOT NULL DEFAULT 104857600 CHECK (max_total_bytes BETWEEN 1 AND 104857600),
 published_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS etec_v3_activities_room_idx ON etec_v3_activities(room_id,status);
CREATE TABLE IF NOT EXISTS etec_v3_activity_exceptions (
 id uuid PRIMARY KEY,
 activity_id uuid NOT NULL REFERENCES etec_v3_activities(id),
 enrollment_id uuid NOT NULL REFERENCES etec_v3_enrollments(id),
 personal_deadline_at timestamptz NOT NULL,
 reopen_closed boolean NOT NULL DEFAULT false,
 justification text NOT NULL CHECK (length(justification)>0),
 authorized_by text NOT NULL,
 revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS etec_v3_active_exception_idx
 ON etec_v3_activity_exceptions(activity_id,enrollment_id) WHERE revoked_at IS NULL;
CREATE TABLE IF NOT EXISTS etec_v3_submission_versions (
 id uuid PRIMARY KEY,
 activity_id uuid NOT NULL REFERENCES etec_v3_activities(id),
 enrollment_id uuid NOT NULL REFERENCES etec_v3_enrollments(id),
 version integer NOT NULL CHECK (version>=1),
 request_key uuid NOT NULL,
 status text NOT NULL DEFAULT 'STAGING' CHECK (status IN ('STAGING','FILES_CONFIRMED','COMMITTED','FAILED')),
 manifest jsonb NOT NULL,
 physical_commit_ref text,
 protocol text UNIQUE,
 completed_at timestamptz,
 deadline_snapshot_at timestamptz,
 is_late boolean,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(activity_id,enrollment_id,version),
 UNIQUE(activity_id,enrollment_id,request_key),
 CHECK (status <> 'COMMITTED' OR (protocol IS NOT NULL AND completed_at IS NOT NULL AND is_late IS NOT NULL AND physical_commit_ref IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS etec_v3_submissions_by_enrollment_idx
 ON etec_v3_submission_versions(enrollment_id,activity_id,status);
CREATE TABLE IF NOT EXISTS etec_v3_submission_files (
 id uuid PRIMARY KEY,
 submission_id uuid NOT NULL REFERENCES etec_v3_submission_versions(id),
 original_name text NOT NULL,
 physical_name text NOT NULL,
 size_bytes bigint NOT NULL CHECK (size_bytes BETWEEN 0 AND 41943040),
 sha256 char(64),
 UNIQUE(submission_id,physical_name)
);
COMMIT;
