# V43 공지사항 기존 글 수정/저장 안정화

1. Supabase SQL Editor에서 `feature_update_v43.sql` 전체 실행
2. GitHub에서 `app.js`, `sw.js` 교체 (전체 교체 시 index.html/styles.css도 기존 V42 그대로 포함)
3. Ctrl+F5
4. 관리자 > 공지사항 > 등록된 공지 선택 > 내용 수정 > `공지 수정 저장`
5. 저장 후 같은 공지가 선택된 상태로 유지되고 DB 재조회 검증까지 수행
