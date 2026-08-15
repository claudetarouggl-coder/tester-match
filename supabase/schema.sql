-- テスター相互マッチング スキーマ + RLS（Supabase SQL Editor で1回実行）
-- 設計原則: anonキーは公開前提。セキュリティ境界はRLSと列GRANTが全て。
-- クレジットの増減は SECURITY DEFINER 関数のみが行い、credit_events 台帳に必ず1行残す。

-- ==== profiles ====
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  handle text not null check (char_length(handle) between 3 and 40), -- 40: フォールバックhandle('u_'+uuid32桁=34字)を許容
  credits int not null default 3 check (credits >= 0),
  created_at timestamptz not null default now()
);
create unique index profiles_handle_lower on public.profiles (lower(handle));

-- サインアップ時にトリガーで作成（クライアントinsertは不可 = credits改竄防止）
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- 生成handleが万一衝突してもサインアップを失敗させない（フォールバックはUUID全体=必ず一意）
  insert into public.profiles (id, handle)
  values (new.id, 'user_' || substr(replace(new.id::text, '-', ''), 1, 8))
  on conflict do nothing;
  if not found then
    insert into public.profiles (id, handle)
    values (new.id, 'u_' || replace(new.id::text, '-', ''))
    on conflict do nothing; -- 両方衝突=既にプロフィールあり。スキップで正
  end if;
  insert into public.credit_events (user_id, delta, source, ref_id)
  values (new.id, 3, 'signup', new.id::text)
  on conflict do nothing; -- 再実行時の二重付与防止
  return new;
end;
$$;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ==== credit_events（台帳。Stripe導入時も同じ形で追記する） ====
create table public.credit_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  delta int not null check (delta <> 0),
  source text not null check (source in ('signup','confirm','post','stripe','admin')),
  ref_id text not null,
  created_at timestamptz not null default now(),
  unique (source, ref_id)
);

-- ==== apps ====
create table public.apps (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  package_id text not null check (char_length(package_id) <= 150 and package_id ~ '^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$'),
  opt_in_url text not null check (char_length(opt_in_url) <= 500 and opt_in_url like 'https://%'),
  group_join_info text not null default '' check (char_length(group_join_info) <= 1000),
  description text not null check (char_length(description) between 1 and 2000),
  testers_needed int not null default 12 check (testers_needed between 1 and 100),
  joined_count int not null default 0,
  status text not null default 'recruiting' check (status in ('recruiting','closed')),
  created_at timestamptz not null default now()
);
create index apps_owner on public.apps (owner);
create index apps_status_created on public.apps (status, created_at desc);

-- ==== joins ====
create table public.joins (
  id uuid primary key default gen_random_uuid(),
  app_id uuid not null references public.apps(id) on delete cascade,
  tester uuid not null references public.profiles(id) on delete cascade,
  google_email text not null check (char_length(google_email) <= 200 and google_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  status text not null default 'joined' check (status in ('joined','confirmed','dropped')),
  joined_at timestamptz not null default now(),
  confirmed_at timestamptz,
  unique (app_id, tester)
);
create index joins_app on public.joins (app_id);
create index joins_tester on public.joins (tester);

-- joined_count 維持（definerトリガー。RLS越しのcountはブラウズユーザーには見えないため）
create function public.sync_joined_count() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.apps a set joined_count =
    (select count(*) from public.joins j where j.app_id = coalesce(new.app_id, old.app_id)
       and j.status in ('joined','confirmed'))
  where a.id = coalesce(new.app_id, old.app_id);
  return null;
end;
$$;
create trigger joins_count_sync
  after insert or update or delete on public.joins
  for each row execute function public.sync_joined_count();

-- トリガー関数はRPCとして露出させない（直接呼び出しは失敗するが表面積を消す）
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.sync_joined_count() from public, anon, authenticated;

-- ==== RLS ====
alter table public.profiles enable row level security;
alter table public.credit_events enable row level security;
alter table public.apps enable row level security;
alter table public.joins enable row level security;

-- profiles: 読みは公開（handleのみ用途）。書きはhandleの自更新のみ（列GRANTで制限）
create policy profiles_select on public.profiles for select using (true);
create policy profiles_update on public.profiles for update
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
revoke insert, update, delete on public.profiles from anon, authenticated;
grant select on public.profiles to anon, authenticated;
grant update (handle) on public.profiles to authenticated;

-- credit_events: 自分の分のみ閲覧。書き込みはdefiner関数のみ
create policy credit_events_select on public.credit_events for select
  using (user_id = (select auth.uid()));
revoke insert, update, delete on public.credit_events from anon, authenticated;
grant select on public.credit_events to authenticated;

-- apps: 行は「募集中 or 自分のもの」だけ見える。opt_in_url/group_join_info は列GRANTから除外し、
--       get_app_secrets() 経由でのみ取得（参加者と所有者限定）
create policy apps_select on public.apps for select
  using (status = 'recruiting' or owner = (select auth.uid()));
create policy apps_insert on public.apps for insert
  with check (owner = (select auth.uid()));
create policy apps_update on public.apps for update
  using (owner = (select auth.uid())) with check (owner = (select auth.uid()));
revoke insert, update, delete on public.apps from anon, authenticated;
grant select (id, owner, name, package_id, description, testers_needed, joined_count, status, created_at)
  on public.apps to anon, authenticated;
grant insert (owner, name, package_id, opt_in_url, group_join_info, description, testers_needed)
  on public.apps to authenticated;
grant update (name, package_id, opt_in_url, group_join_info, description, testers_needed, status)
  on public.apps to authenticated;
-- 削除ポリシーなし = 履歴保全（closedにする運用）

-- joins: 自分の参加 or 自分のアプリへの参加のみ見える
create policy joins_select on public.joins for select
  using (tester = (select auth.uid())
         or exists (select 1 from public.apps a where a.id = app_id and a.owner = (select auth.uid())));
create policy joins_insert on public.joins for insert
  with check (
    tester = (select auth.uid())
    and exists (select 1 from public.apps a
                where a.id = app_id and a.status = 'recruiting'
                  and a.owner <> (select auth.uid())
                  and a.joined_count < a.testers_needed)
  );
-- 辞退はjoined中のみ削除可（confirmed後の削除→再参加でのクレジット二重取り防止）
create policy joins_delete on public.joins for delete
  using (tester = (select auth.uid()) and status = 'joined');
revoke insert, update, delete on public.joins from anon, authenticated;
grant select on public.joins to authenticated;
grant insert (app_id, tester, google_email) on public.joins to authenticated;
grant delete on public.joins to authenticated;

-- ==== definer 関数 ====
-- 参加者/所有者だけがopt-in情報を取得できる
create function public.get_app_secrets(p_app uuid)
returns table (opt_in_url text, group_join_info text)
language plpgsql security definer set search_path = '' as $$
begin
  return query
  select a.opt_in_url, a.group_join_info
  from public.apps a
  where a.id = p_app
    and (a.owner = auth.uid()
         or exists (select 1 from public.joins j
                    where j.app_id = p_app and j.tester = auth.uid()
                      and j.status in ('joined', 'confirmed')));
end;
$$;
revoke execute on function public.get_app_secrets(uuid) from public, anon;
grant execute on function public.get_app_secrets(uuid) to authenticated;

-- 開発者がテスト完了を確認 → テスターに+1クレジット（1回のみ・14日経過が条件）
create function public.confirm_tester(p_join uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare v_tester uuid;
begin
  update public.joins j set status = 'confirmed', confirmed_at = now()
  where j.id = p_join
    and j.status = 'joined'
    and j.joined_at <= now() - interval '14 days'
    and exists (select 1 from public.apps a where a.id = j.app_id and a.owner = auth.uid())
  returning j.tester into v_tester;
  if v_tester is null then
    return 'not_confirmed'; -- 既確認/14日未満/権限なし のいずれか
  end if;
  insert into public.credit_events (user_id, delta, source, ref_id)
  values (v_tester, 1, 'confirm', p_join::text);
  update public.profiles set credits = credits + 1 where id = v_tester;
  return 'confirmed';
end;
$$;
revoke execute on function public.confirm_tester(uuid) from public, anon;
grant execute on function public.confirm_tester(uuid) to authenticated;
