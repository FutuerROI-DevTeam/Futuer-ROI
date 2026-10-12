-- #248: 独立opt-inの途中到達補助。旧migration/業務log/標準予測を変更しない。
-- Monotone CAS metadata only; no consent history, labels or renewed retention.
alter table goal add column milestone_consent_revision integer not null default 0 check (milestone_consent_revision>=0);
create unique index goal_milestone_owner_key on goal(id,user_id);
create table milestone_participation (
  id uuid not null unique default gen_random_uuid(),
  user_id text primary key references "user"(id) on delete cascade,
  goal_id uuid not null unique,
  policy_version text not null check (policy_version='session-milestone-opt-in-v1'),
  joined_at timestamptz not null,
  expires_at timestamptz not null check (expires_at>joined_at and expires_at<=joined_at+interval '2160 hours'),
  fit_generation integer not null default 0 check (fit_generation>=0),
  unique(goal_id,user_id,id),
  foreign key(goal_id,user_id) references goal(id,user_id) on delete cascade
);
create table milestone_forecast (
  id uuid primary key,
  goal_id uuid not null, user_id text not null, participation_id uuid not null,
  origin_date date not null,
  issued_at timestamptz not null,
  expires_at timestamptz not null check (expires_at>issued_at and expires_at<=issued_at+interval '2160 hours'),
  payload jsonb not null check (jsonb_typeof(payload)='object' and payload->>'schemaVersion'='session-milestone-forecast-v1'),
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  unique(goal_id,origin_date),
  foreign key(goal_id,user_id,participation_id) references milestone_participation(goal_id,user_id,id) on delete cascade
);
create index milestone_forecast_expiry_idx on milestone_forecast(expires_at);
create table milestone_artifact (
  id uuid primary key,
  goal_id uuid not null, user_id text not null, participation_id uuid not null,
  generation integer not null check (generation>0),
  created_at timestamptz not null,
  expires_at timestamptz not null check (expires_at>created_at and expires_at<=created_at+interval '2160 hours'),
  payload jsonb not null check (jsonb_typeof(payload)='object'),
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  unique(participation_id,generation),
  foreign key(goal_id,user_id,participation_id) references milestone_participation(goal_id,user_id,id) on delete cascade
);
create index milestone_artifact_expiry_idx on milestone_artifact(expires_at);
