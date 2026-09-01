# 주의울림 공지사항 편집 V9

변경사항
- 관리자: 등록된 공지를 선택해 수정 저장 가능
- 관리자: 새 공지 등록 가능
- 공지 수정/등록은 `youth_admin_save_notice` RPC로 처리
- 사용자: 최상단에는 가장 최근 등록된 공개 공지 1개만 표시
- 사용자: 공지사항 탭에서 최신 공지와 지난 공지 전체 확인
- 최신 공개 공지는 상단에 자동 표시
- 기존 말씀·성경공부·감사기도 기능 유지

적용 순서
1. Supabase SQL Editor에서 `admin_notice_editor_v6.sql` 전체 실행
2. GitHub에서 index.html, app.js, styles.css, sw.js 교체
3. GitHub Pages 배포 후 Ctrl+F5
4. 관리자 화면에서 `관리자 콘텐츠 편집 v9 준비 완료.` 문구 확인
