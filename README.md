# 주의울림 V14 관리자/모바일 오류 수정

## 수정 내용
- PGRST202 삭제 함수 불일치 수정
  - `youth_admin_delete_word_v14(p_content_id)`
  - `youth_admin_delete_study_v14(p_content_id)`
  - `youth_admin_delete_notice_v14(p_notice_id)`
  - `youth_admin_delete_student_record_v14(p_record_id, p_record_type)`
- PostgREST schema cache reload 포함
- RPC가 아직 캐시에 없을 때 RLS 기반 직접 삭제 fallback 추가
- 학생 제출기록을 주일별 그룹으로 유지하면서 모바일에서 카드/삭제버튼이 깨지지 않도록 반응형 수정
- 관리자 화면 버튼을 누르면 `?admin=1` 새 브라우저 탭으로 열림
- 관리자 탭에서는 학생용 메뉴/입력 화면을 숨기고 관리자 화면에 집중하도록 UI 정리
- 전반적인 카드, 버튼, 입력창, 포커스, 간격 개선

## 적용 순서
1. Supabase `youth-worship` 프로젝트 → SQL Editor → New query
2. `admin_delete_mobile_fix_v14.sql` 전체 붙여넣기 → Run
3. 마지막 결과에 아래 4개 함수가 모두 나오고 `can_execute=true`인지 확인
   - youth_admin_delete_notice_v14
   - youth_admin_delete_student_record_v14
   - youth_admin_delete_study_v14
   - youth_admin_delete_word_v14
4. GitHub `youth-worship-app`에서 다음 파일 교체
   - index.html
   - app.js
   - styles.css
   - sw.js
5. GitHub Pages 배포 후 Ctrl+F5
6. 설치형 PWA가 예전 화면이면 DevTools → Application → Service Workers → Unregister 후 Storage → Clear site data

## 관리자 화면
학생 화면 하단의 `관리자 화면 새 탭에서 열기 ↗`를 누르면 같은 사이트의 `?admin=1` 관리자 탭이 열립니다.
Supabase 로그인 세션은 같은 브라우저에서 공유되므로 이미 관리자 로그인 상태라면 새 탭에서도 자동 확인됩니다.

## 검증
- app.js를 ES module(.mjs)로 Node syntax check 완료
- app.js가 직접 참조하는 DOM ID 94개가 index.html에 모두 존재함을 확인
- Service Worker cache: `주의울림-v14-admin-mobile-delete-fix`
