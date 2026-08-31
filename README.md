# 양정중앙교회 청소년부 주의울림

Supabase 연결이 완료된 PWA 웹앱입니다.

## 포함 기능
- 관리자 등록 말씀구절 조회
- 말씀 직접 따라쓰기
- 말씀쓰기 복사/붙여넣기 및 드래그앤드롭 차단
- 말씀 정확히 완성 후 학년+이름 기준 출석 저장
- 관리자 등록 성경공부 질문 2~3개 및 학생 답변 제출
- 기도제목 제출
- 공지사항 및 상단 배너
- 찬양단 게시판 / 다음 주 찬양곡 순서 등록
- 익명 건의·문의 게시판
- 관리자 이메일/비밀번호 로그인
- 관리자 제출 현황 조회
- PWA 설치

## Supabase
Project URL:
https://gcsfrsemshrddlcptsxo.supabase.co

프론트엔드에는 Publishable Key만 들어 있습니다.
Service Role / Secret Key는 포함하지 않았습니다.

## 최초 관리자 계정 만들기
1. Supabase Dashboard → Authentication → Users에서 관리자 이메일 계정을 생성합니다.
2. 생성한 사용자의 UUID를 복사합니다.
3. SQL Editor에서 아래 SQL을 1회 실행합니다.

```sql
insert into public.admin_users (user_id)
values ('여기에_관리자_USER_UUID');
```

그 뒤 앱 하단의 `관리자 화면`에서 이메일/비밀번호로 로그인합니다.

## GitHub Pages 배포
이 폴더 안의 파일들을 GitHub 저장소 루트에 업로드한 뒤:
Settings → Pages → Deploy from a branch → main / root 선택

## 파일
- index.html
- styles.css
- app.js
- manifest.json
- sw.js
- icon.svg / icon-192.png / icon-512.png

## 참고
말씀쓰기의 브라우저 붙여넣기/드롭은 차단되어 있습니다.
다만 웹 브라우저라는 환경 특성상 개발자 도구나 접근성 자동화까지 100% 차단하는 것은 불가능합니다.
출석 신뢰성이 매우 중요하면 서버 측 검증(타이핑 이벤트 검증/세션 토큰 등)을 추가하는 것이 좋습니다.
