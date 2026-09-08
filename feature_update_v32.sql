-- 주의울림 V32 업데이트
-- 1) 감사기도 기록 시 42501 충돌 오류를 사용자 오류로 노출하지 않도록 저장 함수 보강
-- 2) 학생 공개 챌린지 현황은 연속기록 TOP 3만 조회 가능
-- 3) 관리자 삭제 권한은 그대로 유지
-- 기존 감사기도 데이터는 삭제하지 않습니다.

begin;

-- ============================================================
-- A. 감사기도 기본 권한 재확인
-- ============================================================
alter table public.gratitude_prayers enable row level security;
grant insert on table public.gratitude_prayers to anon, authenticated;
grant select, delete on table public.gratitude_prayers to authenticated;
revoke delete on table public.gratitude_prayers from anon;

-- 학생 신규 INSERT 정책을 현재 학년/구분 규칙으로 다시 보장합니다.
drop policy if exists gratitude_prayers_student_insert_v32 on public.gratitude_prayers;
create policy gratitude_prayers_student_insert_v32
on public.gratitude_prayers
for insert
to anon, authenticated
with check (
  grade in ('중1','중2','중3','고1','고2','고3','선생님')
  and char_length(btrim(coalesce(student_name,''))) between 1 and 30
  and char_length(btrim(coalesce(gratitude_text,''))) between 10 and 2000
  and prayer_date <= (now() at time zone 'Asia/Seoul')::date
);

-- 기존 이름의 INSERT 정책이 중복으로 남아 있더라도 문제는 없지만,
-- V30 정책은 현재 규칙보다 느슨하므로 제거합니다.
drop policy if exists gratitude_prayers_student_insert_v30 on public.gratitude_prayers;

-- ============================================================
-- B. V32 감사기도 저장 함수
-- 기존 V27 함수에서 명시적으로 발생하던 42501을 제거합니다.
-- 같은 학년/이름/날짜 기록이 다른 기기 토큰으로 이미 존재하면
-- 덮어쓰지 않고 'already_recorded'를 반환하여 데이터 보호와 UX를 함께 지킵니다.
-- ============================================================
create or replace function public.youth_gratitude_save_v32(
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
  v_today date := (now() at time zone 'Asia/Seoul')::date;
begin
  if p_grade not in ('중1','중2','중3','고1','고2','고3','선생님') then
    raise exception using errcode='22023', message='올바른 학년/구분을 선택해 주세요.';
  end if;
  if char_length(btrim(coalesce(p_student_name,''))) not between 1 and 30 then
    raise exception using errcode='22023', message='이름을 확인해 주세요.';
  end if;
  if p_prayer_date is null or p_prayer_date > v_today then
    raise exception using errcode='22023', message='감사기도 날짜를 확인해 주세요.';
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
  order by g.created_at asc
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

  -- 같은 기기에서 작성한 기록은 정상 수정
  if v_existing_token = p_edit_token then
    update public.gratitude_prayers
       set gratitude_text = btrim(p_gratitude_text),
           is_public = true,
           updated_at = now()
     where id = v_id;
    return query select v_id, 'updated'::text;
    return;
  end if;

  -- 이전 버전 기록(edit_token NULL)은 기기에 남아 있는 원문이 같을 때만 편집권 연결
  if v_existing_token is null
     and p_original_text is not null
     and v_existing_text = p_original_text then
    update public.gratitude_prayers
       set gratitude_text = btrim(p_gratitude_text),
           edit_token = p_edit_token,
           is_public = true,
           updated_at = now()
     where id = v_id;
    return query select v_id, 'claimed_and_updated'::text;
    return;
  end if;

  -- 다른 기기에서 이미 작성된 동일 날짜 기록은 42501 예외 대신 정상 상태를 반환합니다.
  return query select v_id, 'already_recorded'::text;
end;
$$;

revoke all on function public.youth_gratitude_save_v32(text,text,date,text,uuid,text) from public;
grant execute on function public.youth_gratitude_save_v32(text,text,date,text,uuid,text) to anon, authenticated;

-- 프로필 기준 챌린지 동기화. 감사기도 본문은 현재 공개 데이터이므로
-- 다른 기기에서도 자신의 연속기록을 복원할 수 있게 하되, 편집권은 edit_token으로 계속 보호합니다.
create or replace function public.youth_gratitude_sync_v32(
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
    raise exception using errcode='22023', message='학년/구분을 확인해 주세요.';
  end if;
  if char_length(v_name) not between 1 and 30 then
    raise exception using errcode='22023', message='이름을 확인해 주세요.';
  end if;
  if p_edit_token is null then
    raise exception using errcode='22023', message='감사기도 동기화 토큰이 없습니다.';
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
  order by g.prayer_date desc;
end;
$$;
revoke all on function public.youth_gratitude_sync_v32(text,text,uuid,jsonb) from public;
grant execute on function public.youth_gratitude_sync_v32(text,text,uuid,jsonb) to anon, authenticated;

-- ============================================================
-- C. 학생 공개 챌린지 현황: TOP 3 전용 함수
-- 본문은 반환하지 않으며 현재 연속기록 상위 3명만 반환합니다.
-- ============================================================
create or replace function public.youth_gratitude_top3_v32()
returns table(
  grade text,
  student_name text,
  current_streak integer,
  best_streak integer,
  total_days integer,
  last_date date
)
language sql
stable
security definer
set search_path = ''
as $$
  with params as (
    select (now() at time zone 'Asia/Seoul')::date as today
  ),
  days as (
    select distinct g.grade, g.student_name, g.prayer_date
    from public.gratitude_prayers g
  ),
  numbered as (
    select
      d.grade,
      d.student_name,
      d.prayer_date,
      d.prayer_date - (row_number() over (
        partition by d.grade, d.student_name
        order by d.prayer_date
      ))::integer as island_key
    from days d
  ),
  islands as (
    select
      n.grade,
      n.student_name,
      min(n.prayer_date) as start_date,
      max(n.prayer_date) as end_date,
      count(*)::integer as streak_days
    from numbered n
    group by n.grade, n.student_name, n.island_key
  ),
  ranked as (
    select
      i.*,
      row_number() over (
        partition by i.grade, i.student_name
        order by i.end_date desc
      ) as latest_rank
    from islands i
  ),
  summary as (
    select
      r.grade,
      r.student_name,
      max(case
        when r.latest_rank = 1 and r.end_date >= p.today - 1 then r.streak_days
        else 0
      end)::integer as current_streak,
      max(r.streak_days)::integer as best_streak,
      sum(r.streak_days)::integer as total_days,
      max(r.end_date) as last_date
    from ranked r
    cross join params p
    group by r.grade, r.student_name
  )
  select
    s.grade,
    s.student_name,
    s.current_streak,
    s.best_streak,
    s.total_days,
    s.last_date
  from summary s
  where s.current_streak > 0
  order by s.current_streak desc, s.best_streak desc, s.total_days desc, s.student_name asc
  limit 3;
$$;

revoke all on function public.youth_gratitude_top3_v32() from public;
grant execute on function public.youth_gratitude_top3_v32() to anon, authenticated;

-- 이전 전체 공개 리더보드는 학생 앱에서 더 이상 호출하지 못하도록 실행권한을 회수합니다.
revoke execute on function public.youth_gratitude_leaderboard_v27() from anon, authenticated;

-- 관리자 삭제 정책 재확인
drop policy if exists gratitude_prayers_admin_delete_v32 on public.gratitude_prayers;
create policy gratitude_prayers_admin_delete_v32
on public.gratitude_prayers
for delete
to authenticated
using (private.is_youth_admin());

notify pgrst, 'reload schema';
commit;

-- ============================================================
-- 실행 확인: 아래 값이 모두 true이면 정상입니다.
-- ============================================================
select
  to_regprocedure('public.youth_gratitude_save_v32(text,text,date,text,uuid,text)') is not null as gratitude_save_v32_exists,
  has_function_privilege('anon','public.youth_gratitude_save_v32(text,text,date,text,uuid,text)','EXECUTE') as gratitude_save_anon,
  has_function_privilege('authenticated','public.youth_gratitude_save_v32(text,text,date,text,uuid,text)','EXECUTE') as gratitude_save_auth,
  to_regprocedure('public.youth_gratitude_sync_v32(text,text,uuid,jsonb)') is not null as gratitude_sync_v32_exists,
  has_function_privilege('anon','public.youth_gratitude_sync_v32(text,text,uuid,jsonb)','EXECUTE') as gratitude_sync_anon,
  to_regprocedure('public.youth_gratitude_top3_v32()') is not null as gratitude_top3_exists,
  has_function_privilege('anon','public.youth_gratitude_top3_v32()','EXECUTE') as gratitude_top3_anon,
  has_function_privilege('authenticated','public.youth_gratitude_top3_v32()','EXECUTE') as gratitude_top3_auth,
  not has_function_privilege('anon','public.youth_gratitude_leaderboard_v27()','EXECUTE') as old_full_leaderboard_hidden_anon,
  not has_function_privilege('authenticated','public.youth_gratitude_leaderboard_v27()','EXECUTE') as old_full_leaderboard_hidden_auth,
  has_table_privilege('authenticated','public.gratitude_prayers','DELETE') as gratitude_admin_delete;
