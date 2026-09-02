# 주의울림 V15 — 기도제목 + 행사 달력

이번 업데이트는 기존 V14를 기준으로 다음 기능을 추가/수정합니다.

## 수정 내용

1. **기도제목 학생 등록 복구**
   - `prayer_requests`에 `anon`, `authenticated` INSERT 권한 추가
   - 학생용 INSERT RLS 정책 추가
   - 기존 테이블 ID가 serial/identity인 경우 시퀀스 권한도 자동 보완
   - 오류 발생 시 실제 Supabase 오류 코드/문구 표시

2. **관리자 기도제목 관리**
   - 관리자 화면에 `기도제목 관리` 별도 영역 추가
   - 기도제목을 **주일 날짜별**로 그룹화
   - 각 기도제목 개별 삭제 가능
   - 기존 `학생 제출 기록`의 기도제목 삭제 버튼도 V15 삭제 기능 사용

3. **학생 화면 하단 행사·이벤트 달력**
   - 월간 달력 표시
   - 등록된 일정이 있는 날짜에 행사명 표시
   - 날짜 클릭 시 행사명, 시간, 장소, 상세내용 표시
   - 학생은 조회만 가능

4. **관리자 행사·이벤트 달력 관리**
   - 관리자 새 탭 화면에 별도 달력 관리 영역 추가
   - 날짜 클릭 → 새 행사 등록
   - 같은 날짜에 여러 행사 등록 가능
   - 기존 행사 선택 → 수정 저장
   - 기존 행사 선택 → 삭제
   - 공개/비공개 설정 가능
   - 비공개 일정은 학생 달력에서 보이지 않음

5. **PWA 캐시 수정**
   - 캐시명: `주의울림-v15-prayer-calendar`
   - 존재하지 않던 `icon.svg`를 캐시 목록에서 제거하여 Service Worker 설치 실패 가능성도 함께 수정

## 적용 순서

### 1) Supabase SQL Editor
`prayer_calendar_v15.sql` 전체를 실행합니다.

마지막 진단 결과에서 아래 항목이 모두 `true`인지 확인합니다.

- prayer_anon_insert
- prayer_auth_insert
- prayer_admin_delete
- prayer_delete_function_exists
- calendar_anon_select
- calendar_admin_insert
- calendar_admin_update
- calendar_admin_delete

### 2) GitHub 교체 파일
다음 파일 4개를 기존 저장소 파일과 교체합니다.

- `index.html`
- `app.js`
- `styles.css`
- `sw.js`

`manifest.json`, `icon-192.png`, `icon-512.png`은 그대로 사용해도 됩니다.

### 3) 배포 후 새로고침
GitHub Pages 배포 후 `Ctrl + F5`를 누릅니다.

설치형 앱에 이전 화면이 남으면:

1. F12 → Application → Service Workers → Unregister
2. Application → Storage → Clear site data
3. 다시 접속

## 관리자 달력 사용

1. 학생 화면 하단 `관리자 화면 새 탭에서 열기 ↗`
2. 관리자 로그인
3. `행사 · 이벤트 달력 관리`
4. 날짜 클릭
5. 행사명/시간/장소/내용 입력
6. `행사 등록`

수정은 해당 날짜를 선택한 뒤 `선택한 날짜의 행사` 목록에서 기존 행사를 고르고 `행사 수정 저장`을 누릅니다.
삭제는 기존 행사를 선택한 뒤 `선택한 행사 삭제`를 누릅니다.
