# 주의울림 V33 — YouTube 찬양 검색 · 주일 플레이리스트

## 추가 기능
- 학생 메뉴에 `찬양` 탭 추가
- 이번 주 주일에 등록된 찬양만 자동 표시
- YouTube 영상 플레이어
- 재생 / 일시정지 / 이전곡 / 다음곡 / 볼륨 / 자동 다음곡
- 플레이리스트에서 원하는 곡을 눌러 바로 재생
- 관리자 메뉴에 `찬양 관리` 탭 추가
- 찬양 제목을 YouTube에서 검색하고 썸네일 확인 후 즉시 등록
- 선택한 주일별로 플레이리스트 구성
- 등록된 곡 순서 위/아래 이동 및 삭제
- 영상 URL을 수동으로 입력할 필요 없음

## 적용 순서
1. Supabase SQL Editor에서 `feature_update_v33.sql` 전체 실행
2. Google Cloud에서 YouTube Data API v3 활성화 후 API 키 1개 생성
3. API 키는 가능하면 `YouTube Data API v3`만 사용하도록 API 제한
4. 웹사이트 제한에는 실제 GitHub Pages 주소를 HTTP referrer로 등록 권장
5. GitHub의 `index.html`, `app.js`, `styles.css`, `sw.js`, `manifest.json` 교체
6. 앱 관리자 → `찬양 관리` → YouTube API 키를 최초 1회 저장
7. 주일 선택 → 찬양 제목 검색 → 썸네일 확인 → `주일 찬양에 추가`
8. 학생 화면 → `찬양` 탭에서 재생

## 주의
- YouTube API 키는 학생에게 공개 조회되지 않도록 `youth_app_settings` 테이블에서 관리자만 읽게 구성했습니다.
- 브라우저에서 YouTube 검색 API를 호출하므로 Google Cloud에서 HTTP referrer 제한을 권장합니다.
- YouTube에서 임베드를 허용하지 않는 영상은 플레이어에서 재생되지 않을 수 있습니다.
- 첫 곡은 브라우저 자동재생 정책 때문에 학생이 `재생`을 한 번 눌러야 합니다. 이후 `자동 다음곡`이 켜져 있으면 다음 곡으로 이어집니다.
