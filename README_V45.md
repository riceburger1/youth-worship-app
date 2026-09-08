# 주의울림 V45

## 핵심 변경
- 학생 찬양 관리자 가입 시 이메일 인증 메일/확인 절차 제거
- 가입: 이메일 + 비밀번호 → 전체 관리자 이메일 승인 → 로그인
- 찬양 관리자 승인 RPC에서 email_confirmed 조건 제거
- 상단 최신 공지 배너는 공지 제목만 표시
- 공지사항 탭에서는 최신 공지 전체 내용과 지난 공지 목록을 그대로 확인

## Supabase에서 반드시 1회 설정
Dashboard → Authentication → Sign In / Providers → Email → **Confirm Email OFF**

V45 SQL도 실행하세요: `feature_update_v45.sql`

## GitHub 교체 파일
- index.html
- app.js
- styles.css
- sw.js
- manifest.json

적용 후 Ctrl+F5로 새로고침하세요.
