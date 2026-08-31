import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.4/+esm";

const SUPABASE_URL = "https://jdnxmkkyusktfiavfdwb.supabase.co";
const SUPABASE_KEY = "sb_publishable_swA-gv1uwixyiN-qZUYLzQ_J6oqxGiI";
const db = createClient(SUPABASE_URL, SUPABASE_KEY);

const $ = (q) => document.querySelector(q);
const $$ = (q) => [...document.querySelectorAll(q)];
const clean = (s) => String(s ?? "").replace(/\s+/g," ").trim();
const normalize = (s) => clean(s).replace(/\s/g,"");
const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

let weekly = null;
let questions = [];
let deferredPrompt = null;
let isAdmin = false;

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
function renderGratitudeChallenge() {
  const p = profile();
  const ready = p.grade && p.name;
  const rows = ready ? getLocalGratitude(p).sort((a,b)=>String(b.date).localeCompare(String(a.date))) : [];
  const stats = streakStats(rows);
  const today = localISODate();
  const doneToday = rows.some(x=>x.date===today);
  $("#gratitudeStreak").textContent = `${stats.current}일`;
  $("#gratitudeBest").textContent = `${stats.best}일`;
  $("#gratitudeToday").textContent = doneToday ? "완료 ✓" : "미기록";
  $("#gratitudeCount").textContent = `${rows.length}회`;
  $("#gratitudeSubmitBtn").disabled = doneToday;
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
if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js"));

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
  $("#weekStart").value = data.week_start;
  $("#adminVerseRef").value = data.verse_reference;
  $("#adminVerseText").value = data.verse_text;
  $("#adminStudyTitle").value = data.study_title;
  $("#weeklyPublished").checked = data.published;
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
  $("#adminQ1").value = questions[0]?.question_text || "";
  $("#adminQ2").value = questions[1]?.question_text || "";
  $("#adminQ3").value = questions[2]?.question_text || "";
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
  $("#gratitudeStatus").textContent = `오늘의 감사기도 완료! 현재 ${stats.current}일 연속 기록 중입니다. 🔥`;
});

async function loadNotices() {
  const { data } = await db.from("notices").select("*").eq("published",true)
    .order("event_date",{ascending:true,nullsFirst:false}).order("created_at",{ascending:false});
  const rows = data || [];
  $("#noticeList").innerHTML = rows.length ? rows.map(n=>`
    <article class="list-item"><div class="meta">${fmtDate(n.event_date)}</div>
    <h3>${escapeHtml(n.title)}</h3><div>${escapeHtml(n.body).replace(/\n/g,"<br>")}</div></article>`).join("")
    : '<p class="muted">등록된 공지사항이 없습니다.</p>';
  const banners = rows.filter(n=>n.banner).slice(0,3);
  $("#bannerArea").innerHTML = banners.map(n=>`
    <div class="banner"><b>${escapeHtml(n.title)}</b><small>${fmtDate(n.event_date)} · ${escapeHtml(n.body)}</small></div>`).join("");
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
  const { data } = await db.from("admin_users").select("user_id").eq("user_id",user.id).maybeSingle();
  if (!data) {
    await db.auth.signOut();
    $("#adminLoginStatus").textContent = "관리자 권한이 없는 계정입니다.";
    return setAdminState(false);
  }
  $("#adminLoginStatus").textContent = "";
  setAdminState(true);
  await loadAdminRecords();
}
function setAdminState(value) {
  isAdmin = value;
  $("#adminLoginForm").classList.toggle("hidden", value);
  $("#adminWorkspace").classList.toggle("hidden", !value);
  $("#adminLogoutBtn").classList.toggle("hidden", !value);
}
$("#adminLogoutBtn").addEventListener("click", async () => { await db.auth.signOut(); setAdminState(false); });
$("#refreshAdminBtn").addEventListener("click", loadAdminRecords);

$("#weeklyForm").addEventListener("submit", async e => {
  e.preventDefault();
  if (!isAdmin) return;
  const payload = {
    week_start:$("#weekStart").value, verse_reference:clean($("#adminVerseRef").value),
    verse_text:clean($("#adminVerseText").value), study_title:clean($("#adminStudyTitle").value),
    published:$("#weeklyPublished").checked, updated_at:new Date().toISOString()
  };
  let res;
  if (weekly && weekly.week_start === payload.week_start) {
    res = await db.from("weekly_contents").update(payload).eq("id",weekly.id).select().single();
  } else {
    res = await db.from("weekly_contents").upsert(payload,{onConflict:"week_start"}).select().single();
  }
  if (res.error) { $("#weeklyAdminStatus").textContent="저장에 실패했습니다."; return; }
  const wid = res.data.id;
  await db.from("study_questions").delete().eq("weekly_content_id",wid);
  const qs=[clean($("#adminQ1").value),clean($("#adminQ2").value),clean($("#adminQ3").value)].filter(Boolean);
  const qres=await db.from("study_questions").insert(qs.map((text,i)=>({weekly_content_id:wid,question_order:i+1,question_text:text})));
  $("#weeklyAdminStatus").textContent=qres.error?"질문 저장에 실패했습니다.":"말씀과 성경공부 문제가 저장되었습니다.";
  await loadWeekly();
});

$("#noticeAdminForm").addEventListener("submit", async e => {
  e.preventDefault();
  const { error } = await db.from("notices").insert({
    title:clean($("#noticeTitle").value), event_date:$("#noticeDate").value||null,
    body:clean($("#noticeBody").value), banner:$("#noticeBanner").checked, published:true
  });
  $("#noticeAdminStatus").textContent=error?"공지 등록에 실패했습니다.":"공지사항이 등록되었습니다.";
  if(!error){e.target.reset();$("#noticeBanner").checked=true;await loadNotices();}
});

async function loadAdminRecords() {
  if(!isAdmin)return;
  const weekId = weekly?.id;
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

const today = new Date();
const monday = new Date(today);
monday.setDate(today.getDate() - ((today.getDay()+6)%7));
$("#weekStart").value=[monday.getFullYear(),String(monday.getMonth()+1).padStart(2,"0"),String(monday.getDate()).padStart(2,"0")].join("-");

const { data:{session} } = await db.auth.getSession();
if(session?.user) await verifyAdmin(session.user);

renderGratitudeChallenge();
await Promise.all([loadWeekly(),loadNotices(),loadBoard()]);
