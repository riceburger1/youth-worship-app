-- 주의울림 V30 통합 업데이트
-- 1) 감사기도 본문을 전체공개(학년/구분 + 이름 + 날짜 + 내용), 삭제는 관리자만
-- 2) 내 정보에 '선생님' 추가 및 말씀/성경공부/기도/감사 기록 허용
-- 3) 말씀쓰기 출석 인정시간: 해당 주일 10:30 이상 ~ 13:00 미만(KST), 그 외 연습모드
-- 4) 새친구: 학년/이름/학교 공개, 연락처/인도자/기타정보 관리자 전용
-- 기존 데이터는 삭제하지 않습니다.

begin;

create schema if not exists private;

-- 관리자 판별 helper (노출 스키마 밖에서 사용)
create or replace function private.is_youth_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.admin_users a
    where a.user_id = auth.uid()
  );
$$;
revoke all on function private.is_youth_admin() from public;
revoke all on function private.is_youth_admin() from anon;
grant usage on schema private to authenticated;
grant execute on function private.is_youth_admin() to authenticated;

-- ============================================================
-- A. 공통 프로필: '선생님' 허용
-- 기존 학년 CHECK가 있으면 안전하게 교체합니다. 과거 데이터는 검증하지 않고 앞으로 저장되는 행에 적용합니다.
-- ============================================================

do $$
declare r record;
begin
  for r in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.attendance'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%grade%'
      and pg_get_constraintdef(c.oid) ilike '%중1%'
  loop
    execute format('alter table public.attendance drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.attendance
  add constraint attendance_grade_v30_check
  check (grade in ('중1','중2','중3','고1','고2','고3','선생님')) not valid;

do $$
declare r record;
begin
  for r in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.study_submissions'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%grade%'
      and pg_get_constraintdef(c.oid) ilike '%중1%'
  loop
    execute format('alter table public.study_submissions drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.study_submissions
  add constraint study_submissions_grade_v30_check
  check (grade in ('중1','중2','중3','고1','고2','고3','선생님')) not valid;

do $$
declare r record;
begin
  for r in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.prayer_requests'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%grade%'
      and pg_get_constraintdef(c.oid) ilike '%중1%'
  loop
    execute format('alter table public.prayer_requests drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.prayer_requests
  add constraint prayer_requests_grade_v30_check
  check (grade in ('중1','중2','중3','고1','고2','고3','선생님')) not valid;

do $$
declare r record;
begin
  for r in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.gratitude_prayers'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%grade%'
      and pg_get_constraintdef(c.oid) ilike '%중1%'
  loop
    execute format('alter table public.gratitude_prayers drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.gratitude_prayers
  add constraint gratitude_prayers_grade_v30_check
  check (grade in ('중1','중2','중3','고1','고2','고3','선생님')) not valid;

-- ============================================================
-- B. 말씀쓰기 출석: 주일 10:30 ~ 13:00 KST만 저장
-- ============================================================

grant insert on table public.attendance to anon, authenticated;
grant select on table public.weekly_contents to anon, authenticated;
alter table public.attendance enable row level security;

drop policy if exists attendance_student_insert_v11 on public.attendance;
drop policy if exists attendance_student_insert_v29 on public.attendance;
drop policy if exists attendance_student_insert_v30 on public.attendance;

create policy attendance_student_insert_v30
on public.attendance
for insert
to anon, authenticated
with check (
  grade in ('중1','중2','중3','고1','고2','고3','선생님')
  and char_length(btrim(coalesce(student_name,''))) between 1 and 50
  and exists (
    select 1
    from public.weekly_contents w
    where w.id = attendance.weekly_content_id
      and w.published = true
      and (now() at time zone 'Asia/Seoul') >= ((w.week_start::date + 6) + time '10:30')
      and (now() at time zone 'Asia/Seoul') <  ((w.week_start::date + 6) + time '13:00')
  )
);

create or replace function private.youth_submit_attendance_impl(
  p_weekly_content_id text,
  p_grade text,
  p_student_name text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_week_id public.weekly_contents.id%TYPE;
  v_week_start date;
  v_name text := btrim(coalesce(p_student_name,''));
  v_open_at timestamp without time zone;
  v_close_at timestamp without time zone;
  v_now_kst timestamp without time zone := now() at time zone 'Asia/Seoul';
begin
  if p_grade not in ('중1','중2','중3','고1','고2','고3','선생님') then
    raise exception '학년/구분을 확인해 주세요.' using errcode='22023';
  end if;

  if char_length(v_name) < 1 or char_length(v_name) > 50 then
    raise exception '이름을 확인해 주세요.' using errcode='22023';
  end if;

  select w.id, w.week_start::date
    into v_week_id, v_week_start
  from public.weekly_contents w
  where w.id::text = p_weekly_content_id
    and w.published = true
  limit 1;

  if v_week_id is null then
    raise exception '현재 공개된 말씀 기록을 찾지 못했습니다.' using errcode='P0002';
  end if;

  v_open_at := (v_week_start + 6) + time '10:30';
  v_close_at := (v_week_start + 6) + time '13:00';

  if v_now_kst < v_open_at or v_now_kst >= v_close_at then
    raise exception '말씀쓰기 출석은 해당 주일 오전 10시 30분부터 오후 1시 전까지만 인정됩니다. 지금은 연습모드입니다.'
      using errcode='22023';
  end if;

  begin
    insert into public.attendance(weekly_content_id, grade, student_name)
    values (v_week_id, p_grade, v_name);
  exception
    when unique_violation then
      return 'duplicate';
  end;

  return 'saved';
end;
$$;

revoke all on function private.youth_submit_attendance_impl(text,text,text) from public;
grant usage on schema private to anon, authenticated;
grant execute on function private.youth_submit_attendance_impl(text,text,text) to anon, authenticated;

-- ============================================================
-- C. 성경공부: 선생님 허용 + 답변별 10자 규칙 유지
-- ============================================================

grant insert on table public.study_submissions to anon, authenticated;
alter table public.study_submissions enable row level security;

drop policy if exists study_submissions_student_insert_v21 on public.study_submissions;
drop policy if exists study_submissions_student_insert_v29 on public.study_submissions;
drop policy if exists study_submissions_student_insert_v30 on public.study_submissions;

create policy study_submissions_student_insert_v30
on public.study_submissions
for insert
to anon, authenticated
with check (
  weekly_content_id is not null
  and grade in ('중1','중2','중3','고1','고2','고3','선생님')
  and length(btrim(student_name)) between 1 and 30
  and public.youth_study_answers_valid_v29(answers)
);

-- ============================================================
-- D. 기도제목: 선생님 허용
-- ============================================================

grant insert on table public.prayer_requests to anon, authenticated;
alter table public.prayer_requests enable row level security;

drop policy if exists prayer_requests_student_insert_v15 on public.prayer_requests;
drop policy if exists prayer_requests_student_insert_v30 on public.prayer_requests;

create policy prayer_requests_student_insert_v30
on public.prayer_requests
for insert
to anon, authenticated
with check (
  grade in ('중1','중2','중3','고1','고2','고3','선생님')
  and char_length(btrim(student_name)) between 1 and 30
  and char_length(btrim(prayer_text)) between 1 and 3000
);

-- ============================================================
-- E. 감사기도: 전체공개 + 선생님 허용 + 삭제 관리자 전용
-- ============================================================

-- 과거에 비공개 안내를 보고 작성한 감사기도는 자동 공개하지 않습니다.
-- V30 이후 새로 작성하거나 수정한 기록부터 공개됩니다.
alter table public.gratitude_prayers add column if not exists is_public boolean;
update public.gratitude_prayers set is_public = false where is_public is null;
alter table public.gratitude_prayers alter column is_public set default true;
alter table public.gratitude_prayers alter column is_public set not null;

-- 기존 학생 INSERT 정책도 선생님을 허용하도록 교체합니다.
alter table public.gratitude_prayers enable row level security;
grant insert on table public.gratitude_prayers to anon, authenticated;
revoke delete on table public.gratitude_prayers from anon;
grant select, delete on table public.gratitude_prayers to authenticated;

drop policy if exists gratitude_prayers_student_insert on public.gratitude_prayers;
drop policy if exists gratitude_prayers_student_insert_v30 on public.gratitude_prayers;
create policy gratitude_prayers_student_insert_v30
on public.gratitude_prayers
for insert
to anon, authenticated
with check (
  grade in ('중1','중2','중3','고1','고2','고3','선생님')
  and char_length(btrim(student_name)) between 1 and 30
  and char_length(btrim(gratitude_text)) between 10 and 2000
);

-- 관리자 외 삭제 차단을 명확히 보장합니다.
drop policy if exists gratitude_prayers_admin_delete_v30 on public.gratitude_prayers;
create policy gratitude_prayers_admin_delete_v30
on public.gratitude_prayers
for delete
to authenticated
using (private.is_youth_admin());

-- 기존 관리자 SELECT 정책이 있더라도 유지. 관리자 화면용 SELECT를 명시적으로 추가합니다.
drop policy if exists gratitude_prayers_admin_select_v30 on public.gratitude_prayers;
create policy gratitude_prayers_admin_select_v30
on public.gratitude_prayers
for select
to authenticated
using (private.is_youth_admin());

-- 신규/수정 함수: 선생님 허용. 학생은 수정만 가능하고 삭제 함수는 제공하지 않습니다.
create or replace function public.youth_gratitude_save_v27(
  p_grade text,
  p_student_name text,
  p_prayer_date date,
  p_gratitude_text text,
  p_edit_token uuid,
  p_original_text text default null
)
returns table(record_id uuid, save_action text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_existing_token uuid;
  v_existing_text text;
begin
  if p_grade not in ('중1','중2','중3','고1','고2','고3','선생님') then
    raise exception using errcode='22023', message='올바른 학년/구분을 선택해 주세요.';
  end if;
  if char_length(btrim(coalesce(p_student_name,''))) not between 1 and 30 then
    raise exception using errcode='22023', message='이름을 확인해 주세요.';
  end if;
  if p_prayer_date is null then
    raise exception using errcode='22023', message='감사기도 날짜가 없습니다.';
  end if;
  if char_length(btrim(coalesce(p_gratitude_text,''))) not between 10 and 2000 then
    raise exception using errcode='22023', message='감사기도는 10자 이상 2000자 이하로 작성해 주세요.';
  end if;
  if p_edit_token is null then
    raise exception using errcode='22023', message='감사기도 편집 토큰이 없습니다.';
  end if;

  select g.id, g.edit_token, g.gratitude_text
    into v_id, v_existing_token, v_existing_text
  from public.gratitude_prayers g
  where g.prayer_date = p_prayer_date
    and g.grade = p_grade
    and g.student_name = btrim(p_student_name)
  limit 1;

  if not found then
    insert into public.gratitude_prayers (
      grade, student_name, prayer_date, gratitude_text, edit_token, is_public, created_at, updated_at
    ) values (
      p_grade, btrim(p_student_name), p_prayer_date, btrim(p_gratitude_text), p_edit_token, true, now(), now()
    ) returning id into v_id;
    return query select v_id, 'inserted'::text;
    return;
  end if;

  if v_existing_token = p_edit_token then
    update public.gratitude_prayers
      set gratitude_text = btrim(p_gratitude_text), is_public = true, updated_at = now()
    where id = v_id;
    return query select v_id, 'updated'::text;
    return;
  end if;

  if v_existing_token is null
     and p_original_text is not null
     and v_existing_text = p_original_text then
    update public.gratitude_prayers
      set gratitude_text = btrim(p_gratitude_text), edit_token = p_edit_token, is_public = true, updated_at = now()
    where id = v_id;
    return query select v_id, 'claimed_and_updated'::text;
    return;
  end if;

  raise exception using errcode='42501', message='이 감사기도 기록은 작성한 기기에서만 수정할 수 있습니다.';
end;
$$;
revoke all on function public.youth_gratitude_save_v27(text,text,date,text,uuid,text) from public;
grant execute on function public.youth_gratitude_save_v27(text,text,date,text,uuid,text) to anon, authenticated;

-- 학생 자신의 로컬 챌린지 동기화 함수도 선생님 허용
create or replace function public.youth_gratitude_sync_v29(
  p_grade text,
  p_student_name text,
  p_edit_token uuid,
  p_local_records jsonb default '[]'::jsonb
)
returns table(
  prayer_date date,
  gratitude_text text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_student_name,''));
begin
  if p_grade not in ('중1','중2','중3','고1','고2','고3','선생님') then
    raise exception '학년/구분을 확인해 주세요.' using errcode='22023';
  end if;
  if char_length(v_name) not between 1 and 30 then
    raise exception '이름을 확인해 주세요.' using errcode='22023';
  end if;
  if p_edit_token is null then
    raise exception '감사기도 동기화 토큰이 없습니다.' using errcode='22023';
  end if;

  update public.gratitude_prayers g
     set edit_token = p_edit_token,
         updated_at = coalesce(g.updated_at, now())
   where g.grade = p_grade
     and g.student_name = v_name
     and g.edit_token is null
     and exists (
       select 1
       from jsonb_array_elements(coalesce(p_local_records, '[]'::jsonb)) as local_row
       where local_row->>'date' = g.prayer_date::text
         and local_row->>'text' = g.gratitude_text
     );

  return query
  select g.prayer_date, g.gratitude_text, g.created_at, g.updated_at
  from public.gratitude_prayers g
  where g.grade = p_grade
    and g.student_name = v_name
    and g.edit_token = p_edit_token
  order by g.prayer_date desc;
end;
$$;
revoke all on function public.youth_gratitude_sync_v29(text,text,uuid,jsonb) from public;
grant execute on function public.youth_gratitude_sync_v29(text,text,uuid,jsonb) to anon, authenticated;

-- 전체 공개용 함수: edit_token 같은 비공개 DB 컬럼은 절대 반환하지 않습니다.
create or replace function public.youth_gratitude_public_feed_v30(p_limit integer default 100)
returns table(
  grade text,
  student_name text,
  prayer_date date,
  gratitude_text text,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select g.grade, g.student_name, g.prayer_date, g.gratitude_text, g.created_at, g.updated_at
  from public.gratitude_prayers g
  where g.is_public = true
  order by g.prayer_date desc, g.created_at desc
  limit least(greatest(coalesce(p_limit,100),1),200);
$$;
revoke all on function public.youth_gratitude_public_feed_v30(integer) from public;
grant execute on function public.youth_gratitude_public_feed_v30(integer) to anon, authenticated;

-- ============================================================
-- F. 새친구 등록
-- 공개: 학년/이름/학교
-- 관리자 전용: 연락처/인도자/기타정보
-- ============================================================

create table if not exists public.new_friends (
  id uuid primary key default gen_random_uuid(),
  grade text not null,
  friend_name text not null,
  school text not null,
  phone text,
  inviter text,
  other_info text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint new_friends_grade_v30_check check (grade in ('중1','중2','중3','고1','고2','고3')),
  constraint new_friends_name_v30_check check (char_length(btrim(friend_name)) between 1 and 30),
  constraint new_friends_school_v30_check check (char_length(btrim(school)) between 1 and 100),
  constraint new_friends_phone_v30_check check (phone is null or char_length(btrim(phone)) <= 30),
  constraint new_friends_inviter_v30_check check (inviter is null or char_length(btrim(inviter)) <= 50),
  constraint new_friends_other_v30_check check (other_info is null or char_length(btrim(other_info)) <= 1000)
);

create index if not exists new_friends_created_v30_idx on public.new_friends(created_at desc);
alter table public.new_friends enable row level security;

grant insert on table public.new_friends to anon, authenticated;
grant select, update, delete on table public.new_friends to authenticated;
revoke select, update, delete on table public.new_friends from anon;

drop policy if exists new_friends_public_insert_v30 on public.new_friends;
create policy new_friends_public_insert_v30
on public.new_friends
for insert
to anon, authenticated
with check (
  grade in ('중1','중2','중3','고1','고2','고3')
  and char_length(btrim(friend_name)) between 1 and 30
  and char_length(btrim(school)) between 1 and 100
  and (phone is null or char_length(btrim(phone)) <= 30)
  and (inviter is null or char_length(btrim(inviter)) <= 50)
  and (other_info is null or char_length(btrim(other_info)) <= 1000)
);

drop policy if exists new_friends_admin_select_v30 on public.new_friends;
create policy new_friends_admin_select_v30
on public.new_friends for select to authenticated
using (private.is_youth_admin());

drop policy if exists new_friends_admin_update_v30 on public.new_friends;
create policy new_friends_admin_update_v30
on public.new_friends for update to authenticated
using (private.is_youth_admin())
with check (private.is_youth_admin());

drop policy if exists new_friends_admin_delete_v30 on public.new_friends;
create policy new_friends_admin_delete_v30
on public.new_friends for delete to authenticated
using (private.is_youth_admin());

-- 공개 함수에는 공개 허용된 3개 항목(+등록일)만 반환합니다.
create or replace function public.youth_new_friend_public_v30(p_limit integer default 100)
returns table(
  friend_id uuid,
  grade text,
  friend_name text,
  school text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select n.id, n.grade, n.friend_name, n.school, n.created_at
  from public.new_friends n
  order by n.created_at desc
  limit least(greatest(coalesce(p_limit,100),1),200);
$$;
revoke all on function public.youth_new_friend_public_v30(integer) from public;
grant execute on function public.youth_new_friend_public_v30(integer) to anon, authenticated;

notify pgrst, 'reload schema';
commit;

-- ============================================================
-- 실행 확인: 주요 값이 모두 true이면 정상입니다.
-- ============================================================
select
  exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='attendance'
      and policyname='attendance_student_insert_v30' and cmd='INSERT'
  ) as attendance_1030_1300_policy,
  to_regprocedure('private.youth_submit_attendance_impl(text,text,text)') is not null as attendance_time_gate,
  exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='study_submissions'
      and policyname='study_submissions_student_insert_v30' and cmd='INSERT'
  ) as teacher_study_policy,
  exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='prayer_requests'
      and policyname='prayer_requests_student_insert_v30' and cmd='INSERT'
  ) as teacher_prayer_policy,
  exists (select 1 from information_schema.columns where table_schema='public' and table_name='gratitude_prayers' and column_name='is_public') as gratitude_public_flag_exists,
  to_regprocedure('public.youth_gratitude_public_feed_v30(integer)') is not null as gratitude_public_feed_exists,
  has_function_privilege('anon','public.youth_gratitude_public_feed_v30(integer)','EXECUTE') as gratitude_public_anon,
  not has_table_privilege('anon','public.gratitude_prayers','DELETE') as gratitude_anon_cannot_delete,
  to_regclass('public.new_friends') is not null as new_friends_table_exists,
  to_regprocedure('public.youth_new_friend_public_v30(integer)') is not null as new_friend_public_feed_exists,
  has_table_privilege('anon','public.new_friends','INSERT') as new_friend_anon_insert,
  not has_table_privilege('anon','public.new_friends','SELECT') as new_friend_private_columns_hidden,
  has_table_privilege('authenticated','public.new_friends','DELETE') as new_friend_admin_delete_grant;
