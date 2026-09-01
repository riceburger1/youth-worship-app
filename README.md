# 주의울림 v11 — 출석 저장 + 지난 기록 삭제

## 변경사항
- 말씀쓰기 완료 및 출석 저장을 `youth_submit_attendance_v1` RPC로 안정화
- 관리자 로그인 상태/비로그인 상태 모두 출석 저장 가능
- 기존 직접 INSERT도 fallback으로 유지
- 지난 성경공부만 삭제 가능
- 지난 말씀·성경공부 전체 삭제 가능
  - 연결된 말씀쓰기 출석과 성경공부 제출 기록은 함께 삭제
  - 기도제목 내용은 보존하고 해당 주차 연결만 해제
- 지난 공지사항 선택 후 삭제 가능
- 오류 발생 시 실제 Supabase 오류 코드/내용 표시

## 적용 순서
1. Supabase SQL Editor에서 `attendance_delete_admin_v8.sql` 전체 실행
2. GitHub에서 `index.html`, `app.js`, `sw.js` 교체 (styles.css도 함께 올려도 됨)
3. GitHub Pages 배포 후 Ctrl+F5
4. 관리자 화면에 `관리자 말씀·성경공부·공지 삭제 v11 준비 완료.`가 보이는지 확인
