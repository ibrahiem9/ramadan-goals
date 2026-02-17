-- friend-sharing-v1-rls-hotfix.sql
-- Purpose: Patch recursive RLS in circle_members and add invite-join RPC for existing deployments.

begin;

create or replace function public.auth_user_in_circle(target_circle_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    case
      when auth.uid() is null or target_circle_id is null then false
      else exists (
        select 1
        from public.circle_members cm
        where cm.circle_id = target_circle_id and cm.user_id = auth.uid()
      )
    end;
$$;

create or replace function public.users_share_circle(left_user_id uuid, right_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    case
      when left_user_id is null or right_user_id is null then false
      else exists (
        select 1
        from public.circle_members left_cm
        join public.circle_members right_cm on left_cm.circle_id = right_cm.circle_id
        where left_cm.user_id = left_user_id and right_cm.user_id = right_user_id
      )
    end;
$$;

create or replace function public.join_circle_by_invite(invite_code_input text)
returns table (
  id uuid,
  name text,
  invite_code text,
  member_limit int,
  is_active boolean,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  normalized_code text;
  target_circle public.circles%rowtype;
  current_members int := 0;
begin
  if current_user_id is null then
    raise exception 'Sign in first.';
  end if;

  normalized_code := upper(trim(coalesce(invite_code_input, '')));
  if normalized_code = '' then
    raise exception 'Invite code is required.';
  end if;

  select *
  into target_circle
  from public.circles c
  where c.invite_code = normalized_code and c.is_active = true
  for update;

  if target_circle.id is null then
    raise exception 'Invite code not found.';
  end if;

  if exists (
    select 1
    from public.circle_members cm
    where cm.circle_id = target_circle.id and cm.user_id = current_user_id
  ) then
    return query
    select
      target_circle.id,
      target_circle.name,
      target_circle.invite_code,
      target_circle.member_limit,
      target_circle.is_active,
      target_circle.created_at;
    return;
  end if;

  select count(*)
  into current_members
  from public.circle_members cm
  where cm.circle_id = target_circle.id;

  if current_members >= coalesce(target_circle.member_limit, 12) then
    raise exception 'This circle is already full.';
  end if;

  insert into public.circle_members (circle_id, user_id, role)
  values (target_circle.id, current_user_id, 'member');

  return query
  select
    target_circle.id,
    target_circle.name,
    target_circle.invite_code,
    target_circle.member_limit,
    target_circle.is_active,
    target_circle.created_at;
end;
$$;

grant execute on function public.auth_user_in_circle(uuid) to authenticated;
grant execute on function public.users_share_circle(uuid, uuid) to authenticated;
grant execute on function public.join_circle_by_invite(text) to authenticated;

drop policy if exists profiles_select_own_or_shared_circle on public.profiles;
create policy profiles_select_own_or_shared_circle
on public.profiles
for select
using (
  auth.uid() = id
  or public.users_share_circle(auth.uid(), profiles.id)
);

drop policy if exists circles_select_members_only on public.circles;
create policy circles_select_members_only
on public.circles
for select
using (
  auth.uid() = owner_user_id
  or public.auth_user_in_circle(circles.id)
);

drop policy if exists circle_members_select_circle_members on public.circle_members;
create policy circle_members_select_circle_members
on public.circle_members
for select
using (public.auth_user_in_circle(circle_members.circle_id));

drop policy if exists circle_members_insert_self_or_owner on public.circle_members;
drop policy if exists circle_members_insert_owner_only on public.circle_members;
create policy circle_members_insert_owner_only
on public.circle_members
for insert
with check (
  exists (
    select 1
    from public.circles c
    where c.id = circle_members.circle_id and c.owner_user_id = auth.uid()
  )
);

drop policy if exists circle_updates_select_members_only on public.circle_updates;
create policy circle_updates_select_members_only
on public.circle_updates
for select
using (public.auth_user_in_circle(circle_updates.circle_id));

drop policy if exists circle_updates_insert_author_member on public.circle_updates;
create policy circle_updates_insert_author_member
on public.circle_updates
for insert
with check (
  auth.uid() = user_id
  and public.auth_user_in_circle(circle_updates.circle_id)
);

drop policy if exists circle_reactions_select_members_only on public.circle_update_reactions;
create policy circle_reactions_select_members_only
on public.circle_update_reactions
for select
using (
  exists (
    select 1
    from public.circle_updates cu
    where cu.id = circle_update_reactions.update_id
      and public.auth_user_in_circle(cu.circle_id)
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
    where cu.id = circle_update_reactions.update_id
      and public.auth_user_in_circle(cu.circle_id)
  )
);

commit;
