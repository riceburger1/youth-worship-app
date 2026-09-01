-- 주의울림 youth-worship 공지사항 수정 저장 보강 V6
-- 목적
-- 1) 기존 공지 선택 후 수정 저장이 확실히 되도록 전용 RPC 추가
-- 2) 새 공지 등록도 동일 함수로 처리
-- 3) 기존 공지 데이터는 삭제하지 않음

begin;

-- 관리자 연결 보장
insert into public.admin_users (user_id)
select id from auth.users
where id = '0f919b37-d853-4c87-9cca-5e43ca3badc0'
on conflict (user_id) do nothing;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

-- 실제 저장은 private SECURITY DEFINER 함수에서 수행합니다.
-- 함수 내부에서 현재 로그인 UID가 admin_users에 등록된 경우만 허용합니다.
drop function if exists private.youth_admin_save_notice_impl(text,text,date,text,boolean,boolean);

create function private.youth_admin_save_notice_impl(
  p_notice_id text,
  p_title text,
  p_event_date date,
  p_body text,
  p_banner boolean,
  p_published boolean
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id public.notices.id%TYPE;
begin
  if (select auth.uid()) is null
     or not exists (
       select 1
       from public.admin_users a
       where a.user_id = (select auth.uid())
     ) then
    raise exception '관리자 권한이 없습니다.' using errcode = '42501';
  end if;

  if nullif(btrim(coalesce(p_title,'')), '') is null
     or nullif(btrim(coalesce(p_body,'')), '') is null then
    raise exception '공지 제목과 내용은 필수입니다.' using errcode = '22023';
  end if;

  if nullif(btrim(coalesce(p_notice_id,'')), '') is not null then
    select n.id into v_id
    from public.notices n
    where n.id::text = p_notice_id
    limit 1;

    if v_id is null then
      raise exception '수정할 공지사항을 찾지 못했습니다.' using errcode = 'P0002';
    end if;

    update public.notices
       set title = btrim(p_title),
           event_date = p_event_date,
           body = btrim(p_body),
           banner = coalesce(p_banner, true),
           published = coalesce(p_published, true)
     where id = v_id;
  else
    insert into public.notices
      (title, event_date, body, banner, published)
    values
      (btrim(p_title), p_event_date, btrim(p_body), coalesce(p_banner, true), coalesce(p_published, true))
    returning id into v_id;
  end if;

  return v_id::text;
end;
$$;

revoke all on function private.youth_admin_save_notice_impl(text,text,date,text,boolean,boolean) from public;
grant execute on function private.youth_admin_save_notice_impl(text,text,date,text,boolean,boolean) to authenticated;

-- Data API에서 호출할 public wrapper. 권한 우회는 private 함수 안에서만 일어나며
-- private 함수가 다시 관리자 UID를 검증합니다.
drop function if exists public.youth_admin_save_notice(text,text,date,text,boolean,boolean);

create function public.youth_admin_save_notice(
  p_notice_id text,
  p_title text,
  p_event_date date,
  p_body text,
  p_banner boolean,
  p_published boolean
)
returns text
language sql
security invoker
set search_path = ''
as $$
  select private.youth_admin_save_notice_impl(
    p_notice_id,
    p_title,
    p_event_date,
    p_body,
    p_banner,
    p_published
  );
$$;

revoke all on function public.youth_admin_save_notice(text,text,date,text,boolean,boolean) from public;
revoke all on function public.youth_admin_save_notice(text,text,date,text,boolean,boolean) from anon;
grant execute on function public.youth_admin_save_notice(text,text,date,text,boolean,boolean) to authenticated;

commit;

-- 실행 확인
select
  (select count(*) from auth.users where id='0f919b37-d853-4c87-9cca-5e43ca3badc0') as auth_user_count,
  (select count(*) from public.admin_users where user_id='0f919b37-d853-4c87-9cca-5e43ca3badc0') as admin_link_count,
  has_schema_privilege('authenticated','private','USAGE') as private_schema_usage,
  has_function_privilege('authenticated','private.youth_admin_save_notice_impl(text,text,date,text,boolean,boolean)','EXECUTE') as notice_impl_execute,
  has_function_privilege('authenticated','public.youth_admin_save_notice(text,text,date,text,boolean,boolean)','EXECUTE') as notice_rpc_execute;
