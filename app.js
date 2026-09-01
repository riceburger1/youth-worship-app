import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.4/+esm";

const SUPABASE_URL = "https://jdnxmkkyusktfiavfdwb.supabase.co";
const SUPABASE_KEY = "sb_publishable_swA-gv1uwixyiN-qZUYLzQ_J6oqxGiI";
const db = createClient(SUPABASE_URL, SUPABASE_KEY);
const APP_VERSION = "v8-admin-content-editor";
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

let weekly = null;
let questions = [];
let deferredPrompt = null;
let isAdmin = false;
let gratitudeCalendarCursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let adminWeeklyId = null;
let adminWeeklyRows = [];
let adminNoticeId = null;
let adminNoticeRows = [];

const PROFILE_STORAGE_KEY = "주의울림-profile-v2";
const GRATITUDE_PREFIX = "주의울림-gratitude-v2:";

function profile() {
  return { grade: $("#grade").value, name: clean($("#studentName").value) };
}
function requireProfile(statusEl) {
  const p = profile();
  if (!p.grade || !p.name) {
    statusEl.textContent = "학년과 이름을 먼저 입력해 주세요.";
    $("#studentIdentity").scrollIntoView({behavior:"smooth", block:"center"});
    return null;
  }
  return p;
}
function saveProfile() {
  const p = profile();
  if (p.grade || p.name) localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(p));
  renderGratitudeChallenge();
}
function restoreProfile() {
  try {
    const p = JSON.parse(localStorage.getItem(PROFILE_STORAGE_KEY) || "null");
    if (p?.grade) $("#grade").value = p.grade;
    if (p?.name) $("#studentName").value = p.name;
  } catch {}
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
  $("#gratitudeSubmitBtn").disabled = doneToday;
  renderGratitudeCalendar(rows, stats, ready);
  renderGratitudeBadges(stats, ready);
  if (!ready) {
    $("#gratitudeHistory").innerHTML = '<p class="muted">내 정보에서 학년과 이름을 입력하면 챌린지 기록이 표시됩니다.</p>';
    return;
  }
  $("#gratitudeHistory").innerHTML = rows.length ? rows.slice(0,14).map((r,i)=>`
    <article class="gratitude-record ${i===0&&r.date===today?"today":""}">
      <div class="gratitude-date"><span>${fmtDate(r.date)}</span>${r.date===today?'<b>오늘</b>':''}</div>
      <p>${escapeHtml(r.text || "감사기도 기록 완료")}</p>
    </article>`).join("") : '<p class="muted">아직 기록이 없습니다. 오늘 첫 감사기도를 남겨 보세요.</p>';
}

restoreProfile();
$("#grade").addEventListener("change", saveProfile);
$("#studentName").addEventListener("input", saveProfile);

$$(".tab").forEach(btn => btn.addEventListener("click", () => {
  $$(".tab").forEach(x => x.classList.toggle("active", x === btn));
  $$(".panel").forEach(p => p.classList.add("hidden"));
  $("#" + btn.dataset.tab).classList.remove("hidden");
  if (btn.dataset.tab === "gratitude") renderGratitudeChallenge();
}));
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
  $("#wordStatus").textContent = "말씀을 직접 입력해 주세요.";
  await loadQuestions();
}

async function loadQuestions() {
  if (!weekly) return;
  const { data } = await db.from("study_questions").select("*")
    .eq("weekly_content_id", weekly.id).order("question_order");
  questions = data || [];
  $("#studyQuestions").innerHTML = questions.map((q,i)=>`
    <label class="field-label">${i+1}. ${escapeHtml(q.question_text)}
      <textarea data-answer="${i}" rows="4" maxlength="2000" required placeholder="내 생각을 적어 주세요."></textarea>
    </label>`).join("");
}

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
  $("#completeWordBtn").disabled = !exact;
  if (exact) $("#wordStatus").textContent = "말씀을 정확하게 완성했습니다. 출석 버튼을 눌러 주세요.";
  else if (!input) $("#wordStatus").textContent = "말씀을 직접 입력해 주세요.";
  else if (matched === input.length) $("#wordStatus").textContent = "좋아요. 계속 입력해 주세요.";
  else $("#wordStatus").textContent = "다른 글자가 있습니다. 본문을 다시 확인해 주세요.";
});

$("#completeWordBtn").addEventListener("click", async () => {
  const p = requireProfile($("#wordStatus"));
  if (!p || !weekly) return;
  if (normalize(verseInput.value) !== normalize(weekly.verse_text)) return;
  const { error } = await db.from("attendance").insert({
    weekly_content_id: weekly.id, grade:p.grade, student_name:p.name
  });
  if (error) {
    $("#wordStatus").textContent = error.code === "23505"
      ? "이미 이번 주 말씀쓰기 출석이 완료되어 있습니다."
      : "저장 중 오류가 발생했습니다.";
    return;
  }
  $("#wordStatus").textContent = "완료! 말씀쓰기와 출석이 기록되었습니다.";
  $("#completeWordBtn").disabled = true;
});

$("#studyForm").addEventListener("submit", async e => {
  e.preventDefault();
  const p = requireProfile($("#studyStatus"));
  if (!p || !weekly) return;
  const answers = $$("[data-answer]").map(x => clean(x.value));
  if (answers.length < 2 || answers.some(x => !x)) {
    $("#studyStatus").textContent = "모든 질문에 답을 작성해 주세요.";
    return;
  }
  const { error } = await db.from("study_submissions").insert({
    weekly_content_id: weekly.id, grade:p.grade, student_name:p.name, answers
  });
  $("#studyStatus").textContent = error ? "제출 중 오류가 발생했습니다." : "성경공부 나눔이 제출되었습니다.";
  if (!error) e.target.reset();
});

$("#prayerForm").addEventListener("submit", async e => {
  e.preventDefault();
  const p = requireProfile($("#prayerStatus"));
  const text = clean($("#prayerText").value);
  if (!p) return;
  if (!text) { $("#prayerStatus").textContent = "기도제목을 입력해 주세요."; return; }
  const { error } = await db.from("prayer_requests").insert({
    weekly_content_id: weekly?.id ?? null, grade:p.grade, student_name:p.name,
    prayer_text:text, is_private:$("#prayerPrivate").checked
  });
  $("#prayerStatus").textContent = error ? "제출 중 오류가 발생했습니다." : "기도제목이 제출되었습니다.";
  if (!error) e.target.reset();
});

$("#gratitudeForm").addEventListener("submit", async e => {
  e.preventDefault();
  const p = requireProfile($("#gratitudeStatus"));
  if (!p) return;
  const text = clean($("#gratitudeText").value);
  if (!text) { $("#gratitudeStatus").textContent = "오늘 감사한 내용을 적어 주세요."; return; }
  const today = localISODate();
  let localRows = getLocalGratitude(p);
  const beforeStats = streakStats(localRows);
  if (localRows.some(x=>x.date===today)) {
    $("#gratitudeStatus").textContent = "오늘 감사기도는 이미 기록했습니다. 내일 다시 이어가세요!";
    renderGratitudeChallenge();
    return;
  }
  $("#gratitudeSubmitBtn").disabled = true;
  $("#gratitudeStatus").textContent = "감사기도를 기록하고 있습니다...";
  const { error } = await db.from("gratitude_prayers").insert({
    grade:p.grade, student_name:p.name, prayer_date:today, gratitude_text:text
  });
  if (error && error.code !== "23505") {
    $("#gratitudeSubmitBtn").disabled = false;
    $("#gratitudeStatus").textContent = error.code === "PGRST205"
      ? "감사기도 기능 준비가 필요합니다. Supabase에서 감사기도 SQL을 먼저 실행해 주세요."
      : "감사기도 저장 중 오류가 발생했습니다.";
    return;
  }
  const localText = error?.code === "23505" ? "오늘 감사기도 기록 완료(다른 기기에서 먼저 기록됨)" : text;
  localRows = [{date:today,text:localText,createdAt:new Date().toISOString()}, ...localRows.filter(x=>x.date!==today)];
  setLocalGratitude(p, localRows);
  e.target.reset();
  renderGratitudeChallenge();
  const stats = streakStats(localRows);
  let badgeMessage = "";
  if (beforeStats.best < 30 && stats.best >= 30) badgeMessage = " 🏆 30일 감사습관 배지를 획득했습니다!";
  else if (beforeStats.best < 7 && stats.best >= 7) badgeMessage = " 🏅 7일 감사습관 배지를 획득했습니다!";
  $("#gratitudeStatus").textContent = `오늘의 감사기도 완료! 현재 ${stats.current}일 연속 기록 중입니다. 🔥${badgeMessage}`;
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
  if (!body) { $("#boardStatus").textContent = "내용을 입력해 주세요."; return; }
  const { error } = await db.from("anonymous_posts").insert({body});
  $("#boardStatus").textContent = error ? "등록 중 오류가 발생했습니다." : "익명으로 등록되었습니다.";
  if (!error) { e.target.reset(); await loadBoard(); }
});
async function loadBoard() {
  const { data } = await db.from("anonymous_posts").select("id,body,reply_text,created_at")
    .eq("is_hidden",false).order("created_at",{ascending:false}).limit(50);
  const rows = data || [];
  $("#boardList").innerHTML = rows.length ? rows.map(p=>`
    <article class="list-item"><div class="meta">${new Date(p.created_at).toLocaleString("ko-KR")}</div>
    <p>${escapeHtml(p.body)}</p>
    ${p.reply_text ? `<div class="banner"><b>관리자 답변</b><span>${escapeHtml(p.reply_text)}</span></div>` : ""}</article>`).join("")
    : '<p class="muted">아직 등록된 글이 없습니다.</p>';
}

$("#openAdminBtn").addEventListener("click", () => $("#adminPanel").classList.toggle("hidden"));
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
  $("#weeklyAdminStatus").textContent = "관리자 콘텐츠 편집 v9 준비 완료.";
  await Promise.all([loadAdminWeeklyOptions(), loadAdminNoticeOptions(), loadAdminRecords()]);
}
function setAdminState(value) {
  isAdmin = value;
  $("#adminLoginForm").classList.toggle("hidden", value);
  $("#adminWorkspace").classList.toggle("hidden", !value);
  $("#adminLogoutBtn").classList.toggle("hidden", !value);
}
$("#adminLogoutBtn").addEventListener("click", async () => { await db.auth.signOut(); setAdminState(false); });
$("#refreshAdminBtn").addEventListener("click", async () => {
  await Promise.all([loadAdminWeeklyOptions(adminWeeklyId), loadAdminNoticeOptions(adminNoticeId), loadAdminRecords()]);
});

function currentMondayISO() {
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay()+6)%7));
  return localISODate(monday);
}

function resetWeeklyEditor() {
  adminWeeklyId = null;
  $("#weeklyPicker").value = "__new__";
  $("#weekStart").value = currentMondayISO();
  $("#adminVerseRef").value = "";
  $("#adminVerseText").value = "";
  $("#adminStudyTitle").value = "";
  $("#adminQ1").value = "";
  $("#adminQ2").value = "";
  $("#adminQ3").value = "";
  $("#weeklyPublished").checked = true;
  $("#weeklyModeLabel").textContent = "새 주차 등록 모드입니다.";
  $("#weeklySubmitBtn").textContent = "말씀·문제 등록";
  $("#weeklyAdminStatus").textContent = "새 말씀과 성경공부 문제를 입력해 주세요.";
}

async function loadAdminWeeklyOptions(preferredId = null) {
  if (!isAdmin) return;
  const { data, error } = await db.from("weekly_contents").select("*").order("week_start", {ascending:false});
  if (error) {
    $("#weeklyAdminStatus").textContent = dbErrorMessage(error, "기존 말씀 목록을 불러오지 못했습니다.");
    return;
  }
  adminWeeklyRows = data || [];
  $("#weeklyPicker").innerHTML = '<option value="__new__">＋ 새 주차 등록</option>' + adminWeeklyRows.map(r =>
    `<option value="${escapeHtml(String(r.id))}">${escapeHtml(r.week_start || "날짜 없음")} · ${escapeHtml(r.verse_reference || "말씀 미입력")} · ${r.published ? "공개" : "비공개"}</option>`
  ).join("");
  const target = preferredId && adminWeeklyRows.some(r=>String(r.id)===String(preferredId))
    ? String(preferredId)
    : (adminWeeklyRows[0] ? String(adminWeeklyRows[0].id) : "__new__");
  $("#weeklyPicker").value = target;
  if (target === "__new__") resetWeeklyEditor();
  else await loadAdminWeeklyEditor(target);
}

async function loadAdminWeeklyEditor(id) {
  const row = adminWeeklyRows.find(r => String(r.id) === String(id));
  if (!row) return resetWeeklyEditor();
  adminWeeklyId = String(row.id);
  $("#weekStart").value = row.week_start || currentMondayISO();
  $("#adminVerseRef").value = row.verse_reference || "";
  $("#adminVerseText").value = row.verse_text || "";
  $("#adminStudyTitle").value = row.study_title || "";
  $("#weeklyPublished").checked = Boolean(row.published);
  $("#weeklyModeLabel").textContent = `${row.week_start || "날짜 없음"} 기록을 수정 중입니다.`;
  $("#weeklySubmitBtn").textContent = "말씀·문제 수정 저장";
  $("#weeklyAdminStatus").textContent = "기존 말씀과 성경공부 문제를 불러왔습니다.";
  const { data, error } = await db.from("study_questions").select("*").eq("weekly_content_id", row.id).order("question_order");
  if (error) {
    $("#weeklyAdminStatus").textContent = dbErrorMessage(error, "성경공부 문제를 불러오지 못했습니다.");
    return;
  }
  const qs = data || [];
  $("#adminQ1").value = qs[0]?.question_text || "";
  $("#adminQ2").value = qs[1]?.question_text || "";
  $("#adminQ3").value = qs[2]?.question_text || "";
}

$("#weeklyPicker").addEventListener("change", async e => {
  if (e.target.value === "__new__") resetWeeklyEditor();
  else await loadAdminWeeklyEditor(e.target.value);
});
$("#newWeeklyBtn").addEventListener("click", resetWeeklyEditor);

async function directSaveWeekly(payload, qs) {
  let wid = adminWeeklyId;
  if (wid) {
    const upd = await db.from("weekly_contents").update(payload).eq("id", wid).select("id").maybeSingle();
    if (upd.error) return {error:upd.error};
    if (!upd.data?.id) return {error:{code:"PGRST116",message:"수정 대상 말씀을 다시 읽지 못했습니다."}};
    wid = String(upd.data.id);
  } else {
    const existing = await db.from("weekly_contents").select("id").eq("week_start", payload.week_start).limit(1).maybeSingle();
    if (existing.error) return {error:existing.error};
    if (existing.data?.id) {
      const upd = await db.from("weekly_contents").update(payload).eq("id", existing.data.id).select("id").maybeSingle();
      if (upd.error) return {error:upd.error};
      wid = String(existing.data.id);
    } else {
      const ins = await db.from("weekly_contents").insert(payload).select("id").single();
      if (ins.error) return {error:ins.error};
      wid = String(ins.data.id);
    }
  }
  const del = await db.from("study_questions").delete().eq("weekly_content_id", wid);
  if (del.error) return {error:del.error, partial:true};
  const insQ = await db.from("study_questions").insert(qs.map((text,i)=>({
    weekly_content_id: wid, question_order:i+1, question_text:text
  })));
  if (insQ.error) return {error:insQ.error, partial:true};
  return {id:wid};
}

async function saveWeeklyContent(payload, qs) {
  const rpc = await db.rpc("youth_admin_save_weekly", {
    p_content_id: adminWeeklyId || null,
    p_week_start: payload.week_start,
    p_verse_reference: payload.verse_reference,
    p_verse_text: payload.verse_text,
    p_study_title: payload.study_title,
    p_published: payload.published,
    p_questions: qs
  });
  if (!rpc.error) return {id:String(rpc.data)};
  // SQL 함수를 아직 적용하지 않은 경우에만 기존 Data API 방식으로 자동 대체합니다.
  if (["PGRST202","42883"].includes(rpc.error.code) || String(rpc.error.message || "").includes("youth_admin_save_weekly")) {
    return directSaveWeekly(payload, qs);
  }
  return {error:rpc.error};
}

$("#weeklyForm").addEventListener("submit", async e => {
  e.preventDefault();
  const status = $("#weeklyAdminStatus");
  if (!isAdmin) { status.textContent = "관리자 로그인 후 저장해 주세요."; return; }
  const payload = {
    week_start: $("#weekStart").value,
    verse_reference: clean($("#adminVerseRef").value),
    verse_text: clean($("#adminVerseText").value),
    study_title: clean($("#adminStudyTitle").value),
    published: $("#weeklyPublished").checked
  };
  const qs = [clean($("#adminQ1").value), clean($("#adminQ2").value), clean($("#adminQ3").value)].filter(Boolean);
  if (!payload.week_start || !payload.verse_reference || !payload.verse_text || !payload.study_title || qs.length < 2) {
    status.textContent = "주 시작일, 말씀, 성경공부 제목과 질문 2개 이상을 입력해 주세요.";
    return;
  }
  const wasEditing = Boolean(adminWeeklyId);
  status.textContent = wasEditing ? "기존 말씀과 문제를 수정하고 있습니다…" : "새 말씀과 문제를 등록하고 있습니다…";
  $("#weeklySubmitBtn").disabled = true;
  const result = await saveWeeklyContent(payload, qs);
  $("#weeklySubmitBtn").disabled = false;
  if (result.error) {
    status.textContent = dbErrorMessage(result.error, wasEditing ? "말씀·성경공부 수정에 실패했습니다." : "말씀·성경공부 등록에 실패했습니다.");
    return;
  }
  adminWeeklyId = result.id;
  await loadAdminWeeklyOptions(adminWeeklyId);
  await loadWeekly();
  await loadAdminRecords();
  status.textContent = wasEditing ? "말씀과 성경공부 문제가 수정되었습니다." : "말씀과 성경공부 문제가 등록되었습니다.";
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
  $("#noticeAdminStatus").textContent = "기존 공지 내용을 불러왔습니다.";
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

async function loadAdminRecords() {
  if(!isAdmin)return;
  const weekId = adminWeeklyId || weekly?.id;
  const [a,s,p,g,b] = await Promise.all([
    weekId ? db.from("attendance").select("*").eq("weekly_content_id",weekId).order("completed_at",{ascending:false}) : Promise.resolve({data:[]}),
    weekId ? db.from("study_submissions").select("*").eq("weekly_content_id",weekId).order("submitted_at",{ascending:false}) : Promise.resolve({data:[]}),
    weekId ? db.from("prayer_requests").select("*").eq("weekly_content_id",weekId).order("submitted_at",{ascending:false}) : Promise.resolve({data:[]}),
    db.from("gratitude_prayers").select("*").gte("prayer_date", $("#weekStart").value || localISODate()).order("prayer_date",{ascending:false}).order("created_at",{ascending:false}),
    db.from("anonymous_posts").select("*").order("created_at",{ascending:false}).limit(100)
  ]);
  $("#statAttendance").textContent=a.data?.length||0;
  $("#statStudy").textContent=s.data?.length||0;
  $("#statPrayer").textContent=p.data?.length||0;
  $("#statGratitude").textContent=g.data?.length||0;
  $("#statBoard").textContent=b.data?.length||0;
  const rows=[];
  (a.data||[]).forEach(x=>rows.push(`<article class="list-item"><b>말씀쓰기 · 출석</b><div>${escapeHtml(x.grade)} ${escapeHtml(x.student_name)}</div><div class="meta">${new Date(x.completed_at).toLocaleString("ko-KR")}</div></article>`));
  (s.data||[]).forEach(x=>rows.push(`<article class="list-item"><b>성경공부</b><div>${escapeHtml(x.grade)} ${escapeHtml(x.student_name)}</div><ol>${(x.answers||[]).map(v=>`<li>${escapeHtml(v)}</li>`).join("")}</ol></article>`));
  (p.data||[]).forEach(x=>rows.push(`<article class="list-item"><b>기도제목${x.is_private?" · 비공개":""}</b><div>${escapeHtml(x.grade)} ${escapeHtml(x.student_name)}</div><p>${escapeHtml(x.prayer_text)}</p></article>`));
  (g.data||[]).forEach(x=>rows.push(`<article class="list-item gratitude-admin-record"><b>감사기도 · ${fmtDate(x.prayer_date)}</b><div>${escapeHtml(x.grade)} ${escapeHtml(x.student_name)}</div><p>${escapeHtml(x.gratitude_text)}</p></article>`));
  $("#adminRecords").innerHTML=rows.length?rows.join(""):'<p class="muted">이번 주 제출 기록이 없습니다.</p>';
}

$("#weekStart").value = currentMondayISO();

const { data:{session} } = await db.auth.getSession();
if(session?.user) await verifyAdmin(session.user);

renderGratitudeChallenge();
await Promise.all([loadWeekly(),loadNotices(),loadBoard()]);
