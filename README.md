# 주의울림 V19 — 행사 기간 저장 PGRST204 수정

## 원인
앱은 `church_events.end_date`를 저장하지만 Supabase 테이블 또는 PostgREST 스키마 캐시에 `end_date`가 없어 `PGRST204`가 발생했습니다.

## 적용 순서
1. Supabase `youth-worship` 프로젝트 → SQL Editor → New query
2. `event_period_v19.sql` 전체 실행
3. 마지막 진단 결과가 모두 `true`인지 확인
4. GitHub에서 `index.html`, `app.js`, `styles.css`, `sw.js` 교체
5. GitHub Pages 배포 후 Ctrl+F5

## 정상 진단값
- end_date_exists = true
- no_null_end_date = true
- valid_event_periods = true
- calendar_public_select = true
- calendar_admin_insert = true
- calendar_admin_update = true
- calendar_admin_delete = true
