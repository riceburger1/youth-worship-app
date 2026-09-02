# 주의울림 V21 — 성경공부 답안 저장 수정

## 원인
`study_submissions` 테이블은 관리자 조회/삭제 정책은 있었지만 학생용 INSERT 정책/권한이 빠져 있어 학생 답안 제출이 막힐 수 있었습니다.

## 적용 순서
1. Supabase SQL Editor에서 `study_submission_fix_v21.sql` 전체 실행
2. 마지막 진단 결과가 모두 true인지 확인
3. GitHub에서 `app.js`, `sw.js` 교체
4. Ctrl+F5

## 변경
- anon/authenticated 모두 성경공부 답안 INSERT 허용(RLS 적용)
- serial/identity ID일 경우 sequence 권한 자동 보완
- 앱에서 실제 Supabase 오류 코드 표시
- 중복 제출(23505)은 별도 안내
