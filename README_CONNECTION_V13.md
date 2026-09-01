# 주의울림 Supabase 연결 수정 V13

이번 수정은 DB 테이블/정책을 변경하지 않습니다. SQL 실행이 필요 없습니다.

## 원인 점검 결과
- Supabase Project URL: 유지
- Publishable Key: 유지
- app.js 문법/DOM 연결: 확인
- 브라우저용 Supabase JS 로더를 jsDelivr +esm 단독 방식에서 esm.sh 우선 + jsDelivr 보조 방식으로 변경
- 화면에 Supabase 연결 상태 표시 및 `다시 연결` 버튼 추가
- Service Worker 캐시를 v13으로 변경

## GitHub 교체 파일
1. index.html
2. app.js
3. styles.css
4. sw.js

## 적용 후
1. GitHub Pages 배포 완료 대기
2. Ctrl + F5
3. 상단 연결 상태 확인
   - `Supabase 데이터 연결 정상` → 정상
   - `[42501]` → 연결은 됐고 DB 권한 문제
   - `[PGRST...]` → 연결은 됐고 DB 테이블/함수 설정 문제
   - `Supabase 서버에 연결하지 못했습니다` → 네트워크/API/CDN 문제
4. 예전 화면이면 F12 → Application → Service Workers → Unregister → Storage → Clear site data
