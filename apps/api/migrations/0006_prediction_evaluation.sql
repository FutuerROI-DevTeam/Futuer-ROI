-- #225: 既定OFFの本人向け評価。既存goal/logの履歴や意味を変更しない。
create table evaluation_participation (
  id uuid not null unique default gen_random_uuid(),
  user_id text primary key references "user"(id) on delete cascade,
  goal_id uuid not null unique references goal(id) on delete cascade,
  policy_version text not null check (policy_version = 'self-evaluation-v1'),
  joined_at timestamptz not null,
  expires_at timestamptz not null check (expires_at > joined_at)
);
create table evaluation_forecast (
  id uuid primary key,
  goal_id uuid not null references evaluation_participation(goal_id) on delete cascade,
  anchor_date date not null,
  issued_at timestamptz not null,
  expires_at timestamptz not null check (expires_at > issued_at),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  unique (goal_id, anchor_date)
);
create index evaluation_forecast_expiry_idx on evaluation_forecast(expires_at);
create index evaluation_forecast_goal_issued_idx on evaluation_forecast(goal_id, issued_at desc);
