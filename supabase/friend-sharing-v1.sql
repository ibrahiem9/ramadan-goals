-- friend-sharing-v1.sql
-- Purpose: Supabase schema and RLS policies for friend sharing + emoji reactions v1.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.user_goals (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  type text not null check (type in ('boolean', 'count')),
  target int not null,
  unit text,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.user_goal_checkins (
  user_id uuid not null references auth.users(id) on delete cascade,
  goal_id uuid not null references public.user_goals(id) on delete cascade,
  checkin_date date not null,
  value int not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, goal_id, checkin_date)
);

create table if not exists public.circles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  invite_code text not null unique,
  member_limit int not null default 12,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.circle_members (
  circle_id uuid not null references public.circles(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (circle_id, user_id)
);

create table if not exists public.circle_updates (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.circles(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  snapshot_date date not null,
  overall_completion_pct numeric(5, 2) not null,
  today_completed_count int not null,
  today_total_goals int not null,
  goal_progress_json jsonb not null,
  source_updated_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (circle_id, user_id, snapshot_date)
);

create table if not exists public.circle_update_reactions (
  update_id uuid not null references public.circle_updates(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  primary key (update_id, user_id, emoji)
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_circle_updates_updated_at on public.circle_updates;
create trigger trg_circle_updates_updated_at
before update on public.circle_updates
for each row execute procedure public.set_updated_at();

create or replace function public.set_checkin_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_user_goal_checkins_updated_at on public.user_goal_checkins;
create trigger trg_user_goal_checkins_updated_at
before update on public.user_goal_checkins
for each row execute procedure public.set_checkin_updated_at();

create or replace function public.enforce_circle_member_limit()
returns trigger
language plpgsql
as $$
declare
  limit_count int;
  current_count int;
begin
  select member_limit
  into limit_count
  from public.circles
  where id = new.circle_id and is_active = true
  for update;

  if limit_count is null then
    raise exception 'Circle is inactive or does not exist';
  end if;

  select count(*)
  into current_count
  from public.circle_members
  where circle_id = new.circle_id;

  if current_count >= limit_count then
    raise exception 'Circle member limit reached';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_circle_member_limit on public.circle_members;
create trigger trg_circle_member_limit
before insert on public.circle_members
for each row execute procedure public.enforce_circle_member_limit();

alter table public.profiles enable row level security;
alter table public.user_goals enable row level security;
alter table public.user_goal_checkins enable row level security;
alter table public.circles enable row level security;
alter table public.circle_members enable row level security;
alter table public.circle_updates enable row level security;
alter table public.circle_update_reactions enable row level security;

-- profiles
drop policy if exists profiles_select_own_or_shared_circle on public.profiles;
create policy profiles_select_own_or_shared_circle
on public.profiles
for select
using (
  auth.uid() = id
  or exists (
    select 1
    from public.circle_members me
    join public.circle_members other on me.circle_id = other.circle_id
    where me.user_id = auth.uid() and other.user_id = profiles.id
  )
);

drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self
on public.profiles
for insert
with check (auth.uid() = id);

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self
on public.profiles
for update
using (auth.uid() = id)
with check (auth.uid() = id);

-- user_goals
drop policy if exists user_goals_owner_only_select on public.user_goals;
create policy user_goals_owner_only_select
on public.user_goals
for select
using (auth.uid() = user_id);

drop policy if exists user_goals_owner_only_insert on public.user_goals;
create policy user_goals_owner_only_insert
on public.user_goals
for insert
with check (auth.uid() = user_id);

drop policy if exists user_goals_owner_only_update on public.user_goals;
create policy user_goals_owner_only_update
on public.user_goals
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists user_goals_owner_only_delete on public.user_goals;
create policy user_goals_owner_only_delete
on public.user_goals
for delete
using (auth.uid() = user_id);

-- user_goal_checkins
drop policy if exists user_goal_checkins_owner_only_select on public.user_goal_checkins;
create policy user_goal_checkins_owner_only_select
on public.user_goal_checkins
for select
using (auth.uid() = user_id);

drop policy if exists user_goal_checkins_owner_only_insert on public.user_goal_checkins;
create policy user_goal_checkins_owner_only_insert
on public.user_goal_checkins
for insert
with check (auth.uid() = user_id);

drop policy if exists user_goal_checkins_owner_only_update on public.user_goal_checkins;
create policy user_goal_checkins_owner_only_update
on public.user_goal_checkins
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists user_goal_checkins_owner_only_delete on public.user_goal_checkins;
create policy user_goal_checkins_owner_only_delete
on public.user_goal_checkins
for delete
using (auth.uid() = user_id);

-- circles
drop policy if exists circles_select_members_only on public.circles;
create policy circles_select_members_only
on public.circles
for select
using (
  exists (
    select 1
    from public.circle_members cm
    where cm.circle_id = circles.id and cm.user_id = auth.uid()
  )
);

drop policy if exists circles_insert_owner_only on public.circles;
create policy circles_insert_owner_only
on public.circles
for insert
with check (auth.uid() = owner_user_id);

drop policy if exists circles_update_owner_only on public.circles;
create policy circles_update_owner_only
on public.circles
for update
using (auth.uid() = owner_user_id)
with check (auth.uid() = owner_user_id);

drop policy if exists circles_delete_owner_only on public.circles;
create policy circles_delete_owner_only
on public.circles
for delete
using (auth.uid() = owner_user_id);

-- circle_members
drop policy if exists circle_members_select_circle_members on public.circle_members;
create policy circle_members_select_circle_members
on public.circle_members
for select
using (
  exists (
    select 1
    from public.circle_members cm
    where cm.circle_id = circle_members.circle_id and cm.user_id = auth.uid()
  )
);

drop policy if exists circle_members_insert_self_or_owner on public.circle_members;
create policy circle_members_insert_self_or_owner
on public.circle_members
for insert
with check (
  auth.uid() = user_id
  or exists (
    select 1
    from public.circles c
    where c.id = circle_members.circle_id and c.owner_user_id = auth.uid()
  )
);

drop policy if exists circle_members_update_owner_only on public.circle_members;
create policy circle_members_update_owner_only
on public.circle_members
for update
using (
  exists (
    select 1
    from public.circles c
    where c.id = circle_members.circle_id and c.owner_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.circles c
    where c.id = circle_members.circle_id and c.owner_user_id = auth.uid()
  )
);

drop policy if exists circle_members_delete_owner_or_self on public.circle_members;
create policy circle_members_delete_owner_or_self
on public.circle_members
for delete
using (
  auth.uid() = user_id
  or exists (
    select 1
    from public.circles c
    where c.id = circle_members.circle_id and c.owner_user_id = auth.uid()
  )
);

-- circle_updates
drop policy if exists circle_updates_select_members_only on public.circle_updates;
create policy circle_updates_select_members_only
on public.circle_updates
for select
using (
  exists (
    select 1
    from public.circle_members cm
    where cm.circle_id = circle_updates.circle_id and cm.user_id = auth.uid()
  )
);

drop policy if exists circle_updates_insert_author_member on public.circle_updates;
create policy circle_updates_insert_author_member
on public.circle_updates
for insert
with check (
  auth.uid() = user_id
  and exists (
    select 1
    from public.circle_members cm
    where cm.circle_id = circle_updates.circle_id and cm.user_id = auth.uid()
  )
);

drop policy if exists circle_updates_update_author_only on public.circle_updates;
create policy circle_updates_update_author_only
on public.circle_updates
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- circle_update_reactions
drop policy if exists circle_reactions_select_members_only on public.circle_update_reactions;
create policy circle_reactions_select_members_only
on public.circle_update_reactions
for select
using (
  exists (
    select 1
    from public.circle_updates cu
    join public.circle_members cm on cm.circle_id = cu.circle_id
    where cu.id = circle_update_reactions.update_id and cm.user_id = auth.uid()
  )
);

drop policy if exists circle_reactions_insert_self_member on public.circle_update_reactions;
create policy circle_reactions_insert_self_member
on public.circle_update_reactions
for insert
with check (
  auth.uid() = user_id
  and exists (
    select 1
    from public.circle_updates cu
    join public.circle_members cm on cm.circle_id = cu.circle_id
    where cu.id = circle_update_reactions.update_id and cm.user_id = auth.uid()
  )
);

drop policy if exists circle_reactions_delete_self on public.circle_update_reactions;
create policy circle_reactions_delete_self
on public.circle_update_reactions
for delete
using (auth.uid() = user_id);
