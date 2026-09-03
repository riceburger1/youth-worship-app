// Supabase JS 브라우저 ESM 로더
// jsDelivr +esm 변환 오류를 피하기 위해 esm.sh를 우선 사용하고, 실패 시 jsDelivr를 보조로 시도합니다.
let createClient;
try {
  ({ createClient } = await import("https://esm.sh/@supabase/supabase-js@2.112.4"));
} catch (esmError) {
  console.warn("esm.sh에서 Supabase JS 로드 실패, 보조 CDN을 시도합니다.", esmError);
  ({ createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.4/+esm"));
}

const SUPABASE_URL = "https://jdnxmkkyusktfiavfdwb.supabase.co";
const SUPABASE_KEY = "sb_publishable_swA-gv1uwixyiN-qZUYLzQ_J6oqxGiI";
const db = createClient(SUPABASE_URL, SUPABASE_KEY);
const APP_VERSION = "v29-word-practice-gratitude-sync-study-min10";
const ADMIN_WINDOW = new URLSearchParams(window.location.search).get("admin") === "1";
console.info("주의울림 앱 버전:", APP_VERSION);

const $ = (q) => document.querySelector(q);
const $$ = (q) => [...document.querySelectorAll(q)];
const clean = (s) => String(s ?? "").replace(/\s+/g," ").trim();
const normalize = (s) => clean(s).replace(/\s/g,"");
const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));


function dbErrorMessage(error, fallback = "처리 중 오류가 발생했습니다.") {
  if (!error) return fallback;
  console.error("Supabase error:", error);
  const code = error.code ? ` [${error.code}]` : "";
  const extra = [error.message, error.details, error.hint].filter(Boolean).join(" · ");
  if (error.code === "42501") return `저장 권한이 없습니다.${code}${extra ? ` · ${extra}` : ""}`;
  if (error.code === "23505") return `같은 날짜/순서의 데이터가 이미 있습니다.${code}${extra ? ` · ${extra}` : ""}`;
  if (error.code === "23503") return `연결된 데이터가 없어 저장할 수 없습니다.${code}${extra ? ` · ${extra}` : ""}`;
  if (error.code === "42703") return `데이터베이스 칼럼 구성이 앱과 다릅니다.${code}${extra ? ` · ${extra}` : ""}`;
  if (["PGRST202","PGRST205"].includes(error.code)) return `${fallback}${code}${extra ? ` · ${extra}` : ""}`;
  return `${fallback}${code}${extra ? ` · ${extra}` : ""}`;
}


function isMissingRpc(error, functionName = "") {
  if (!error) return false;
  const message = String(error.message || "");
  return ["PGRST202", "42883"].includes(error.code) || (functionName && message.includes(functionName));
}


async function checkSupabaseConnection({reloadData=false} = {}) {
  const bar = $("#supabaseConnection");
  const text = $("#supabaseConnectionText");
  const retry = $("#retryConnectionBtn");
  if (!bar || !text || !retry) return false;

  bar.classList.remove("connected", "error");
  bar.classList.add("checking");
  text.textContent = "Supabase 연결 확인 중…";
  retry.disabled = true;

  try {
    const { error } = await db.from("weekly_contents").select("id").limit(1);
    if (error) {
      console.error("Supabase connection test error:", error);
      bar.classList.remove("checking");

      // API 응답이 왔으므로 네트워크 연결 자체는 된 상태입니다.
      if (error.code === "42501") {
        bar.classList.add("error");
        text.textContent = "Supabase는 연결됐지만 데이터 권한 오류가 있습니다. [42501]";
      } else if (["PGRST202","PGRST204","PGRST205"].includes(error.code)) {
        bar.classList.add("error");
        text.textContent = `Supabase는 연결됐지만 DB 설정 확인이 필요합니다. [${error.code}]`;
      } else {
        bar.classList.add("error");
        text.textContent = `Supabase 연결 오류${error.code ? ` [${error.code}]` : ""}: ${error.message || "응답을 확인하지 못했습니다."}`;
      }
      retry.disabled = false;
      return false;
    }

    bar.classList.remove("checking", "error");
    bar.classList.add("connected");
    text.textContent = "Supabase 데이터 연결 정상";
    retry.disabled = false;

    if (reloadData) {
      await Promise.all([loadWeekly(), loadNotices(), loadBoard(), loadPublicEventCalendar(), loadGratitudeLeaders()]);
      if (isAdmin) {
        await refreshActiveAdminTab(activeAdminTab);
      }
    }
    return true;
  } catch (error) {
    console.error("Supabase connection exception:", error);
    bar.classList.remove("checking", "connected");
    bar.classList.add("error");
    text.textContent = `Supabase 서버에 연결하지 못했습니다: ${error?.message || "네트워크 연결을 확인해 주세요."}`;
    retry.disabled = false;
    return false;
  }
}

let weekly = null;
let questions = [];
let deferredPrompt = null;
let isAdmin = false;
let gratitudeCalendarCursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let gratitudeEditingDate = null;
let adminWordId = null;
let adminStudyId = null;
let adminWeeklyRows = [];
let adminNoticeId = null;
let adminNoticeRows = [];
let eventCalendarCursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let adminEventCalendarCursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let publicEventRows = [];
let adminEventRows = [];
let selectedAdminEventDate = null;
let selectedAdminEventId = null;
let activeAdminTab = sessionStorage.getItem("주의울림-admin-tab-v17") || "word";

const PROFILE_STORAGE_KEY = "주의울림-profile-v2";
const GRATITUDE_PREFIX = "주의울림-gratitude-v2:";
const GRATITUDE_EDIT_TOKEN_PREFIX = "주의울림-gratitude-edit-token-v27:";
const GRATITUDE_SYNC_SIGNAL_KEY = "주의울림-gratitude-sync-signal-v29";
const gratitudeSyncChannel = "BroadcastChannel" in window ? new BroadcastChannel("주의울림-gratitude-sync-v29") : null;
let gratitudeSyncTimer = null;
let wordModeTimer = null;

function profile() {
  return { grade: $("#grade")?.value || "", name: clean($("#studentName")?.value || "") };
}
function profileReady(p = profile()) {
  return Boolean(p.grade && p.name);
}
function updateProfileLinkedUI(p = profile()) {
  const ready = profileReady(p);
  const text = ready
    ? `현재 기록 정보: ${p.grade} ${p.name} · 제출 시 관리자 기록에 함께 저장됩니다.`
    : "오른쪽 위 내 정보에서 학년과 이름을 입력하면 이 기록에 자동으로 연결됩니다.";
  $$('[data-profile-display]').forEach(el => { el.textContent = text; });
  return ready;
}
function persistProfile({feedback=false} = {}) {
  const p = profile();
  const ready = updateProfileLinkedUI(p);
  const status = $("#profileStatus");
  if (!ready) {
    if (feedback && status) status.textContent = "학년과 이름을 모두 입력해 주세요.";
    return false;
  }
  localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(p));
  if (feedback && status) status.textContent = `${p.grade} ${p.name} 학생 정보가 저장되었습니다. 말씀쓰기·성경공부·기도제목·감사기도에 자동 연동됩니다.`;
  renderGratitudeChallenge();
  return true;
}
function restoreProfile() {
  try {
    const p = JSON.parse(localStorage.getItem(PROFILE_STORAGE_KEY) || "null");
    if (p?.grade && $("#grade")) $("#grade").value = p.grade;
    if (p?.name && $("#studentName")) $("#studentName").value = p.name;
  } catch {}
  const restored = profile();
  updateProfileLinkedUI(restored);
  const status = $("#profileStatus");
  if (status) {
    status.textContent = profileReady(restored)
      ? `저장된 내 정보: ${restored.grade} ${restored.name}`
      : "학년과 이름을 입력해 주세요.";
  }
  return restored;
}
function setProfilePanel(open, {scroll=false, focus=false} = {}) {
  const panel = $("#profile");
  const btn = $("#profileHeaderBtn");
  if (!panel) return;
  panel.classList.toggle("hidden", !open);
  panel.setAttribute("aria-hidden", open ? "false" : "true");
  if (btn) {
    btn.classList.toggle("active", open);
    btn.setAttribute("aria-pressed", open ? "true" : "false");
  }
  if (open && scroll) requestAnimationFrame(() => panel.scrollIntoView({behavior:"smooth", block:"start"}));
  if (open && focus) requestAnimationFrame(() => {
    const target = profileReady() ? $("#studentName") : ($("#grade") || $("#studentName"));
    target?.focus({preventScroll:true});
  });
}
function activateStudentTab(tabName) {
  if (tabName === "profile") {
    setProfilePanel(true, {scroll:true, focus:true});
    return;
  }
  const target = $("#" + tabName);
  if (!target) return;
  setProfilePanel(false);
  $$(".tab").forEach(btn => btn.classList.toggle("active", btn.dataset.tab === tabName));
  $$("main .panel").forEach(panel => panel.classList.add("hidden"));
  target.classList.remove("hidden");
  if (tabName === "gratitude") {
    renderGratitudeChallenge();
    void refreshGratitudeStudentFromServer();
  }
}
function requireProfile(statusEl) {
  const p = profile();
  if (!profileReady(p)) {
    if (statusEl) statusEl.textContent = "오른쪽 위 내 정보에서 학년과 이름을 먼저 입력해 주세요.";
    setProfilePanel(true, {scroll:true, focus:true});
    return null;
  }
  // 제출할 때마다 현재 공통 프로필을 다시 저장해 네 가지 기록이 동일한 학년·이름을 사용하도록 합니다.
  persistProfile({feedback:false});
  return p;
}
function fmtDate(v) {
  if (!v) return "일정 미정";
  const [y,m,d] = v.split("-").map(Number);
  return `${y}. ${m}. ${d}.`;
}
function localISODate(date = new Date()) {
  return [date.getFullYear(), String(date.getMonth()+1).padStart(2,"0"), String(date.getDate()).padStart(2,"0")].join("-");
}
function addDaysISO(iso, days) {
  const [y,m,d] = iso.split("-").map(Number);
  const date = new Date(y,m-1,d);
  date.setDate(date.getDate()+days);
  return localISODate(date);
}

function wordRegistrationState(content = weekly) {
  if (!content?.week_start) return { canRegister:false, sunday:null, openAt:null, label:"주일 날짜를 확인할 수 없어 연습모드로 동작합니다." };
  const sunday = addDaysISO(String(content.week_start).slice(0,10), 6);
  const openAt = new Date(`${sunday}T10:30:00+09:00`);
  const canRegister = Date.now() >= openAt.getTime();
  return {
    canRegister,
    sunday,
    openAt,
    label: canRegister
      ? `${fmtDate(sunday)} 주일 오전 10:30부터 출석 등록이 가능합니다.`
      : `${fmtDate(sunday)} 주일 오전 10:30 전에는 연습모드입니다. 따라쓰기는 가능하지만 출석 기록은 저장되지 않습니다.`
  };
}

function isVerseExact() {
  return Boolean(weekly?.verse_text) && normalize($("#verseInput")?.value || "") === normalize(weekly.verse_text);
}

function updateWordModeUI({updateStatus=false} = {}) {
  const notice = $("#wordModeNotice");
  const badge = $("#wordModeBadge");
  const text = $("#wordModeText");
  const btn = $("#completeWordBtn");
  if (!notice || !badge || !text || !btn) return;
  const state = wordRegistrationState();
  notice.classList.toggle("practice", !state.canRegister);
  notice.classList.toggle("open", state.canRegister);
  badge.textContent = state.canRegister ? "출석등록 가능" : "연습모드";
  text.textContent = state.label;
  btn.textContent = state.canRegister ? "말씀쓰기 완료 및 출석" : "연습 완료 확인";
  btn.disabled = !isVerseExact();
  if (updateStatus && weekly) {
    $("#wordStatus").textContent = state.canRegister
      ? "말씀을 직접 입력해 주세요. 정확히 완성하면 출석을 등록할 수 있습니다."
      : "지금은 연습모드입니다. 말씀을 직접 따라 써 보세요.";
  }
}

function startWordModeClock() {
  if (wordModeTimer) clearInterval(wordModeTimer);
  updateWordModeUI();
  wordModeTimer = setInterval(() => updateWordModeUI(), 30000);
}
function gratitudeStorageKey(p) {
  return `${GRATITUDE_PREFIX}${encodeURIComponent(p.grade)}:${encodeURIComponent(p.name.toLowerCase())}`;
}
function getLocalGratitude(p) {
  if (!p?.grade || !p?.name) return [];
  try {
    const rows = JSON.parse(localStorage.getItem(gratitudeStorageKey(p)) || "[]");
    return Array.isArray(rows) ? rows : [];
  } catch { return []; }
}
function setLocalGratitude(p, rows) {
  localStorage.setItem(gratitudeStorageKey(p), JSON.stringify(rows.slice(0,365)));
}
function gratitudeEditTokenKey(p) {
  return `${GRATITUDE_EDIT_TOKEN_PREFIX}${encodeURIComponent(p.grade)}:${encodeURIComponent(p.name.toLowerCase())}`;
}
function getGratitudeEditToken(p) {
  if (!p?.grade || !p?.name) return null;
  const key = gratitudeEditTokenKey(p);
  let token = localStorage.getItem(key);
  if (!token) {
    token = globalThis.crypto?.randomUUID?.() || "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16);
    });
    localStorage.setItem(key, token);
  }
  return token;
}
async function syncGratitudeRecordsFromServer({quiet=true} = {}) {
  if (ADMIN_WINDOW) return false;
  const p = profile();
  if (!profileReady(p)) return false;
  const localRows = getLocalGratitude(p);
  const token = getGratitudeEditToken(p);
  const { data, error } = await db.rpc("youth_gratitude_sync_v29", {
    p_grade:p.grade,
    p_student_name:p.name,
    p_edit_token:token,
    p_local_records:localRows.map(row => ({date:row.date, text:row.text || ""}))
  });
  if (error) {
    if (!isMissingRpc(error, "youth_gratitude_sync_v29") && !quiet && $("#gratitudeStatus")) {
      $("#gratitudeStatus").textContent = dbErrorMessage(error, "감사기도 기록 동기화에 실패했습니다.");
    }
    return false;
  }
  const serverRows = (data || []).map(row => ({
    date:String(row.prayer_date || "").slice(0,10),
    text:row.gratitude_text || "",
    createdAt:row.created_at || new Date().toISOString(),
    updatedAt:row.updated_at || row.created_at || new Date().toISOString()
  })).filter(row => row.date);
  setLocalGratitude(p, serverRows);
  if (gratitudeEditingDate && !serverRows.some(row => row.date === gratitudeEditingDate)) {
    resetGratitudeEditor();
    if ($("#gratitudeStatus")) $("#gratitudeStatus").textContent = "관리자에서 삭제된 감사기도 기록이 챌린지 화면에도 반영되었습니다.";
  }
  renderGratitudeChallenge();
  return true;
}

async function refreshGratitudeStudentFromServer() {
  await Promise.all([syncGratitudeRecordsFromServer(), loadGratitudeLeaders()]);
}

function signalGratitudeServerChanged() {
  const value = String(Date.now());
  try { localStorage.setItem(GRATITUDE_SYNC_SIGNAL_KEY, value); } catch {}
  try { gratitudeSyncChannel?.postMessage({type:"gratitude-server-changed", at:value}); } catch {}
}

async function handleGratitudeServerChanged() {
  if (ADMIN_WINDOW) return;
  await refreshGratitudeStudentFromServer();
}

gratitudeSyncChannel?.addEventListener("message", event => {
  if (event.data?.type === "gratitude-server-changed") void handleGratitudeServerChanged();
});
window.addEventListener("storage", event => {
  if (event.key === GRATITUDE_SYNC_SIGNAL_KEY) void handleGratitudeServerChanged();
});
window.addEventListener("focus", () => {
  if (!ADMIN_WINDOW && $("#gratitude") && !$("#gratitude").classList.contains("hidden")) void refreshGratitudeStudentFromServer();
});
if (!ADMIN_WINDOW) {
  gratitudeSyncTimer = setInterval(() => {
    if ($("#gratitude") && !$("#gratitude").classList.contains("hidden")) void refreshGratitudeStudentFromServer();
  }, 15000);
}

function gratitudeTextLength(value) {
  return clean(value).length;
}
function updateGratitudeCharCount() {
  const len = gratitudeTextLength($("#gratitudeText")?.value || "");
  const counter = $("#gratitudeCharCount");
  if (counter) {
    counter.textContent = len >= 10 ? `${len}자 · 저장 가능 ✓` : `${len}자 · 최소 10자`;
    counter.classList.toggle("ready", len >= 10);
  }
  const submitBtn = $("#gratitudeSubmitBtn");
  if (submitBtn) {
    const p = profile();
    const doneToday = profileReady(p) && getLocalGratitude(p).some(x => x.date === localISODate());
    submitBtn.disabled = len < 10 || (!gratitudeEditingDate && doneToday);
  }
}
function resetGratitudeEditor({clear=true} = {}) {
  gratitudeEditingDate = null;
  if (clear && $("#gratitudeText")) $("#gratitudeText").value = "";
  $("#gratitudeSubmitBtn").textContent = "오늘 감사기도 기록하기";
  $("#gratitudeEditCancelBtn")?.classList.add("hidden");
  $("#gratitudeEditHint")?.classList.add("hidden");
  if ($("#gratitudeEditHint")) $("#gratitudeEditHint").textContent = "";
  updateGratitudeCharCount();
}
function startGratitudeEdit(date) {
  const p = requireProfile($("#gratitudeStatus"));
  if (!p) return;
  const row = getLocalGratitude(p).find(x => x.date === date);
  if (!row) {
    $("#gratitudeStatus").textContent = "이 기기에 저장된 감사기도만 수정할 수 있습니다.";
    return;
  }
  gratitudeEditingDate = date;
  $("#gratitudeText").value = row.text || "";
  $("#gratitudeSubmitBtn").disabled = false;
  $("#gratitudeSubmitBtn").textContent = "감사기도 수정 저장";
  $("#gratitudeEditCancelBtn")?.classList.remove("hidden");
  if ($("#gratitudeEditHint")) {
    $("#gratitudeEditHint").textContent = `${fmtDate(date)} 기록을 수정하고 있습니다.`;
    $("#gratitudeEditHint").classList.remove("hidden");
  }
  $("#gratitudeStatus").textContent = "오타나 내용을 고친 뒤 ‘감사기도 수정 저장’을 눌러 주세요.";
  updateGratitudeCharCount();
  $("#gratitudeText")?.focus();
  $("#gratitudeText")?.scrollIntoView({behavior:"smooth", block:"center"});
}
function streakStats(rows) {
  const dates = [...new Set(rows.map(x=>x.date).filter(Boolean))].sort();
  if (!dates.length) return {current:0,best:0};
  let best=1, run=1;
  for (let i=1;i<dates.length;i++) {
    if (dates[i] === addDaysISO(dates[i-1],1)) run++;
    else run=1;
    best=Math.max(best,run);
  }
  const today=localISODate();
  const yesterday=addDaysISO(today,-1);
  const latest=dates[dates.length-1];
  if (![today,yesterday].includes(latest)) return {current:0,best};
  let current=1;
  for (let i=dates.length-1;i>0;i--) {
    if (dates[i-1] === addDaysISO(dates[i],-1)) current++;
    else break;
  }
  return {current,best};
}
function activeStreakDates(rows, stats) {
  if (!stats.current) return new Set();
  const dates = new Set(rows.map(x=>x.date).filter(Boolean));
  const today = localISODate();
  const yesterday = addDaysISO(today,-1);
  let last = dates.has(today) ? today : (dates.has(yesterday) ? yesterday : null);
  if (!last) return new Set();
  const active = new Set();
  for (let i=0;i<stats.current;i++) active.add(addDaysISO(last,-i));
  return active;
}
function renderGratitudeCalendar(rows, stats, ready) {
  const year = gratitudeCalendarCursor.getFullYear();
  const month = gratitudeCalendarCursor.getMonth();
  const monthKey = `${year}-${String(month+1).padStart(2,"0")}`;
  const today = localISODate();
  const todayObj = new Date();
  const currentMonthKey = `${todayObj.getFullYear()}-${String(todayObj.getMonth()+1).padStart(2,"0")}`;
  const firstDay = new Date(year, month, 1).getDay();
  const lastDate = new Date(year, month+1, 0).getDate();
  const recorded = new Set(rows.map(x=>x.date));
  const active = activeStreakDates(rows, stats);
  const cells = [];
  for (let i=0;i<firstDay;i++) cells.push('<span class="calendar-day empty" aria-hidden="true"></span>');
  for (let day=1;day<=lastDate;day++) {
    const iso = `${monthKey}-${String(day).padStart(2,"0")}`;
    const isRecorded = recorded.has(iso);
    const isToday = iso === today;
    const isFuture = iso > today;
    const icon = isRecorded ? (active.has(iso) ? "🔥" : "✅") : "";
    const classes = ["calendar-day", isRecorded?"recorded":"", active.has(iso)?"active-streak":"", isToday?"today":"", isFuture?"future":""].filter(Boolean).join(" ");
    const label = `${year}년 ${month+1}월 ${day}일${isRecorded ? " 감사기도 기록 완료" : ""}${isToday ? " 오늘" : ""}`;
    cells.push(`<span class="${classes}" role="gridcell" aria-label="${label}"><span class="day-number">${day}</span><span class="day-mark" aria-hidden="true">${icon}</span></span>`);
  }
  $("#gratitudeCalendar").innerHTML = cells.join("");
  $("#gratitudeCalendarMonth").textContent = `${year}년 ${month+1}월`;
  const monthCount = rows.filter(x=>String(x.date).startsWith(monthKey)).length;
  $("#gratitudeMonthCount").textContent = `${month+1}월 ${monthCount}일 기록`;
  $("#gratitudeCalendarHint").textContent = ready ? (monthCount ? "🔥는 현재 이어지는 연속 기록, ✅는 완료한 기록입니다." : "아직 이 달의 기록이 없습니다.") : "내 정보를 입력하면 나의 감사 기록을 표시합니다.";
  $("#gratitudeNextMonth").disabled = monthKey >= currentMonthKey;
}
function renderGratitudeBadges(stats, ready) {
  const badges = [
    {days:7, icon:"🏅", title:"7일 감사습관", desc:"7일 연속 감사기도 달성"},
    {days:30, icon:"🏆", title:"30일 감사습관", desc:"30일 연속 감사기도 달성"}
  ];
  const unlockedCount = badges.filter(b=>stats.best>=b.days).length;
  $("#gratitudeBadgeCount").textContent = `${unlockedCount}/2`;
  $("#gratitudeBadges").innerHTML = badges.map(b=>{
    const unlocked = stats.best >= b.days;
    const progress = unlocked ? b.days : Math.min(stats.current,b.days);
    const pct = Math.round(progress / b.days * 100);
    return `<article class="challenge-badge ${unlocked?"unlocked":"locked"}">
      <div class="badge-icon" aria-hidden="true">${unlocked?b.icon:"🔒"}</div>
      <div class="badge-copy"><div class="badge-title-row"><strong>${b.title}</strong><span>${unlocked?"달성!":`${progress}/${b.days}일`}</span></div>
      <p>${unlocked?`${b.desc} 배지를 획득했습니다!`:ready?`${b.days}일을 연속으로 기록하면 배지가 열립니다.`:"내 정보를 입력하고 챌린지를 시작해 보세요."}</p>
      <div class="badge-progress" aria-label="${b.title} 진행률 ${pct}%"><span style="width:${pct}%"></span></div></div>
    </article>`;
  }).join("");
}
async function loadGratitudeLeaders() {
  if (ADMIN_WINDOW || !$("#gratitudeLeaderList")) return;
  const list = $("#gratitudeLeaderList");
  const status = $("#gratitudeLeaderStatus");
  if (status) status.textContent = "챌린지 현황을 불러오는 중입니다…";
  const { data, error } = await db.rpc("youth_gratitude_leaderboard_v27");
  if (error) {
    list.innerHTML = "";
    if (status) status.textContent = isMissingRpc(error, "youth_gratitude_leaderboard_v27")
      ? "감사기도 챌린지 현황 기능을 사용하려면 V27 SQL을 먼저 실행해 주세요."
      : dbErrorMessage(error, "감사기도 챌린지 현황을 불러오지 못했습니다.");
    return;
  }
  const rows = (data || []).filter(row => Number(row.current_streak || 0) > 0);
  if (!rows.length) {
    list.innerHTML = '<div class="gratitude-leader-empty">아직 연속 챌린지를 이어가는 학생이 없습니다. 오늘 첫 기록을 시작해 보세요! 🔥</div>';
    if (status) status.textContent = "감사기도를 오늘 또는 어제까지 이어온 학생이 여기에 표시됩니다.";
    return;
  }
  list.innerHTML = rows.map((row,index)=>`
    <article class="gratitude-leader-chip ${index===0?"top":""}">
      <span class="gratitude-leader-rank">${index===0?"🏆":`${index+1}`}</span>
      <div><b>${escapeHtml(row.grade)} ${escapeHtml(row.student_name)}</b><small>현재 연속</small></div>
      <strong>🔥 ${Number(row.current_streak || 0)}일</strong>
    </article>`).join("");
  if (status) status.textContent = `${rows.length}명이 감사기도 챌린지를 이어가고 있습니다.`;
}

function renderGratitudeChallenge() {
  const p = profile();
  const ready = Boolean(p.grade && p.name);
  const rows = ready ? getLocalGratitude(p).sort((a,b)=>String(b.date).localeCompare(String(a.date))) : [];
  const stats = streakStats(rows);
  const today = localISODate();
  const doneToday = rows.some(x=>x.date===today);
  $("#gratitudeStreak").textContent = `${stats.current}일`;
  $("#gratitudeBest").textContent = `${stats.best}일`;
  $("#gratitudeToday").textContent = doneToday ? "완료 ✓" : "미기록";
  $("#gratitudeCount").textContent = `${rows.length}회`;
  $("#gratitudeSubmitBtn").disabled = !gratitudeEditingDate && doneToday;
  renderGratitudeCalendar(rows, stats, ready);
  renderGratitudeBadges(stats, ready);
  updateGratitudeCharCount();
  if (!ready) {
    $("#gratitudeHistory").innerHTML = '<p class="muted">내 정보에서 학년과 이름을 입력하면 챌린지 기록이 표시됩니다.</p>';
    return;
  }
  $("#gratitudeHistory").innerHTML = rows.length ? rows.slice(0,14).map((r,i)=>`
    <article class="gratitude-record ${i===0&&r.date===today?"today":""}">
      <div class="gratitude-record-head">
        <div class="gratitude-date"><span>${fmtDate(r.date)}</span>${r.date===today?'<b>오늘</b>':''}</div>
        <button class="ghost compact-btn gratitude-edit-btn" type="button" data-gratitude-date="${escapeHtml(r.date)}">수정</button>
      </div>
      <p>${escapeHtml(r.text || "감사기도 기록 완료")}</p>
    </article>`).join("") : '<p class="muted">아직 기록이 없습니다. 오늘 첫 감사기도를 남겨 보세요.</p>';
}


const restoredProfile = restoreProfile();
$("#grade").addEventListener("change", () => {
  updateProfileLinkedUI();
  if (profileReady()) persistProfile({feedback:false});
});
$("#studentName").addEventListener("input", () => {
  updateProfileLinkedUI();
  const status = $("#profileStatus");
  if (status) status.textContent = profileReady() ? "입력한 정보를 저장해 주세요." : "학년과 이름을 모두 입력해 주세요.";
});
$("#studentName").addEventListener("change", () => {
  if (profileReady()) persistProfile({feedback:false});
});
$("#saveProfileBtn").addEventListener("click", () => persistProfile({feedback:true}));

$$(".tab").forEach(btn => btn.addEventListener("click", () => activateStudentTab(btn.dataset.tab)));
$("#profileHeaderBtn")?.addEventListener("click", () => {
  const isOpen = !$("#profile")?.classList.contains("hidden");
  setProfilePanel(!isOpen, {scroll:!isOpen, focus:!isOpen});
});
$("#closeProfileBtn")?.addEventListener("click", () => setProfilePanel(false));
if (!ADMIN_WINDOW && !profileReady(restoredProfile)) setProfilePanel(true, {scroll:false, focus:false});
$("#gratitudePrevMonth").addEventListener("click", () => {
  gratitudeCalendarCursor = new Date(gratitudeCalendarCursor.getFullYear(), gratitudeCalendarCursor.getMonth()-1, 1);
  renderGratitudeChallenge();
});
$("#gratitudeNextMonth").addEventListener("click", () => {
  const now = new Date();
  const next = new Date(gratitudeCalendarCursor.getFullYear(), gratitudeCalendarCursor.getMonth()+1, 1);
  const current = new Date(now.getFullYear(), now.getMonth(), 1);
  if (next <= current) gratitudeCalendarCursor = next;
  renderGratitudeChallenge();
});
$("#gratitudeText")?.addEventListener("input", updateGratitudeCharCount);
$("#gratitudeEditCancelBtn")?.addEventListener("click", () => {
  resetGratitudeEditor();
  renderGratitudeChallenge();
  $("#gratitudeStatus").textContent = "수정을 취소했습니다.";
});
$("#gratitudeHistory")?.addEventListener("click", e => {
  const btn = e.target.closest(".gratitude-edit-btn");
  if (!btn) return;
  startGratitudeEdit(btn.dataset.gratitudeDate);
});
$("#refreshGratitudeLeaderBtn")?.addEventListener("click", loadGratitudeLeaders);
updateGratitudeCharCount();

window.addEventListener("beforeinstallprompt", e => {
  e.preventDefault();
  deferredPrompt = e;
  $("#installBtn").classList.remove("hidden");
});
$("#installBtn").addEventListener("click", async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  $("#installBtn").classList.add("hidden");
});
if ("serviceWorker" in navigator) window.addEventListener("load", async () => {
  try {
    const reg = await navigator.serviceWorker.register("./sw.js", { updateViaCache:"none" });
    await reg.update();
  } catch (err) { console.warn("Service worker update failed:", err); }
});

async function loadWeekly() {
  const { data, error } = await db.from("weekly_contents")
    .select("*").eq("published", true).order("week_start", {ascending:false}).limit(1).maybeSingle();
  if (error || !data) {
    $("#verseReference").textContent = "등록된 말씀이 없습니다.";
    $("#verseText").textContent = "관리자가 이번 주 말씀을 등록하면 표시됩니다.";
    $("#wordStatus").textContent = error ? "말씀을 불러오지 못했습니다." : "아직 등록된 말씀이 없습니다.";
    return;
  }
  weekly = data;
  $("#verseReference").textContent = data.verse_reference;
  $("#verseText").textContent = data.verse_text;
  $("#studyTitle").textContent = data.study_title;
  updateWordModeUI({updateStatus:true});
  startWordModeClock();
  await loadQuestions();
}

function studyAnswerLength(value) {
  return clean(value).length;
}

function updateStudyAnswerState() {
  const fields = $$('[data-answer]');
  const submitBtn = $("#studySubmitBtn");
  fields.forEach(field => {
    const index = field.dataset.answer;
    const len = studyAnswerLength(field.value);
    const counter = $(`[data-answer-count="${index}"]`);
    if (counter) {
      counter.textContent = len >= 10 ? `${len}자 · 등록 가능 ✓` : `${len}자 · 최소 10자`;
      counter.classList.toggle("ready", len >= 10);
    }
  });
  const ready = fields.length >= 2 && fields.every(field => studyAnswerLength(field.value) >= 10);
  if (submitBtn) submitBtn.disabled = !ready;
  return ready;
}

async function loadQuestions() {
  if (!weekly) return;
  const { data } = await db.from("study_questions").select("*")
    .eq("weekly_content_id", weekly.id).order("question_order");
  questions = data || [];
  $("#studyQuestions").innerHTML = questions.map((q,i)=>`
    <label class="field-label">${i+1}. ${escapeHtml(q.question_text)}
      <textarea data-answer="${i}" rows="4" minlength="10" maxlength="2000" required placeholder="내 생각을 10자 이상 적어 주세요."></textarea>
      <small class="study-answer-count" data-answer-count="${i}">0자 · 최소 10자</small>
    </label>`).join("");
  updateStudyAnswerState();
}

$("#studyQuestions")?.addEventListener("input", e => {
  if (e.target.closest("[data-answer]")) updateStudyAnswerState();
});

const verseInput = $("#verseInput");
["paste","drop"].forEach(type => verseInput.addEventListener(type, e => {
  e.preventDefault();
  $("#wordStatus").textContent = type === "paste"
    ? "복사·붙여넣기는 사용할 수 없습니다. 직접 입력해 주세요."
    : "드래그해서 넣을 수 없습니다. 직접 입력해 주세요.";
}));
verseInput.addEventListener("beforeinput", e => {
  if (["insertFromPaste","insertFromDrop"].includes(e.inputType)) {
    e.preventDefault();
    $("#wordStatus").textContent = "붙여넣기 입력은 사용할 수 없습니다.";
  }
});
verseInput.addEventListener("input", () => {
  if (!weekly) return;
  const input = normalize(verseInput.value);
  const target = normalize(weekly.verse_text);
  let matched = 0;
  const max = Math.min(input.length, target.length);
  while (matched < max && input[matched] === target[matched]) matched++;
  const pct = target.length ? Math.round(matched / target.length * 100) : 0;
  $("#progressText").textContent = pct + "%";
  $("#progressBar").style.width = Math.min(100,pct) + "%";
  const exact = input === target && target.length > 0;
  const mode = wordRegistrationState();
  $("#completeWordBtn").disabled = !exact;
  $("#completeWordBtn").textContent = mode.canRegister ? "말씀쓰기 완료 및 출석" : "연습 완료 확인";
  if (exact) {
    $("#wordStatus").textContent = mode.canRegister
      ? "말씀을 정확하게 완성했습니다. 출석을 등록할 수 있습니다."
      : `연습 완료! ${fmtDate(mode.sunday)} 주일 오전 10:30부터 출석 등록이 가능합니다.`;
  } else if (!input) {
    $("#wordStatus").textContent = mode.canRegister ? "말씀을 직접 입력해 주세요." : "연습모드입니다. 말씀을 직접 따라 써 보세요.";
  } else if (matched === input.length) {
    $("#wordStatus").textContent = "좋아요. 계속 입력해 주세요.";
  } else {
    $("#wordStatus").textContent = "다른 글자가 있습니다. 본문을 다시 확인해 주세요.";
  }
});

async function submitAttendance(p) {
  const rpc = await db.rpc("youth_submit_attendance_v1", {
    p_weekly_content_id: String(weekly.id),
    p_grade: p.grade,
    p_student_name: p.name
  });
  if (!rpc.error) return { status: String(rpc.data || "saved") };

  // SQL을 아직 적용하지 않은 환경에서는 기존 INSERT 방식으로 한 번 더 시도합니다.
  if (["PGRST202","42883"].includes(rpc.error.code) || String(rpc.error.message || "").includes("youth_submit_attendance_v1")) {
    const direct = await db.from("attendance").insert({
      weekly_content_id: weekly.id, grade:p.grade, student_name:p.name
    });
    if (direct.error) return { error: direct.error };
    return { status: "saved" };
  }
  return { error: rpc.error };
}

$("#completeWordBtn").addEventListener("click", async () => {
  const status = $("#wordStatus");
  if (!weekly) return;
  if (normalize(verseInput.value) !== normalize(weekly.verse_text)) return;

  const mode = wordRegistrationState();
  if (!mode.canRegister) {
    status.textContent = `연습 완료! 지금은 연습모드라 출석은 저장되지 않습니다. ${fmtDate(mode.sunday)} 주일 오전 10:30부터 등록할 수 있습니다.`;
    return;
  }

  const p = requireProfile(status);
  if (!p) return;
  $("#completeWordBtn").disabled = true;
  status.textContent = "말씀쓰기 완료와 출석을 저장하고 있습니다…";
  const result = await submitAttendance(p);

  if (result.error) {
    $("#completeWordBtn").disabled = false;
    status.textContent = result.error.code === "23505"
      ? "이미 이번 주 말씀쓰기 출석이 완료되어 있습니다."
      : dbErrorMessage(result.error, "말씀쓰기 출석 저장에 실패했습니다.");
    return;
  }

  if (result.status === "duplicate") {
    status.textContent = "이미 이번 주 말씀쓰기 출석이 완료되어 있습니다.";
  } else {
    status.textContent = "완료! 말씀쓰기와 출석이 기록되었습니다.";
  }
  $("#completeWordBtn").disabled = true;
});

$("#studyForm").addEventListener("submit", async e => {
  e.preventDefault();
  const status = $("#studyStatus");
  const p = requireProfile(status);
  if (!p || !weekly) return;

  const answers = $$('[data-answer]').map(x => clean(x.value));
  if (answers.length < 2) {
    status.textContent = "등록된 성경공부 질문이 2개 이상 있어야 제출할 수 있습니다.";
    return;
  }
  if (answers.some(x => !x)) {
    status.textContent = "모든 질문에 답을 작성해 주세요.";
    updateStudyAnswerState();
    return;
  }
  const shortIndex = answers.findIndex(x => x.length < 10);
  if (shortIndex >= 0) {
    status.textContent = `${shortIndex+1}번 답변을 10자 이상 작성해 주세요. 현재 ${answers[shortIndex].length}자입니다.`;
    $(`[data-answer="${shortIndex}"]`)?.focus();
    updateStudyAnswerState();
    return;
  }

  const submitBtn = e.target.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;
  status.textContent = "성경공부 답안을 저장하고 있습니다…";

  const { error } = await db.from("study_submissions").insert({
    weekly_content_id: weekly.id,
    grade: p.grade,
    student_name: p.name,
    answers
  });

  if (error) {
    if (submitBtn) submitBtn.disabled = false;
    status.textContent = error.code === "23505"
      ? "이미 이번 주 성경공부 답안을 제출했습니다."
      : dbErrorMessage(error, "성경공부 답안 저장에 실패했습니다.");
    return;
  }

  status.textContent = "성경공부 답안이 저장되었습니다.";
  e.target.reset();
  updateStudyAnswerState();
});

$("#prayerForm").addEventListener("submit", async e => {
  e.preventDefault();
  const status = $("#prayerStatus");
  const p = requireProfile(status);
  const text = clean($("#prayerText").value);
  if (!p) return;
  if (!text) { status.textContent = "기도제목을 입력해 주세요."; return; }

  const submitBtn = e.target.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;
  status.textContent = "기도제목을 저장하고 있습니다…";

  const { error } = await db.from("prayer_requests").insert({
    weekly_content_id: weekly?.id ?? null,
    grade:p.grade,
    student_name:p.name,
    prayer_text:text,
    is_private:$("#prayerPrivate").checked
  });

  if (submitBtn) submitBtn.disabled = false;
  if (error) {
    status.textContent = dbErrorMessage(error, "기도제목 제출에 실패했습니다.");
    return;
  }

  status.textContent = "기도제목이 제출되었습니다. 함께 기도할게요.";
  e.target.reset();
  $("#prayerPrivate").checked = true;
  if (isAdmin) await Promise.all([loadAdminPrayers(), loadAdminRecords()]);
});

$("#gratitudeForm").addEventListener("submit", async e => {
  e.preventDefault();
  const status = $("#gratitudeStatus");
  const p = requireProfile(status);
  if (!p) return;

  const text = clean($("#gratitudeText").value);
  const textLength = gratitudeTextLength(text);
  if (textLength < 10) {
    status.textContent = `감사기도를 10자 이상 적어 주세요. 현재 ${textLength}자입니다.`;
    $("#gratitudeText").focus();
    updateGratitudeCharCount();
    return;
  }

  const today = localISODate();
  const targetDate = gratitudeEditingDate || today;
  let localRows = getLocalGratitude(p);
  const existingLocal = localRows.find(x => x.date === targetDate) || null;
  const beforeStats = streakStats(localRows);

  if (!gratitudeEditingDate && localRows.some(x => x.date === today)) {
    status.textContent = "오늘 감사기도는 이미 기록했습니다. 최근 기록의 ‘수정’ 버튼을 눌러 내용을 고칠 수 있습니다.";
    renderGratitudeChallenge();
    return;
  }

  const submitBtn = $("#gratitudeSubmitBtn");
  submitBtn.disabled = true;
  status.textContent = gratitudeEditingDate ? "감사기도를 수정하고 있습니다…" : "감사기도를 기록하고 있습니다…";

  const editToken = getGratitudeEditToken(p);
  let result = await db.rpc("youth_gratitude_save_v27", {
    p_grade:p.grade,
    p_student_name:p.name,
    p_prayer_date:targetDate,
    p_gratitude_text:text,
    p_edit_token:editToken,
    p_original_text:existingLocal?.text || null
  });

  if (result.error && isMissingRpc(result.error, "youth_gratitude_save_v27") && !gratitudeEditingDate) {
    // V27 SQL 적용 전에도 신규 기록 자체는 기존 INSERT 정책으로 저장할 수 있도록 보조합니다.
    result = await db.from("gratitude_prayers").insert({
      grade:p.grade, student_name:p.name, prayer_date:today, gratitude_text:text
    });
  }

  if (result.error) {
    submitBtn.disabled = false;
    status.textContent = isMissingRpc(result.error, "youth_gratitude_save_v27")
      ? "감사기도 수정 기능을 사용하려면 Supabase에서 V27 SQL을 먼저 실행해 주세요."
      : dbErrorMessage(result.error, gratitudeEditingDate ? "감사기도 수정에 실패했습니다." : "감사기도 저장에 실패했습니다.");
    return;
  }

  const wasEditing = Boolean(gratitudeEditingDate);
  localRows = [{
    date:targetDate,
    text,
    createdAt:existingLocal?.createdAt || new Date().toISOString(),
    updatedAt:new Date().toISOString()
  }, ...localRows.filter(x=>x.date!==targetDate)];
  setLocalGratitude(p, localRows);
  resetGratitudeEditor();
  renderGratitudeChallenge();
  await loadGratitudeLeaders();
  signalGratitudeServerChanged();

  if (wasEditing) {
    status.textContent = `${fmtDate(targetDate)} 감사기도 내용이 수정되었습니다. 연속 기록은 그대로 유지됩니다. ✓`;
    if (isAdmin) await loadAdminGratitude();
    return;
  }

  const stats = streakStats(localRows);
  let badgeMessage = "";
  if (beforeStats.best < 30 && stats.best >= 30) badgeMessage = " 🏆 30일 감사습관 배지를 획득했습니다!";
  else if (beforeStats.best < 7 && stats.best >= 7) badgeMessage = " 🏅 7일 감사습관 배지를 획득했습니다!";
  status.textContent = `오늘의 감사기도 완료! 현재 ${stats.current}일 연속 기록 중입니다. 🔥${badgeMessage}`;
  if (isAdmin) await Promise.all([loadAdminGratitude(), loadAdminRecords()]);
});


async function loadNotices() {
  const { data, error } = await db.from("notices")
    .select("*")
    .eq("published", true)
    .order("created_at", {ascending:false});
  const rows = data || [];

  if (error) {
    $("#noticeList").innerHTML = '<p class="muted">공지사항을 불러오지 못했습니다.</p>';
    $("#bannerArea").innerHTML = '';
    return;
  }

  // 최상단에는 가장 최근 등록된 공개 공지 1개만 노출합니다.
  const latest = rows[0] || null;
  $("#bannerArea").innerHTML = latest ? `
    <article class="banner latest-notice-banner">
      <div class="latest-notice-label">최신 공지</div>
      <b>${escapeHtml(latest.title)}</b>
      <small>${fmtDate(latest.event_date)} · ${escapeHtml(latest.body)}</small>
    </article>` : '';

  // 공지사항 탭에서는 최신 공지를 포함해 지난 공지 전체를 확인할 수 있습니다.
  $("#noticeList").innerHTML = rows.length ? rows.map((n,index)=>`
    <article class="list-item notice-archive-item ${index===0 ? "notice-current" : "notice-past"}">
      <div class="notice-item-head">
        <div class="meta">${fmtDate(n.event_date)}</div>
        <span class="notice-state-badge">${index===0 ? "최신" : "지난 공지"}</span>
      </div>
      <h3>${escapeHtml(n.title)}</h3>
      <div>${escapeHtml(n.body).replace(/\n/g,"<br>")}</div>
    </article>`).join("")
    : '<p class="muted">등록된 공지사항이 없습니다.</p>';
}

$("#boardForm").addEventListener("submit", async e => {
  e.preventDefault();
  const body = clean($("#boardText").value);
  const status = $("#boardStatus");
  const submitBtn = e.submitter || e.target.querySelector('button[type="submit"]');
  if (!body) { status.textContent = "내용을 입력해 주세요."; return; }
  if (body.length > 2000) { status.textContent = "익명글은 2,000자 이내로 작성해 주세요."; return; }

  if (submitBtn) submitBtn.disabled = true;
  status.textContent = "익명글을 등록하고 있습니다…";
  const { error } = await db.from("anonymous_posts").insert({ body });
  if (error) {
    console.error("anonymous_posts insert error:", error);
    status.textContent = dbErrorMessage(error, "익명글 등록에 실패했습니다.");
    if (submitBtn) submitBtn.disabled = false;
    return;
  }

  e.target.reset();
  status.textContent = "익명으로 등록되었습니다.";
  await loadBoard();
  if (isAdmin && activeAdminTab === "board") await loadAdminBoardGroups();
  if (submitBtn) submitBtn.disabled = false;
});
async function loadBoard() {
  const { data, error } = await db.from("anonymous_posts").select("id,body,reply_text,created_at")
    .eq("is_hidden",false).order("created_at",{ascending:false}).limit(50);
  if (error) {
    console.error("anonymous_posts select error:", error);
    $("#boardList").innerHTML = `<p class="muted">${escapeHtml(dbErrorMessage(error,"익명게시판을 불러오지 못했습니다."))}</p>`;
    return;
  }
  const rows = data || [];
  $("#boardList").innerHTML = rows.length ? rows.map(p=>`
    <article class="list-item"><div class="meta">${new Date(p.created_at).toLocaleString("ko-KR")}</div>
    <p>${escapeHtml(p.body)}</p>
    ${p.reply_text ? `<div class="banner"><b>관리자 답변</b><span>${escapeHtml(p.reply_text)}</span></div>` : ""}</article>`).join("")
    : '<p class="muted">아직 등록된 글이 없습니다.</p>';
}


// ============================================================
// 청소년부 행사 · 이벤트 달력 — 기간형 일정
// event_date = 시작일, end_date = 종료일
// ============================================================
function calendarMonthRange(cursor) {
  const y = cursor.getFullYear();
  const m = cursor.getMonth();
  return {
    year:y,
    month:m,
    key:`${y}-${String(m+1).padStart(2,"0")}`,
    start:`${y}-${String(m+1).padStart(2,"0")}-01`,
    end:localISODate(new Date(y,m+1,0))
  };
}
function parseISODate(iso) {
  const [y,m,d]=String(iso||"").split("-").map(Number);
  return y && m && d ? new Date(y,m-1,d) : null;
}
function eventStartDate(row) {
  return String(row?.event_date || "");
}
function eventEndDate(row) {
  return String(row?.end_date || row?.event_date || "");
}
function dateInEvent(row,date) {
  const start=eventStartDate(row);
  const end=eventEndDate(row);
  return Boolean(start && end && date >= start && date <= end);
}
function eventPeriodText(row) {
  const start=eventStartDate(row);
  const end=eventEndDate(row);
  if (!start) return "";
  if (!end || start===end) return fmtDate(start);
  return `${fmtDate(start)} ~ ${fmtDate(end)}`;
}
function eventsByDate(rows, cursor) {
  const map = new Map();
  const range=calendarMonthRange(cursor);
  (rows||[]).forEach(row => {
    let start=eventStartDate(row);
    let end=eventEndDate(row);
    if(!start) return;
    if(!end) end=start;
    if(end < range.start || start > range.end) return;
    start = start < range.start ? range.start : start;
    end = end > range.end ? range.end : end;
    let day=parseISODate(start);
    const last=parseISODate(end);
    if(!day || !last) return;
    while(day<=last){
      const key=localISODate(day);
      if(!map.has(key)) map.set(key,[]);
      map.get(key).push(row);
      day=new Date(day.getFullYear(),day.getMonth(),day.getDate()+1);
    }
  });
  for (const list of map.values()) {
    list.sort((a,b)=>eventStartDate(a).localeCompare(eventStartDate(b)) || String(a.created_at||"").localeCompare(String(b.created_at||"")));
  }
  return map;
}
function renderEventCalendar(container, monthLabel, cursor, rows, {selectedDate=null, admin=false}={}) {
  if (!container || !monthLabel) return;
  const {year,month,key} = calendarMonthRange(cursor);
  const firstDay = new Date(year,month,1).getDay();
  const lastDate = new Date(year,month+1,0).getDate();
  const today = localISODate();
  const byDate = eventsByDate(rows,cursor);
  const cells = [];
  for (let i=0;i<firstDay;i++) cells.push('<span class="event-day empty" aria-hidden="true"></span>');
  for (let day=1;day<=lastDate;day++) {
    const iso = `${key}-${String(day).padStart(2,"0")}`;
    const list = byDate.get(iso) || [];
    const classes = ["event-day", iso===today?"today":"", iso===selectedDate?"selected":"", list.length?"has-event":""].filter(Boolean).join(" ");
    const eventLabels = list.slice(0,2).map(ev=>`<span class="event-mini-title">${escapeHtml(ev.title)}</span>`).join("");
    const more = list.length>2 ? `<span class="event-more">+${list.length-2}</span>` : "";
    cells.push(`<button class="${classes}" type="button" data-${admin?"admin-":""}event-date="${iso}" aria-label="${year}년 ${month+1}월 ${day}일, 일정 ${list.length}개"><span class="event-day-number">${day}</span><span class="event-day-content">${eventLabels}${more}</span></button>`);
  }
  container.innerHTML = cells.join("");
  monthLabel.textContent = `${year}년 ${month+1}월`;
}
function renderPublicEventDay(date) {
  const box = $("#eventDayDetails");
  if (!box) return;
  const list = publicEventRows.filter(row=>dateInEvent(row,date));
  if (!list.length) {
    box.innerHTML = `<div class="event-day-heading"><strong>${escapeHtml(fmtDate(date))}</strong></div><p class="muted">등록된 행사가 없습니다.</p>`;
    return;
  }
  box.innerHTML = `<div class="event-day-heading"><strong>${escapeHtml(fmtDate(date))}</strong><span>${list.length}개 일정</span></div>` + list.map(row=>`
    <article class="event-detail-card">
      <div class="event-detail-head"><strong>${escapeHtml(row.title)}</strong><span>📅 ${escapeHtml(eventPeriodText(row))}</span></div>
      ${row.location?`<div class="event-location">📍 ${escapeHtml(row.location)}</div>`:""}
      ${row.description?`<p>${escapeHtml(row.description)}</p>`:""}
    </article>`).join("");
}
async function loadPublicEventCalendar({selectDate=null}={}) {
  const status = $("#eventCalendarStatus");
  const range = calendarMonthRange(eventCalendarCursor);
  let {data,error} = await db.from("church_events")
    .select("id,event_date,end_date,title,description,location,created_at")
    .eq("published",true)
    .lte("event_date",range.end).gte("end_date",range.start)
    .order("event_date",{ascending:true});
  if (error && (error.code==="PGRST204" || /end_date/i.test(error.message||""))) {
    const fallback=await db.from("church_events")
      .select("id,event_date,title,description,location,created_at")
      .eq("published",true)
      .gte("event_date",range.start).lte("event_date",range.end)
      .order("event_date",{ascending:true});
    data=(fallback.data||[]).map(row=>({...row,end_date:row.event_date}));
    error=fallback.error;
    if(!error && status) status.textContent="기간형 달력을 사용하려면 관리자에게 V18 DB 업데이트를 요청해 주세요.";
  }
  if (error) {
    publicEventRows=[];
    renderEventCalendar($("#eventCalendar"), $("#eventCalendarMonth"), eventCalendarCursor, []);
    if (status) status.textContent = error.code === "PGRST205" ? "행사 달력 DB 설정이 아직 적용되지 않았습니다. 관리자에게 문의해 주세요." : dbErrorMessage(error,"행사 달력을 불러오지 못했습니다.");
    return;
  }
  publicEventRows=data||[];
  renderEventCalendar($("#eventCalendar"), $("#eventCalendarMonth"), eventCalendarCursor, publicEventRows, {selectedDate:selectDate});
  if (status && !status.textContent.includes("V18")) status.textContent = publicEventRows.length ? `이번 달 등록된 행사 ${publicEventRows.length}개` : "이번 달 등록된 행사가 없습니다.";
  if (selectDate) renderPublicEventDay(selectDate);
}
$("#eventPrevMonth")?.addEventListener("click", async()=>{
  eventCalendarCursor=new Date(eventCalendarCursor.getFullYear(),eventCalendarCursor.getMonth()-1,1);
  await loadPublicEventCalendar();
  $("#eventDayDetails").innerHTML='<p class="muted">날짜를 선택하면 그날이 포함된 일정이 표시됩니다.</p>';
});
$("#eventNextMonth")?.addEventListener("click", async()=>{
  eventCalendarCursor=new Date(eventCalendarCursor.getFullYear(),eventCalendarCursor.getMonth()+1,1);
  await loadPublicEventCalendar();
  $("#eventDayDetails").innerHTML='<p class="muted">날짜를 선택하면 그날이 포함된 일정이 표시됩니다.</p>';
});
$("#eventCalendar")?.addEventListener("click",e=>{
  const btn=e.target.closest("[data-event-date]");
  if(!btn) return;
  renderEventCalendar($("#eventCalendar"), $("#eventCalendarMonth"), eventCalendarCursor, publicEventRows, {selectedDate:btn.dataset.eventDate});
  renderPublicEventDay(btn.dataset.eventDate);
});

function renderAdminEventDayList(date=selectedAdminEventDate) {
  const box = $("#adminEventDayList");
  if (!box) return;
  if (!date) {
    box.innerHTML = '<p class="muted">달력에서 날짜를 클릭하면 해당 날짜가 포함된 행사를 수정하거나 삭제할 수 있습니다.</p>';
    return;
  }
  const list = adminEventRows
    .filter(row=>dateInEvent(row,String(date)))
    .sort((a,b)=>eventStartDate(a).localeCompare(eventStartDate(b)) || String(a.created_at||"").localeCompare(String(b.created_at||"")));
  if (!list.length) {
    box.innerHTML = `
      <div class="admin-event-day-list-head">
        <div><strong>${escapeHtml(fmtDate(date))}</strong><span>등록된 행사 없음</span></div>
        <button class="ghost compact-btn" type="button" data-event-new-date="${escapeHtml(date)}">＋ 이 날짜부터 행사 등록</button>
      </div>
      <p class="muted admin-event-empty">이 날짜에는 등록된 행사가 없습니다. 시작일과 종료일을 선택해 새 행사를 등록할 수 있습니다.</p>`;
    return;
  }
  box.innerHTML = `
    <div class="admin-event-day-list-head">
      <div><strong>${escapeHtml(fmtDate(date))}</strong><span>${list.length}개 행사</span></div>
      <button class="ghost compact-btn" type="button" data-event-new-date="${escapeHtml(date)}">＋ 새 행사</button>
    </div>
    <div class="admin-event-list-cards">
      ${list.map(row=>`
        <article class="admin-event-list-card ${String(row.id)===String(selectedAdminEventId)?"active":""}" data-event-row-id="${escapeHtml(String(row.id))}">
          <div class="admin-event-list-main">
            <div class="admin-event-list-title-row">
              <strong>${escapeHtml(row.title || "제목 없음")}</strong>
              <span class="event-publish-badge ${row.published?"public":"private"}">${row.published?"공개":"비공개"}</span>
            </div>
            <div class="admin-event-list-meta">
              <span>📅 ${escapeHtml(eventPeriodText(row))}</span>
              ${row.location?`<span>📍 ${escapeHtml(row.location)}</span>`:""}
            </div>
            ${row.description?`<p>${escapeHtml(row.description)}</p>`:""}
          </div>
          <div class="admin-event-list-actions">
            <button class="ghost compact-btn" type="button" data-event-edit-id="${escapeHtml(String(row.id))}">수정</button>
            <button class="ghost compact-btn danger-outline" type="button" data-event-delete-id="${escapeHtml(String(row.id))}">삭제</button>
          </div>
        </article>`).join("")}
    </div>`;
}

function resetAdminEventForm({keepDate=true}={}) {
  selectedAdminEventId=null;
  if (!keepDate) selectedAdminEventDate=null;
  $("#eventPicker").value="__new__";
  $("#eventTitle").value="";
  $("#eventStartDate").value=selectedAdminEventDate||"";
  $("#eventEndDate").value=selectedAdminEventDate||"";
  $("#eventLocation").value="";
  $("#eventDescription").value="";
  $("#eventPublished").checked=true;
  $("#eventSaveBtn").textContent="행사 등록";
  $("#eventDeleteBtn").disabled=true;
  $("#adminSelectedEventDate").textContent=selectedAdminEventDate ? fmtDate(selectedAdminEventDate) : "날짜를 선택해 주세요.";
}
function refreshAdminEventPicker() {
  const picker=$("#eventPicker");
  if(!picker) return;
  const list=adminEventRows.filter(row=>selectedAdminEventDate && dateInEvent(row,selectedAdminEventDate));
  picker.innerHTML='<option value="__new__">＋ 새 행사 등록</option>'+list.map(row=>`<option value="${escapeHtml(String(row.id))}">${escapeHtml(`${eventPeriodText(row)} · ${row.title}`)}</option>`).join("");
  picker.value=selectedAdminEventId && list.some(x=>String(x.id)===String(selectedAdminEventId)) ? String(selectedAdminEventId) : "__new__";
}
function fillAdminEvent(row) {
  selectedAdminEventId=String(row.id);
  const rowStart=eventStartDate(row);
  const rowEnd=eventEndDate(row);
  if(!selectedAdminEventDate || !dateInEvent(row,selectedAdminEventDate)) selectedAdminEventDate=rowStart;
  $("#adminSelectedEventDate").textContent=fmtDate(selectedAdminEventDate);
  $("#eventTitle").value=row.title||"";
  $("#eventStartDate").value=rowStart;
  $("#eventEndDate").value=rowEnd;
  $("#eventLocation").value=row.location||"";
  $("#eventDescription").value=row.description||"";
  $("#eventPublished").checked=Boolean(row.published);
  $("#eventSaveBtn").textContent="행사 수정 저장";
  $("#eventDeleteBtn").disabled=false;
  refreshAdminEventPicker();
  renderAdminEventDayList(selectedAdminEventDate);
}
async function loadAdminEventCalendar({selectDate=selectedAdminEventDate,selectId=selectedAdminEventId}={}) {
  if(!isAdmin) return;
  const range=calendarMonthRange(adminEventCalendarCursor);
  let {data,error}=await db.from("church_events").select("*")
    .lte("event_date",range.end).gte("end_date",range.start)
    .order("event_date",{ascending:true});
  if(error && (error.code==="PGRST204" || /end_date/i.test(error.message||""))){
    const fallback=await db.from("church_events").select("*")
      .gte("event_date",range.start).lte("event_date",range.end)
      .order("event_date",{ascending:true});
    data=(fallback.data||[]).map(row=>({...row,end_date:row.event_date}));
    error=fallback.error;
    if(!error) $("#eventAdminStatus").textContent="V18 기간형 달력 DB 업데이트가 필요합니다. 제공된 SQL을 먼저 실행해 주세요.";
  }
  if(error){
    $("#eventAdminStatus").textContent=dbErrorMessage(error,"관리자 행사 달력을 불러오지 못했습니다.");
    return;
  }
  adminEventRows=data||[];
  selectedAdminEventDate=selectDate;
  selectedAdminEventId=selectId;
  renderEventCalendar($("#adminEventCalendar"), $("#adminEventCalendarMonth"), adminEventCalendarCursor, adminEventRows, {selectedDate:selectedAdminEventDate,admin:true});
  refreshAdminEventPicker();
  renderAdminEventDayList(selectedAdminEventDate);
  if(selectedAdminEventId){
    const row=adminEventRows.find(x=>String(x.id)===String(selectedAdminEventId));
    if(row) fillAdminEvent(row); else resetAdminEventForm({keepDate:true});
  } else {
    resetAdminEventForm({keepDate:true});
    refreshAdminEventPicker();
  }
}
$("#adminEventCalendar")?.addEventListener("click",e=>{
  const btn=e.target.closest("[data-admin-event-date]");
  if(!btn) return;
  selectedAdminEventDate=btn.dataset.adminEventDate;
  selectedAdminEventId=null;
  renderEventCalendar($("#adminEventCalendar"), $("#adminEventCalendarMonth"), adminEventCalendarCursor, adminEventRows, {selectedDate:selectedAdminEventDate,admin:true});
  const dayRows=adminEventRows.filter(row=>dateInEvent(row,selectedAdminEventDate));
  if(dayRows.length===1){
    fillAdminEvent(dayRows[0]);
    $("#eventAdminStatus").textContent=`${fmtDate(selectedAdminEventDate)}에 해당하는 행사를 불러왔습니다. 기간과 내용을 수정하거나 삭제할 수 있습니다.`;
  } else {
    resetAdminEventForm({keepDate:true});
    refreshAdminEventPicker();
    renderAdminEventDayList(selectedAdminEventDate);
    $("#eventAdminStatus").textContent=dayRows.length
      ? `${fmtDate(selectedAdminEventDate)}에 해당하는 ${dayRows.length}개 행사가 있습니다. 수정하거나 삭제할 행사를 선택해 주세요.`
      : `${fmtDate(selectedAdminEventDate)}부터 새 행사 기간을 등록할 수 있습니다.`;
  }
});
$("#adminEventPrevMonth")?.addEventListener("click",async()=>{
  adminEventCalendarCursor=new Date(adminEventCalendarCursor.getFullYear(),adminEventCalendarCursor.getMonth()-1,1);
  selectedAdminEventDate=null; selectedAdminEventId=null;
  await loadAdminEventCalendar({selectDate:null,selectId:null});
});
$("#adminEventNextMonth")?.addEventListener("click",async()=>{
  adminEventCalendarCursor=new Date(adminEventCalendarCursor.getFullYear(),adminEventCalendarCursor.getMonth()+1,1);
  selectedAdminEventDate=null; selectedAdminEventId=null;
  await loadAdminEventCalendar({selectDate:null,selectId:null});
});
$("#newEventBtn")?.addEventListener("click",()=>{
  if(!selectedAdminEventDate){
    const today=localISODate();
    const range=calendarMonthRange(adminEventCalendarCursor);
    selectedAdminEventDate=today.startsWith(range.key)?today:range.start;
  }
  selectedAdminEventId=null;
  resetAdminEventForm({keepDate:true});
  refreshAdminEventPicker();
  renderAdminEventDayList(selectedAdminEventDate);
  renderEventCalendar($("#adminEventCalendar"), $("#adminEventCalendarMonth"), adminEventCalendarCursor, adminEventRows, {selectedDate:selectedAdminEventDate,admin:true});
  $("#eventTitle").focus();
});
$("#eventPicker")?.addEventListener("change",e=>{
  const id=e.target.value;
  if(id==="__new__") { selectedAdminEventId=null; resetAdminEventForm({keepDate:true}); refreshAdminEventPicker(); return; }
  const row=adminEventRows.find(x=>String(x.id)===String(id));
  if(row) fillAdminEvent(row);
});
$("#eventStartDate")?.addEventListener("change",()=>{
  const start=$("#eventStartDate").value;
  const end=$("#eventEndDate").value;
  if(start && (!end || end<start)) $("#eventEndDate").value=start;
});
$("#eventAdminForm")?.addEventListener("submit",async e=>{
  e.preventDefault();
  if(!isAdmin){ $("#eventAdminStatus").textContent="관리자 로그인 후 저장해 주세요."; return; }
  const startDate=$("#eventStartDate").value;
  const endDate=$("#eventEndDate").value;
  const payload={
    event_date:startDate,
    end_date:endDate,
    title:clean($("#eventTitle").value),
    start_time:null,
    end_time:null,
    location:clean($("#eventLocation").value)||null,
    description:clean($("#eventDescription").value)||null,
    published:$("#eventPublished").checked,
    updated_at:new Date().toISOString()
  };
  if(!payload.title){ $("#eventAdminStatus").textContent="행사명을 입력해 주세요."; return; }
  if(!startDate || !endDate){ $("#eventAdminStatus").textContent="행사 시작일과 종료일을 모두 선택해 주세요."; return; }
  if(endDate < startDate){ $("#eventAdminStatus").textContent="종료일은 시작일보다 빠를 수 없습니다."; return; }
  $("#eventSaveBtn").disabled=true;
  let result;
  if(selectedAdminEventId) result=await db.from("church_events").update(payload).eq("id",selectedAdminEventId).select("id").single();
  else result=await db.from("church_events").insert(payload).select("id").single();
  $("#eventSaveBtn").disabled=false;
  if(result.error){
    if(result.error.code==="PGRST204" && /end_date/i.test(result.error.message||"")){
      $("#eventAdminStatus").textContent="행사 기간 저장용 DB 업데이트가 아직 적용되지 않았습니다. Supabase SQL Editor에서 V19 행사기간 수정 SQL을 실행한 뒤 다시 저장해 주세요. [PGRST204]";
    } else {
      $("#eventAdminStatus").textContent=dbErrorMessage(result.error,"행사 저장에 실패했습니다.");
    }
    return;
  }
  selectedAdminEventId=String(result.data.id);
  selectedAdminEventDate = selectedAdminEventDate && selectedAdminEventDate>=startDate && selectedAdminEventDate<=endDate ? selectedAdminEventDate : startDate;
  $("#eventAdminStatus").textContent=`행사가 ${eventPeriodText(payload)} 기간으로 저장되었습니다.`;
  await Promise.all([loadAdminEventCalendar({selectDate:selectedAdminEventDate,selectId:selectedAdminEventId}),loadPublicEventCalendar()]);
});
async function deleteAdminEventById(eventId) {
  if(!isAdmin || !eventId) return false;
  const row=adminEventRows.find(x=>String(x.id)===String(eventId));
  if(!confirm(`“${row?.title||"선택한 행사"}”를 삭제할까요?\n\n기간: ${row?eventPeriodText(row):""}\n삭제 후에는 되돌릴 수 없습니다.`)) return false;
  $("#eventAdminStatus").textContent="행사를 삭제하고 있습니다...";
  const deleted=await db.from("church_events").delete().eq("id",eventId).select("id");
  if(deleted.error){
    $("#eventAdminStatus").textContent=dbErrorMessage(deleted.error,"행사 삭제에 실패했습니다.");
    return false;
  }
  if(!deleted.data?.length){
    $("#eventAdminStatus").textContent="삭제할 행사를 찾지 못했습니다.";
    return false;
  }
  if(String(selectedAdminEventId)===String(eventId)) selectedAdminEventId=null;
  $("#eventAdminStatus").textContent="행사가 삭제되었습니다.";
  await Promise.all([
    loadAdminEventCalendar({selectDate:selectedAdminEventDate,selectId:null}),
    loadPublicEventCalendar()
  ]);
  renderAdminEventDayList(selectedAdminEventDate);
  return true;
}

$("#adminEventDayList")?.addEventListener("click",async e=>{
  const newBtn=e.target.closest("[data-event-new-date]");
  if(newBtn){
    selectedAdminEventDate=newBtn.dataset.eventNewDate;
    selectedAdminEventId=null;
    resetAdminEventForm({keepDate:true});
    refreshAdminEventPicker();
    renderAdminEventDayList(selectedAdminEventDate);
    $("#eventTitle").focus();
    return;
  }
  const editBtn=e.target.closest("[data-event-edit-id]");
  if(editBtn){
    const row=adminEventRows.find(x=>String(x.id)===String(editBtn.dataset.eventEditId));
    if(row){
      fillAdminEvent(row);
      $("#eventAdminStatus").textContent=`“${row.title}” 수정 모드입니다. 기간과 내용을 수정할 수 있습니다.`;
      $("#eventTitle").focus();
    }
    return;
  }
  const deleteBtn=e.target.closest("[data-event-delete-id]");
  if(deleteBtn){
    deleteBtn.disabled=true;
    await deleteAdminEventById(deleteBtn.dataset.eventDeleteId);
    return;
  }
  const card=e.target.closest("[data-event-row-id]");
  if(card){
    const row=adminEventRows.find(x=>String(x.id)===String(card.dataset.eventRowId));
    if(row) fillAdminEvent(row);
  }
});

$("#eventDeleteBtn")?.addEventListener("click",async()=>{
  if(!isAdmin||!selectedAdminEventId) return;
  $("#eventDeleteBtn").disabled=true;
  await deleteAdminEventById(selectedAdminEventId);
  $("#eventDeleteBtn").disabled=!selectedAdminEventId;
});


const ADMIN_TAB_META = {
  word:{title:"말씀 관리",badge:"말씀",description:"새 말씀을 등록하거나 지난 말씀을 선택해 수정·삭제할 수 있습니다."},
  study:{title:"성경공부 관리",badge:"성경공부",description:"말씀 주차를 선택한 뒤 성경공부 제목과 질문을 등록·수정·삭제할 수 있습니다."},
  notice:{title:"공지사항 관리",badge:"공지",description:"새 공지를 등록하거나 기존 공지를 선택해 수정·삭제할 수 있습니다."},
  prayer:{title:"기도제목 관리",badge:"기도",description:"학생들이 제출한 기도제목을 주일별로 확인하고 필요한 기록을 삭제할 수 있습니다."},
  gratitude:{title:"감사기도 챌린지",badge:"감사 챌린지",description:"학생별 현재·최고 연속일과 누적 기록을 확인하고 감사기도를 주일별로 관리합니다."},
  board:{title:"익명게시판 관리",badge:"익명글",description:"익명 게시글을 주일별로 모아 확인하고 개별 삭제할 수 있습니다."},
  records:{title:"학생 제출 통계",badge:"통계",description:"제출 내용은 숨기고 말씀쓰기·성경공부·기도·감사·익명 제출 건수만 주일별로 집계합니다."},
  events:{title:"행사 · 이벤트 달력",badge:"행사 달력",description:"시작일과 종료일을 선택해 행사 기간을 등록하고 기존 일정을 수정·삭제할 수 있습니다."}
};

async function refreshActiveAdminTab(tab=activeAdminTab) {
  if (!isAdmin) return;
  if (tab === "word") await Promise.all([loadAdminWordOptions(adminWordId), loadAdminWordSubmissions()]);
  else if (tab === "study") await Promise.all([loadAdminStudyOptions(adminStudyId), loadAdminStudySubmissions()]);
  else if (tab === "notice") await loadAdminNoticeOptions(adminNoticeId);
  else if (tab === "prayer") await loadAdminPrayers();
  else if (tab === "gratitude") await loadAdminGratitude();
  else if (tab === "board") await loadAdminBoardGroups();
  else if (tab === "records") await loadAdminRecords();
  else if (tab === "events") await loadAdminEventCalendar();
}

function setAdminTab(tab, {reload=true}={}) {
  if (!ADMIN_TAB_META[tab]) tab = "word";
  activeAdminTab = tab;
  sessionStorage.setItem("주의울림-admin-tab-v17", tab);
  $$(".admin-tab").forEach(btn => {
    const active = btn.dataset.adminTab === tab;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  });
  $$('[data-admin-panel]').forEach(panel => {
    panel.classList.toggle("admin-panel-active", panel.dataset.adminPanel === tab);
  });
  const meta = ADMIN_TAB_META[tab];
  if ($("#adminSectionTitle")) $("#adminSectionTitle").textContent = meta.title;
  if ($("#adminSectionDescription")) $("#adminSectionDescription").textContent = meta.description;
  if ($("#adminSectionBadge")) $("#adminSectionBadge").textContent = meta.badge;
  if (reload && isAdmin) refreshActiveAdminTab(tab).catch(err => console.error("관리자 탭 새로고침 실패", err));
}

$("#adminTabs")?.addEventListener("click", e => {
  const btn = e.target.closest(".admin-tab");
  if (!btn) return;
  setAdminTab(btn.dataset.adminTab, {reload:true});
});

$("#openAdminBtn").addEventListener("click", () => {
  const url = new URL(window.location.href);
  url.searchParams.set("admin", "1");
  url.hash = "";
  window.open(url.toString(), "_blank", "noopener");
});

function applyAdminWindowMode() {
  if (!ADMIN_WINDOW) return;
  document.body.classList.add("admin-window");
  document.title = "주의울림 관리자 | 양정중앙교회 청소년부";
  $(".brand .subtitle").textContent = "관리자 콘텐츠 · 제출 기록 관리";
  $("#adminPanel").classList.remove("hidden");
  setAdminTab(activeAdminTab, {reload:false});
}
applyAdminWindowMode();
$("#adminLoginForm").addEventListener("submit", async e => {
  e.preventDefault();
  const { data, error } = await db.auth.signInWithPassword({
    email:$("#adminEmail").value.trim(), password:$("#adminPassword").value
  });
  if (error) { $("#adminLoginStatus").textContent = "로그인 정보를 확인해 주세요."; return; }
  await verifyAdmin(data.user);
});

async function verifyAdmin(user) {
  if (!user) return setAdminState(false);
  const { data, error } = await db.from("admin_users").select("user_id").eq("user_id",user.id).maybeSingle();
  if (error || !data) {
    await db.auth.signOut();
    $("#adminLoginStatus").textContent = error ? dbErrorMessage(error, "관리자 권한 확인에 실패했습니다.") : "관리자 권한이 없는 계정입니다.";
    return setAdminState(false);
  }
  $("#adminLoginStatus").textContent = "";
  setAdminState(true);
  $("#wordAdminStatus").textContent = "말씀 관리 준비 완료 · v17";
  $("#studyAdminStatus").textContent = "성경공부 관리 준비 완료 · v17";
  setAdminTab(activeAdminTab, {reload:false});
  await refreshActiveAdminTab(activeAdminTab);
}
function setAdminState(value) {
  isAdmin = value;
  $("#adminLoginForm").classList.toggle("hidden", value);
  $("#adminWorkspace").classList.toggle("hidden", !value);
  $("#adminLogoutBtn").classList.toggle("hidden", !value);
}
$("#adminLogoutBtn").addEventListener("click", async () => { await db.auth.signOut(); setAdminState(false); });
$("#refreshAdminBtn").addEventListener("click", async () => {
  await refreshActiveAdminTab(activeAdminTab);
});

function currentMondayISO() {
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay()+6)%7));
  return localISODate(monday);
}

async function refreshAdminWeeklyRows() {
  const { data, error } = await db.from("weekly_contents").select("*").order("week_start", {ascending:false});
  if (error) return { error };
  adminWeeklyRows = data || [];
  return { data: adminWeeklyRows };
}

// ============================================================
// 말씀 관리 - 성경공부와 분리
// ============================================================
function resetWordEditor() {
  adminWordId = null;
  if ($("#wordPicker")) $("#wordPicker").value = "__new__";
  $("#wordWeekStart").value = currentMondayISO();
  $("#adminVerseRef").value = "";
  $("#adminVerseText").value = "";
  $("#wordPublished").checked = true;
  $("#wordModeLabel").textContent = "새 말씀 등록 모드입니다.";
  $("#wordSaveBtn").textContent = "말씀 등록";
  $("#deleteWordBtn").disabled = true;
  $("#wordAdminStatus").textContent = "새 말씀을 입력해 주세요.";
}

async function loadAdminWordOptions(preferredId = null) {
  if (!isAdmin) return;
  const result = await refreshAdminWeeklyRows();
  if (result.error) {
    $("#wordAdminStatus").textContent = dbErrorMessage(result.error, "지난 말씀 목록을 불러오지 못했습니다.");
    return;
  }
  $("#wordPicker").innerHTML = '<option value="__new__">＋ 새 말씀 등록</option>' + adminWeeklyRows.map(r =>
    `<option value="${escapeHtml(String(r.id))}">${escapeHtml(sundayFromWeekStart(r.week_start) || r.week_start || "날짜 없음")} 주일 · ${escapeHtml(r.verse_reference || "말씀 미입력")} · ${r.published ? "공개" : "비공개"}</option>`
  ).join("");
  const target = preferredId && adminWeeklyRows.some(r=>String(r.id)===String(preferredId))
    ? String(preferredId)
    : "__new__";
  $("#wordPicker").value = target;
  if (target === "__new__") resetWordEditor();
  else loadAdminWordEditor(target);
}

function loadAdminWordEditor(id) {
  const row = adminWeeklyRows.find(r => String(r.id) === String(id));
  if (!row) return resetWordEditor();
  adminWordId = String(row.id);
  $("#wordWeekStart").value = row.week_start || currentMondayISO();
  $("#adminVerseRef").value = row.verse_reference || "";
  $("#adminVerseText").value = row.verse_text || "";
  $("#wordPublished").checked = Boolean(row.published);
  $("#wordModeLabel").textContent = `${row.week_start || "날짜 없음"} 말씀을 수정 중입니다.`;
  $("#wordSaveBtn").textContent = "말씀 수정 저장";
  $("#deleteWordBtn").disabled = false;
  $("#wordAdminStatus").textContent = "기존 말씀을 불러왔습니다. 수정하거나 삭제할 수 있습니다.";
}

$("#wordPicker").addEventListener("change", e => {
  if (e.target.value === "__new__") resetWordEditor();
  else loadAdminWordEditor(e.target.value);
});
$("#newWordBtn").addEventListener("click", resetWordEditor);

async function directSaveWord(payload) {
  if (adminWordId) {
    const result = await db.from("weekly_contents")
      .update({
        week_start: payload.week_start,
        verse_reference: payload.verse_reference,
        verse_text: payload.verse_text,
        published: payload.published
      })
      .eq("id", adminWordId)
      .select("id")
      .maybeSingle();
    if (result.error) return {error:result.error};
    if (!result.data?.id) return {error:{code:"PGRST116",message:"수정할 말씀을 찾지 못했습니다."}};
    return {id:String(result.data.id)};
  }

  const existing = await db.from("weekly_contents").select("id").eq("week_start", payload.week_start).maybeSingle();
  if (existing.error) return {error:existing.error};
  if (existing.data?.id) {
    const result = await db.from("weekly_contents")
      .update({verse_reference:payload.verse_reference, verse_text:payload.verse_text, published:payload.published})
      .eq("id", existing.data.id).select("id").single();
    if (result.error) return {error:result.error};
    return {id:String(result.data.id)};
  }
  const result = await db.from("weekly_contents").insert({
    week_start: payload.week_start,
    verse_reference: payload.verse_reference,
    verse_text: payload.verse_text,
    study_title: "성경공부",
    published: payload.published
  }).select("id").single();
  if (result.error) return {error:result.error};
  return {id:String(result.data.id)};
}

async function saveWord(payload) {
  const rpc = await db.rpc("youth_admin_save_word_v12", {
    p_content_id: adminWordId || null,
    p_week_start: payload.week_start,
    p_verse_reference: payload.verse_reference,
    p_verse_text: payload.verse_text,
    p_published: payload.published
  });
  if (!rpc.error) return {id:String(rpc.data)};
  if (["PGRST202","42883"].includes(rpc.error.code) || String(rpc.error.message || "").includes("youth_admin_save_word_v12")) {
    return directSaveWord(payload);
  }
  return {error:rpc.error};
}

$("#wordSaveBtn").addEventListener("click", async () => {
  const status = $("#wordAdminStatus");
  if (!isAdmin) { status.textContent = "관리자 로그인 후 저장해 주세요."; return; }
  const payload = {
    week_start: $("#wordWeekStart").value,
    verse_reference: clean($("#adminVerseRef").value),
    verse_text: clean($("#adminVerseText").value),
    published: $("#wordPublished").checked
  };
  if (!payload.week_start || !payload.verse_reference || !payload.verse_text) {
    status.textContent = "주 시작일, 말씀구절, 말씀본문을 입력해 주세요.";
    return;
  }
  const wasEditing = Boolean(adminWordId);
  status.textContent = wasEditing ? "말씀을 수정하고 있습니다…" : "말씀을 등록하고 있습니다…";
  $("#wordSaveBtn").disabled = true;
  const result = await saveWord(payload);
  $("#wordSaveBtn").disabled = false;
  if (result.error || !result.id) {
    status.textContent = dbErrorMessage(result.error, wasEditing ? "말씀 수정에 실패했습니다." : "말씀 등록에 실패했습니다.");
    return;
  }
  adminWordId = String(result.id);
  adminStudyId = String(result.id);
  await Promise.all([loadAdminWordOptions(adminWordId), loadAdminStudyOptions(adminStudyId), loadWeekly(), loadAdminWordSubmissions(), loadAdminRecords()]);
  status.textContent = wasEditing ? "말씀이 수정되었습니다." : "말씀이 등록되었습니다.";
});

async function directDeleteWord(contentId) {
  const steps = [
    () => db.from("attendance").delete().eq("weekly_content_id", contentId),
    () => db.from("study_submissions").delete().eq("weekly_content_id", contentId),
    () => db.from("prayer_requests").update({ weekly_content_id:null }).eq("weekly_content_id", contentId),
    () => db.from("study_questions").delete().eq("weekly_content_id", contentId)
  ];
  for (const run of steps) {
    const result = await run();
    if (result.error) return { error:result.error };
  }
  const result = await db.from("weekly_contents").delete().eq("id", contentId).select("id");
  if (result.error) return { error:result.error };
  if (!result.data?.length) return { error:{code:"PGRST116",message:"삭제할 지난 말씀을 찾지 못했습니다."} };
  return { data:{deleted:true} };
}

$("#deleteWordBtn").addEventListener("click", async () => {
  const status = $("#wordAdminStatus");
  if (!isAdmin) { status.textContent = "관리자 로그인 후 삭제해 주세요."; return; }
  if (!adminWordId) { status.textContent = "삭제할 지난 말씀을 먼저 선택해 주세요."; return; }
  const row = adminWeeklyRows.find(r => String(r.id) === String(adminWordId));
  const label = row ? `${row.week_start || "해당 주차"} · ${row.verse_reference || "말씀"}` : "선택한 말씀";
  if (!confirm(`${label}을 삭제할까요?\n\n같은 주차의 성경공부, 말씀쓰기 출석, 성경공부 제출 기록도 함께 삭제됩니다. 기도제목 내용은 보존됩니다.\n\n삭제 후에는 되돌릴 수 없습니다.`)) return;
  status.textContent = "말씀과 연결 기록을 삭제하고 있습니다…";
  $("#deleteWordBtn").disabled = true;
  let result = await db.rpc("youth_admin_delete_word_v14", { p_content_id:String(adminWordId) });
  if (result.error && isMissingRpc(result.error, "youth_admin_delete_word_v14")) {
    console.warn("말씀 삭제 RPC를 찾지 못해 RLS 기반 직접 삭제를 시도합니다.", result.error);
    result = await directDeleteWord(String(adminWordId));
  }
  $("#deleteWordBtn").disabled = false;
  if (result.error) {
    status.textContent = dbErrorMessage(result.error, "지난 말씀 삭제에 실패했습니다.");
    return;
  }
  adminWordId = null;
  if (adminStudyId === String(row?.id || "")) adminStudyId = null;
  await Promise.all([loadAdminWordOptions(), loadAdminStudyOptions(), loadWeekly(), loadQuestions(), loadAdminWordSubmissions(), loadAdminStudySubmissions(), loadAdminRecords()]);
  status.textContent = "선택한 지난 말씀이 삭제되었습니다.";
});

// ============================================================
// 성경공부 관리 - 말씀과 분리
// ============================================================
function resetStudyEditor(clearSelection = false) {
  if (clearSelection) adminStudyId = null;
  $("#adminStudyTitle").value = "";
  $("#adminQ1").value = "";
  $("#adminQ2").value = "";
  $("#adminQ3").value = "";
  $("#studySaveBtn").textContent = "성경공부 등록";
  $("#deleteStudyBtn").disabled = true;
  $("#studyAdminStatus").textContent = adminStudyId ? "성경공부 내용을 입력해 주세요." : "성경공부를 연결할 말씀을 선택해 주세요.";
}

async function loadAdminStudyOptions(preferredId = null) {
  if (!isAdmin) return;
  const result = await refreshAdminWeeklyRows();
  if (result.error) {
    $("#studyAdminStatus").textContent = dbErrorMessage(result.error, "말씀 목록을 불러오지 못했습니다.");
    return;
  }
  $("#studyPicker").innerHTML = '<option value="">말씀을 선택해 주세요</option>' + adminWeeklyRows.map(r =>
    `<option value="${escapeHtml(String(r.id))}">${escapeHtml(sundayFromWeekStart(r.week_start) || r.week_start || "날짜 없음")} 주일 · ${escapeHtml(r.verse_reference || "말씀 미입력")} · ${escapeHtml(r.study_title || "성경공부 미등록")}</option>`
  ).join("");
  const target = preferredId && adminWeeklyRows.some(r=>String(r.id)===String(preferredId))
    ? String(preferredId)
    : "";
  $("#studyPicker").value = target;
  if (target) await loadAdminStudyEditor(target);
  else {
    $("#studyWeekInfo").textContent = "말씀을 선택해 주세요.";
    resetStudyEditor(true);
  }
}

async function loadAdminStudyEditor(id) {
  const row = adminWeeklyRows.find(r => String(r.id) === String(id));
  if (!row) return resetStudyEditor(true);
  adminStudyId = String(row.id);
  $("#studyWeekInfo").textContent = `${sundayFromWeekStart(row.week_start) || row.week_start || "날짜 없음"} 주일 · ${row.verse_reference || "말씀 미입력"}`;
  $("#adminStudyTitle").value = row.study_title && row.study_title !== "성경공부" ? row.study_title : "";
  const { data, error } = await db.from("study_questions").select("*").eq("weekly_content_id", row.id).order("question_order");
  if (error) {
    $("#studyAdminStatus").textContent = dbErrorMessage(error, "성경공부 문제를 불러오지 못했습니다.");
    return;
  }
  const qs = data || [];
  $("#adminQ1").value = qs[0]?.question_text || "";
  $("#adminQ2").value = qs[1]?.question_text || "";
  $("#adminQ3").value = qs[2]?.question_text || "";
  const hasStudy = Boolean(qs.length || ($("#adminStudyTitle").value));
  $("#studyModeLabel").textContent = hasStudy ? "기존 성경공부를 수정 중입니다." : "이 말씀에는 아직 성경공부가 없습니다. 새로 등록할 수 있습니다.";
  $("#studySaveBtn").textContent = hasStudy ? "성경공부 수정 저장" : "성경공부 등록";
  $("#deleteStudyBtn").disabled = !hasStudy;
  $("#studyAdminStatus").textContent = hasStudy ? "기존 성경공부를 불러왔습니다." : "성경공부 내용을 입력해 주세요.";
}

$("#studyPicker").addEventListener("change", async e => {
  if (!e.target.value) {
    $("#studyWeekInfo").textContent = "말씀을 선택해 주세요.";
    resetStudyEditor(true);
  } else {
    await loadAdminStudyEditor(e.target.value);
  }
});

async function directSaveStudy(contentId, title, qs) {
  const up = await db.from("weekly_contents").update({study_title:title}).eq("id",contentId).select("id").maybeSingle();
  if (up.error) return {error:up.error};
  if (!up.data?.id) return {error:{code:"PGRST116",message:"성경공부를 연결할 말씀을 찾지 못했습니다."}};
  const del = await db.from("study_questions").delete().eq("weekly_content_id",contentId);
  if (del.error) return {error:del.error};
  const rows = qs.map((question_text,i)=>({weekly_content_id:contentId,question_order:i+1,question_text}));
  const ins = await db.from("study_questions").insert(rows);
  if (ins.error) return {error:ins.error};
  return {id:String(contentId)};
}

async function saveStudy(contentId, title, qs) {
  const rpc = await db.rpc("youth_admin_save_study_v12", {
    p_content_id:String(contentId),
    p_study_title:title,
    p_questions:qs
  });
  if (!rpc.error) return {id:String(rpc.data)};
  if (["PGRST202","42883"].includes(rpc.error.code) || String(rpc.error.message || "").includes("youth_admin_save_study_v12")) {
    return directSaveStudy(contentId,title,qs);
  }
  return {error:rpc.error};
}

$("#studySaveBtn").addEventListener("click", async () => {
  const status = $("#studyAdminStatus");
  if (!isAdmin) { status.textContent = "관리자 로그인 후 저장해 주세요."; return; }
  if (!adminStudyId) { status.textContent = "성경공부를 연결할 말씀을 먼저 선택해 주세요."; return; }
  const title = clean($("#adminStudyTitle").value);
  const qs = [clean($("#adminQ1").value), clean($("#adminQ2").value), clean($("#adminQ3").value)].filter(Boolean);
  if (!title || qs.length < 2 || qs.length > 3) {
    status.textContent = "성경공부 제목과 질문 2개 이상(최대 3개)을 입력해 주세요.";
    return;
  }
  status.textContent = "성경공부를 저장하고 있습니다…";
  $("#studySaveBtn").disabled = true;
  const result = await saveStudy(adminStudyId,title,qs);
  $("#studySaveBtn").disabled = false;
  if (result.error) {
    status.textContent = dbErrorMessage(result.error, "성경공부 저장에 실패했습니다.");
    return;
  }
  await Promise.all([loadAdminStudyOptions(adminStudyId), loadAdminWordOptions(adminWordId), loadWeekly(), loadQuestions(), loadAdminStudySubmissions(), loadAdminRecords()]);
  status.textContent = "성경공부가 저장되었습니다.";
});

async function directDeleteStudy(contentId) {
  const q = await db.from("study_questions").delete().eq("weekly_content_id", contentId);
  if (q.error) return { error:q.error };
  const w = await db.from("weekly_contents").update({study_title:"성경공부"}).eq("id", contentId).select("id");
  if (w.error) return { error:w.error };
  if (!w.data?.length) return { error:{code:"PGRST116",message:"삭제할 성경공부의 말씀 주차를 찾지 못했습니다."} };
  return { data:{deleted:true} };
}

$("#deleteStudyBtn").addEventListener("click", async () => {
  const status = $("#studyAdminStatus");
  if (!isAdmin) { status.textContent = "관리자 로그인 후 삭제해 주세요."; return; }
  if (!adminStudyId) { status.textContent = "삭제할 성경공부를 먼저 선택해 주세요."; return; }
  if (!confirm("선택한 주차의 성경공부 제목과 질문을 삭제할까요? 말씀과 학생 제출 기록은 그대로 유지됩니다.")) return;
  status.textContent = "성경공부를 삭제하고 있습니다…";
  $("#deleteStudyBtn").disabled = true;
  let result = await db.rpc("youth_admin_delete_study_v14", {p_content_id:String(adminStudyId)});
  if (result.error && isMissingRpc(result.error, "youth_admin_delete_study_v14")) {
    result = await directDeleteStudy(String(adminStudyId));
  }
  if (result.error) {
    $("#deleteStudyBtn").disabled = false;
    status.textContent = dbErrorMessage(result.error, "성경공부 삭제에 실패했습니다.");
    return;
  }
  await Promise.all([loadAdminStudyOptions(adminStudyId), loadAdminWordOptions(adminWordId), loadWeekly(), loadQuestions(), loadAdminStudySubmissions(), loadAdminRecords()]);
  status.textContent = "선택한 성경공부가 삭제되었습니다.";
});

function resetNoticeEditor() {
  adminNoticeId = null;
  $("#noticePicker").value = "__new__";
  $("#noticeTitle").value = "";
  $("#noticeDate").value = "";
  $("#noticeBody").value = "";
  $("#noticeBanner").checked = true;
  $("#noticePublished").checked = true;
  $("#noticeModeLabel").textContent = "새 공지 등록 모드입니다.";
  $("#noticeSubmitBtn").textContent = "공지 등록";
  $("#deleteNoticeBtn").disabled = true;
  $("#noticeAdminStatus").textContent = "새 공지 내용을 입력해 주세요.";
}

async function loadAdminNoticeOptions(preferredId = null) {
  if (!isAdmin) return;
  const { data, error } = await db.from("notices").select("*").order("created_at", {ascending:false});
  if (error) {
    $("#noticeAdminStatus").textContent = dbErrorMessage(error, "공지 목록을 불러오지 못했습니다.");
    return;
  }
  adminNoticeRows = data || [];
  $("#noticePicker").innerHTML = '<option value="__new__">＋ 새 공지 등록</option>' + adminNoticeRows.map(n =>
    `<option value="${escapeHtml(String(n.id))}">${escapeHtml(n.event_date || "일정 없음")} · ${escapeHtml(n.title || "제목 없음")} · ${n.published ? "공개" : "비공개"}</option>`
  ).join("");
  const target = preferredId && adminNoticeRows.some(n=>String(n.id)===String(preferredId))
    ? String(preferredId)
    : "__new__";
  $("#noticePicker").value = target;
  if (target === "__new__") resetNoticeEditor();
  else loadAdminNoticeEditor(target);
}

function loadAdminNoticeEditor(id) {
  const row = adminNoticeRows.find(n => String(n.id) === String(id));
  if (!row) return resetNoticeEditor();
  adminNoticeId = String(row.id);
  $("#noticeTitle").value = row.title || "";
  $("#noticeDate").value = row.event_date || "";
  $("#noticeBody").value = row.body || "";
  $("#noticeBanner").checked = Boolean(row.banner);
  $("#noticePublished").checked = Boolean(row.published);
  $("#noticeModeLabel").textContent = `“${row.title || "제목 없음"}” 공지를 수정 중입니다.`;
  $("#noticeSubmitBtn").textContent = "공지 수정 저장";
  $("#deleteNoticeBtn").disabled = false;
  $("#noticeAdminStatus").textContent = "기존 공지 내용을 불러왔습니다. 수정하거나 삭제할 수 있습니다.";
}

$("#noticePicker").addEventListener("change", e => {
  if (e.target.value === "__new__") resetNoticeEditor();
  else loadAdminNoticeEditor(e.target.value);
});
$("#newNoticeBtn").addEventListener("click", resetNoticeEditor);

async function directSaveNotice(payload) {
  if (adminNoticeId) {
    const result = await db.from("notices")
      .update(payload)
      .eq("id", adminNoticeId)
      .select("id")
      .maybeSingle();
    if (result.error) return {error:result.error};
    if (!result.data?.id) return {error:{code:"PGRST116",message:"수정할 공지사항을 찾지 못했습니다."}};
    return {id:String(result.data.id)};
  }
  const result = await db.from("notices").insert(payload).select("id").single();
  if (result.error) return {error:result.error};
  return {id:String(result.data.id)};
}

async function saveNotice(payload) {
  const rpc = await db.rpc("youth_admin_save_notice", {
    p_notice_id: adminNoticeId || null,
    p_title: payload.title,
    p_event_date: payload.event_date,
    p_body: payload.body,
    p_banner: payload.banner,
    p_published: payload.published
  });
  if (!rpc.error) return {id:String(rpc.data)};
  if (["PGRST202","42883"].includes(rpc.error.code) || String(rpc.error.message || "").includes("youth_admin_save_notice")) {
    return directSaveNotice(payload);
  }
  return {error:rpc.error};
}

$("#noticeAdminForm").addEventListener("submit", async e => {
  e.preventDefault();
  const status = $("#noticeAdminStatus");
  if (!isAdmin) { status.textContent = "관리자 로그인 후 저장해 주세요."; return; }
  const payload = {
    title: clean($("#noticeTitle").value),
    event_date: $("#noticeDate").value || null,
    body: clean($("#noticeBody").value),
    banner: $("#noticeBanner").checked,
    published: $("#noticePublished").checked
  };
  if (!payload.title || !payload.body) { status.textContent = "공지 제목과 내용을 입력해 주세요."; return; }
  const wasEditing = Boolean(adminNoticeId);
  status.textContent = wasEditing ? "공지를 수정하고 있습니다…" : "공지를 등록하고 있습니다…";
  $("#noticeSubmitBtn").disabled = true;
  const result = await saveNotice(payload);
  $("#noticeSubmitBtn").disabled = false;
  if (result.error || !result.id) {
    status.textContent = dbErrorMessage(result.error, wasEditing ? "공지 수정에 실패했습니다." : "공지 등록에 실패했습니다.");
    return;
  }
  adminNoticeId = String(result.id);
  await loadNotices();
  await loadAdminNoticeOptions(adminNoticeId);
  status.textContent = wasEditing ? "공지사항이 수정되었습니다." : "공지사항이 등록되었습니다.";
});

async function directDeleteNotice(noticeId) {
  const result = await db.from("notices").delete().eq("id", noticeId).select("id");
  if (result.error) return { error:result.error };
  if (!result.data?.length) return { error:{code:"PGRST116",message:"삭제할 공지사항을 찾지 못했습니다."} };
  return { data:{deleted:true} };
}

$("#deleteNoticeBtn").addEventListener("click", async () => {
  const status = $("#noticeAdminStatus");
  if (!isAdmin) { status.textContent = "관리자 로그인 후 삭제해 주세요."; return; }
  if (!adminNoticeId) { status.textContent = "삭제할 공지사항을 먼저 선택해 주세요."; return; }
  const row = adminNoticeRows.find(n => String(n.id) === String(adminNoticeId));
  const title = row?.title || "선택한 공지";
  if (!confirm(`“${title}” 공지를 삭제할까요?\n\n삭제 후에는 되돌릴 수 없습니다.`)) return;

  status.textContent = "공지사항을 삭제하고 있습니다…";
  $("#deleteNoticeBtn").disabled = true;
  let result = await db.rpc("youth_admin_delete_notice_v14", { p_notice_id:String(adminNoticeId) });
  if (result.error && isMissingRpc(result.error, "youth_admin_delete_notice_v14")) {
    result = await directDeleteNotice(String(adminNoticeId));
  }
  if (result.error) {
    $("#deleteNoticeBtn").disabled = false;
    status.textContent = dbErrorMessage(result.error, "공지사항 삭제에 실패했습니다.");
    return;
  }

  adminNoticeId = null;
  await loadNotices();
  await loadAdminNoticeOptions();
  status.textContent = "공지사항이 삭제되었습니다.";
});

function sundayForISO(iso) {
  if (!iso) return null;
  const [y,m,d] = String(iso).slice(0,10).split("-").map(Number);
  if (!y || !m || !d) return null;
  const date = new Date(y,m-1,d);
  const day = date.getDay();
  const add = day === 0 ? 0 : 7 - day;
  date.setDate(date.getDate()+add);
  return localISODate(date);
}
function sundayFromWeekStart(iso) {
  return iso ? addDaysISO(iso,6) : null;
}
function recordTime(v) {
  if (!v) return "";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("ko-KR");
}

function weeklySundayMap(rows) {
  return new Map((rows || []).map(row => [String(row.id), sundayFromWeekStart(row.week_start)]));
}
function groupBySunday(rows, getSunday) {
  const groups = new Map();
  (rows || []).forEach(row => {
    const sunday = getSunday(row) || "unknown";
    if (!groups.has(sunday)) groups.set(sunday, []);
    groups.get(sunday).push(row);
  });
  return groups;
}
function sundayGroupLabel(key) {
  return key === "unknown" ? "날짜를 확인할 수 없는 기록" : `${fmtDate(key)} 주일`;
}

async function directDeleteStudentRecord(type, id) {
  const tableMap = {
    attendance:"attendance",
    study:"study_submissions",
    prayer:"prayer_requests",
    gratitude:"gratitude_prayers",
    board:"anonymous_posts"
  };
  const table = tableMap[type];
  if (!table) return { error:{code:"22023",message:"지원하지 않는 기록 유형입니다."} };
  const result = await db.from(table).delete().eq("id", id).select("id");
  if (result.error) return { error:result.error };
  if (!result.data?.length) return { error:{code:"PGRST116",message:"삭제할 기록을 찾지 못했습니다."} };
  return { data:{deleted:true} };
}

async function deleteAdminStudentRecord(type, id) {
  if (type === "prayer") return deletePrayerRecordV15(id);
  // 익명게시판은 테이블 RLS로 관리자 삭제를 직접 처리해 오래된 RPC 캐시 문제를 피합니다.
  if (type === "board") return directDeleteStudentRecord(type, id);
  let result = await db.rpc("youth_admin_delete_student_record_v14", {p_record_id:String(id),p_record_type:type});
  if (result.error && isMissingRpc(result.error, "youth_admin_delete_student_record_v14")) {
    console.warn("학생 기록 삭제 RPC를 찾지 못해 직접 삭제를 시도합니다.", result.error);
    result = await directDeleteStudentRecord(type, id);
  }
  return result;
}

async function loadAdminWordSubmissions() {
  if (!isAdmin || !$("#adminWordSubmissionGroups")) return;
  $("#wordSubmissionStatus").textContent = "말씀쓰기 기록을 불러오는 중입니다…";
  const [w,a] = await Promise.all([
    db.from("weekly_contents").select("id,week_start,verse_reference").order("week_start",{ascending:false}).limit(300),
    db.from("attendance").select("id,weekly_content_id,grade,student_name,completed_at").order("completed_at",{ascending:false}).limit(1000)
  ]);
  if (w.error || a.error) {
    $("#wordSubmissionStatus").textContent = dbErrorMessage(w.error || a.error, "말씀쓰기 기록을 불러오지 못했습니다.");
    return;
  }
  const weekMap = weeklySundayMap(w.data);
  const groups = groupBySunday(a.data, row => weekMap.get(String(row.weekly_content_id || "")) || sundayForISO(row.completed_at));
  const keys = [...groups.keys()].sort((x,y)=>String(y).localeCompare(String(x)));
  if (!keys.length) {
    $("#adminWordSubmissionGroups").innerHTML = '<p class="muted">아직 말씀쓰기 완료 기록이 없습니다.</p>';
    $("#wordSubmissionStatus").textContent = "";
    return;
  }
  $("#adminWordSubmissionGroups").innerHTML = keys.map((key,index)=>{
    const rows = groups.get(key) || [];
    return `<details class="record-week-group" ${index===0?"open":""}>
      <summary><span><b>${escapeHtml(sundayGroupLabel(key))}</b><small>말씀쓰기 ${rows.length}건</small></span><span class="record-week-counts"><span>말씀 ${rows.length}</span></span></summary>
      <div class="record-week-body">${rows.map(row=>`
        <article class="list-item record-item">
          <div class="record-item-head"><div><b>말씀쓰기 · 출석</b><div>${escapeHtml(row.grade)} ${escapeHtml(row.student_name)}</div></div>
          <button class="ghost danger-outline compact-btn word-submission-delete-btn" type="button" data-record-id="${escapeHtml(String(row.id))}">삭제</button></div>
          <div class="meta">${escapeHtml(recordTime(row.completed_at))}</div>
        </article>`).join("")}</div>
    </details>`;
  }).join("");
  $("#wordSubmissionStatus").textContent = `말씀쓰기 기록 ${(a.data||[]).length}건을 주일별로 불러왔습니다.`;
}

$("#refreshWordSubmissionsBtn")?.addEventListener("click", loadAdminWordSubmissions);
$("#adminWordSubmissionGroups")?.addEventListener("click", async e => {
  const btn = e.target.closest(".word-submission-delete-btn");
  if (!btn) return;
  if (!confirm("이 말씀쓰기 완료 기록을 삭제할까요?\n\n삭제 후에는 되돌릴 수 없습니다.")) return;
  btn.disabled = true;
  $("#wordSubmissionStatus").textContent = "말씀쓰기 기록을 삭제하고 있습니다…";
  const result = await deleteAdminStudentRecord("attendance", btn.dataset.recordId);
  if (result.error) { btn.disabled=false; $("#wordSubmissionStatus").textContent=dbErrorMessage(result.error,"말씀쓰기 기록 삭제에 실패했습니다."); return; }
  await Promise.all([loadAdminWordSubmissions(), loadAdminRecords()]);
  $("#wordSubmissionStatus").textContent = "말씀쓰기 기록이 삭제되었습니다.";
});

async function loadAdminStudySubmissions() {
  if (!isAdmin || !$("#adminStudySubmissionGroups")) return;
  $("#studySubmissionStatus").textContent = "성경공부 답안을 불러오는 중입니다…";
  const [w,sr] = await Promise.all([
    db.from("weekly_contents").select("id,week_start,verse_reference,study_title").order("week_start",{ascending:false}).limit(300),
    db.from("study_submissions").select("id,weekly_content_id,grade,student_name,answers,submitted_at").order("submitted_at",{ascending:false}).limit(1000)
  ]);
  if (w.error || sr.error) {
    $("#studySubmissionStatus").textContent = dbErrorMessage(w.error || sr.error, "성경공부 답안을 불러오지 못했습니다.");
    return;
  }
  const weekMap = weeklySundayMap(w.data);
  const groups = groupBySunday(sr.data, row => weekMap.get(String(row.weekly_content_id || "")) || sundayForISO(row.submitted_at));
  const keys = [...groups.keys()].sort((x,y)=>String(y).localeCompare(String(x)));
  if (!keys.length) {
    $("#adminStudySubmissionGroups").innerHTML = '<p class="muted">아직 제출된 성경공부 답안이 없습니다.</p>';
    $("#studySubmissionStatus").textContent = "";
    return;
  }
  $("#adminStudySubmissionGroups").innerHTML = keys.map((key,index)=>{
    const rows = groups.get(key) || [];
    return `<details class="record-week-group" ${index===0?"open":""}>
      <summary><span><b>${escapeHtml(sundayGroupLabel(key))}</b><small>성경공부 ${rows.length}건</small></span><span class="record-week-counts"><span>성경 ${rows.length}</span></span></summary>
      <div class="record-week-body">${rows.map(row=>`
        <article class="list-item record-item">
          <div class="record-item-head"><div><b>성경공부 제출</b><div>${escapeHtml(row.grade)} ${escapeHtml(row.student_name)}</div></div>
          <button class="ghost danger-outline compact-btn study-submission-delete-btn" type="button" data-record-id="${escapeHtml(String(row.id))}">삭제</button></div>
          <ol>${(Array.isArray(row.answers)?row.answers:[]).map(v=>`<li>${escapeHtml(v)}</li>`).join("")}</ol>
          <div class="meta">${escapeHtml(recordTime(row.submitted_at))}</div>
        </article>`).join("")}</div>
    </details>`;
  }).join("");
  $("#studySubmissionStatus").textContent = `성경공부 답안 ${(sr.data||[]).length}건을 주일별로 불러왔습니다.`;
}

$("#refreshStudySubmissionsBtn")?.addEventListener("click", loadAdminStudySubmissions);
$("#adminStudySubmissionGroups")?.addEventListener("click", async e => {
  const btn = e.target.closest(".study-submission-delete-btn");
  if (!btn) return;
  if (!confirm("이 성경공부 제출 답안을 삭제할까요?\n\n삭제 후에는 되돌릴 수 없습니다.")) return;
  btn.disabled = true;
  $("#studySubmissionStatus").textContent = "성경공부 답안을 삭제하고 있습니다…";
  const result = await deleteAdminStudentRecord("study", btn.dataset.recordId);
  if (result.error) { btn.disabled=false; $("#studySubmissionStatus").textContent=dbErrorMessage(result.error,"성경공부 답안 삭제에 실패했습니다."); return; }
  await Promise.all([loadAdminStudySubmissions(), loadAdminRecords()]);
  $("#studySubmissionStatus").textContent = "성경공부 답안이 삭제되었습니다.";
});

async function loadAdminGratitude() {
  if (!isAdmin || !$("#adminGratitudeResults") || !$("#adminGratitudeGroups")) return;
  const status = $("#gratitudeAdminStatus");
  status.textContent = "감사기도 챌린지 결과를 불러오는 중입니다…";
  const { data, error } = await db.from("gratitude_prayers")
    .select("id,grade,student_name,prayer_date,gratitude_text,created_at")
    .order("prayer_date", {ascending:false})
    .limit(3000);
  if (error) {
    status.textContent = dbErrorMessage(error, "감사기도 챌린지 결과를 불러오지 못했습니다.");
    return;
  }

  const rows = data || [];
  const byStudent = new Map();
  rows.forEach(row => {
    const key = `${row.grade}|||${row.student_name}`;
    if (!byStudent.has(key)) byStudent.set(key, []);
    byStudent.get(key).push(row);
  });

  const students = [...byStudent.entries()].map(([key, items]) => {
    const [grade, student_name] = key.split("|||");
    const dates = items.map(x => ({date:x.prayer_date}));
    const stats = streakStats(dates);
    const lastDate = items.map(x=>x.prayer_date).filter(Boolean).sort().at(-1) || null;
    return { grade, student_name, current:stats.current, best:stats.best, total:items.length, lastDate };
  }).sort((a,b) => b.current-a.current || b.best-a.best || b.total-a.total || a.student_name.localeCompare(b.student_name,"ko"));

  $("#adminGratitudeResults").innerHTML = students.length ? students.map((student,index)=>`
    <article class="gratitude-admin-result-card ${student.current>0?"active":""}">
      <div class="gratitude-admin-student">
        <span class="gratitude-admin-rank">${index+1}</span>
        <div><b>${escapeHtml(student.grade)} ${escapeHtml(student.student_name)}</b><small>최근 기록 ${escapeHtml(fmtDate(student.lastDate))}</small></div>
      </div>
      <div class="gratitude-admin-metrics">
        <span><small>현재 연속</small><strong>${student.current>0?`🔥 ${student.current}일`:`0일`}</strong></span>
        <span><small>최고 연속</small><strong>${student.best}일</strong></span>
        <span><small>누적</small><strong>${student.total}일</strong></span>
      </div>
    </article>`).join("") : '<p class="muted">아직 감사기도 챌린지 기록이 없습니다.</p>';

  const groups = groupBySunday(rows, row => sundayForISO(row.prayer_date || row.created_at));
  const keys = [...groups.keys()].sort((a,b)=>String(b).localeCompare(String(a)));
  $("#adminGratitudeGroups").innerHTML = keys.length ? keys.map((key,index)=>{
    const groupRows = groups.get(key) || [];
    return `<details class="record-week-group gratitude-admin-week-group" ${index===0?"open":""}>
      <summary><span><b>${escapeHtml(sundayGroupLabel(key))}</b><small>감사기도 ${groupRows.length}건</small></span><span class="record-week-counts"><span>감사 ${groupRows.length}</span></span></summary>
      <div class="record-week-body">${groupRows.map(row=>`
        <article class="list-item record-item gratitude-admin-record">
          <div class="record-item-head"><div><b>${escapeHtml(row.grade)} ${escapeHtml(row.student_name)}</b><div class="meta">${escapeHtml(fmtDate(row.prayer_date))} · ${escapeHtml(recordTime(row.created_at))}</div></div>
          <button class="ghost danger-outline compact-btn gratitude-admin-delete-btn" type="button" data-record-id="${escapeHtml(String(row.id))}">삭제</button></div>
          <p>${escapeHtml(row.gratitude_text)}</p>
        </article>`).join("")}</div>
    </details>`;
  }).join("") : '<p class="muted">주일별 감사기도 기록이 없습니다.</p>';

  const activeCount = students.filter(x=>x.current>0).length;
  status.textContent = `학생 ${students.length}명 · 감사기도 ${rows.length}건 · 현재 챌린지 진행 ${activeCount}명`;
}

$("#refreshGratitudeAdminBtn")?.addEventListener("click", loadAdminGratitude);
$("#adminGratitudeGroups")?.addEventListener("click", async e => {
  const btn = e.target.closest(".gratitude-admin-delete-btn");
  if (!btn) return;
  if (!confirm("이 감사기도 기록을 삭제할까요?\n\n삭제 후에는 되돌릴 수 없습니다.")) return;
  btn.disabled = true;
  $("#gratitudeAdminStatus").textContent = "감사기도 기록을 삭제하고 있습니다…";
  const result = await db.from("gratitude_prayers").delete().eq("id", btn.dataset.recordId).select("id");
  if (result.error || !result.data?.length) {
    btn.disabled = false;
    $("#gratitudeAdminStatus").textContent = result.error
      ? dbErrorMessage(result.error, "감사기도 삭제에 실패했습니다.")
      : "삭제할 감사기도 기록을 찾지 못했습니다.";
    return;
  }
  await Promise.all([loadAdminGratitude(), loadAdminRecords()]);
  signalGratitudeServerChanged();
  $("#gratitudeAdminStatus").textContent = "감사기도 기록이 삭제되었고 학생 챌린지 화면에도 동기화됩니다.";
});

async function loadAdminBoardGroups() {
  if (!isAdmin || !$("#adminBoardGroups")) return;
  $("#boardAdminStatus").textContent = "익명 게시글을 불러오는 중입니다…";
  const { data, error } = await db.from("anonymous_posts")
    .select("id,body,reply_text,created_at,is_hidden")
    .order("created_at",{ascending:false}).limit(1000);
  if (error) { $("#boardAdminStatus").textContent=dbErrorMessage(error,"익명 게시글을 불러오지 못했습니다."); return; }
  const groups = groupBySunday(data, row => sundayForISO(row.created_at));
  const keys = [...groups.keys()].sort((x,y)=>String(y).localeCompare(String(x)));
  if (!keys.length) {
    $("#adminBoardGroups").innerHTML = '<p class="muted">아직 익명 게시글이 없습니다.</p>';
    $("#boardAdminStatus").textContent = "";
    return;
  }
  $("#adminBoardGroups").innerHTML = keys.map((key,index)=>{
    const rows = groups.get(key) || [];
    return `<details class="record-week-group" ${index===0?"open":""}>
      <summary><span><b>${escapeHtml(sundayGroupLabel(key))}</b><small>익명글 ${rows.length}건</small></span><span class="record-week-counts"><span>익명 ${rows.length}</span></span></summary>
      <div class="record-week-body">${rows.map(row=>`
        <article class="list-item record-item">
          <div class="record-item-head"><div><b>익명게시판${row.is_hidden?" · 숨김":""}</b><div class="meta">${escapeHtml(recordTime(row.created_at))}</div></div>
          <button class="ghost danger-outline compact-btn board-admin-delete-btn" type="button" data-record-id="${escapeHtml(String(row.id))}">삭제</button></div>
          <p>${escapeHtml(row.body)}</p>
          ${row.reply_text ? `<div class="banner"><b>관리자 답변</b><span>${escapeHtml(row.reply_text)}</span></div>` : ""}
        </article>`).join("")}</div>
    </details>`;
  }).join("");
  $("#boardAdminStatus").textContent = `익명 게시글 ${(data||[]).length}건을 주일별로 불러왔습니다.`;
}

$("#refreshBoardAdminBtn")?.addEventListener("click", loadAdminBoardGroups);
$("#adminBoardGroups")?.addEventListener("click", async e => {
  const btn = e.target.closest(".board-admin-delete-btn");
  if (!btn) return;
  if (!confirm("이 익명 게시글을 삭제할까요?\n\n삭제 후에는 되돌릴 수 없습니다.")) return;
  btn.disabled = true;
  $("#boardAdminStatus").textContent = "익명 게시글을 삭제하고 있습니다…";
  const result = await deleteAdminStudentRecord("board", btn.dataset.recordId);
  if (result.error) { btn.disabled=false; $("#boardAdminStatus").textContent=dbErrorMessage(result.error,"익명 게시글 삭제에 실패했습니다."); return; }
  await Promise.all([loadAdminBoardGroups(), loadBoard(), loadAdminRecords()]);
  $("#boardAdminStatus").textContent = "익명 게시글이 삭제되었습니다.";
});


async function loadAdminPrayers() {
  if(!isAdmin) return;
  const [w,p] = await Promise.all([
    db.from("weekly_contents").select("id,week_start,verse_reference").order("week_start",{ascending:false}),
    db.from("prayer_requests").select("*").order("submitted_at",{ascending:false}).limit(1000)
  ]);
  if(w.error||p.error){
    $("#prayerAdminStatus").textContent=dbErrorMessage(w.error||p.error,"기도제목을 불러오지 못했습니다.");
    return;
  }
  const weekMap=new Map((w.data||[]).map(row=>[String(row.id),sundayFromWeekStart(row.week_start)]));
  const groups=new Map();
  (p.data||[]).forEach(row=>{
    const sunday=weekMap.get(String(row.weekly_content_id||"")) || sundayForISO(row.submitted_at);
    if(!groups.has(sunday)) groups.set(sunday,[]);
    groups.get(sunday).push(row);
  });
  const keys=[...groups.keys()].sort((a,b)=>String(b).localeCompare(String(a)));
  if(!keys.length){
    $("#adminPrayerGroups").innerHTML='<p class="muted">아직 등록된 기도제목이 없습니다.</p>';
    $("#prayerAdminStatus").textContent="";
    return;
  }
  $("#adminPrayerGroups").innerHTML=keys.map((key,index)=>{
    const rows=groups.get(key)||[];
    return `<details class="record-week-group prayer-week-group" ${index===0?"open":""}>
      <summary><span><b>${escapeHtml(fmtDate(key))} 주일</b><small>기도제목 ${rows.length}건</small></span><span class="record-week-counts"><span>기도 ${rows.length}</span></span></summary>
      <div class="record-week-body">${rows.map(row=>`
        <article class="list-item record-item prayer-admin-record">
          <div class="record-item-head"><div><b>${row.is_private?"🔒 비공개 기도제목":"기도제목"}</b><div>${escapeHtml(row.grade)} ${escapeHtml(row.student_name)}</div></div>
          <button class="ghost danger-outline compact-btn prayer-admin-delete-btn" type="button" data-prayer-id="${escapeHtml(String(row.id))}">삭제</button></div>
          <p>${escapeHtml(row.prayer_text)}</p><div class="meta">${escapeHtml(recordTime(row.submitted_at))}</div>
        </article>`).join("")}</div>
    </details>`;
  }).join("");
  $("#prayerAdminStatus").textContent=`기도제목 ${p.data?.length||0}건을 주일별로 불러왔습니다.`;
}
async function deletePrayerRecordV15(id) {
  let result=await db.rpc("youth_admin_delete_prayer_v15",{p_prayer_id:String(id)});
  if(result.error && isMissingRpc(result.error,"youth_admin_delete_prayer_v15")) {
    result=await db.from("prayer_requests").delete().eq("id",id).select("id");
    if(!result.error && !result.data?.length) return {error:{code:"PGRST116",message:"삭제할 기도제목을 찾지 못했습니다."}};
  }
  return result;
}
$("#refreshPrayerAdminBtn")?.addEventListener("click",loadAdminPrayers);
$("#adminPrayerGroups")?.addEventListener("click",async e=>{
  const btn=e.target.closest(".prayer-admin-delete-btn");
  if(!btn) return;
  if(!isAdmin){ $("#prayerAdminStatus").textContent="관리자 로그인 후 삭제해 주세요."; return; }
  if(!confirm("이 기도제목을 삭제할까요?\n\n삭제 후에는 되돌릴 수 없습니다.")) return;
  btn.disabled=true;
  $("#prayerAdminStatus").textContent="기도제목을 삭제하고 있습니다…";
  const result=await deletePrayerRecordV15(btn.dataset.prayerId);
  if(result.error){ btn.disabled=false; $("#prayerAdminStatus").textContent=dbErrorMessage(result.error,"기도제목 삭제에 실패했습니다."); return; }
  await Promise.all([loadAdminPrayers(),loadAdminRecords()]);
  $("#prayerAdminStatus").textContent="기도제목이 삭제되었습니다.";
});

async function loadAdminRecords() {
  if (!isAdmin) return;
  $("#recordsAdminStatus").textContent = "주일별 제출 통계를 집계하는 중입니다…";
  const [w,a,sr,p,g,b] = await Promise.all([
    db.from("weekly_contents").select("id,week_start").order("week_start",{ascending:false}).limit(300),
    db.from("attendance").select("id,weekly_content_id,completed_at").order("completed_at",{ascending:false}).limit(2000),
    db.from("study_submissions").select("id,weekly_content_id,submitted_at").order("submitted_at",{ascending:false}).limit(2000),
    db.from("prayer_requests").select("id,weekly_content_id,submitted_at").order("submitted_at",{ascending:false}).limit(2000),
    db.from("gratitude_prayers").select("id,prayer_date,created_at").order("prayer_date",{ascending:false}).limit(2000),
    db.from("anonymous_posts").select("id,created_at").order("created_at",{ascending:false}).limit(2000)
  ]);
  const errors = [w,a,sr,p,g,b].map(x=>x.error).filter(Boolean);
  if (errors.length) {
    $("#recordsAdminStatus").textContent = dbErrorMessage(errors[0], "학생 제출 통계를 불러오지 못했습니다.");
    return;
  }

  const weekMap = weeklySundayMap(w.data);
  const records = [];
  const resolveSunday = (weeklyId, fallbackDate) => weekMap.get(String(weeklyId||"")) || sundayForISO(fallbackDate);
  (a.data||[]).forEach(x => records.push({type:"attendance", sunday:resolveSunday(x.weekly_content_id,x.completed_at)}));
  (sr.data||[]).forEach(x => records.push({type:"study", sunday:resolveSunday(x.weekly_content_id,x.submitted_at)}));
  (p.data||[]).forEach(x => records.push({type:"prayer", sunday:resolveSunday(x.weekly_content_id,x.submitted_at)}));
  (g.data||[]).forEach(x => records.push({type:"gratitude", sunday:sundayForISO(x.prayer_date || x.created_at)}));
  (b.data||[]).forEach(x => records.push({type:"board", sunday:sundayForISO(x.created_at)}));

  const groups = new Map();
  records.forEach(r => {
    const key = r.sunday || "unknown";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  });
  const keys = [...groups.keys()].sort((x,y)=>String(y).localeCompare(String(x)));
  const currentSunday = sundayForISO(localISODate());
  const current = groups.get(currentSunday) || [];
  const countCurrent = t => current.filter(r=>r.type===t).length;
  $("#recordWeekLabel").textContent = `${fmtDate(currentSunday)} 주일 기준`;
  $("#statAttendance").textContent = countCurrent("attendance");
  $("#statStudy").textContent = countCurrent("study");
  $("#statPrayer").textContent = countCurrent("prayer");
  $("#statGratitude").textContent = countCurrent("gratitude");
  $("#statBoard").textContent = countCurrent("board");

  if (!keys.length) {
    $("#adminRecords").innerHTML = '<p class="muted">아직 집계할 학생 제출 기록이 없습니다.</p>';
    $("#recordsAdminStatus").textContent = "";
    return;
  }

  $("#adminRecords").innerHTML = keys.map(key => {
    const group = groups.get(key) || [];
    const c = t => group.filter(r=>r.type===t).length;
    return `<article class="weekly-stat-card">
      <div class="weekly-stat-head"><div><b>${escapeHtml(sundayGroupLabel(key))}</b><small>총 ${group.length}건</small></div><span class="weekly-stat-total">${group.length}</span></div>
      <div class="weekly-stat-grid">
        <div><span>말씀쓰기</span><strong>${c("attendance")}</strong></div>
        <div><span>성경공부</span><strong>${c("study")}</strong></div>
        <div><span>기도제목</span><strong>${c("prayer")}</strong></div>
        <div><span>감사기도</span><strong>${c("gratitude")}</strong></div>
        <div><span>익명글</span><strong>${c("board")}</strong></div>
      </div>
    </article>`;
  }).join("");
  $("#recordsAdminStatus").textContent = `총 ${records.length}건을 ${keys.length}개 주일로 집계했습니다. 개인정보와 제출 내용은 표시하지 않습니다.`;
}

$("#retryConnectionBtn")?.addEventListener("click", async () => {
  await checkSupabaseConnection({reloadData:true});
});

await checkSupabaseConnection();

const { data:{session} } = await db.auth.getSession();
if(session?.user) await verifyAdmin(session.user);

renderGratitudeChallenge();
await Promise.all([loadWeekly(),loadNotices(),loadBoard(),loadPublicEventCalendar(),loadGratitudeLeaders()]);
