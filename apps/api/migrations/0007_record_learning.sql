-- #227: separate explicit owner consent, immutable numeric artifacts, and CAS activation.
-- Source only; production application/enablement needs a separate decision.
create unique index goal_learning_owner_idx on goal(id, user_id);
create table learning_participation (
  id uuid not null unique default gen_random_uuid(),
  user_id text primary key references "user"(id) on delete cascade,
  goal_id uuid not null unique,
  policy_version text not null check (policy_version = 'self-learning-v1'),
  joined_at timestamptz not null,
  expires_at timestamptz not null check (expires_at > joined_at),
  fit_generation bigint not null default 0 check (fit_generation between 0 and 9007199254740991),
  active_revision bigint not null default 0 check (active_revision between 0 and 9007199254740991),
  unique(id, user_id, goal_id),
  foreign key(goal_id, user_id) references goal(id, user_id) on delete cascade
);
-- One date per Goal prevents reusing test labels across withdrawal/rejoin.
-- No observations, model, email, or free text are retained in this receipt.
create table learning_holdout_receipt (
  goal_id uuid primary key,
  user_id text not null,
  through_date date not null,
  foreign key(goal_id, user_id) references goal(id, user_id) on delete cascade
);
create table learning_artifact (
  id uuid primary key,
  participation_id uuid not null,
  user_id text not null,
  goal_id uuid not null,
  created_at timestamptz not null,
  fit_generation bigint not null check (fit_generation between 1 and 9007199254740991),
  expires_at timestamptz not null check (expires_at > created_at),
  artifact_hash text not null check (artifact_hash ~ '^[0-9a-f]{64}$'),
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 2097152),
  unique(id, participation_id, user_id, goal_id),
  unique(participation_id, fit_generation),
  foreign key(participation_id, user_id, goal_id) references learning_participation(id, user_id, goal_id) on delete cascade
);
create table learning_activation (
  participation_id uuid primary key,
  user_id text not null,
  goal_id uuid not null,
  artifact_id uuid not null,
  foreign key(participation_id, user_id, goal_id) references learning_participation(id, user_id, goal_id) on delete cascade,
  foreign key(artifact_id, participation_id, user_id, goal_id) references learning_artifact(id, participation_id, user_id, goal_id) on delete cascade
);
create index learning_artifact_expiry_idx on learning_artifact(expires_at);
create index learning_artifact_owner_created_idx on learning_artifact(user_id, goal_id, created_at desc);
