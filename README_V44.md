# 주의울림 V44 — 학생 찬양 관리자 인증 안정화 + 전체 최적화

## 핵심 변경

1. 학생 찬양 관리자 가입
   - 이메일 형식 검증 강화
   - Supabase `signUp()`에 현재 앱의 관리자 화면 복귀 URL을 자동 지정
   - 이메일 인증 ON/OFF 설정 모두 대응
   - 인증메일 다시 보내기 버튼 추가(60초 재요청 제한)
   - 이메일 미인증, 잘못된 비밀번호, 요청 과다(429), 기본 SMTP 제한 등을 구분해 안내
   - 전체 관리자는 **이메일 인증이 완료된 계정만** 찬양 관리자로 승인 가능(V44 SQL)

2. 앱 로딩 최적화
   - 첫 화면에서는 공지/말씀 기본정보/행사 달력만 우선 로드
   - 찬양, 감사기도, 익명게시판, 새친구 데이터는 해당 탭을 눌렀을 때 지연 로드
   - 같은 탭을 짧은 시간에 반복 눌러도 중복 요청을 줄임
   - YouTube 플레이어도 찬양 탭을 열기 전에는 만들지 않음

3. PWA/캐시 최적화
   - V44 ZIP에 `manifest.json` 포함
   - 페이지는 network-first, 정적 파일은 stale-while-revalidate 방식
   - 성공 응답만 캐시에 저장
   - Supabase/YouTube/날씨 API는 서비스워커 캐시에서 제외

4. DB 조회 최적화
   - 공지, 주일말씀, 찬양, 감사기도, 제출기록 등 자주 쓰는 조회 컬럼에 인덱스 추가

## 반드시 확인할 Supabase Auth 설정

### A. URL Configuration
Supabase Dashboard → Authentication → URL Configuration

- Site URL: `https://riceburger1.github.io/`
- Redirect URLs에 추가: `https://riceburger1.github.io/**`

실제 GitHub Pages 주소가 다른 경우 실제 주소로 바꾸세요.

### B. Email Provider
Supabase Dashboard → Authentication → Providers → Email

- Allow new users to sign up: ON
- Confirm Email: 이메일 인증을 사용할 경우 ON

### C. 실제 학생 이메일로 인증 메일을 보내려면
Supabase 기본 SMTP는 운영용 이메일 발송에 제약이 있습니다. 실제 학생 이메일 인증을 안정적으로 쓰려면 Authentication → SMTP에서 사용자 SMTP를 설정하는 것이 좋습니다.

이메일 인증을 끄더라도 V44는 정상 가입됩니다. 이 경우에도 학생은 바로 관리자가 되는 것이 아니며, 기존처럼 **전체 관리자의 찬양 관리자 승인**이 있어야만 찬양 관리 화면에 들어갈 수 있습니다.

## 적용 순서

1. `feature_update_v44.sql` 전체 실행
2. 마지막 진단 결과가 모두 `true`인지 확인
3. GitHub의 `index.html`, `app.js`, `styles.css`, `sw.js`, `manifest.json` 교체
4. Ctrl + F5
5. 학생 관리자 가입 테스트
6. 이메일 인증 사용 시 인증 링크 클릭
7. 전체 관리자 → 찬양 관리 → 학생 이메일 승인
8. 학생 계정 로그인 후 찬양 관리 탭만 보이는지 확인

## 가입 테스트 체크리스트

- 새 이메일 가입 시 가입 완료 안내가 나오는가
- Confirm Email ON이면 인증메일 안내 + `인증메일 다시 보내기`가 보이는가
- 인증 전 전체 관리자 승인을 누르면 '이메일 인증 전' 안내가 나오는가
- 인증 후 승인되는가
- 승인 전 학생이 관리자 로그인하면 다른 데이터가 노출되지 않는가
- 승인 후 학생은 찬양 관리만 보이는가
- 권한 해제 후 다시 접근할 수 없는가
