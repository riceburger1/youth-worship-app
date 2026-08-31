-- 주의울림: 감사기도 챌린지 추가 SQL
-- 기존 테이블은 삭제하거나 다시 만들지 않습니다.

create table if not exists public.gratitude_prayers (
  id uuid primary key default gen_random_uuid(),
  grade text not null check (grade in ('중1','중2','중3','고1','고2','고3')),
  student_name text not null check (char_length(trim(student_name)) between 1 and 30),
  prayer_date date not null default current_date,
  gratitude_text text not null check (char_length(trim(gratitude_text)) between 1 and 2000),
  created_at timestamptz not null default now(),
  constraint gratitude_prayers_one_per_day unique (prayer_date, grade, student_name)
);

create index if not exists gratitude_prayers_date_idx
  on public.gratitude_prayers (prayer_date desc, created_at desc);

alter table public.gratitude_prayers enable row level security;

grant insert on table public.gratitude_prayers to anon, authenticated;
grant select, delete on table public.gratitude_prayers to authenticated;
grant select on table public.admin_users to authenticated;

-- 학생(로그인하지 않은 이용자 포함)은 감사기도를 '작성'만 할 수 있습니다.
-- 다른 학생의 감사기도 내용을 조회하는 권한은 주지 않습니다.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='gratitude_prayers'
      and policyname='gratitude_prayers_student_insert'
  ) then
    create policy gratitude_prayers_student_insert
      on public.gratitude_prayers
      for insert
      to anon, authenticated
      with check (
        grade in ('중1','중2','중3','고1','고2','고3')
        and char_length(trim(student_name)) between 1 and 30
        and char_length(trim(gratitude_text)) between 1 and 2000
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='gratitude_prayers'
      and policyname='gratitude_prayers_admin_select'
  ) then
    create policy gratitude_prayers_admin_select
      on public.gratitude_prayers
      for select
      to authenticated
      using (
        exists (
          select 1 from public.admin_users a
          where a.user_id = (select auth.uid())
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='gratitude_prayers'
      and policyname='gratitude_prayers_admin_delete'
  ) then
    create policy gratitude_prayers_admin_delete
      on public.gratitude_prayers
      for delete
      to authenticated
      using (
        exists (
          select 1 from public.admin_users a
          where a.user_id = (select auth.uid())
        )
      );
  end if;
end
$$;

-- 확인용
select table_name
from information_schema.tables
where table_schema='public' and table_name='gratitude_prayers';
