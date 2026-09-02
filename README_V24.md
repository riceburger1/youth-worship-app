# 주의울림 V24 - 내 정보 독립 탭 / 공통 프로필 연동

## 변경 내용
- 학생 화면의 기존 상단 `내 정보` 입력란을 제거하고 `내 정보` 독립 탭으로 이동
- 저장 정보: 학년 + 이름
- 기존 localStorage 키 `주의울림-profile-v2` 유지 (기존 학생 정보 자동 승계)
- 저장된 내 정보가 다음 기록에 자동 연동됨
  - 말씀쓰기/출석 -> attendance.grade, attendance.student_name
  - 성경공부 -> study_submissions.grade, study_submissions.student_name
  - 기도제목 -> prayer_requests.grade, prayer_requests.student_name
  - 감사기도 -> gratitude_prayers.grade, gratitude_prayers.student_name
- 위 네 화면에 현재 연동 중인 학년/이름 표시
- 내 정보가 없으면 제출 시 자동으로 `내 정보` 탭으로 이동
- 처음 접속한 학생에게 저장된 프로필이 없으면 `내 정보` 탭을 먼저 표시
- 익명게시판은 익명성 보호를 위해 내 정보와 연결하지 않음
- 관리자 화면/주일별 통계 구조는 기존 V23/V22 방식을 유지

## 설치
Supabase SQL 추가 실행은 필요 없습니다.
GitHub의 아래 파일을 교체하세요.
- index.html
- app.js
- styles.css
- sw.js
- manifest.json

적용 후 Ctrl+F5로 새로고침하세요.
Service Worker cache: `주의울림-v24-profile-tab-linked-records`
