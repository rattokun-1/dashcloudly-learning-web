const STORAGE_KEY = 'dashcloudly-public-kobun-v1';
let cloudSaveTimer = null;
let cloudRestoreComplete = false;
const WELCOME_ACCEPTED_KEY = 'systan_welcome_terms_accepted_v1';
const SCHOOL_CODE_KEY = 'systan_school_code_v1';
const SCHOOL_CODE_NAME_KEY = 'systan_school_name_v1';
const SCHOOL_LOGO_KEY_PREFIX = 'systan_school_logo_v1_';
// 管理者のみ参加コードを発行できます。公開前に管理者のGoogleメールまたはUIDを設定してください。
const ADMIN_EMAILS = window.DASHCLOUDLY_CONFIG.adminEmails || [];
const ADMIN_UIDS = window.DASHCLOUDLY_CONFIG.adminUids || [];

const USER_SUSPENDED_MESSAGE = '現在、このアカウントは管理者によって、利用停止の状態にさせられています。管理者までお問い合わせください。';

const firebaseConfig = window.DASHCLOUDLY_CONFIG.firebase || {projectId:"local-demo"};
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

const MAINTENANCE_SETTINGS_COLLECTION = 'appSettings';
const MAINTENANCE_SETTINGS_DOC = 'global';
// update.htmlでアプリ更新・Cookie/キャッシュ削除が完了した端末だけ、
// 現在のメンテナンスを自動解除して通常画面へ戻します。
const MAINTENANCE_RELEASE_ID = '2026.05.09-update-cleanup-1';
const MAINTENANCE_CLEANUP_DONE_KEY = 'systan_maintenance_cleanup_done_v1';

function getMaintenanceReleaseId(settings) {
  return String((settings && settings.maintenanceReleaseId) || MAINTENANCE_RELEASE_ID);
}

function isMaintenanceCleanupDoneForDevice(settings) {
  try {
    const requiredId = getMaintenanceReleaseId(settings);
    return localStorage.getItem(MAINTENANCE_CLEANUP_DONE_KEY) === requiredId;
  } catch (e) {
    return false;
  }
}

function waitForAuthReady(timeoutMs = 2500) {
  return new Promise(resolve => {
    let done = false;
    const finish = (user) => {
      if (done) return;
      done = true;
      if (unsubscribe) unsubscribe();
      resolve(user || null);
    };
    let unsubscribe = null;
    try {
      unsubscribe = auth.onAuthStateChanged(user => finish(user));
    } catch (e) {
      resolve(auth.currentUser || null);
      return;
    }
    setTimeout(() => finish(auth.currentUser || null), timeoutMs);
  });
}

async function getGlobalAppSettings() {
  try {
    const snap = await db.collection(MAINTENANCE_SETTINGS_COLLECTION).doc(MAINTENANCE_SETTINGS_DOC).get();
    return snap.exists ? (snap.data() || {}) : {};
  } catch (e) {
    console.warn('getGlobalAppSettings error:', e);
    return {};
  }
}

async function enforceMaintenanceMode() {
  const settings = await getGlobalAppSettings();
  const maintenanceOn = settings.maintenanceMode === true;
  if (!maintenanceOn) return false;

  // この端末で update.html の自動更新・Cookie削除が完了している場合は、
  // メンテナンス画面に戻さず通常利用を許可します。
  if (isMaintenanceCleanupDoneForDevice(settings)) {
    return false;
  }

  const user = await waitForAuthReady();
  const adminByEmail = user && ADMIN_EMAILS.map(v => String(v).toLowerCase()).includes(String(user.email || '').toLowerCase());
  const adminByUid = user && ADMIN_UIDS.includes(user.uid);

  if (adminByEmail || adminByUid) {
    return false;
  }

  const target = './update.html?maintenance=1&v=' + Date.now();
  window.location.replace(target);
  return true;
}

async function setMaintenanceModeOneTap(enabled) {
  if (!auth.currentUser || !isSchoolAdmin()) {
    showSyncStatus('管理者のみ変更できます', true);
    return;
  }
  try {
    const payload = {
      maintenanceMode: !!enabled,
      updatedByUid: auth.currentUser.uid,
      updatedByEmail: auth.currentUser.email || '',
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    // ONにするたびにリリースIDを更新し、過去の完了済み端末まで無条件で通さないようにします。
    if (enabled) {
      payload.maintenanceReleaseId = 'maintenance-' + Date.now();
    }
    await db.collection(MAINTENANCE_SETTINGS_COLLECTION).doc(MAINTENANCE_SETTINGS_DOC).set(payload, { merge: true });
    showSyncStatus(enabled ? 'メンテナンスをONにしました' : 'メンテナンスをOFFにしました');
    await loadAdminDashboard();
  } catch (e) {
    console.warn('setMaintenanceModeOneTap error:', e);
    showSyncStatus('メンテナンス設定の変更に失敗しました', true);
  }
}

// =========================================================
// SOUND EFFECTS
// =========================================================
let audioCtx = null;
let soundUnlocked = false;

function ensureAudioContext() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  if (!audioCtx) audioCtx = new AudioCtx();
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  soundUnlocked = true;
  return audioCtx;
}

function unlockSound() {
  ensureAudioContext();
}

document.addEventListener('pointerdown', unlockSound, { passive: true });
document.addEventListener('keydown', unlockSound);

function playTone(freq, startAt, duration, type = 'sine', volume = 0.05) {
  const ctx = ensureAudioContext();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, startAt);
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(volume, startAt + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(startAt);
  osc.stop(startAt + duration + 0.02);
}

function playCorrectSound() {
  const ctx = ensureAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime + 0.01;
  playTone(880, now, 0.10, 'sine', 0.045);
  playTone(1174.66, now + 0.11, 0.16, 'sine', 0.05);
}

function playWrongSound() {
  const ctx = ensureAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime + 0.01;
  playTone(330, now, 0.12, 'square', 0.04);
  playTone(220, now + 0.10, 0.18, 'square', 0.04);
}

function playFinishSound() {
  const ctx = ensureAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime + 0.01;
  playTone(523.25, now, 0.12, 'triangle', 0.04);
  playTone(659.25, now + 0.13, 0.12, 'triangle', 0.04);
  playTone(783.99, now + 0.26, 0.14, 'triangle', 0.045);
  playTone(1046.50, now + 0.41, 0.28, 'triangle', 0.05);
}

// =========================================================
// OFFLINE CACHE / DATA SAVER
// =========================================================
const APP_CACHE_VERSION = '2026.10.11-account-dock-v7';

async function registerOfflineCache() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register('./sw.js?v=' + encodeURIComponent(APP_CACHE_VERSION));
    // Reload once when the new worker takes control so an open tab picks up the new app shell.
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (sessionStorage.getItem('systan-sw-reloaded') === APP_CACHE_VERSION) return;
      sessionStorage.setItem('systan-sw-reloaded', APP_CACHE_VERSION);
      location.reload();
    });
    if (reg && reg.update && navigator.onLine) reg.update().catch(() => {});
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && navigator.onLine) reg.update().catch(() => {});
    });
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'CACHE_READY') {
        if (typeof showSyncStatus === 'function') showSyncStatus('オフライン用データを保存しました');
      }
    });
  } catch (err) {
    console.warn('Service Worker registration failed:', err);
  }
}

registerOfflineCache();

// =========================================================
// WORD DATA
// =========================================================
const WORDS_RAW = window.DASHCLOUDLY_CONTENT.words;
const WORDS = WORDS_RAW.map(([isNew, id, en, jp]) => ({ isNew, id, en, jp }));
const RANKINGS_COLLECTION = 'rankingsKobun';
const WORD_MAP = {};
WORDS.forEach(w => WORD_MAP[w.id] = w);

function getWordPhonetic(word) {
  if (!word) return '';
  const phonetic = word.phonetic || word.kana || '';
  return typeof phonetic === 'string' ? phonetic.trim() : '';
}

const SET_SIZE = 50;
const WRONG_THRESHOLD = 10;
const TOTAL_SETS = Math.ceil(WORDS.length / SET_SIZE);

// =========================================================
// STATE
// =========================================================
let progress = {}; // wordId → { q1, q2, q3 }
let bookmarks = new Set(); // bookmarked wordIds
let currentSetIdx = 0;
let selectedMode = 1;
let selectedRetest = 'all'; // 'all' | 'mix' | 'circle' | 'cross' | 'bookmark'
let selectedBmMode = 1;    // mode selector for bookmark screen
let selectedBmFilter = 'all'; // 'all' | 'bm' | 'wrong'
let normalQuizCount = 10;
let setQuizRanges = {}; // setIdx -> { startId, endId }
let bookmarkQuizCount = 10;
let quiz = null;

// =========================================================
// WORD VOICE / SPEECH SYNTHESIS
// =========================================================
const VOICE_AUTO_KEY = 'kobun_voice_auto_enabled';
function isVoiceSupported() { return typeof window !== 'undefined' && 'speechSynthesis' in window; }
function isAutoVoiceEnabled() { return localStorage.getItem(VOICE_AUTO_KEY) === '1'; }
function setAutoVoiceEnabled(enabled) {
  localStorage.setItem(VOICE_AUTO_KEY, enabled ? '1' : '0');
  renderAccountSettings && renderAccountSettings();
}
function speakWordText(text) {
  if (!text || !isVoiceSupported()) { showSyncStatus('この端末では読み上げを利用できません', true); return; }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(String(text));
  utterance.lang = 'ja-JP';
  utterance.rate = 0.9;
  window.speechSynthesis.speak(utterance);
}
function speakWordById(wordId, event) {
  if (event) event.stopPropagation();
  const w = WORDS.find(x => Number(x.id) === Number(wordId));
  if (w) speakWordText(w.en);
}
function speakCurrentQuizWord() {
  if (!quiz || !quiz.words || !quiz.words[quiz.idx]) return;
  speakWordText(quiz.words[quiz.idx].en);
}
function toggleAutoVoiceFromSettings() {
  const input = document.getElementById('voice-auto-toggle');
  setAutoVoiceEnabled(!!(input && input.checked));
}
function renderVoiceSettingsCard() { return ''; }

let leaderboardStats = { totalAnswered: 0, totalCorrect: 0, totalWrong: 0, updatedAt: null };
let leaderboardCache = [];
let myLeaderboardRank = null;
let accountProfile = { nickname: '' };
let profileAvatarData = '';
const NICKNAME_KEY = 'systan_public_nickname_v1';
const PROFILE_AVATAR_KEY_PREFIX = 'systan_profile_avatar_v1_';

const STATUS_RANK = { '◎': 4, '○': 3, '×': 2, null: 0, '': 0 };

function getWordProgress(id) {
  return progress[id] || { q1: null, q2: null, q3: null };
}

function getStatus(id) {
  const wp = getWordProgress(id);
  // Historical records have no order information; retain their previous display
  // until this word receives a new answer.
  if (['◎', '○', '×'].includes(wp.latestStatus)) return wp.latestStatus;
  const vals = [wp.q1, wp.q2, wp.q3];
  let best = 0;
  vals.forEach(v => { const r = STATUS_RANK[v] || 0; if (r > best) best = r; });
  if (best === 4) return '◎';
  if (best === 3) return '○';
  if (best === 2) return '×';
  return '';
}

function setQResult(id, qn, result) {
  if (!progress[id]) progress[id] = { q1: null, q2: null, q3: null };
  progress[id][qn] = result;
  if (['◎', '○', '×'].includes(result)) {
    progress[id].latestStatus = result;
    progress[id].latestAnsweredAt = Date.now();
  }
}

function getQProgress(id) {
  const wp = getWordProgress(id);
  return { q1: wp.q1 || '', q2: wp.q2 || '', q3: wp.q3 || '' };
}

function getSetWords(setIdx) {
  const start = setIdx * SET_SIZE;
  return WORDS.slice(start, start + SET_SIZE);
}

function getSetIdBounds(setIdx) {
  const words = getSetWords(setIdx);
  return {
    minId: words[0].id,
    maxId: words[words.length - 1].id
  };
}

function sanitizeSetRange(setIdx, startValue, endValue) {
  // Unit内に限定せず、全単語から自由に範囲指定できるようにする
  const minId = WORDS[0].id;
  const maxId = WORDS[WORDS.length - 1].id;
  let startId = Number(startValue);
  let endId = Number(endValue);

  if (!Number.isFinite(startId)) startId = minId;
  if (!Number.isFinite(endId)) endId = maxId;

  startId = Math.max(minId, Math.min(maxId, Math.floor(startId)));
  endId = Math.max(minId, Math.min(maxId, Math.floor(endId)));

  if (startId > endId) {
    const temp = startId;
    startId = endId;
    endId = temp;
  }

  return { startId, endId, minId, maxId };
}

function ensureSetRange(setIdx) {
  const stored = setQuizRanges[setIdx] || {};
  const safe = sanitizeSetRange(setIdx, stored.startId, stored.endId);
  setQuizRanges[setIdx] = { startId: safe.startId, endId: safe.endId };
  return safe;
}

function getRangedSetWords(setIdx) {
  const { startId, endId } = ensureSetRange(setIdx);
  // Unitをまたいだ範囲指定に対応
  return WORDS.filter(w => w.id >= startId && w.id <= endId);
}

function getSetStats(setIdx) {
  const words = getSetWords(setIdx);
  const counts = { '': 0, '○': 0, '◎': 0, '×': 0 };
  words.forEach(w => { const s = getStatus(w.id); counts[s] = (counts[s] || 0) + 1; });
  return counts;
}

function isSetCompleted(setIdx) {
  const words = getSetWords(setIdx);
  return words.every(w => getStatus(w.id) === '◎');
}

function getWrongWords() {
  return WORDS.filter(w => getStatus(w.id) === '×');
}

// =========================================================
// BOOKMARK HELPERS
// =========================================================
function isBookmarked(id) {
  return bookmarks.has(id);
}

function toggleBookmark(id) {
  if (bookmarks.has(id)) {
    bookmarks.delete(id);
  } else {
    bookmarks.add(id);
  }
  saveProgress();
}

function getBookmarkedWords() {
  return WORDS.filter(w => bookmarks.has(w.id));
}

function selectRetest(mode) {
  selectedRetest = mode;
  const select = document.getElementById('retest-select');
  if (select && select.value !== mode) select.value = mode;
  ['all','mix','circle','cross','bookmark'].forEach(m => {
    const btn = document.getElementById('retest-btn-' + m);
    if (btn) btn.classList.toggle('active', m === mode);
  });
  renderSet();
}

function normalizeResultMark(value) {
  // 「○」と「〇」は見た目が近い別文字なので、判定前に統一する
  if (value === '〇') return '○';
  return value || null;
}

function getWordResultMarks(id) {
  const wp = getWordProgress(id);
  return [wp.q1, wp.q2, wp.q3].map(normalizeResultMark).filter(Boolean);
}

function hasAnyWordResult(id, targets) {
  const targetSet = new Set(targets.map(normalizeResultMark));
  return getWordResultMarks(id).some(result => targetSet.has(result));
}

function getActiveWords(setIdx) {
  const words = getRangedSetWords(setIdx);

  // 出題対象の仕様:
  // all      = すべて（未回答、○、×） ※◎は習得済みとして除外
  // mix      = ○、×
  // circle   = ○
  // cross    = ×
  // bookmark = 選択範囲内のブックマーク
  //
  // 判定は各問題形式(q1/q2/q3)の個別結果ではなく、画面に表示している
  // 総合ステータス(getStatus)に統一する。これによりプルダウン表示と
  // 実際の出題対象がズレない。
  if (selectedRetest === 'all') {
    return words.filter(w => {
      const status = getStatus(w.id);
      return status === '' || status === '○' || status === '×';
    });
  }

  if (selectedRetest === 'mix') {
    return words.filter(w => {
      const status = getStatus(w.id);
      return status === '○' || status === '×';
    });
  }

  if (selectedRetest === 'circle') {
    return words.filter(w => getStatus(w.id) === '○');
  }

  if (selectedRetest === 'cross') {
    return words.filter(w => getStatus(w.id) === '×');
  }

  if (selectedRetest === 'bookmark') {
    return words.filter(w => bookmarks.has(w.id));
  }

  return words;
}

function getTotalStats() {
  const counts = { '': 0, '○': 0, '◎': 0, '×': 0 };
  WORDS.forEach(w => { const s = getStatus(w.id); counts[s] = (counts[s] || 0) + 1; });
  return counts;
}

// =========================================================
// LEADERBOARD
// =========================================================

function showSyncStatus(message, isError = false) {
  const el = document.getElementById('sync-status');
  if (!el) return;
  el.textContent = message;
  el.classList.toggle('error', !!isError);
  el.classList.add('show');
  clearTimeout(showSyncStatus._timer);
  showSyncStatus._timer = setTimeout(() => el.classList.remove('show'), 1800);
}

function getInitials(name) {
  const txt = String(name || '').trim();
  if (!txt) return 'G';
  return txt.replace(/\s+/g, '').slice(0, 1).toUpperCase();
}

function getAnonymousName(uid) {
  const raw = String(uid || 'guest').replace(/[^a-zA-Z0-9]/g, '');
  const suffix = (raw.slice(-4) || '0000').toUpperCase();
  return `学習者-${suffix}`;
}

function getStoredNickname() {
  try { return (localStorage.getItem(NICKNAME_KEY+'_'+(auth.currentUser?.uid||'guest')) || '').trim(); } catch(e) { return ''; }
}

function setStoredNickname(name) {
  try {
    if (name) localStorage.setItem(NICKNAME_KEY+'_'+(auth.currentUser?.uid||'guest'), name);
    else localStorage.removeItem(NICKNAME_KEY+'_'+(auth.currentUser?.uid||'guest'));
  } catch(e) {}
}

function getPublicNickname(user = auth.currentUser) {
  const local = getStoredNickname();
  const remote = (accountProfile && accountProfile.nickname || '').trim();
  if (remote) return remote;
  if (local) return local;
  return user ? getAnonymousName(user.uid) : 'ゲスト';
}



function normalizeSchoolCode(code) {
  return String(code || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 30);
}

function getSchoolCode() {
  try { return normalizeSchoolCode(localStorage.getItem(SCHOOL_CODE_KEY) || ''); } catch (e) { return ''; }
}

function getSchoolName() {
  try { return String(localStorage.getItem(SCHOOL_CODE_NAME_KEY) || '').trim(); } catch (e) { return ''; }
}

function getCachedSchoolLogo(code = getSchoolCode()) {
  if (!code) return '';
  try {
    const value = localStorage.getItem(SCHOOL_LOGO_KEY_PREFIX + normalizeSchoolCode(code)) || '';
    return value.length <= 260000 && /^data:image\/webp;base64,[A-Za-z0-9+/]+=*$/.test(value) ? value : '';
  } catch (e) { return ''; }
}

function cacheSchoolLogo(code, value) {
  const normalized = normalizeSchoolCode(code);
  if (!normalized) return;
  try {
    if (typeof value === 'string' && value.length <= 260000 && /^data:image\/webp;base64,[A-Za-z0-9+/]+=*$/.test(value)) {
      localStorage.setItem(SCHOOL_LOGO_KEY_PREFIX + normalized, value);
    } else {
      localStorage.removeItem(SCHOOL_LOGO_KEY_PREFIX + normalized);
    }
  } catch (e) { console.warn('Could not cache school logo:', e); }
}

function renderSchoolBranding() {
  const accountButton = document.getElementById('header-account-button');
  if (accountButton) accountButton.innerHTML = getAccountIconMarkup();
  const title = document.querySelector('.app-header .header-title');
  if (!title) return;
  const logo = getCachedSchoolLogo();
  if (logo) {
    title.innerHTML = `<img class="school-brand-logo" src="${logo}" alt="${escapeHtml(getSchoolName() || '学校ロゴ')}">`;
    title.setAttribute('aria-label', getSchoolName() || '学校ロゴ');
  } else {
    title.textContent = '古文学習';
    title.removeAttribute('aria-label');
  }
}

async function refreshSchoolBranding() {
  const code = getSchoolCode();
  if (!code) { renderSchoolBranding(); return; }
  try {
    const snap = await db.collection('schoolCodes').doc(code).get();
    if (snap.exists) {
      const data = snap.data() || {};
      if (logoutInProgress || getSchoolCode() !== code) return;
      if (data.schoolName) setLocalSchoolCode(code, data.schoolName);
      cacheSchoolLogo(code, data.schoolLogoData || '');
    }
  } catch (e) { console.warn('refreshSchoolBranding error:', e); }
  renderSchoolBranding();
}

function setLocalSchoolCode(code, name = '') {
  const normalized = normalizeSchoolCode(code);
  try {
    if (normalized) localStorage.setItem(SCHOOL_CODE_KEY, normalized);
    else localStorage.removeItem(SCHOOL_CODE_KEY);
    if (name) localStorage.setItem(SCHOOL_CODE_NAME_KEY, String(name).trim().slice(0, 40));
    else localStorage.removeItem(SCHOOL_CODE_NAME_KEY);
  } catch (e) {}
  renderSchoolBranding();
}

const CLASS_SESSION_KEY = 'systan_class_session_v1';
let activeClassAssignment = null;
function normalizeClassId(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 30);
}
function storeClassAssignment(assignment) {
  activeClassAssignment = assignment;
  try {
    if (assignment) localStorage.setItem(CLASS_SESSION_KEY, JSON.stringify(assignment));
    else localStorage.removeItem(CLASS_SESSION_KEY);
  } catch (e) {}
  renderClassStudyShortcut();
}
function restoreClassAssignment() {
  try {
    const saved = JSON.parse(localStorage.getItem(CLASS_SESSION_KEY) || 'null');
    if (saved && (saved.local === true || typeof saved.uid === 'string') && saved.schoolId === getSchoolCode() &&
      normalizeClassId(saved.classId) === saved.classId) {
      activeClassAssignment = saved;
    }
  } catch (e) {}
}
function renderClassStudyShortcut() {
  const slot = document.getElementById('home-class-study');
  if (!slot) return;
  const a = activeClassAssignment;
  const validSession = a && (a.local === true && !auth.currentUser || auth.currentUser && a.uid === auth.currentUser.uid);
  if (!a || !validSession || getSchoolCode() !== a.schoolId) {
    slot.innerHTML = '';
    return;
  }
  const hasRange = Number.isInteger(a.startId) && Number.isInteger(a.endId) && a.startId >= WORDS[0].id && a.endId <= WORDS[WORDS.length - 1].id && a.startId <= a.endId;
  slot.innerHTML = `<div class="class-study-card">
    <div class="class-study-kicker">今回の単語テスト範囲</div>
    <div class="class-study-heading">${escapeHtml(a.schoolName || a.schoolId)} · ${escapeHtml(a.className || a.classId)}</div>
    <div class="class-study-range">${hasRange ? `${a.startId}〜${a.endId}番 · ${a.endId - a.startId + 1}語` : 'テスト範囲はまだ設定されていません'}</div>
    ${hasRange ? '<button type="button" class="btn btn-primary class-study-button" onclick="startClassStudy()">この範囲で学習する →</button>' : ''}
  </div>`;
}
function startClassStudy() {
  const a = activeClassAssignment;
  if (!a || !(a.local === true && !auth.currentUser || auth.currentUser && a.uid === auth.currentUser.uid) ||
      !Number.isInteger(a.startId) || !Number.isInteger(a.endId)) return;
  currentSetIdx = 0;
  selectedRetest = 'all';
  setQuizRanges[0] = { startId: a.startId, endId: a.endId };
  showHome();
  const words = WORDS.filter(w => w.id >= a.startId && w.id <= a.endId);
  startQuizSession(shuffle(words), 'normal');
}

function showSchoolLoginMessage(message, error = false) {
  const el = document.getElementById('auth-school-message');
  if (el) { el.textContent = message; el.classList.toggle('error', error); }
  showSyncStatus(message, error);
}

function leaveLocalSchool() {
  if (!activeClassAssignment?.local) return;
  storeClassAssignment(null);
  setLocalSchoolCode('', '');
  showHome();
}

async function loginSchoolClass() {
  const schoolId = normalizeSchoolCode(document.getElementById('auth-school-id')?.value);
  const classId = normalizeClassId(document.getElementById('auth-class-id')?.value);
  if (!schoolId) { showSchoolLoginMessage('学校IDを入力してください', true); return; }
  const button = document.getElementById('auth-school-login');
  if (button) button.disabled = true;
  showSchoolLoginMessage('学校IDを確認しています…');
  try {
    const schoolSnap = await db.collection('schoolCodes').doc(schoolId).get();
    if (!schoolSnap.exists || schoolSnap.data()?.active === false) throw new Error('学校IDが見つからないか、停止中です');
    const schoolData = schoolSnap.data() || {};
    let classData = null;
    if (classId) {
      const classSnap = await db.collection('schoolCodes').doc(schoolId).collection('classes').doc(classId).get();
      if (!classSnap.exists || classSnap.data()?.active === false) {
        throw new Error('クラスIDを確認できません。学校IDのみでログインするか、管理者にクラス登録を依頼してください');
      }
      classData = classSnap.data();
    }
    const rangeData = classData || schoolData;
    const startId = Number(rangeData.startId), endId = Number(rangeData.endId);
    const validRange = Number.isInteger(startId) && Number.isInteger(endId) &&
      startId >= WORDS[0].id && endId <= WORDS[WORDS.length - 1].id && startId <= endId;
    let local = false;
    if (!auth.currentUser) {
      try { await auth.signInAnonymously(); }
      catch (error) {
        // A verified school may still use device-local learning when Anonymous Auth is disabled.
        console.warn('Anonymous Auth unavailable; using local school session:', error);
        local = true;
      }
    }
    const schoolName = String(schoolData.schoolName || '').slice(0,40);
    cacheSchoolLogo(schoolId, schoolData.schoolLogoData || '');
    setLocalSchoolCode(schoolId, schoolName);
    storeClassAssignment({uid:auth.currentUser?.uid || null,local,schoolId,classId,
      startId:validRange ? startId : null,endId:validRange ? endId : null,
      schoolName,className:String(classData?.className || '').slice(0,40)});
    if (auth.currentUser && !await saveSchoolCodeToProfile(schoolId, schoolName)) throw new Error('school_profile_link_failed');
    closeAuthModal();
    markWelcomeAccepted();
    showHome();
    showSchoolLoginMessage(local ? '学校IDを確認しました。学習履歴はこの端末に保存されます' :
      (validRange ? '学校・クラスでログインしました' : '学校に参加しました。テスト範囲は未設定です'));
  } catch (e) {
    console.warn('loginSchoolClass error:', e);
    if (e.message === 'school_profile_link_failed') {
      storeClassAssignment(null);
      await loadSchoolCodeFromProfile();
    }
    showSchoolLoginMessage(e.message === 'school_profile_link_failed' ? '学校とアカウントを紐づけできませんでした。現在の所属を確認してください。' :
      (e.code === 'permission-denied' ? '学校・クラスの設定を取得できませんでした。時間をおいて再度お試しください。' :
      '学校IDを確認できませんでした。入力内容をご確認ください。'), true);
  } finally { if (button) button.disabled = false; }
}

async function refreshClassTestRange() {
  const a = activeClassAssignment;
  if (!a || !(a.local === true && !auth.currentUser || auth.currentUser && a.uid === auth.currentUser.uid) || !navigator.onLine) return;
  try {
    const schoolSnap = await db.collection('schoolCodes').doc(a.schoolId).get();
    if (!schoolSnap.exists || schoolSnap.data()?.active === false) { storeClassAssignment(null); return; }
    let data = schoolSnap.data();
    if (a.classId) {
      const snap = await db.collection('schoolCodes').doc(a.schoolId).collection('classes').doc(a.classId).get();
      if (!snap.exists || snap.data()?.active === false) { storeClassAssignment(null); return; }
      data = snap.data();
    }
    if (logoutInProgress || activeClassAssignment !== a) return;
    const startId = Number(data.startId), endId = Number(data.endId);
    const valid = Number.isInteger(startId) && Number.isInteger(endId) && startId >= WORDS[0].id &&
      endId <= WORDS[WORDS.length-1].id && startId <= endId;
    storeClassAssignment({ ...a, startId:valid ? startId : null, endId:valid ? endId : null,
      className:a.classId ? String(data.className || '').slice(0,40) : '' });
  } catch(e) { console.warn('refreshClassTestRange error:',e); }
}

async function saveClassTestRange() {
  if (!isSchoolAdmin()) { showSyncStatus('管理者のみ設定できます', true); return; }
  const schoolId = normalizeSchoolCode(document.getElementById('admin-class-school')?.value);
  const classId = normalizeClassId(document.getElementById('admin-class-id')?.value);
  const className = String(document.getElementById('admin-class-name')?.value || '').trim().slice(0,40);
  const startId = Number(document.getElementById('admin-class-start')?.value);
  const endId = Number(document.getElementById('admin-class-end')?.value);
  if (!schoolId || !Number.isInteger(startId) || !Number.isInteger(endId) ||
    startId < WORDS[0].id || endId > WORDS[WORDS.length - 1].id || startId > endId) {
    showSyncStatus('学校ID・クラスIDと正しい単語範囲を入力してください', true); return;
  }
  try {
    const school = await db.collection('schoolCodes').doc(schoolId).get();
    if (!school.exists || school.data()?.active === false) throw new Error('先に有効な学校IDを発行してください');
    if (classId) {
      await db.collection('schoolCodes').doc(schoolId).collection('classes').doc(classId).set({
        classId,className,startId,endId,active:true,
        updatedAt:firebase.firestore.FieldValue.serverTimestamp()
      },{merge:true});
    } else {
      await db.collection('schoolCodes').doc(schoolId).set({startId,endId,updatedAt:firebase.firestore.FieldValue.serverTimestamp()},{merge:true});
    }
    showSyncStatus(`${schoolId}${classId ? ' / ' + classId : ''}：${startId}〜${endId}番を保存しました`);
  } catch(e) { console.warn('saveClassTestRange error:',e); showSyncStatus(e.message || '範囲を保存できませんでした',true); }
}

function isSchoolAdmin(user = auth.currentUser) {
  if (!user) return false;
  const email = String(user.email || '').toLowerCase();
  const uid = String(user.uid || '');
  return user.emailVerified === true && (ADMIN_UIDS.includes(uid) || ADMIN_EMAILS.map(v => String(v).toLowerCase()).includes(email));
}

async function getUserManagementProfile(user = auth.currentUser) {
  if (!user) return {};
  try {
    const snap = await db.collection('users').doc(user.uid).get();
    return snap.exists ? (snap.data() || {}) : {};
  } catch (e) {
    console.warn('getUserManagementProfile error:', e);
    return {};
  }
}

function getLocalUserRole(profile = null, user = auth.currentUser) {
  if (isSchoolAdmin(user)) return 'admin';
  return String((profile && profile.role) || 'user').trim() || 'user';
}

async function isTeacherUser(user = auth.currentUser) {
  if (!user) return false;
  if (isSchoolAdmin(user)) return true;
  const profile = await getUserManagementProfile(user);
  return String(profile.role || '').trim() === 'teacher';
}

function showSuspendedOverlay() {
  let el = document.getElementById('suspended-account-overlay');
  if (!el) {
    el = document.createElement('div');
    el.id = 'suspended-account-overlay';
    el.className = 'suspended-overlay';
    document.body.appendChild(el);
  }
  el.innerHTML = `
    <div class="suspended-card">
      <div class="suspended-icon">⛔</div>
      <h1>利用停止中</h1>
      <p>${escapeHtml(USER_SUSPENDED_MESSAGE)}</p>
      <button class="btn btn-secondary" onclick="location.reload()">再読み込み</button>
    </div>`;
  el.classList.add('show');
}

function hideSuspendedOverlay() {
  const el = document.getElementById('suspended-account-overlay');
  if (el) el.classList.remove('show');
}

function showRoleAccessMessage(title, message, showLogin = false) {
  const body = document.getElementById('role-page-body');
  if (!body) return;
  body.innerHTML = `
    <div class="role-access-card">
      <div class="role-access-icon">🔒</div>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(message)}</p>
      <div class="role-access-actions">
        ${showLogin ? '<button class="btn btn-primary" onclick="showAuthModal()">ログインする</button>' : ''}
        <button class="btn btn-secondary" onclick="location.href='./index.html'">ホームへ戻る</button>
      </div>
    </div>`;
}

async function initRolePage(pageType) {
  if(pageType==='teacher'&&!window.dashcloudlyLearningReady){
    await new Promise(resolve=>{const done=()=>{clearTimeout(timer);removeEventListener('dashcloudly-learning-ready',done);resolve();};const timer=setTimeout(done,5000);addEventListener('dashcloudly-learning-ready',done,{once:true});});
    if(!window.dashcloudlyLearningReady){document.getElementById('loading-screen')?.style.setProperty('display','none');showRoleAccessMessage('学習管理を読み込めませんでした','通信を確認して再読み込みしてください。');return;}
  }

  const loading = document.getElementById('loading-screen');
  if (loading) loading.style.display = 'none';
  renderAuthFab();

  const user = await waitForAuthReady(3500);
  if (!user) {
    showRoleAccessMessage('ログインが必要です', 'このページはアクセス許可を持つユーザーのみ利用できます。', true);
    return;
  }

  const profile = await getUserManagementProfile(user);
  if (profile.disabledInApp === true && !isSchoolAdmin(user)) {
    showSuspendedOverlay();
    try { await auth.signOut(); } catch (e) {}
    showRoleAccessMessage('利用停止中', USER_SUSPENDED_MESSAGE, false);
    return;
  }

  if (pageType === 'admin') {
    if (!isSchoolAdmin(user)) {
      showRoleAccessMessage('管理者専用ページです', '管理者権限を持つアカウントのみアクセスできます。', false);
      return;
    }
    const body = document.getElementById('role-page-body');
    if (body) body.innerHTML = '<div id="admin-dashboard-body" class="admin-dashboard-body"></div>';
    await loadAdminDashboard();
    return;
  }

  if (pageType === 'teacher') {
    const role = getLocalUserRole(profile, user);
    if (role !== 'teacher' && role !== 'admin') {
      showRoleAccessMessage('先生専用ページです', '先生または管理者に設定されたアカウントのみアクセスできます。', false);
      return;
    }
    await loadTeacherDashboard(profile);
  }
}

async function loadTeacherDashboard(profile = {}) {
  const body = document.getElementById('role-page-body');
  if (!body) return;
  body.innerHTML = '<div class="school-muted">先生用データを読み込み中...</div>';
  try {
    const schoolCode = normalizeSchoolCode(profile.schoolCode || getSchoolCode() || '');
    const usersQuery = schoolCode
      ? db.collection('users').where('schoolCode', '==', schoolCode).limit(500).get().catch(() => null)
      : Promise.resolve(null);
    const [rankingSnap, usersSnap, codesSnap] = await Promise.all([
      (schoolCode ? db.collection(RANKINGS_COLLECTION).where('schoolCode', '==', schoolCode) : Promise.resolve(null)),
      usersQuery,
      db.collection('schoolCodes').limit(200).get().catch(() => null)
    ]);
    let rankingRows = rankingSnap && rankingSnap.docs ? rankingSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })) : [];
    let userRows = usersSnap && usersSnap.docs ? usersSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })) : [];
    if (schoolCode) {
      rankingRows = rankingRows.filter(row => normalizeSchoolCode(row.schoolCode) === schoolCode);
      userRows = userRows.filter(row => normalizeSchoolCode(row.schoolCode) === schoolCode);
    }
    rankingRows.sort((a,b) =>
      (Number(b.totalCorrect || 0) - Number(a.totalCorrect || 0)) ||
      String(a.id || '').localeCompare(String(b.id || ''))
    );
    const activeCodes = codesSnap && codesSnap.docs ? codesSnap.docs.filter(doc => (doc.data() || {}).active !== false).length : 0;
    body.innerHTML = `
      <div class="admin-hero teacher-hero">
        <div>
          <div class="admin-hero-kicker">TEACHER DASHBOARD</div>
          <div class="admin-hero-title">先生用ページ</div>
          <div class="admin-hero-sub">${schoolCode ? escapeHtml(schoolCode) + ' の' : ''}学習状況を確認できます。設定変更は管理者ページのみ可能です。</div>
        </div>
        <button class="admin-refresh-btn" onclick="loadTeacherDashboard()">↻ 更新</button>
      </div>
      <div class="admin-dashboard-grid admin-stat-grid-new">
        <div class="admin-stat"><div class="admin-stat-icon">👥</div><div class="admin-stat-value">${userRows.length}</div><div class="admin-stat-label">登録ユーザー</div></div>
        <div class="admin-stat"><div class="admin-stat-icon">🏆</div><div class="admin-stat-value">${rankingRows.length}</div><div class="admin-stat-label">ランキング参加者</div></div>
        <div class="admin-stat"><div class="admin-stat-icon">🔑</div><div class="admin-stat-value">${activeCodes}</div><div class="admin-stat-label">有効コード</div></div>
      </div>
      <section class="admin-panel">
        <div class="admin-panel-head"><div><div class="admin-section-title">学習ランキング</div><div class="admin-card-sub">先生権限では閲覧のみできます。</div></div></div>
        <div class="teacher-ranking-list">
          ${rankingRows.slice(0, 50).map((row, i) => `<div class="teacher-row"><strong>#${i + 1}</strong><span>${escapeHtml(getPublicRankingName(row))}</span><span>正解 ${Number(row.totalCorrect || 0)}回</span></div>`).join('') || '<div class="school-muted">まだランキングデータがありません。</div>'}
        </div>
      </section>
      <section class="admin-panel">
        <div class="admin-panel-head"><div><div class="admin-section-title">ユーザー一覧</div><div class="admin-card-sub">利用停止やロール変更は管理者ページで行います。</div></div></div>
        <div class="teacher-user-list">
          ${userRows.slice(0, 100).map(row => `<div class="teacher-row"><span>${escapeHtml(row.profileNickname || row.publicName || row.nickname || '名前未設定')}</span><span>${escapeHtml(row.email || 'メール未取得')}</span><span>${escapeHtml(row.role || 'user')}</span><span>${row.disabledInApp ? '停止中' : '有効'}</span></div>`).join('') || '<div class="school-muted">ユーザー情報がありません。</div>'}
        </div>
      </section>`;
  } catch (e) {
    console.warn('loadTeacherDashboard error:', e);
    body.innerHTML = '<div class="role-access-card"><h1>読み込みに失敗しました</h1><p>時間をおいて再度お試しください。</p></div>';
  }
}

async function saveSchoolCodeToProfile(code, name = '') {
  if (!auth.currentUser) return true;
  try {
    await db.collection('users').doc(auth.currentUser.uid).set({
      schoolCode: normalizeSchoolCode(code) || null,
      schoolName: name || null,
      schoolCodeUpdatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    await syncLeaderboardProfile();
    return true;
  } catch (e) {
    console.warn('saveSchoolCodeToProfile error:', e);
    return false;
  }
}

async function loadSchoolCodeFromProfile() {
  if (!auth.currentUser) return;
  try {
    const uid = auth.currentUser.uid;
    const snap = await db.collection('users').doc(uid).get();
    if (logoutInProgress || auth.currentUser?.uid !== uid) return;
    const data = snap.exists ? (snap.data() || {}) : {};
    if (data.schoolCode) setLocalSchoolCode(data.schoolCode, data.schoolName || '');
    else setLocalSchoolCode('', '');
    await refreshSchoolBranding();
  } catch (e) {
    console.warn('loadSchoolCodeFromProfile error:', e);
  }
}

async function joinSchoolCode() {
  const input = document.getElementById('school-code-input');
  const code = normalizeSchoolCode(input ? input.value : '');
  if (!code) {
    showSyncStatus('参加コードを入力してください', true);
    return;
  }
  let name = '';
  try {
    const response=await fetch(`${window.DASHCLOUDLY_CONFIG.hubUrl || location.origin}/api/school/info`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code})});
    if(!response.ok){showSyncStatus('学校IDが無効・未承認・停止中です',true);return;}
    const data=await response.json();
    name = String(data.schoolName || data.name || '').trim();
    cacheSchoolLogo(code, data.schoolLogoData || '');
  } catch (e) {
    console.warn('joinSchoolCode validation error:', e);
    showSyncStatus('参加コードを確認できませんでした', true);
    return;
  }
  if (auth.currentUser && !await saveSchoolCodeToProfile(code, name)) {
    showSyncStatus('この学校をアカウントに登録できませんでした。現在の所属を確認してください', true);
    return;
  }
  setLocalSchoolCode(code, name);
  await fetchLeaderboard();
  renderHomeRankingPanel();
  renderAccountSettings();
  if (document.getElementById('screen-ranking')?.classList.contains('active')) renderRanking();
  showSyncStatus(`${name ? name + 'に' : ''}参加しました`);
}

async function clearSchoolCode() {
  if (auth.currentUser && !await saveSchoolCodeToProfile('', '')) {
    showSyncStatus('学校との紐づけを解除できませんでした', true);
    return;
  }
  setLocalSchoolCode('', '');
  storeClassAssignment(null);
  await fetchLeaderboard();
  renderHomeRankingPanel();
  renderAccountSettings();
  if (document.getElementById('screen-ranking')?.classList.contains('active')) renderRanking();
  showSyncStatus('学校コードを解除しました');
}

function makeSchoolCodeSuggestion() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function fillSchoolCodeSuggestion() {
  const input = document.getElementById('admin-school-code-input');
  if (input) input.value = makeSchoolCodeSuggestion();
}

async function issueSchoolCode() { showSyncStatus('学校の申請・承認・終了は学習IDの審査画面で行ってください。', true); }

async function saveSchoolLogo(input) {
  const file = input?.files?.[0];
  const code = normalizeSchoolCode(document.getElementById('admin-school-logo-code')?.value);
  if (!file) return;
  if (!isSchoolAdmin() || !auth.currentUser) {
    showSyncStatus('学校ロゴの変更は管理者のみ行えます', true);
    input.value = '';
    return;
  }
  if (!code) {
    showSyncStatus('学校IDを入力してください', true);
    input.value = '';
    return;
  }
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
    showSyncStatus('JPEG・PNG・WebP形式の5MB以下の画像を選んでください', true);
    input.value = '';
    return;
  }
  try {
    const schoolRef = db.collection('schoolCodes').doc(code);
    const schoolSnap = await schoolRef.get();
    if (!schoolSnap.exists) throw new Error('school_not_found');
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 480 / bitmap.width, 220 / bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const logo = canvas.toDataURL('image/webp', 0.78);
    if (logo.length > 240000) throw new Error('school_logo_too_large');
    await schoolRef.update({ schoolLogoData: logo, schoolLogoUpdatedAt: firebase.firestore.FieldValue.serverTimestamp() });
    cacheSchoolLogo(code, logo);
    if (code === getSchoolCode()) renderSchoolBranding();
    showSyncStatus('学校ロゴを保存しました');
  } catch (e) {
    console.warn('saveSchoolLogo error:', e);
    showSyncStatus(e.message === 'school_not_found' ? '学校IDが見つかりません' : '学校ロゴを保存できませんでした', true);
  } finally { input.value = ''; }
}

async function removeSchoolLogo() {
  const code = normalizeSchoolCode(document.getElementById('admin-school-logo-code')?.value);
  if (!isSchoolAdmin() || !auth.currentUser || !code) {
    showSyncStatus('管理者アカウントと学校IDを確認してください', true);
    return;
  }
  try {
    await db.collection('schoolCodes').doc(code).update({ schoolLogoData: firebase.firestore.FieldValue.delete() });
    cacheSchoolLogo(code, '');
    renderSchoolBranding();
    showSyncStatus('学校ロゴを削除しました');
  } catch (e) {
    console.warn('removeSchoolLogo error:', e);
    showSyncStatus('学校ロゴを削除できませんでした', true);
  }
}

async function loadIssuedSchoolCodes() {
  const list = document.getElementById('admin-school-code-list');
  if (!list) return;
  if (!auth.currentUser || !isSchoolAdmin()) {
    list.innerHTML = '<div class="school-muted">管理者ログイン時のみ発行済みコードを表示します。</div>';
    return;
  }
  try {
    const snap = await db.collection('schoolCodes').orderBy('createdAt', 'desc').limit(20).get();
    if (snap.empty) {
      list.innerHTML = '<div class="school-muted">まだ発行済みコードはありません。</div>';
      return;
    }
    list.innerHTML = snap.docs.map(doc => {
      const data = doc.data() || {};
      const active = data.active !== false;
      return `<div class="school-code-item">
        <div><div class="school-code-main">${escapeHtml(doc.id)}</div><div class="school-code-sub">${escapeHtml(data.schoolName || '学校名なし')} ／ ${active ? '有効' : '停止中'}</div></div>
        <button class="school-small-btn" onclick="toggleSchoolCodeActive('${escapeHtml(doc.id)}', ${active ? 'false' : 'true'})">${active ? '停止' : '有効化'}</button>
      </div>`;
    }).join('');
  } catch (e) {
    console.warn('loadIssuedSchoolCodes error:', e);
    list.innerHTML = '<div class="school-muted">発行済みコードを取得できませんでした。</div>';
  }
}

async function toggleSchoolCodeActive(code, active) {
  if (!auth.currentUser || !isSchoolAdmin()) {
    showSyncStatus('管理者のみ変更できます', true);
    return;
  }
  try {
    await db.collection('schoolCodes').doc(normalizeSchoolCode(code)).set({
      active: !!active,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    showSyncStatus(active ? '参加コードを有効化しました' : '参加コードを停止しました');
    await loadIssuedSchoolCodes();
  } catch (e) {
    console.warn('toggleSchoolCodeActive error:', e);
    showSyncStatus('変更に失敗しました', true);
  }
}


async function deleteSchoolCode(value) { showSyncStatus('学校の申請・承認・終了は学習IDの審査画面で行ってください。', true); }



// =========================================================
// PWA INSTALL SUPPORT
// =========================================================
function isInstalledPwa() {
  return !!(
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true ||
    document.referrer.startsWith('android-app://')
  );
}

function buildAdminUserRows(usersSnap, rankingSnap) {
  const map = new Map();
  try {
    if (rankingSnap && rankingSnap.docs) {
      rankingSnap.docs.forEach(doc => {
        const data = doc.data() || {};
        map.set(doc.id, {
          id: doc.id,
          uid: data.uid || doc.id,
          email: data.email || '',
          profileNickname: data.profileNickname || data.nickname || data.name || '',
          publicName: data.publicName || data.nickname || data.name || '',
          schoolCode: data.schoolCode || '',
          schoolName: data.schoolName || '',
          role: data.role || 'user',
          disabledInApp: data.disabledInApp === true,
          note: data.note || '',
          done: Number(data.done || 0),
          mastered: Number(data.mastered || 0),
          totalAnswered: Number(data.totalAnswered || 0),
          accuracy: Number(data.accuracy || 0),
          source: 'ranking'
        });
      });
    }
    if (usersSnap && usersSnap.docs) {
      usersSnap.docs.forEach(doc => {
        const data = doc.data() || {};
        const prev = map.get(doc.id) || { id: doc.id, uid: doc.id, source: 'user' };
        map.set(doc.id, {
          ...prev,
          id: doc.id,
          uid: data.uid || prev.uid || doc.id,
          email: data.email || prev.email || '',
          profileNickname: data.profileNickname || data.nickname || prev.profileNickname || prev.publicName || '',
          publicName: data.publicName || prev.publicName || data.profileNickname || data.nickname || '',
          schoolCode: data.schoolCode || prev.schoolCode || '',
          schoolName: data.schoolName || prev.schoolName || '',
          role: data.role || prev.role || 'user',
          disabledInApp: data.disabledInApp === true,
          note: data.note || prev.note || '',
          source: prev.source === 'ranking' ? 'user+ranking' : 'user'
        });
      });
    }
  } catch (e) {
    console.warn('buildAdminUserRows error:', e);
  }
  return Array.from(map.values()).sort((a, b) => {
    if ((b.totalAnswered || 0) !== (a.totalAnswered || 0)) return (b.totalAnswered || 0) - (a.totalAnswered || 0);
    return String(a.profileNickname || a.email || a.uid).localeCompare(String(b.profileNickname || b.email || b.uid), 'ja');
  });
}

function renderAdminUserRows(rows) {
  if (!rows || !rows.length) return '<div class="school-muted admin-empty">登録ユーザー情報はまだありません。</div>';
  return rows.map(row => {
    const uid = escapeHtml(row.id || row.uid || '');
    const nick = escapeHtml(row.profileNickname || row.publicName || '');
    const email = escapeHtml(row.email || 'メール未取得');
    const schoolCode = escapeHtml(normalizeSchoolCode(row.schoolCode || ''));
    const schoolName = escapeHtml(row.schoolName || '');
    const role = escapeHtml(row.role || 'user');
    const note = escapeHtml(row.note || '');
    const suspended = row.disabledInApp === true;
    const stats = `回答 ${Number(row.totalAnswered || 0)}問 ／ 習得 ${Number(row.mastered || 0)}語 ／ 正答率 ${Number(row.accuracy || 0)}%`;
    return `<div class="admin-user-row" data-admin-user-row data-search="${uid} ${email} ${nick} ${schoolCode} ${schoolName} ${role}">
      <div class="admin-user-summary">
        <div class="admin-user-avatar">${suspended ? '⛔' : '👤'}</div>
        <div>
          <div class="admin-user-name">${nick || '名前未設定'} <span class="admin-pill ${suspended ? 'off' : 'on'}">${suspended ? '停止中' : '有効'}</span></div>
          <div class="admin-user-sub">${email}</div><details class="admin-uid-details"><summary>ユーザーID</summary><span class="admin-mono">${uid}</span></details>
          <div class="admin-user-sub">${escapeHtml(stats)}</div>
        </div>
      </div>
      <div class="admin-role-assignment"><div class="admin-role-current">現在の権限 <strong class="admin-role-badge">${role === 'teacher' ? '先生' : role === 'admin' ? '管理者メモ' : '生徒・一般'}</strong><span>${schoolName || schoolCode || '学校未設定'}</span></div>
        <label class="admin-field admin-role-field"><span>割り当てる権限</span><select id="admin-user-role-${uid}" class="account-input"><option value="user" ${role === 'user' ? 'selected' : ''}>生徒・一般ユーザー</option><option value="teacher" ${role === 'teacher' ? 'selected' : ''}>先生（所属校の閲覧）</option><option value="admin" ${role === 'admin' ? 'selected' : ''}>管理者メモ</option></select></label>
      </div>
      <details class="admin-user-details"><summary>プロフィール・所属学校・管理メモ</summary>
      <div class="admin-user-edit-grid">
        <label class="admin-field"><span>表示名</span><input id="admin-user-nick-${uid}" class="account-input" maxlength="24" value="${nick}" placeholder="表示名"></label>
        <label class="admin-field"><span>学校コード</span><input id="admin-user-school-code-${uid}" class="account-input" maxlength="20" value="${schoolCode}" placeholder="ABC123"></label>
        <label class="admin-field"><span>学校名</span><input id="admin-user-school-name-${uid}" class="account-input" maxlength="40" value="${schoolName}" placeholder="学校名・クラス名"></label>
        <label class="admin-field admin-user-note-field"><span>管理メモ</span><input id="admin-user-note-${uid}" class="account-input" maxlength="80" value="${note}" placeholder="任意メモ"></label>
      </div>
      </details>
      <div class="admin-user-actions">
        <button class="btn btn-primary" onclick="saveAdminUserProfile('${uid}')">変更を保存</button>
        <button class="btn btn-secondary" onclick="toggleAdminUserSuspended('${uid}', ${suspended ? 'false' : 'true'})">${suspended ? '利用停止を解除' : '利用停止にする'}</button>
        <button class="school-small-btn danger" onclick="deleteAdminUserAppData('${uid}')">アプリ情報を削除</button>
      </div>
    </div>`;
  }).join('');
}

function filterAdminUserRows() {
  const q = String(document.getElementById('admin-user-search')?.value || '').trim().toLowerCase();
  document.querySelectorAll('[data-admin-user-row]').forEach(row => {
    const hay = String(row.getAttribute('data-search') || '').toLowerCase();
    row.style.display = !q || hay.includes(q) ? '' : 'none';
  });
}

async function saveAdminUserProfile(uid) {
  if (!auth.currentUser || !isSchoolAdmin()) {
    showSyncStatus('管理者のみ変更できます', true);
    return;
  }
  const safeUid = String(uid || '').trim();
  if (!safeUid) return;
  const nickname = String(document.getElementById(`admin-user-nick-${safeUid}`)?.value || '').trim().slice(0, 24);
  const schoolCode = normalizeSchoolCode(document.getElementById(`admin-user-school-code-${safeUid}`)?.value || '');
  const schoolName = String(document.getElementById(`admin-user-school-name-${safeUid}`)?.value || '').trim().slice(0, 40);
  const role = String(document.getElementById(`admin-user-role-${safeUid}`)?.value || 'user').trim().slice(0, 20);
  const note = String(document.getElementById(`admin-user-note-${safeUid}`)?.value || '').trim().slice(0, 80);
  try {
    const payload = {
      uid: safeUid,
      profileNickname: nickname || null,
      publicName: nickname || null,
      schoolCode: schoolCode || null,
      schoolName: schoolName || null,
      role: role || 'user',
      note: note || null,
      updatedByUid: auth.currentUser.uid,
      updatedByEmail: auth.currentUser.email || '',
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    await db.collection('users').doc(safeUid).set(payload, { merge: true });
    await db.collection(RANKINGS_COLLECTION).doc(safeUid).set({
      nickname: nickname || null,
      schoolCode: schoolCode || null,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    showSyncStatus('ユーザー情報を保存しました');
    await loadAdminDashboard();
  } catch (e) {
    console.warn('saveAdminUserProfile error:', e);
    showSyncStatus('ユーザー情報の保存に失敗しました', true);
  }
}

async function toggleAdminUserSuspended(uid, disabled) {
  if (!auth.currentUser || !isSchoolAdmin()) {
    showSyncStatus('管理者のみ変更できます', true);
    return;
  }
  const safeUid = String(uid || '').trim();
  if (!safeUid) return;
  try {
    await db.collection('users').doc(safeUid).set({
      disabledInApp: !!disabled,
      disabledUpdatedByUid: auth.currentUser.uid,
      disabledUpdatedByEmail: auth.currentUser.email || '',
      disabledUpdatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    await db.collection(RANKINGS_COLLECTION).doc(safeUid).set({ disabledInApp: !!disabled }, { merge: true });
    showSyncStatus(disabled ? 'ユーザーを利用停止にしました' : '利用停止を解除しました');
    await loadAdminDashboard();
  } catch (e) {
    console.warn('toggleAdminUserSuspended error:', e);
    showSyncStatus('利用停止状態の変更に失敗しました', true);
  }
}

async function deleteAdminUserAppData(value) { showSyncStatus('退会は本人確認後に学習IDで行います。個別の削除請求は窓口で対応してください。', true); }

async function enforceUserSuspendedState(user) {
  if (!user || isSchoolAdmin(user)) return false;
  try {
    const snap = await db.collection('users').doc(user.uid).get();
    const data = snap.exists ? (snap.data() || {}) : {};
    if (data.disabledInApp === true) {
      showSuspendedOverlay();
      showSyncStatus(USER_SUSPENDED_MESSAGE, true);
      await auth.signOut();
      return true;
    }
    hideSuspendedOverlay();
  } catch (e) {
    console.warn('enforceUserSuspendedState error:', e);
  }
  return false;
}

async function loadAdminDashboard() {
  const wrap = document.getElementById('admin-dashboard-body');
  if (!wrap) return;
  if (!auth.currentUser || !isSchoolAdmin()) {
    wrap.innerHTML = '<div class="school-muted">管理者ログイン時のみダッシュボードを表示します。</div>';
    return;
  }
  wrap.innerHTML = '<div class="school-muted">管理者データを読み込み中...</div>';
  try {
    const [codesSnap, rankingSnap, settingsSnap, usersSnap] = await Promise.all([
      db.collection('schoolCodes').orderBy('createdAt', 'desc').limit(100).get(),
      db.collection(RANKINGS_COLLECTION).limit(500).get(),
      db.collection('appSettings').doc('global').get().catch(() => null),
      db.collection('users').limit(500).get().catch(() => null)
    ]);
    const rankingRows = rankingSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    const codeRows = codesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    const joinedCounts = {};
    rankingRows.forEach(row => {
      const c = normalizeSchoolCode(row.schoolCode);
      if (c) joinedCounts[c] = (joinedCounts[c] || 0) + 1;
    });
    const activeCount = codeRows.filter(row => row.active !== false).length;
    const schoolParticipants = Object.values(joinedCounts).reduce((a, b) => a + b, 0);
    const settings = settingsSnap && settingsSnap.exists ? (settingsSnap.data() || {}) : {};
    const userRows = buildAdminUserRows(usersSnap, rankingSnap);
    const suspendedUserCount = userRows.filter(row => row.disabledInApp === true).length;
    wrap.innerHTML = `
      <div class="admin-hero">
        <div>
          <div class="admin-hero-kicker">ADMIN DASHBOARD</div>
          <div class="admin-hero-title">管理者メニュー</div>
          <div class="admin-hero-sub">学校コード・ユーザー・メンテナンスを管理できます。</div>
        </div>
        <button class="admin-refresh-btn" onclick="loadAdminDashboard()">↻ 更新</button>
      </div>

      <div class="admin-dashboard-grid admin-stat-grid-new">
        <div class="admin-stat"><div class="admin-stat-icon">🔑</div><div class="admin-stat-value">${codeRows.length}</div><div class="admin-stat-label">発行コード</div></div>
        <div class="admin-stat"><div class="admin-stat-icon">✅</div><div class="admin-stat-value">${activeCount}</div><div class="admin-stat-label">有効コード</div></div>
        <div class="admin-stat"><div class="admin-stat-icon">🏆</div><div class="admin-stat-value">${rankingRows.length}</div><div class="admin-stat-label">ランキング参加者</div></div>
        <div class="admin-stat"><div class="admin-stat-icon">🏫</div><div class="admin-stat-value">${schoolParticipants}</div><div class="admin-stat-label">学校コード参加者</div></div>
        <div class="admin-stat"><div class="admin-stat-icon">👥</div><div class="admin-stat-value">${userRows.length}</div><div class="admin-stat-label">登録ユーザー</div></div>
        <div class="admin-stat"><div class="admin-stat-icon">⛔</div><div class="admin-stat-value">${suspendedUserCount}</div><div class="admin-stat-label">停止中</div></div>
      </div>

      <div class="admin-panel-grid">
        <section class="admin-panel admin-panel-maintenance">
          <div class="admin-panel-head">
            <div>
              <div class="admin-section-title">公開状態</div>
              <h3>メンテナンス</h3>
            </div>
            <span class="admin-state-badge ${settings.maintenanceMode ? 'danger' : 'safe'}">${settings.maintenanceMode ? 'ON' : 'OFF'}</span>
          </div>
          <div class="admin-maintenance-panel ${settings.maintenanceMode ? 'is-on' : 'is-off'}">
            <div>
              <div class="admin-maintenance-title">現在：${settings.maintenanceMode ? 'メンテナンス中' : '通常公開中'}</div>
              <div class="school-muted">${settings.maintenanceMode ? '一般ユーザーはメンテナンス画面に移動します。' : '一般ユーザーは通常どおり利用できます。'}</div>
            </div>
            <div class="admin-maintenance-actions">
              <button class="btn btn-review" onclick="setMaintenanceModeOneTap(true)" ${settings.maintenanceMode ? 'disabled' : ''}>ONにする</button>
              <button class="btn btn-secondary" onclick="setMaintenanceModeOneTap(false)" ${settings.maintenanceMode ? '' : 'disabled'}>OFFにする</button>
            </div>
          </div>
        </section>

      </div>

      <section class="admin-panel admin-list-panel admin-user-panel">
        <div class="admin-panel-head">
          <div>
            <div class="admin-section-title">ユーザー管理</div>
            <h3>登録ユーザー情報</h3>
          </div>
        </div>
        <div class="admin-note">メールアドレス・パスワードそのものはFirebase Authentication側で管理されるため、この画面ではアプリ内プロフィール・学校コード・権限・利用停止状態を変更します。</div>
        <div class="admin-user-toolbar">
          <input id="admin-user-search" class="account-input" placeholder="名前・メール・UID・学校コードで検索" oninput="filterAdminUserRows()">
          <button class="btn btn-secondary" onclick="filterAdminUserRows()">検索</button>
        </div>
        <div class="admin-user-list" id="admin-user-list">
          ${renderAdminUserRows(userRows)}
        </div>
      </section>

      <section class="admin-panel admin-list-panel">
        <div class="admin-panel-head">
          <div>
            <div class="admin-section-title">学校コード</div>
            <h3>コード別参加状況</h3>
          </div>
        </div>
        <div class="admin-code-dashboard-list">
          ${codeRows.length ? codeRows.map(row => {
            const active = row.active !== false;
            const count = joinedCounts[row.id] || 0;
            return `<div class="admin-code-row admin-list-row">
              <div>
                <div class="school-code-main">${escapeHtml(row.id)} <span class="admin-pill ${active ? 'on' : 'off'}">${active ? '有効' : '停止中'}</span></div>
                <div class="school-code-sub">${escapeHtml(row.schoolName || '学校名なし')} ／ 参加者 ${count}人</div>
              </div>
              <div class="admin-code-actions">
                <button class="school-small-btn" onclick="toggleSchoolCodeActive('${escapeHtml(row.id)}', ${active ? 'false' : 'true'}).then(loadAdminDashboard)">${active ? '停止' : '有効化'}</button>
                <button class="school-small-btn danger" onclick="deleteSchoolCode('${escapeHtml(row.id)}')">削除</button>
              </div>
            </div>`;
          }).join('') : '<div class="school-muted admin-empty">まだ発行済みコードはありません。</div>'}
        </div>
      </section>
    `;
  } catch (e) {
    console.warn('loadAdminDashboard error:', e);
    wrap.innerHTML = '<div class="school-muted">管理者データを取得できませんでした。時間をおいて再度お試しください。</div>';
  }
}

function renderSchoolCodeSettings() {
  const code = getSchoolCode();
  const name = getSchoolName();
  const admin = isSchoolAdmin();
  return `
    <div class="account-card school-code-card">
      <div class="ranking-meta-title">学校別参加コード</div>
      <div class="school-status-box ${code ? 'joined' : ''}">
        <div class="school-status-icon">${code ? '🏫' : '🔑'}</div>
        <div>
          <div class="school-status-title">${code ? `${escapeHtml(name || '学校グループ')}に参加中` : '学校グループ未参加'}</div>
          <div class="school-status-sub">${code ? `参加コード：${escapeHtml(code)}` : '発行済みコードを入力すると、同じ学校内ランキングに切り替わります。'}</div>
        </div>
      </div>
      <div class="school-join-row">
        <input id="school-code-input" class="account-input" value="${escapeHtml(code)}" placeholder="例：ABC123" maxlength="20">
        <button class="btn btn-primary" onclick="joinSchoolCode()">参加</button>
        <button class="btn btn-secondary" onclick="clearSchoolCode()">解除</button>
      </div>
      <div class="account-help">学校への参加は個人の学習IDでログインして行います。</div>
    </div>
    <div class="account-card school-admin-card">
      <div class="admin-card-header"><div><div class="ranking-meta-title">管理者用コード発行</div><div class="admin-card-sub">学校・クラスごとの参加コードを作成できます。</div></div><span class="admin-card-mark">管理者</span></div>
      ${admin ? `
        <div class="school-admin-grid">
          <input id="admin-school-name-input" class="account-input" placeholder="学校名・クラス名 例：桜高校 2年A組" maxlength="40">
          <div class="school-admin-code-row">
            <input id="admin-school-code-input" class="account-input" placeholder="参加コード" maxlength="20">
            <button class="btn btn-secondary" onclick="fillSchoolCodeSuggestion()">自動生成</button>
          </div>
          <button class="btn btn-primary" onclick="issueSchoolCode()">コードを発行</button>
        </div>
        <div class="school-logo-admin">
          <div class="account-label">学校ロゴ</div>
          <p class="account-help">学校IDを入力してロゴを登録すると、その学校でログインした人のヘッダーに表示されます。横長・正方形の画像に対応します。</p>
          <input id="admin-school-logo-code" class="account-input" placeholder="ロゴを設定する学校ID" maxlength="20">
          <div class="school-logo-actions"><label class="avatar-picker">画像を選択<input type="file" accept="image/jpeg,image/png,image/webp" onchange="saveSchoolLogo(this)"></label><button type="button" class="btn btn-secondary" onclick="removeSchoolLogo()">ロゴを削除</button></div>
        </div>
        <div class="school-issued-head">発行済みコード</div>
        <div id="admin-school-code-list" class="school-code-list"></div>
        <div class="school-issued-head">クラス別・今回の単語テスト範囲</div>
        <div class="admin-class-range-form">
          <input id="admin-class-school" class="account-input" placeholder="発行済みの学校ID" maxlength="20">
          <input id="admin-class-id" class="account-input" placeholder="クラスID（学校共通なら空欄）" maxlength="20">
          <input id="admin-class-name" class="account-input" placeholder="クラス名 例：2年A組（任意）" maxlength="40">
          <input id="admin-class-start" class="account-input" type="number" min="1" max="2027" placeholder="開始番号">
          <input id="admin-class-end" class="account-input" type="number" min="1" max="2027" placeholder="終了番号">
          <button type="button" class="btn btn-primary" onclick="saveClassTestRange()">このクラスの範囲を保存</button>
        </div>
        <div class="admin-dashboard-card">

          <div id="admin-dashboard-body" class="admin-dashboard-body"></div>
        </div>
      ` : `
        <div class="school-muted">参加コードの発行は管理者のみ可能です。管理者にするには、assets/js/app.js の ADMIN_EMAILS または ADMIN_UIDS に対象アカウントを追加してください。</div>
      `}
    </div>
  `;
}

function hasAcceptedWelcome() {
  try { return localStorage.getItem(WELCOME_ACCEPTED_KEY) === '1'; } catch (e) { return false; }
}

function markWelcomeAccepted() {
  try { localStorage.setItem(WELCOME_ACCEPTED_KEY, '1'); } catch (e) {}
}

function showWelcomeModalIfNeeded() {
  if (hasAcceptedWelcome()) { startOnboardingIfNeeded(); return; }
  const modal = document.getElementById('welcome-modal');
  if (!modal) return;
  modal.classList.add('show');
  if(modal.showModal&&!modal.open){modal.showModal();modal.oncancel=event=>event.preventDefault();}
  modal.setAttribute('aria-hidden', 'false');
}

function closeWelcomeModal() {
  const modal = document.getElementById('welcome-modal');
  if (!modal) return;
  modal.classList.remove('show');
  if(modal.open&&modal.close)modal.close();
  modal.setAttribute('aria-hidden', 'true');
}

function declineWelcome() {
  const message=document.getElementById('welcome-decision-message');if(message)message.textContent='同意しないを選択しました。学習は開始されません。文書の確認やお問い合わせはサービス情報から行えます。';
}

function acceptWelcomeAsGuest() {
  markWelcomeAccepted();
  closeWelcomeModal();
  startOnboardingIfNeeded();
}

function acceptWelcomeAndOpenLogin() {
  markWelcomeAccepted();
  closeWelcomeModal();
  startOnboardingIfNeeded();
}

const ONBOARDING_COMPLETE_KEY = 'systan_onboarding_completed_v1';
let onboardingStep = 0;
let onboardingAuthOpen = false;
const onboardingTutorial = [
  ['単語範囲を選ぶ', '学習タブで出題項目と単語番号を選び、「クイズ開始」を押します。'],
  ['答えて、次へ進む', '選択問題は答えをタップ。記述問題は入力して採点します。わからないときはカード内の「わからない」で飛ばせます。'],
  ['間違いを復習する', '間違えた単語は復習タブに集まります。間違いが10語以上になると、学習タブにも復習の案内が表示されます。']
];
function startOnboardingIfNeeded() {
  try { if (localStorage.getItem(ONBOARDING_COMPLETE_KEY) === '1') return; } catch (e) {}
  onboardingStep = 0;
  renderOnboarding();
}
function renderOnboarding() {
  const modal = document.getElementById('onboarding-modal');
  if (!modal) return;
  modal.classList.add('show');
  modal.setAttribute('aria-hidden', 'false');
  document.getElementById('onboarding-progress').innerHTML = Array.from({length:4}, (_, i) => `<span class="${i <= onboardingStep ? 'current' : ''}"></span>`).join('');
  const title = document.getElementById('onboarding-title');
  const description = document.getElementById('onboarding-description');
  const extra = document.getElementById('onboarding-extra');
  const actions = document.getElementById('onboarding-actions');
  const label = document.getElementById('onboarding-step-label');
  if (onboardingStep === 0) {
    label.textContent = 'STEP 1 / アカウント';
    title.textContent = '学習データを保存する';
    description.textContent = 'メールで新規登録、Google、学校IDで利用できます。登録は後からでも可能です。';
    extra.textContent = 'メールで登録する場合は、次の画面でメールアドレスとパスワードを入力し「新規登録」を押してください。';
    actions.innerHTML = '<button type="button" class="welcome-login-btn" onclick="openOnboardingAuth()">アカウントを作成・ログイン</button><button type="button" class="onboarding-skip" onclick="advanceOnboarding()">後で設定する</button>';
  } else {
    const index = onboardingStep - 1;
    label.textContent = `STEP ${onboardingStep + 1} / 使い方`;
    title.textContent = onboardingTutorial[index][0];
    description.textContent = onboardingTutorial[index][1];
    extra.textContent = `${index + 1} / ${onboardingTutorial.length}`;
    actions.innerHTML = `<button type="button" class="welcome-login-btn" onclick="advanceOnboarding()">${onboardingStep === 3 ? '学習を始める' : '次へ'}</button>`;
  }
}
function openOnboardingAuth() {
  onboardingAuthOpen = true;
  try { localStorage.setItem(ONBOARDING_COMPLETE_KEY, '1'); } catch (e) {}
  const modal = document.getElementById('onboarding-modal');
  modal.classList.remove('show');
  modal.setAttribute('aria-hidden', 'true');
  if(window.startDashcloudlyLogin)window.startDashcloudlyLogin();else location.href='./login.html';
}
function advanceOnboarding() {
  if (onboardingStep < 3) { onboardingStep++; renderOnboarding(); return; }
  try { localStorage.setItem(ONBOARDING_COMPLETE_KEY, '1'); } catch (e) {}
  const modal = document.getElementById('onboarding-modal');
  modal.classList.remove('show');
  modal.setAttribute('aria-hidden', 'true');
  showHome();
  window.scrollTo({top:0,behavior:'instant'});
}

async function acceptWelcomeAndLogin() {
  acceptWelcomeAndOpenLogin();
}

function renderAuthFab() {
  const user = auth.currentUser;
  profileAvatarData = user ? (profileAvatarData || getStoredProfileAvatar(user.uid)) : '';
  const floating=document.getElementById('floating-profile-button');if(floating)floating.innerHTML=getAccountIconMarkup();
  const displayName = user ? getPublicNickname(user) : 'ログイン';
  const headerButton = document.getElementById('header-account-button');
  if (headerButton) {
    headerButton.innerHTML = getAccountIconMarkup();
    headerButton.setAttribute('aria-label', user ? displayName + 'さんのプロフィールを開く' : 'ログインプロフィールを開く');
    closeAccountPopover();
  }
  const el = document.getElementById('auth-fab');
  if (!el) return;
  if (!user) {
    el.innerHTML = `
      <button class="auth-pill auth-pill-login" onclick="login()" title="ログイン">
        <span class="auth-dot-avatar">↗</span>
        <span class="auth-pill-text">
          <span class="auth-pill-name">ログイン</span>
          <span class="auth-pill-sub">Google / メール</span>
        </span>
      </button>
    `;
    return;
  }
  const nick = getPublicNickname(user);
  el.innerHTML = `
    <button class="auth-pill" onclick="showAccountSettings()" title="アカウント設定">
      <span class="auth-dot-avatar">${escapeHtml(getInitials(nick))}</span>
      <span class="auth-pill-text">
        <span class="auth-pill-name">${escapeHtml(nick)}</span>
        <span class="auth-pill-sub">アカウント設定</span>
      </span>
    </button>
  `;
}


async function saveCloudProgress() {
  const user = auth.currentUser;
  if (!user || !cloudRestoreComplete) return false;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  try {
    await db.collection('users').doc(auth.currentUser.uid).set({
      kobunAppState: raw,
      kobunAppStateUpdatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      profileNickname: getPublicNickname(auth.currentUser)
    }, { merge: true });
    return true;
  } catch (e) {
    console.warn('saveCloudProgress error:', e);
    showSyncStatus('同期できませんでした。設定の「今すぐ同期」から再試行できます。', true);
    return false;
  }
}

function queueCloudProgressSave() {
  if (!auth.currentUser || !cloudRestoreComplete) return;
  clearTimeout(cloudSaveTimer);
  cloudSaveTimer = setTimeout(() => {
    saveCloudProgress();
  }, 500);
}

async function restoreCloudProgress() {
  const user = auth.currentUser;
  if (!user) return false;
  try {
    const snap = await db.collection('users').doc(user.uid).get({ source: 'server' });
    if (auth.currentUser?.uid !== user.uid) return false;
    if (!snap.exists) return false;
    const data = snap.data() || {};
    if (!data.kobunAppState) return false;
    const localRaw = localStorage.getItem(STORAGE_KEY);
    const localSavedAt = (() => { try { return JSON.parse(localRaw || '{}').savedAt || ''; } catch(e) { return ''; } })();
    const remoteSavedAt = (() => { try { return JSON.parse(data.kobunAppState || '{}').savedAt || ''; } catch(e) { return ''; } })();
    if (remoteSavedAt && (!localSavedAt || new Date(remoteSavedAt).getTime() > new Date(localSavedAt).getTime())) {
      localStorage.setItem(STORAGE_KEY, data.kobunAppState);
      loadProgress();
      showSyncStatus('クラウドの学習記録を読み込みました');
      return true;
    }
    return false;
  } catch (e) {
    console.warn('restoreCloudProgress error:', e);
    showSyncStatus('クラウド記録を確認できませんでした。接続後に再同期してください。', true);
    throw e;
  }
}

function getLeaderboardPayload() {
  return {
    uid: auth.currentUser ? auth.currentUser.uid : null,
    nickname: getPublicNickname(auth.currentUser),
    totalCorrect: Math.max(0, Math.floor(Number(leaderboardStats.totalCorrect) || 0)),
    schoolCode: getSchoolCode() || null,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  };
}

function getPublicRankingName(row) {
  const nick = String((row && (row.nickname || row.publicName)) || '').trim();
  if (nick) return nick;
  return getAnonymousName(row && (row.uid || row.id));
}

let profileAvatarUnsubscribe=null;
function validProfileAvatar(value){return typeof value==='string'&&value.length<=280000&&/^data:image\/(?:webp|png|jpeg);base64,[A-Za-z0-9+/]+=*$/.test(value);}
function applySharedAvatar(data,user){
 if(auth.currentUser?.uid!==user.uid)return;
 const photo=validProfileAvatar(data.profileAvatar)?data.profileAvatar:getStoredProfileAvatar(user.uid);
 const changed=profileAvatarData!==photo;profileAvatarData=photo;
 try{if(photo)localStorage.setItem(PROFILE_AVATAR_KEY_PREFIX+user.uid,photo);}catch{}
 if(!changed)return;
 renderAuthFab();
 const floating=document.getElementById('floating-profile-button');if(floating)floating.innerHTML=getAccountIconMarkup();
 if(document.getElementById('screen-account')?.classList.contains('active'))renderAccountSettings();
 const popup=document.querySelector('.profile-popup-avatar');if(popup)popup.innerHTML=getAccountIconMarkup();
}
async function loadAccountProfile() {
 const user=auth.currentUser;
 profileAvatarUnsubscribe?.();profileAvatarUnsubscribe=null;
 if(!user){accountProfile={nickname:''};profileAvatarData='';return accountProfile;}
 profileAvatarData=getStoredProfileAvatar(user.uid);
 const ref=db.collection('users').doc(user.uid);
 try{
  const snap=await ref.get();if(auth.currentUser?.uid!==user.uid)return accountProfile;
  const data=snap.exists?snap.data():{};
  const remoteNickname=String(data.profileNickname||data.nickname||'').trim();
  accountProfile={nickname:remoteNickname,role:data.role||'user'};
  setStoredNickname(remoteNickname);
  setLocalSchoolCode(data.schoolCode||'',data.schoolName||'');
  if(!Object.prototype.hasOwnProperty.call(data,'profileAvatar')&&profileAvatarData){
   const local=profileAvatarData;
   await db.runTransaction(async tx=>{const current=await tx.get(ref);if(!current.exists||!Object.prototype.hasOwnProperty.call(current.data(),'profileAvatar'))tx.set(ref,{profileAvatar:local,profileAvatarUpdatedAt:firebase.firestore.FieldValue.serverTimestamp()},{merge:true});});
  }
  applySharedAvatar(data,user);
 }catch(error){console.warn('loadAccountProfile error:',error);}
 if(auth.currentUser?.uid===user.uid)profileAvatarUnsubscribe=ref.onSnapshot(snap=>{if(snap.exists&&auth.currentUser?.uid===user.uid){const data=snap.data(),nickname=String(data.profileNickname||data.nickname||'').trim();if(accountProfile.nickname!==nickname){accountProfile.nickname=nickname;setStoredNickname(nickname);renderAuthFab();const title=document.querySelector('#account-popover .profile-identity h2');if(title)title.textContent=getPublicNickname(user);if(document.getElementById('screen-account')?.classList.contains('active'))renderAccountSettings();}if(getSchoolCode()!==(data.schoolCode||'')){storeClassAssignment(null);setLocalSchoolCode(data.schoolCode||'',data.schoolName||'');accountProfile.role=data.role||'user';}applySharedAvatar(data,user);}},()=>{console.warn('Profile photo sync unavailable');});
 return accountProfile;
}

function getStoredProfileAvatar(uid = auth.currentUser?.uid || 'guest') {
  try {
    const value = localStorage.getItem(PROFILE_AVATAR_KEY_PREFIX + uid) || '';
    return validProfileAvatar(value) ? value : '';
  } catch (e) { return ''; }
}

async function changeProfileAvatar(input) {
  const file = input?.files?.[0];
  if (!file) return;
  if (!auth.currentUser) {
    showSyncStatus('画像を設定するにはログインしてください', true);
    input.value = '';
    return;
  }
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
    showSyncStatus('JPEG・PNG・WebP形式の5MB以下の画像を選んでください', true);
    input.value = '';
    return;
  }
  const user=auth.currentUser;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 320 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const compressed = canvas.toDataURL('image/webp', 0.78);
    if (compressed.length > 280000) throw new Error('image_too_large');
    if(auth.currentUser?.uid!==user.uid)return;
    await db.collection('users').doc(user.uid).set({profileAvatar:compressed,profileAvatarUpdatedAt:firebase.firestore.FieldValue.serverTimestamp()},{merge:true});
    if(auth.currentUser?.uid!==user.uid)return;
    localStorage.setItem(PROFILE_AVATAR_KEY_PREFIX + user.uid, compressed);
    profileAvatarData = compressed;
    renderAuthFab();
    renderAccountSettings();
    showSyncStatus('プロフィール画像を保存しました。他の端末にも同期されます');
  } catch (e) {
    console.warn('Profile image could not be prepared:', e);
    showSyncStatus('画像を保存できませんでした。通信を確認して再試行してください', true);
  } finally {
    input.value = '';
  }
}

function renderProfileAvatar(name, className = 'account-avatar-large') {
  return profileAvatarData
    ? `<img class="${className} profile-avatar-image" src="${profileAvatarData}" alt="プロフィール画像">`
    : `<div class="${className}">${escapeHtml(getInitials(name))}</div>`;
}

async function saveAccountNickname() {
  if (!auth.currentUser) {
    showSyncStatus('ログイン後に設定できます', true);
    return;
  }
  const input = document.getElementById('account-nickname-input');
  const raw = input ? input.value.trim() : '';
  const nickname = raw.slice(0, 16);
  if (!nickname) {
    showSyncStatus('ニックネームを入力してください', true);
    return;
  }
  try {
    setStoredNickname(nickname);
    accountProfile.nickname = nickname;
    await db.collection('users').doc(auth.currentUser.uid).set({
      profileNickname: nickname,
      nicknameUpdatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    await syncLeaderboardProfile();
    await fetchLeaderboard();
    renderAuthFab();
    renderAccountSettings();
    renderHomeRankingPanel();
    if (document.getElementById('screen-ranking') && document.getElementById('screen-ranking').classList.contains('active')) {
      renderRanking();
    }
    showSyncStatus('ニックネームを保存しました');
  } catch (e) {
    console.warn('saveAccountNickname error:', e);
    showSyncStatus('保存に失敗しました', true);
  }
}

async function syncLeaderboardProfile() {
  if (!auth.currentUser) return;
  try {
    await db.collection(RANKINGS_COLLECTION).doc(auth.currentUser.uid).set(getLeaderboardPayload());
  } catch (e) {
    console.warn('syncLeaderboardProfile error:', e);
  }
}

async function fetchLeaderboard() {
  if (!auth.currentUser) {
    leaderboardCache = [];
    myLeaderboardRank = null;
    return [];
  }
  try {
    const activeSchoolCode = getSchoolCode() || null;
    const snap = await db.collection(RANKINGS_COLLECTION).where('schoolCode', '==', activeSchoolCode).orderBy('totalCorrect', 'desc').limit(100).get();
    const documents=snap.docs.map(doc=>({...doc.data(),id:doc.id}));
    const canonicalIds=new Set(documents.map(row=>row.id));
    leaderboardCache=documents.filter(row=>!row.uid||row.uid===row.id||!canonicalIds.has(row.uid)).map(row=>({...row,uid:row.id}));
    if (activeSchoolCode) {
      leaderboardCache = leaderboardCache.filter(row => normalizeSchoolCode(row.schoolCode) === activeSchoolCode);
    }
    leaderboardCache.sort((a, b) =>
      (Number(b.totalCorrect || 0) - Number(a.totalCorrect || 0)) ||
      String(a.id || '').localeCompare(String(b.id || ''))
    );
    const uid = auth.currentUser && auth.currentUser.uid;
    myLeaderboardRank = uid ? leaderboardCache.findIndex(item => item.id === uid) + 1 || null : null;
    return leaderboardCache;
  } catch (e) {
    console.warn('fetchLeaderboard error:', e);
    leaderboardCache = [];
    myLeaderboardRank = null;
    showSyncStatus('ランキングの取得に失敗しました', true);
    return [];
  }
}


function renderHomeRankingPanel() {
  const el = document.getElementById('home-ranking-panel');
  if (!el) return;
  const stats = getTotalStats();
  const mastered = stats['◎'] || 0;
  const answered = leaderboardStats.totalAnswered || 0;
  const accuracy = answered > 0 ? Math.round((leaderboardStats.totalCorrect / answered) * 1000) / 10 : 0;
  const rankLabel = auth.currentUser
    ? (myLeaderboardRank ? `#${myLeaderboardRank}` : '—')
    : 'Login';
  const sub = auth.currentUser
    ? `正解 ${leaderboardStats.totalCorrect || 0}回 ・ 正答率 ${accuracy}% ・ タップでランキングを見る`
    : 'ランキングの閲覧・参加には学習IDでのログインが必要です';

  el.innerHTML = `
    <div class="ranking-panel" onclick="showRanking()">
      <div class="ranking-panel-icon">🏆</div>
      <div class="ranking-panel-info">
        <div class="ranking-panel-title">${getSchoolCode() ? '学校内ランキング' : 'ログイン利用者限定ランキング'}</div>
        <div class="ranking-panel-sub">${getSchoolCode() ? `${escapeHtml(getSchoolName() || getSchoolCode())}内の順位 ／ ` : ''}${sub}</div>
      </div>
      <div class="ranking-panel-rank">
        <div class="ranking-panel-rank-num">${rankLabel}</div>
        <div class="ranking-panel-rank-label">${auth.currentUser ? 'あなたの順位' : 'ログイン推奨'}</div>
      </div>
    </div>
  `;
}

async function renderRanking() {
  const listEl = document.getElementById('ranking-list');
  const myEl = document.getElementById('ranking-my-summary');
  if (!listEl || !myEl) return;

  if (!auth.currentUser) {
    listEl.innerHTML = `<div class="ranking-locked"><div class="ranking-locked-icon">🔒</div><div class="ranking-locked-title">ランキングはログイン中のみ閲覧できます</div><div class="ranking-locked-sub">非学校ランキングは学校に所属していないログイン利用者に、学校内ランキングは同じ学校の利用者に公開されます。ニックネームと正解数を表示します。</div><button class="btn btn-primary" onclick="login()">学習IDでログイン</button></div>`;
    myEl.innerHTML = '<div class="ranking-note">ログイン後、アカウント設定でニックネームを変更できます。本名・メールアドレス・Googleプロフィール写真はランキングに表示しません。</div>';
    renderHomeRankingPanel();
    return;
  }

  await syncLeaderboardProfile();
  const rows = await fetchLeaderboard();
  if (!rows.length) {
    listEl.innerHTML = '<div class="ranking-empty">まだランキングデータがありません。最初の1人目になれます。</div>';
  } else {
    listEl.innerHTML = rows.slice(0, 20).map((row, idx) => {
      const me = row.id === auth.currentUser.uid;
      return `
        <div class="ranking-item ${idx === 0 ? 'top1' : idx === 1 ? 'top2' : idx === 2 ? 'top3' : ''} ${me ? 'me' : ''}">
          <div class="ranking-rank-badge">${idx + 1}</div>
          <div class="ranking-user">
            <div class="ranking-name">${escapeHtml(getPublicRankingName(row))} ${me ? '<span class="ranking-you-tag">YOU</span>' : ''}</div>
          </div>
          <div class="ranking-score">
            <div class="ranking-score-main">${row.totalCorrect || 0}</div>
            <div class="ranking-score-label">正解数</div>
          </div>
        </div>
      `;
    }).join('');
  }

  const answered = leaderboardStats.totalAnswered || 0;
  const accuracy = answered > 0 ? Math.round((leaderboardStats.totalCorrect / answered) * 1000) / 10 : 0;
  myEl.innerHTML = `
    <div class="ranking-stat-grid">
      <div class="ranking-stat-box">
        <div class="ranking-stat-value">${myLeaderboardRank ? '#' + myLeaderboardRank : '—'}</div>
        <div class="ranking-stat-label">現在順位</div>
      </div>
      <div class="ranking-stat-box">
        <div class="ranking-stat-value">${answered}</div>
        <div class="ranking-stat-label">累計回答数</div>
      </div>
      <div class="ranking-stat-box">
        <div class="ranking-stat-value">${leaderboardStats.totalCorrect || 0}</div>
        <div class="ranking-stat-label">累計正解数</div>
      </div>
      <div class="ranking-stat-box">
        <div class="ranking-stat-value">${accuracy}%</div>
        <div class="ranking-stat-label">正答率</div>
      </div>
    </div>
  `;
  renderHomeRankingPanel();
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}


function renderRoleAccessSettingsCard(user) {
  if (!user) return '';
  const isAdmin = isSchoolAdmin(user);
  const isTeacher = String(accountProfile.role || '').trim() === 'teacher';
  if (!isAdmin && !isTeacher) return '';
  return `
    <div class="account-card role-access-settings-card">
      <div class="ranking-meta-title">権限メニュー</div>
      <div class="account-help">先生・管理者向けページはこちらから開けます。アクセス権限がないページは表示されません。</div>
      <div class="role-access-actions-row">
        ${isTeacher || isAdmin ? '<button class="btn btn-secondary role-access-action teacher" onclick="location.href=&quot;./teacher.html&quot;"><span>🏫</span><strong>先生用ページ</strong></button>' : ''}
        ${isAdmin ? '<button class="btn btn-secondary role-access-action admin" onclick="location.href=&quot;./admin.html&quot;"><span>🛠</span><strong>管理者ページ</strong></button>' : ''}
      </div>
    </div>
  `;
}

let accountSettingsTab = 'profile';

function setAccountSettingsTab(tab) {
  if (!['profile', 'study', 'access', 'help', 'settings'].includes(tab)) return;
  accountSettingsTab = tab;
  renderAccountSettings();
}

function renderAccountSettings() {
  const el = document.getElementById('account-settings-body');
  if (!el) return;
  const user = auth.currentUser;
  const signedInUser = !!user;
  const nickname = !user ? '' : user.isAnonymous
    ? (getSchoolName() ? `${getSchoolName()}の学習者` : '学習者')
    : getPublicNickname(user);
  const tabs = [['profile', 'プロフィール'], ['settings', '設定']];
  const selectedTab = accountSettingsTab === 'profile' ? 'profile' : 'settings';
  const tabNav = signedInUser ? `<nav class="account-settings-tabs" aria-label="マイページ設定">${tabs.map(([id, label]) => `<button type="button" class="account-tab-button${selectedTab === id ? ' active' : ''}" aria-pressed="${selectedTab === id}" onclick="setAccountSettingsTab('${id}')">${label}</button>`).join('')}</nav>` : '';


  let panel = '';
  if (!signedInUser || accountSettingsTab === 'profile') {
    if (!signedInUser) {
      panel = `
        <section class="account-card account-login-prompt">
          <div class="account-login-mark" aria-hidden="true">👤</div>
          <h2>ログインしよう</h2>
          <p>ログインすると、学習記録の同期やランキング、プロフィール設定が使えます。</p>
          <button class="btn btn-primary" type="button" onclick="login()">ログイン・新規登録へ</button>
        </section>`;
    } else {
      const stats = getTotalStats();
      const answered = leaderboardStats.totalAnswered || 0;
      const accuracy = answered > 0 ? Math.round((leaderboardStats.totalCorrect / answered) * 1000) / 10 : 0;
      panel = `
        <section class="account-card account-profile-card"><h2 class="account-title-main">DashCloudly 学習ID</h2><p class="account-help">プロフィール・パスキー・ログイン方法は、共通のアカウント設定で管理できます。</p><a class="learning-id-manage" href="${window.DASHCLOUDLY_CONFIG.hubUrl || location.origin}/account.html?site=kobun"><img src="assets/icons/dashcloudly.svg" width="42" height="42" alt=""><span><strong>学習IDを管理</strong><small>プロフィール・ログイン・アカウント管理</small></span><span class="manage-arrow" aria-hidden="true">↗</span></a></section>
        <section class="account-card"><div class="ranking-meta-title">学習の状況</div><div class="account-mini-stat">
          <div class="account-mini-box"><div class="account-mini-value">${answered}</div><div class="account-mini-label">回答数</div></div>
          <div class="account-mini-box"><div class="account-mini-value">${myLeaderboardRank ? '#' + myLeaderboardRank : '—'}</div><div class="account-mini-label">順位</div></div>
          <div class="account-mini-box"><div class="account-mini-value">${leaderboardStats.totalCorrect || 0}</div><div class="account-mini-label">正解数</div></div>
          <div class="account-mini-box"><div class="account-mini-value">${accuracy}%</div><div class="account-mini-label">正答率</div></div>
        </div></section>`;
    }
  } else if (accountSettingsTab === 'settings') {
    panel = renderSchoolSettingsMenu();

  } else if (accountSettingsTab === 'help') {
    panel = renderLearningGuide();
  } else if (accountSettingsTab === 'study') {
    panel = `<section class="account-card"><h2 class="account-panel-title">単語学習設定</h2><p class="account-help">学習時の設定を変更できます。</p>${renderVoiceSettingsCard()}</section>`;
  } else {
    panel = '<section class="account-card"><h2 class="account-panel-title">アカウント</h2><button class="btn btn-primary" type="button" onclick="syncLearningNow(this)">今すぐ同期</button>' + (signedInUser ? '<button class="btn btn-secondary" type="button" onclick="logout()">学習ID・学校からログアウト</button>' : '<button class="btn btn-primary" type="button" onclick="login()">ログイン・新規登録へ</button>') + '</section>' + (signedInUser ? renderRoleAccessSettingsCard(user) : '');
  }

  const back = signedInUser && !['profile', 'settings'].includes(accountSettingsTab) ? '<a class="account-subpanel-back" href="#screen-account" onclick="event.preventDefault();setAccountSettingsTab(&quot;settings&quot;)">← 設定に戻る</a>' : '';
  el.innerHTML = `<div class="account-greeting"><span class="account-greeting-kicker">MY PAGE</span><h1>${signedInUser ? `こんにちは、${escapeHtml(nickname)}さん` : 'ログインしよう'}</h1><p>${signedInUser ? '学習の設定やプロフィールをここで管理できます。' : 'ログインすると、学習記録を保存して続きから学べます。'}</p></div>${signedInUser || getSchoolCode() ? '<button class="btn btn-secondary account-signout" type="button" onclick="logout()">学習ID・学校からログアウト</button>' : ''}${tabNav}<div class="account-tab-panel" role="region" aria-live="polite">${back}${panel}</div>`;

}
function renderSchoolSettingsMenu() {
  const user = auth.currentUser;
  const admin = !!user && isSchoolAdmin(user);
  const teacher = !!user && accountProfile.role === 'teacher';
  return '<section class="account-card settings-menu"><h2>設定</h2><div class="settings-menu-grid">'
    + '<button class="btn btn-secondary" onclick="setAccountSettingsTab(&quot;study&quot;)">学習の詳細設定</button>'
    + '<button class="btn btn-secondary" onclick="setAccountSettingsTab(&quot;access&quot;)">アカウント・同期</button>'
    + '<button class="btn btn-secondary" onclick="setAccountSettingsTab(&quot;help&quot;)">使い方</button>'
    + (getSchoolCode() && (teacher || admin) ? '<a class="btn btn-secondary" href="./teacher.html">学校の学習状況</a>' : '')
    + (admin ? '<a class="btn btn-primary" href="./admin.html">学校・管理者設定</a>' : '')
    + '</div></section>';
}

function loadProgress() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      if (saved.progress) {
        Object.keys(saved.progress).forEach(id => {
          const val = saved.progress[id];
          if (typeof val === 'string') {
            progress[id] = { q1: val || null, q2: null, q3: null };
          } else if (val && typeof val === 'object') {
            progress[id] = {
              q1: val.q1 || null,
              q2: val.q2 || null,
              q3: val.q3 || null,
              latestStatus: ['◎', '○', '×'].includes(val.latestStatus) ? val.latestStatus : null,
              latestAnsweredAt: Number(val.latestAnsweredAt) || null
            };
          }
        });
      }
      if (saved.quizProgress) {
        Object.keys(saved.quizProgress).forEach(id => {
          const qp = saved.quizProgress[id];
          if (!progress[id]) progress[id] = { q1: null, q2: null, q3: null };
          if (qp.q1) progress[id].q1 = qp.q1;
          if (qp.q2) progress[id].q2 = qp.q2;
          if (qp.q3) progress[id].q3 = qp.q3;
        });
      }
      if (saved.bookmarks && Array.isArray(saved.bookmarks)) {
        bookmarks = new Set(saved.bookmarks);
      }
      if (Number.isInteger(saved.normalQuizCount) && saved.normalQuizCount > 0) {
        normalQuizCount = saved.normalQuizCount;
      }
      if (Number.isInteger(saved.bookmarkQuizCount) && saved.bookmarkQuizCount > 0) {
        bookmarkQuizCount = saved.bookmarkQuizCount;
      }
      if (saved.setQuizRanges && typeof saved.setQuizRanges === 'object') {
        setQuizRanges = saved.setQuizRanges;
      }
      if (saved.leaderboardStats && typeof saved.leaderboardStats === 'object') {
        leaderboardStats = {
          totalAnswered: Number(saved.leaderboardStats.totalAnswered) || 0,
          totalCorrect: Number(saved.leaderboardStats.totalCorrect) || 0,
          totalWrong: Number(saved.leaderboardStats.totalWrong) || 0,
          updatedAt: saved.leaderboardStats.updatedAt || null
        };
      }
      if (!auth.currentUser && saved.schoolCode) setLocalSchoolCode(saved.schoolCode, saved.schoolName || '');
      if (saved.savedAt) {
        window.__lastSavedAt = saved.savedAt;
      }
    }
  } catch(e) {
    console.warn('loadProgress error:', e);
    progress = {};
    bookmarks = new Set();
  }
}

function saveProgress() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      progress,
      bookmarks: Array.from(bookmarks),
      normalQuizCount,
      bookmarkQuizCount,
      setQuizRanges,
      leaderboardStats,
      schoolCode: getSchoolCode(),
      schoolName: getSchoolName(),
      savedAt: new Date().toISOString()
    }));
    queueCloudProgressSave();
  } catch(e) {
    console.warn('saveProgress error:', e);
  }
}

// =========================================================
// NAVIGATION
// =========================================================
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('loading-screen').style.display = 'none';
  document.getElementById(id).classList.add('active');
  const studying = id === 'screen-quiz';
  document.body.classList.toggle('is-quiz-active', studying);
  document.body.classList.toggle('is-studying', studying);
  document.getElementById('mobile-bottom-nav')?.classList.toggle('hidden', studying);
}

function scrollQuizToTop() {
  window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  requestAnimationFrame(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
  });
}

function relocateDashboardPanels() {
  const targets = [
    ['home-word-search-panel', 'search-panel-slot'],
    ['home-stats', 'results-stats-slot'],
    ['home-ranking-panel', 'results-ranking-panel-slot']
  ];
  targets.forEach(([source, destination]) => {
    const node = document.getElementById(source);
    const slot = document.getElementById(destination);
    if (node && slot && node.parentElement !== slot) slot.appendChild(node);
  });
}

function showSearch() { showBookmarks(); document.getElementById('home-word-search-input')?.focus(); }

function showProgress() {
  showResultsDashboard();
}

async function showResultsDashboard() {
  relocateDashboardPanels();
  const rankingContent = document.querySelector('#screen-ranking > .content');
  const slot = document.getElementById('results-leaderboard-slot');
  if (rankingContent && slot) slot.appendChild(rankingContent);
  renderHome();
  showScreen('screen-results-dashboard');
  await renderRanking();
}

function showAccountTab() {
  if(document.body.dataset.rolePage){location.assign("./index.html?view=account");return;}
  showAccountSettings();
}

function showSearchWord(id) {
  if (!WORD_MAP[id]) return;
  setQuizRanges[0] = { startId: id, endId: id };
  showHome();
  document.getElementById('sets-grid')?.scrollIntoView({ behavior:'smooth', block:'start' });
}

function showHome() {
  relocateDashboardPanels();
  renderHome();
  renderPwaInvite();
  const grid = document.getElementById('sets-grid');
  const picker = document.querySelector('#screen-set > .content');
  if (picker && grid) grid.replaceChildren(picker);
  currentSetIdx = 0;
  renderSet();
  showScreen('screen-home');
}

let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', event => {
  deferredInstallPrompt = event;
  renderPwaInvite();
});
window.addEventListener('appinstalled', () => { deferredInstallPrompt = null; renderPwaInvite(); });
function renderPwaInvite() { document.getElementById('home-pwa-invite')?.replaceChildren(); }

function showSet(setIdx) {
  showHome();
  document.getElementById('sets-grid')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function openSharedSelection() {
  const params = new URLSearchParams(location.search);
  if (params.get('view') !== 'words') return false;
  const validId = value => /^\d{1,5}$/.test(value || '') && Number(value) >= WORDS[0].id && Number(value) <= WORDS[WORDS.length - 1].id;
  if (!validId(params.get('start')) || !validId(params.get('end')) || Number(params.get('start')) > Number(params.get('end'))) {
    showHome();
    showRangeError(`共有URLの単語範囲が正しくありません。${WORDS[0].id}〜${WORDS[WORDS.length - 1].id}の番号を指定してください。`);
    return true;
  }
  currentSetIdx = 0;
  setQuizRanges[0] = { startId: Number(params.get('start')), endId: Number(params.get('end')) };
  const mode = Number(params.get('mode'));
  if ([1, 2, 3].includes(mode)) selectedMode = mode;
  if (['all', 'mix', 'circle', 'cross', 'bookmark'].includes(params.get('retest'))) selectedRetest = params.get('retest');
  showHome();
  return true;
}

async function shareWordSelection() {
  if (!commitSetRangeInput()) return;
  const range = ensureSetRange(currentSetIdx);
  const url = new URL(location.href);
  url.searchParams.set('view', 'words');
  url.searchParams.set('start', range.startId);
  url.searchParams.set('end', range.endId);
  url.searchParams.set('mode', selectedMode);
  url.searchParams.set('retest', selectedRetest);
  try {
    if (navigator.share) await navigator.share({ title: '古文学習：単語選択', url: url.href });
    else if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(url.href); alert('共有URLをコピーしました'); }
    else prompt('共有URLをコピーしてください', url.href);
  } catch (error) { if (error.name !== 'AbortError') prompt('共有URLをコピーしてください', url.href); }
}

function showBookmarks() {
  renderBookmarks();
  showScreen('screen-bookmark');
}

async function showRanking() {
  await showResultsDashboard();
}

function chooseMobileMode(mode) { selectMode(mode); syncMobileStudyChoices(); }
function chooseMobileRetest(target) { selectRetest(target); syncMobileStudyChoices(); }
function syncMobileStudyChoices() {
  document.querySelectorAll('.mobile-study-choices [data-mode]').forEach(button => {
    const active = Number(button.dataset.mode) === selectedMode;
    button.classList.toggle('selected', active);
    button.setAttribute('aria-pressed', String(active));
  });
  document.querySelectorAll('.mobile-study-choices [data-retest]').forEach(button => {
    const active = button.dataset.retest === selectedRetest;
    button.classList.toggle('selected', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

async function showAccountSettings() {
  if (auth.currentUser) await loadAccountProfile();
  renderAccountSettings();
  showScreen('screen-account');
}

function selectMode(m) {
  selectedMode = m;
  const select = document.getElementById('mode-select');
  if (select && Number(select.value) !== m) select.value = String(m);
  [1,2,3].forEach(i => {
    const btn = document.getElementById('mode-btn-'+i);
    if (btn) btn.classList.toggle('active', i === m);
  });
  renderSet();
}

function selectBmMode(m) {
  selectedBmMode = m;
  const select = document.getElementById('bm-mode-select');
  if (select && Number(select.value) !== m) select.value = String(m);
  [1,2,3].forEach(i => {
    const btn = document.getElementById('bm-mode-btn-'+i);
    if (btn) btn.classList.toggle('active', i === m);
  });
}

function quitQuiz() {
  if (confirm('クイズを中断しますか？進捗は保存されます。')) {
    if (quiz && quiz.type === 'bookmark') {
      showBookmarks();
    } else {
      showSet(currentSetIdx);
    }
  }
}

// =========================================================
// QUIZ GENERATION
// =========================================================
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function commonPrefixLen(a, b) {
  let n = 0;
  const len = Math.min(a.length, b.length);
  while (n < len && a[n] === b[n]) n++;
  return n;
}

function commonSuffixLen(a, b) {
  let n = 0;
  const len = Math.min(a.length, b.length);
  while (n < len && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

function levenshteinDistance(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

function normalizedEnglishForChoice(text) {
  return String(text || '').toLowerCase().replace(/[^a-z]/g, '');
}

function japaneseOverlapScore(a, b) {
  const ignore = new Set(['～','を','に','の','る','す','、','。','；','・','A','B','と','て','で','が','は',' ']);
  const setA = new Set(String(a || '').split('').filter(ch => !ignore.has(ch)));
  const setB = new Set(String(b || '').split('').filter(ch => !ignore.has(ch)));
  let score = 0;
  setA.forEach(ch => { if (setB.has(ch)) score++; });
  return score;
}

function scoreDistractor(target, cand, mode) {
  const a = normalizedEnglishForChoice(target.en);
  const b = normalizedEnglishForChoice(cand.en);
  const idDiff = Math.abs(target.id - cand.id);
  const dist = levenshteinDistance(a, b);
  const maxLen = Math.max(a.length, b.length, 1);

  let score = 0;
  score += Math.max(0, 70 - idDiff) * 1.8;
  score += Math.max(0, 20 - Math.abs(a.length - b.length)) * 2;
  score += Math.max(0, (1 - dist / maxLen)) * 45;
  score += commonPrefixLen(a, b) * 12;
  score += commonSuffixLen(a, b) * 7;
  if (a[0] && a[0] === b[0]) score += 16;
  if (a.slice(-1) && a.slice(-1) === b.slice(-1)) score += 8;
  if (mode === 1) score += japaneseOverlapScore(target.jp, cand.jp) * 7;
  score += Math.random() * 8;
  return score;
}

function getSmartDistractors(word, mode, count = 5) {
  const candidates = WORDS.filter(w => {
    if (w.id === word.id) return false;
    if (mode === 1 && w.jp === word.jp) return false;
    if (mode === 2 && w.en === word.en) return false;
    return true;
  });
  const scored = candidates
    .map(w => ({ word: w, score: scoreDistractor(word, w, mode) }))
    .sort((a, b) => b.score - a.score);
  const topPool = scored.slice(0, Math.min(24, scored.length)).map(x => x.word);
  return shuffle(topPool).slice(0, count);
}

function buildMode1Choices(word) {
  const correctJp = word.jp;
  const distractors = getSmartDistractors(word, 1, 5);
  const choices = shuffle([
    { text: correctJp, correct: true },
    ...distractors.map(d => ({ text: d.jp, correct: false, sourceId: d.id }))
  ]);
  return choices;
}

function buildMode2SingleChoices(word) {
  const correctEn = word.en;
  const distractors = getSmartDistractors(word, 2, 5);
  return shuffle([
    { text: correctEn, id: word.id, correct: true },
    ...distractors.map(d => ({ text: d.en, id: d.id, correct: false }))
  ]);
}

// =========================================================
// QUIZ FLOW
// =========================================================

function sanitizeQuizCount(value, maxCount) {
  if (maxCount <= 0) return 0;
  const num = Number(value);
  if (!Number.isFinite(num)) return Math.min(10, maxCount);
  return Math.max(1, Math.min(maxCount, Math.floor(num)));
}

function syncQuizCountUI(type, availableCount) {
  const isBookmark = type === 'bookmark';
  const input = document.getElementById(isBookmark ? 'bm-quiz-count-input' : 'quiz-count-input');
  const help = document.getElementById(isBookmark ? 'bm-quiz-count-help' : 'quiz-count-help');
  if (!input || !help) return 0;

  const currentValue = isBookmark ? bookmarkQuizCount : normalQuizCount;
  const safeCount = sanitizeQuizCount(currentValue, availableCount);

  input.min = availableCount > 0 ? '1' : '0';
  input.max = String(Math.max(availableCount, 0));
  input.disabled = availableCount === 0;
  input.value = availableCount > 0 ? safeCount : 0;

  if (isBookmark) bookmarkQuizCount = safeCount || bookmarkQuizCount;
  else normalQuizCount = safeCount || normalQuizCount;

  help.textContent = availableCount > 0
    ? `1〜${availableCount}問まで指定できます`
    : '出題できる単語がありません';

  return safeCount;
}

function handleQuizCountInput(type) {
  const isBookmark = type === 'bookmark';
  const input = document.getElementById(isBookmark ? 'bm-quiz-count-input' : 'quiz-count-input');
  const availableCount = isBookmark ? getBmFilteredWords().length : getActiveWords(currentSetIdx).length;
  if (!input) return;

  if (availableCount === 0) {
    input.value = 0;
    return;
  }

  const safeCount = sanitizeQuizCount(input.value, availableCount);
  input.value = safeCount;
  if (isBookmark) bookmarkQuizCount = safeCount;
  else normalQuizCount = safeCount;
  saveProgress();
  syncQuizCountUI(type, availableCount);
}

function isSameRange(aStart, aEnd, bStart, bEnd) {
  return Number(aStart) === Number(bStart) && Number(aEnd) === Number(bEnd);
}

function showRangeError(message) {
  const error = document.getElementById('quiz-range-error');
  if (error) { error.textContent = message; error.hidden = !message; }
  for (const id of ['quiz-range-start-input', 'quiz-range-end-input']) {
    const input = document.getElementById(id);
    if (input) input.setAttribute('aria-invalid', message ? 'true' : 'false');
  }
}

function applySetRange(startId, endId) {
  const min = WORDS[0].id, max = WORDS[WORDS.length - 1].id;
  const valid = value => /^\d+$/.test(String(value)) && Number(value) >= min && Number(value) <= max;
  if (!valid(startId) || !valid(endId) || Number(startId) > Number(endId)) {
    showRangeError(`開始・終了に${min}〜${max}の番号を入力し、開始番号を終了番号以下にしてください。`);
    return false;
  }
  showRangeError('');
  setQuizRanges[currentSetIdx] = { startId: Number(startId), endId: Number(endId) };
  saveProgress();
  renderSet();
  return true;
}

function commitSetRangeInput() {
  const start = document.getElementById('quiz-range-start-input');
  const end = document.getElementById('quiz-range-end-input');
  if (!start || !end) return false;
  return applySetRange(start.value, end.value);
}

function renderSetRangePresets() {
  const container = document.getElementById('quiz-range-presets');
  if (!container) return;

  const safe = ensureSetRange(currentSetIdx);
  const allMinId = WORDS[0].id;
  const allMaxId = WORDS[WORDS.length - 1].id;
  const presets = [{ label: '全単語', startId: allMinId, endId: allMaxId }];
  for (let start = allMinId; start <= allMaxId; start += 100) {
    presets.push({ label: `${start}〜${Math.min(start + 99, allMaxId)}`, startId: start, endId: Math.min(start + 99, allMaxId) });
  }

  container.innerHTML = presets.map(p => `
    <button
      type="button"
      class="range-preset-btn${isSameRange(safe.startId, safe.endId, p.startId, p.endId) ? ' active' : ''}"
      onclick="applySetRange(${p.startId}, ${p.endId})"
    >${p.label}</button>
  `).join('');
}

function updateSetRangeUI() {
  const startInput = document.getElementById('quiz-range-start-input');
  const endInput = document.getElementById('quiz-range-end-input');
  const help = document.getElementById('quiz-range-help');
  const summary = document.getElementById('quiz-range-summary');
  if (!startInput || !endInput || !help || !summary) return;

  const safe = ensureSetRange(currentSetIdx);
  startInput.min = String(safe.minId);
  startInput.max = String(safe.maxId);
  endInput.min = String(safe.minId);
  endInput.max = String(safe.maxId);
  startInput.value = safe.startId;
  endInput.value = safe.endId;

  const count = safe.endId - safe.startId + 1;
  summary.textContent = `${safe.startId}〜${safe.endId}番`;
  help.textContent = `${count}語を出題範囲に設定中です（全単語から選択できます）`;
  renderSetRangePresets();
}

function handleSetRangeInput() {
  // Keep the user's draft untouched while typing. Apply only on the button or action.
  showRangeError('');
}

function incrementSetRangeBound(bound, delta) {
  const safe = ensureSetRange(currentSetIdx);
  const nextStart = bound === 'start' ? safe.startId + delta : safe.startId;
  const nextEnd = bound === 'end' ? safe.endId + delta : safe.endId;
  applySetRange(nextStart, nextEnd);
  const input = document.getElementById(bound === 'start' ? 'quiz-range-start-input' : 'quiz-range-end-input');
  if (input) {
    input.classList.remove('stepper-pulse');
    void input.offsetWidth;
    input.classList.add('stepper-pulse');
  }
}

function incrementQuizCount(type, delta) {
  const isBookmark = type === 'bookmark';
  const input = document.getElementById(isBookmark ? 'bm-quiz-count-input' : 'quiz-count-input');
  if (!input || input.disabled) return;
  input.value = Number(input.value || 0) + delta;
  handleQuizCountInput(type);
  input.classList.remove('stepper-pulse');
  void input.offsetWidth;
  input.classList.add('stepper-pulse');
}

function getLimitedQuizWords(words, requestedCount) {
  const safeCount = sanitizeQuizCount(requestedCount, words.length);
  return shuffle(words).slice(0, safeCount);
}

function startNormalQuiz() {
  if (!commitSetRangeInput()) return;
  const activeWords = getActiveWords(currentSetIdx);
  if (activeWords.length === 0) {
    if (selectedRetest === 'bookmark') {
      alert('このセットにブックマーク済みの単語がありません。');
    } else {
      alert('このセットに学習中の単語がありません。');
    }
    return;
  }
  startQuizSession(shuffle(activeWords), 'normal');
}

function startReviewQuiz() {
  const wrongWords = getWrongWords();
  if (wrongWords.length === 0) { alert('復習対象の単語がありません。'); return; }
  startQuizSession(shuffle(wrongWords), 'review');
}

function startBookmarkQuiz() {
  const words = getBmFilteredWords();
  if (words.length === 0) { alert('表示中の単語がありません。'); return; }
  const selectedWords = getLimitedQuizWords(words, bookmarkQuizCount);
  quiz = {
    words: selectedWords,
    type: 'bookmark',
    idx: 0,
    mode: selectedBmMode,
    results: [],
    choices: null,
    answered: false,
  };
  updateQuizHeader();
  showScreen('screen-quiz');
  renderQuestion();
  scrollQuizToTop();
}

function startQuizSession(words, type) {
  quiz = {
    words, type,
    idx: 0,
    mode: selectedMode,
    results: [],
    choices: null,
    answered: false,
  };
  updateQuizHeader();
  showScreen('screen-quiz');
  renderQuestion();
  scrollQuizToTop();
}

function updateQuizHeader() {
  const modeLabels = { 1: '① 古文単語→現代語訳', 2: '② 現代語訳→古文単語', 3: '③ 現代語訳→古文単語（記述）' };
  const typeLabels = { normal: '通常クイズ', review: '復習テスト', bookmark: '★ブックマーク' };
  const typeClasses = { normal: 'type-normal', review: 'type-review', bookmark: 'type-bookmark' };
  document.getElementById('quiz-mode-tag').textContent = modeLabels[quiz.mode];
  const tt = document.getElementById('quiz-type-tag');
  tt.textContent = typeLabels[quiz.type] || quiz.type;
  tt.className = 'quiz-type-tag ' + (typeClasses[quiz.type] || 'type-normal');
}

function updateQuizProgress() {
  const total = quiz.words.length;
  const current = quiz.idx + 1;
  document.getElementById('quiz-progress-text').textContent = `${Math.min(current, total)} / ${total}`;
  document.getElementById('quiz-progress-fill').style.width = `${(quiz.idx / total) * 100}%`;
}

function renderQuestion() {
  if (quiz.idx >= quiz.words.length) { finishQuiz(); return; }
  const word = quiz.words[quiz.idx];
  quiz.answered = false;
  if (isAutoVoiceEnabled()) {
    const asksForEnglish = quiz.mode === 1;
    setTimeout(() => speakWordText(asksForEnglish ? word.en : word.jp, asksForEnglish ? 'en-US' : 'ja-JP'), 180);
  }
  updateQuizProgress();

  document.getElementById('answer-reveal-area').style.display = 'none';
  const answerUserBox = document.getElementById('answer-user-box');
  const autoJudgeBox = document.getElementById('answer-auto-judge');
  const manualJudgeButtons = document.getElementById('manual-judge-buttons');
  if (answerUserBox) answerUserBox.style.display = 'none';
  if (autoJudgeBox) autoJudgeBox.style.display = 'none';
  if (manualJudgeButtons) manualJudgeButtons.style.display = 'none';
  const nextBtn = document.getElementById('next-btn');
  nextBtn.style.display = 'none';
  nextBtn.className = 'next-btn';
  document.getElementById('btn-unknown').hidden = false;
  document.getElementById('btn-grade-mobile').hidden = quiz.mode !== 3;
  document.body.classList.remove('quiz-answer-shown');
  document.getElementById('correct-flash').classList.remove('show');
  document.getElementById('wrong-flash').classList.remove('show');

  const bmBtn = document.getElementById('quiz-bm-btn');
  if (bmBtn) {
    const bm = isBookmarked(word.id);
    bmBtn.innerHTML = studyActionIcon('star');
    bmBtn.classList.toggle('bookmarked', bm);
    bmBtn.title = bm ? 'ブックマーク解除' : 'ブックマークに追加';
  bmBtn.setAttribute('aria-label', bmBtn.title);
  bmBtn.setAttribute('aria-pressed', String(bm));
  }

  const qWord = document.getElementById('q-word');
  const qMeaning = document.getElementById('q-meaning');
  const qPrompt = document.getElementById('q-prompt');
  const qSub = document.getElementById('q-sub');
  const qPhonetic = document.getElementById('q-phonetic');
  const container = document.getElementById('choices-container');
  if (qPhonetic) { qPhonetic.style.display = 'none'; qPhonetic.textContent = ''; }

  if (quiz.mode === 1) {
    qWord.style.display = 'block'; qMeaning.style.display = 'none';
    qWord.textContent = word.en;
    if (qPhonetic) {
      const phonetic = getWordPhonetic(word);
      qPhonetic.textContent = phonetic;
      qPhonetic.style.display = phonetic ? 'block' : 'none';
    }
    qPrompt.textContent = '次の古文単語の意味として正しいものを選んでください';
    qSub.textContent = '';
    const choices = buildMode1Choices(word);
    quiz.choices = choices;
    container.innerHTML = '';

    const grid = document.createElement('div');
    grid.className = 'choices';
    grid.id = 'mode1-choices-grid';
    choices.forEach((c, i) => {
      const btn = document.createElement('button');
      btn.className = 'choice-btn';
      btn.textContent = c.text;
      btn.dataset.idx = i;
      btn.onclick = () => handleMode1Choice(i);
      grid.appendChild(btn);
    });
    container.appendChild(grid);

  } else if (quiz.mode === 2) {
    qWord.style.display = 'none'; qMeaning.style.display = 'block';
    qMeaning.textContent = word.jp;
    qPrompt.textContent = '次の意味に対応する古文単語を1つ選んでください';
    qSub.textContent = '';
    const choices = buildMode2SingleChoices(word);
    quiz.choices = choices;
    quiz.mode2CorrectId = word.id;
    container.innerHTML = '';

    const grid = document.createElement('div');
    grid.className = 'choices';
    grid.id = 'mode2-choices-grid';
    choices.forEach((c, i) => {
      const btn = document.createElement('button');
      btn.className = 'choice-btn';
      btn.textContent = c.text;
      btn.dataset.idx = i;
      btn.onclick = () => handleMode2Choice(i);
      grid.appendChild(btn);
    });
    container.appendChild(grid);

  } else {
    qWord.style.display = 'none'; qMeaning.style.display = 'block';
    qMeaning.textContent = word.jp;
    qPrompt.textContent = 'この意味に対応する古文単語を書いてください（自動採点）';
    qSub.textContent = '';
    container.innerHTML = `
      <input type="text" class="answer-input" id="free-answer" placeholder="古文単語で入力..."
        onkeydown="if(event.key==='Enter')gradeTypedAnswer()" autocomplete="off" autocapitalize="none" spellcheck="false">
      <button class="confirm-btn" onclick="gradeTypedAnswer()">採点する</button>
    `;
  }

  const voiceButton = document.getElementById('quiz-voice-btn');
  if (voiceButton) {
    const label = quiz.mode === 1 ? '古文単語を聞く' : '現代語訳を聞く';
    voiceButton.title = label;
    voiceButton.setAttribute('aria-label', label);
  }
}

function handleMode1Choice(idx) {
  if (quiz.answered) return;
  unlockSound();
  quiz.answered = true;
  const word = quiz.words[quiz.idx];
  const choice = quiz.choices[idx];
  const isCorrect = choice.correct;

  const buttons = document.querySelectorAll('#choices-container .choice-btn');
  buttons.forEach((btn, i) => {
    btn.disabled = true;
    if (quiz.choices[i].correct) btn.classList.add('correct');
    else if (i === idx && !isCorrect) btn.classList.add('wrong');
  });

  const resultStatus = isCorrect ? '○' : '×'; // 正解はデフォルトで「○」
  flashResult(isCorrect);
  advanceProgress(word.id, resultStatus, 'q1');
  showNextBtn(isCorrect);
  setTimeout(()=>{ const nb=document.getElementById('next-btn'); if(nb){ nb.style.display='block'; nb.classList.add('is-visible'); } },120);
}

function handleMode2Choice(idx) {
  if (quiz.answered) return;
  unlockSound();
  quiz.answered = true;
  const word = quiz.words[quiz.idx];
  const choice = quiz.choices[idx];
  const isCorrect = choice.correct;

  const buttons = document.querySelectorAll('#choices-container .choice-btn');
  buttons.forEach((btn, i) => {
    btn.disabled = true;
    if (quiz.choices[i].correct) btn.classList.add('correct');
    else if (i === idx && !isCorrect) btn.classList.add('wrong');
  });

  const resultStatus = isCorrect ? '○' : '×';
  flashResult(isCorrect);
  advanceProgress(word.id, resultStatus, 'q2');
  showNextBtn(isCorrect);
}

function normalizeTypedAnswer(text) {
  return String(text || '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/\s+/g, ' ');
}

function normalizeTypedAnswerStrict(text) {
  return normalizeTypedAnswer(text).replace(/[^a-z0-9]/g, '');
}

function isTypedAnswerCorrect(input, correct) {
  const a = normalizeTypedAnswer(input);
  const b = normalizeTypedAnswer(correct);
  if (!a) return false;
  if (a === b) return true;
  const strictA = normalizeTypedAnswerStrict(a);
  const strictB = normalizeTypedAnswerStrict(b);
  if (!strictA || !strictB) return false;
  return strictA === strictB;
}

function gradeTypedAnswer() {
  if (quiz.answered) return;
  unlockSound();
  quiz.answered = true;

  const word = quiz.words[quiz.idx];
  const inputEl = document.getElementById('free-answer');
  const typedRaw = inputEl ? inputEl.value : '';
  const typedDisplay = typedRaw.trim();
  const isCorrect = isTypedAnswerCorrect(typedRaw, word.en);
  const resultStatus = isCorrect ? '○' : '×';

  const userBox = document.getElementById('answer-user-box');
  const userText = document.getElementById('answer-user-text');
  const judgeBox = document.getElementById('answer-auto-judge');
  const manualJudgeButtons = document.getElementById('manual-judge-buttons');

  if (userBox && userText) {
    userBox.style.display = 'block';
    userText.textContent = typedDisplay || '（未入力）';
    userText.classList.toggle('empty', !typedDisplay);
  }

  document.getElementById('answer-reveal-text').textContent = word.en;
  document.getElementById('answer-reveal-area').style.display = 'block';

  if (judgeBox) {
    judgeBox.style.display = 'block';
    judgeBox.className = 'answer-auto-judge ' + (isCorrect ? 'correct' : 'wrong');
    judgeBox.textContent = isCorrect
      ? '自動採点：正解です。'
      : '自動採点：不正解です。スペルを確認しましょう。';
  }
  if (manualJudgeButtons) manualJudgeButtons.style.display = 'none';

  const container = document.getElementById('choices-container');
  const qPhonetic = document.getElementById('q-phonetic');
  if (qPhonetic) { qPhonetic.style.display = 'none'; qPhonetic.textContent = ''; }
  container.innerHTML = '';

  flashResult(isCorrect);
  advanceProgress(word.id, resultStatus, 'q3');
  showNextBtn(isCorrect);
}

function showAnswer() {
  gradeTypedAnswer();
}

function selfJudge(grade) {
  if (quiz.answered) return;
  unlockSound();
  quiz.answered = true;
  document.getElementById('answer-reveal-area').style.display = 'none';
  const word = quiz.words[quiz.idx];
  const isCorrect = grade !== 'cross';
  const statusMap = { dcircle: '◎', circle: '○', cross: '×' };
  const resultStatus = statusMap[grade];
  flashResult(isCorrect);
  advanceProgress(word.id, resultStatus, 'q3');
  showNextBtn(isCorrect);
}

function flashResult(isCorrect) {
  if (isCorrect) playCorrectSound();
  else playWrongSound();
  const el = document.getElementById(isCorrect ? 'correct-flash' : 'wrong-flash');
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 1150);
}

function showNextBtn(isCorrect) {
  const btn = document.getElementById('next-btn');
  document.getElementById('btn-unknown').hidden = true;
  document.getElementById('btn-grade-mobile').hidden = true;
  const word = quiz.words[quiz.idx];
  quiz.results.push({ wordId: word.id, correct: isCorrect });
  leaderboardStats.totalAnswered = (leaderboardStats.totalAnswered || 0) + 1;
  if (isCorrect) leaderboardStats.totalCorrect = (leaderboardStats.totalCorrect || 0) + 1;
  else leaderboardStats.totalWrong = (leaderboardStats.totalWrong || 0) + 1;
  leaderboardStats.updatedAt = new Date().toISOString();
  saveProgress();
  syncLeaderboardProfile();
  btn.style.display = 'block';
  btn.classList.add('is-visible');
  document.body.classList.add('quiz-answer-shown');
  if (quiz.idx + 1 >= quiz.words.length) {
    btn.textContent = '結果を見る →';
  } else {
    btn.textContent = isCorrect ? '✓ 次の問題へ →' : '✗ 次の問題へ →';
  }
  btn.className = 'next-btn is-visible ' + (isCorrect ? 'correct-next' : 'wrong-next'); btn.style.display='block';
}

function skipUnknownQuestion() {
  if (quiz.answered || !quiz.words[quiz.idx]) return;
  quiz.answered = true;
  const word = quiz.words[quiz.idx];
  document.activeElement?.blur();
  if (quiz.mode === 3) {
    document.getElementById('answer-reveal-text').textContent = word.en;
    document.getElementById('answer-reveal-area').style.display = 'block';
    document.getElementById('answer-user-box').style.display = 'none';
    document.getElementById('answer-auto-judge').style.display = 'none';
    document.getElementById('choices-container').replaceChildren();
  } else {
    document.querySelectorAll('#choices-container .choice-btn').forEach((button, i) => {
      button.disabled = true;
      if (quiz.choices[i]?.correct) button.classList.add('correct');
    });
    const info = document.createElement('div');
    info.className = 'skip-answer';
    info.textContent = `答え：${word.en} — ${word.jp}`;
    document.getElementById('choices-container').appendChild(info);
  }
  advanceProgress(word.id, '×', 'q' + quiz.mode);
  showNextBtn(false);
}

function advanceProgress(wordId, resultStatus, quizNum) {
  if (quizNum && resultStatus) {
    setQResult(wordId, quizNum, resultStatus);
  }
  saveProgress();
}

function nextQuestion() {
  quiz.idx++;
  renderQuestion();
  if (quiz.idx < quiz.words.length) scrollQuizToTop();
}

function finishQuiz() {
  const correct = quiz.results.filter(r => r.correct).length;
  const wrong = quiz.results.length - correct;

  const titleEl = document.getElementById('result-title');
  const subEl = document.getElementById('result-sub');
  const statsEl = document.getElementById('result-stats');
  const btnsEl = document.getElementById('result-btns');

  const typeLabel = { normal: '通常クイズ', review: '復習テスト', bookmark: '★ブックマーク' }[quiz.type];
  titleEl.textContent = `${typeLabel}完了！`;
  subEl.textContent = `全${quiz.results.length}問`;

  statsEl.innerHTML = `
    <div class="result-stat-item correct">
      <div class="result-stat-num">${correct}</div>
      <div class="result-stat-label">正解</div>
    </div>
    <div class="result-stat-item wrong">
      <div class="result-stat-num">${wrong}</div>
      <div class="result-stat-label">不正解</div>
    </div>
  `;
  renderHomeRankingPanel();

  const wrongWords = getWrongWords();
  let btnsHTML = '';
  if (quiz.type === 'normal') {
    btnsHTML += `<button class="btn btn-primary" onclick="showSet(${currentSetIdx})">セットに戻る</button>`;
  } else if (quiz.type === 'bookmark') {
    btnsHTML += `<button class="btn" style="background:var(--bookmark);color:#fff;" onclick="showBookmarks()">📋 マイリストに戻る</button>`;
  } else {
    btnsHTML += `<button class="btn btn-primary" onclick="showHome()">ホームへ</button>`;
  }
  if (wrongWords.length >= WRONG_THRESHOLD) {
    btnsHTML += `<button class="btn btn-review" onclick="startReviewQuiz()">⚠ 復習リスト（${wrongWords.length}問）</button>`;
  }
  btnsHTML += `<button class="btn btn-secondary" onclick="showHome()">ホームへ</button>`;
  btnsEl.innerHTML = btnsHTML;

  playFinishSound();
  showScreen('screen-result');
}

// =========================================================
// RENDER HOME
// =========================================================
function renderHome() {
  const stats = getTotalStats();
  const total = WORDS.length;
  const done = stats['○'] + stats['◎'] + stats['×'];
  document.getElementById('home-stats').innerHTML = `
    <div class="home-stat total"><div class="home-stat-num">${total}</div><div class="home-stat-label">総単語数</div></div>
    <div class="home-stat s-○"><div class="home-stat-num">${stats['○']}</div><div class="home-stat-label">○</div></div>
    <div class="home-stat s-◎"><div class="home-stat-num">${stats['◎']}</div><div class="home-stat-label">◎</div></div>
    <div class="home-stat s-×"><div class="home-stat-num">${stats['×']}</div><div class="home-stat-label">×</div></div>
    <div style="flex:1;margin-left:8px;">
      <div style="font-size:11px;color:var(--text2);margin-bottom:6px;font-weight:bold;">全体進捗 ${done}/${total}</div>
      <div class="progress-bar" style="height:10px;">
        <div class="progress-seg circle" style="width:${(stats['○']/total*100).toFixed(1)}%"></div>
        <div class="progress-seg dcircle" style="width:${(stats['◎']/total*100).toFixed(1)}%"></div>
        <div class="progress-seg cross" style="width:${(stats['×']/total*100).toFixed(1)}%"></div>
      </div>
    </div>
  `;
  renderHomeRankingPanel();

  const wrongWords = getWrongWords();
  const alertEl = document.getElementById('home-alert');

  const bmCount = bookmarks.size;
  const wrongCount = getWrongWords().length;
  const reviewEntry = document.querySelector('#screen-home .review-entry');
  if (reviewEntry) reviewEntry.hidden = wrongCount < WRONG_THRESHOLD;
  const myListCount = new Set([...Array.from(bookmarks), ...getWrongWords().map(w => w.id)]).size;
  const bmPanelEl = document.getElementById('home-bookmark-panel');
  if (bmPanelEl) {
    if (myListCount > 0 && wrongCount >= WRONG_THRESHOLD) {
      const parts = [];
      if (bmCount > 0) parts.push(`★ ${bmCount}語`);
      if (wrongCount > 0) parts.push(`× ${wrongCount}語`);
      bmPanelEl.innerHTML = `
        <div class="bookmark-panel" onclick="showBookmarks()">
          <div class="bookmark-panel-icon">📋</div>
          <div class="bookmark-panel-info">
            <div class="bookmark-panel-title">マイリスト</div>
            <div class="bookmark-panel-sub">${parts.join(' ／ ')} — まとめて復習できます</div>
          </div>
          <div class="bookmark-panel-count">${myListCount}<span style="font-size:14px;color:var(--text2);margin-left:4px;">語</span></div>
        </div>`;
    } else {
      bmPanelEl.innerHTML = '';
    }
  }

  if (wrongWords.length >= WRONG_THRESHOLD) {
    alertEl.innerHTML = `
      <div class="alert-banner" onclick="startReviewQuiz()">
        <div class="alert-icon">⚠</div>
        <div class="alert-text">
          <div class="alert-title">間違えた単語が${wrongWords.length}語あります</div>
          <div class="alert-sub">×になった単語が溜まっています。今すぐ復習しましょう。</div>
        </div>
        <button class="alert-btn">復習する</button>
      </div>
    `;
  } else {
    alertEl.innerHTML = '';
  }

  renderClassStudyShortcut();
  const grid = document.getElementById('sets-grid');
  if (grid.querySelector('.quiz-options')) return;
  grid.innerHTML = `<button type="button" class="set-card word-picker-card" onclick="showSet(0)">
    <div class="set-title">単語を選ぶ →</div>
    <div class="set-range">全${WORDS.length}語から番号範囲を選択</div>
    <div class="progress-bar"><div class="progress-seg circle" style="width:${(stats['○']/total*100).toFixed(1)}%"></div><div class="progress-seg dcircle" style="width:${(stats['◎']/total*100).toFixed(1)}%"></div><div class="progress-seg cross" style="width:${(stats['×']/total*100).toFixed(1)}%"></div></div>
    <div class="set-stats"><span class="stat-item stat-none">未 ${stats['']}</span><span class="stat-item stat-○">○ ${stats['○']}</span><span class="stat-item stat-◎">◎ ${stats['◎']}</span><span class="stat-item stat-×">× ${stats['×']}</span></div>
  </button>`;
}


// =========================================================
// WORD SEARCH
// =========================================================
let wordSearchQuery = '';

function normalizeWordSearchText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function setWordSearchQuery(value) {
  wordSearchQuery = String(value || '');
  renderSet();
}

function clearWordSearch() {
  wordSearchQuery = '';
  const input = document.getElementById('word-search-input');
  if (input) input.value = '';
  renderSet();
}

function isWordSearchMatch(word, query) {
  const q = normalizeWordSearchText(query);
  if (!q) return true;
  const haystack = normalizeWordSearchText(`${word.id} ${word.en} ${word.jp}`);
  return haystack.includes(q);
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function highlightWordSearch(value) {
  const raw = String(value || '');
  const q = normalizeWordSearchText(wordSearchQuery);
  if (!q) return escapeHtml(raw);
  const escaped = escapeHtml(raw);
  const safeQ = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  try {
    return escaped.replace(new RegExp(`(${safeQ})`, 'ig'), '<mark class="word-search-mark">$1</mark>');
  } catch (e) {
    return escaped;
  }
}

// =========================================================
// RENDER SET
// =========================================================
function renderSet() {
  const range = ensureSetRange(currentSetIdx);
  const words = WORDS.filter(w => w.id >= range.startId && w.id <= range.endId).slice(0, 100);
  document.getElementById('set-screen-title').textContent = '単語を選ぶ';
  document.getElementById('set-screen-sub').textContent = `${range.startId}〜${range.endId}番 / ${range.endId-range.startId+1}語を選択中`;

  updateSetRangeUI();
  const modeSelect = document.getElementById('mode-select');
  if (modeSelect) modeSelect.value = String(selectedMode);
  const retestSelect = document.getElementById('retest-select');
  if (retestSelect) retestSelect.value = selectedRetest;
  syncMobileStudyChoices();

  const activeWords = getActiveWords(currentSetIdx);
  const startBtn = document.getElementById('btn-start-quiz');

  startBtn.disabled = activeWords.length === 0;
  startBtn.textContent = activeWords.length > 0
    ? `▶ ${range.startId}〜${range.endId}番でクイズ開始（${activeWords.length}語）`
    : `▶ ${range.startId}〜${range.endId}番は出題対象なし`;

  const body = document.getElementById('word-table-body');
  let html = '';
  words.forEach(w => {
    const inRange = w.id >= range.startId && w.id <= range.endId;
    const s = getStatus(w.id);
    const qp = getQProgress(w.id);
    const bm = isBookmarked(w.id);
    const newBadge = w.isNew ? '<span class="new-badge">新</span>' : '';
    const manualBtn = s === '○' ? `<button class="manual-up-btn" onclick="manualUpgrade(${w.id},event)" title="◎に昇格">▲◎</button>` : '';
    const q1b = qp.q1 ? `<span class="mini-badge mini-badge-q1">①${qp.q1}</span>` : '';
    const q2b = qp.q2 ? `<span class="mini-badge mini-badge-q2">②${qp.q2}</span>` : '';
    const q3b = qp.q3 ? `<span class="mini-badge mini-badge-q3">③${qp.q3}</span>` : '';
    html += `
      <div class="word-row" style="${inRange ? '' : 'opacity:0.45;'}">
        <span><button class="bookmark-btn${bm ? ' bookmarked' : ''}" onclick="toggleBookmarkRow(${w.id},event)" title="${bm ? 'ブックマーク解除' : 'ブックマーク追加'}">${bm ? '★' : '☆'}</button></span>
        <span class="word-num">${w.id}</span>
        <span class="word-en"><button class="word-voice-btn" onclick="speakWordById(${w.id},event)" title="発音を聞く">${studyActionIcon('audio')}</button>${highlightWordSearch(w.en)}${newBadge}</span>
        <span class="word-jp">${highlightWordSearch(w.jp)}${inRange ? '' : ' <span style="font-size:10px;color:var(--text2);">(範囲外)</span>'}</span>
        <span class="word-status">
          <span class="badge badge-${s || 'none'}">${s || '―'}</span>
          ${manualBtn}
          <span class="word-quiz-badges">${q1b}${q2b}${q3b}</span>
        </span>
      </div>
    `;
  });
  body.innerHTML = html + (range.endId - range.startId >= 100 ? '<div class="range-preview-note">プレビューは先頭100語を表示しています。クイズには選択した全単語が含まれます。</div>' : '');
}

function toggleBookmarkRow(wordId, event) {
  event.stopPropagation();
  toggleBookmark(wordId);
  renderSet();
}

function toggleQuizBookmark() {
  if (!quiz) return;
  const word = quiz.words[quiz.idx];
  toggleBookmark(word.id);
  const bmBtn = document.getElementById('quiz-bm-btn');
  const bm = isBookmarked(word.id);
  bmBtn.innerHTML = studyActionIcon('star');
  bmBtn.classList.toggle('bookmarked', bm);
  bmBtn.title = bm ? 'ブックマーク解除' : 'ブックマークに追加';
  bmBtn.setAttribute('aria-label', bmBtn.title);
  bmBtn.setAttribute('aria-pressed', String(bm));
}

function manualUpgrade(wordId, event) {
  event.stopPropagation();
  if (getStatus(wordId) === '○') {
    const qn = 'q' + selectedMode;
    if (confirm(`「${WORD_MAP[wordId].en}」を○→◎に手動昇格しますか？`)) {
      setQResult(wordId, qn, '◎');
      saveProgress();
      syncLeaderboardProfile();
      renderSet();
    }
  }
}

// =========================================================
// RENDER BOOKMARKS
// =========================================================
function getBmFilteredWords() {
  if (selectedBmFilter === 'bm') return getBookmarkedWords();
  if (selectedBmFilter === 'wrong') return getWrongWords();
  const ids = new Set([
    ...Array.from(bookmarks),
    ...getWrongWords().map(w => w.id)
  ]);
  return WORDS.filter(w => ids.has(w.id));
}

function setBmFilter(filter) {
  selectedBmFilter = filter;
  renderBookmarks();
}

function renderBookmarks() {
  const bmWords    = getBookmarkedWords();
  const wrongWords = getWrongWords();
  const allWords   = (() => {
    const ids = new Set([...Array.from(bookmarks), ...wrongWords.map(w => w.id)]);
    return WORDS.filter(w => ids.has(w.id));
  })();

  document.getElementById('bm-cnt-all').textContent   = allWords.length;
  document.getElementById('bm-cnt-bm').textContent    = bmWords.length;
  document.getElementById('bm-cnt-wrong').textContent = wrongWords.length;

  ['all','bm','wrong'].forEach(f => {
    const btn = document.getElementById('bm-filter-' + f);
    if (!btn) return;
    btn.className = 'bm-filter-btn' + (selectedBmFilter === f ? ' active-' + f : '');
  });

  const displayWords = getBmFilteredWords();
  const titleMap = { all: 'マイリスト', bm: '★ ブックマーク', wrong: '× 間違い一覧' };
  const titleEl = document.getElementById('bm-screen-title');
  if (titleEl) titleEl.textContent = titleMap[selectedBmFilter];
  document.getElementById('bm-screen-sub').textContent = `${displayWords.length}語`;

  const quizBtn = document.getElementById('btn-bm-quiz');
  if (quizBtn) {
    quizBtn.disabled = displayWords.length === 0;
    const currentCount = syncQuizCountUI('bookmark', displayWords.length);
    const btnLabelMap = {
      all: '▶ マイリストクイズ',
      bm:  '★ ブックマーククイズ',
      wrong: '× 間違い語句クイズ'
    };
    const btnColorMap = {
      all:   'var(--gold)',
      bm:    'var(--bookmark)',
      wrong: 'var(--cross)'
    };
    quizBtn.textContent = displayWords.length > 0
      ? `${btnLabelMap[selectedBmFilter]} (${currentCount} / ${displayWords.length}語)`
      : btnLabelMap[selectedBmFilter];
    quizBtn.style.background = btnColorMap[selectedBmFilter];
    quizBtn.style.color = '#fff';
  }

  const listEl = document.getElementById('bm-word-list');

  if (displayWords.length === 0) {
    const emptyMsgMap = {
      all:   ['📋', 'マイリストが空です', 'ブックマーク（☆）を追加するか、クイズで×をつけると表示されます'],
      bm:    ['☆',  'ブックマークがありません', '単語リストの ☆ ボタン、またはクイズ中の ☆ でブックマークできます'],
      wrong: ['✗',  '×の単語がありません', 'クイズで間違えた単語がここに表示されます'],
    };
    const [icon, text, sub] = emptyMsgMap[selectedBmFilter];
    listEl.innerHTML = `
      <div class="bm-empty">
        <div class="bm-empty-icon">${icon}</div>
        <div class="bm-empty-text">${text}</div>
        <div class="bm-empty-sub">${sub}</div>
      </div>`;
    return;
  }

  let html = `
    <div class="word-table-wrap">
      <div class="word-table-header" style="grid-template-columns:28px 40px 120px 1fr 90px 32px;">
        <span></span><span>No.</span><span>古文単語</span><span>意味</span><span>進捗</span><span></span>
      </div>
      <div class="word-table-scroll">`;

  displayWords.forEach(w => {
    const s   = getStatus(w.id);
    const bm  = isBookmarked(w.id);
    const isWrong = s === '×';
    const newBadge = w.isNew ? '<span class="new-badge">新</span>' : '';
    const wrongTag = isWrong ? '<span class="cross-indicator">×</span>' : '';
    const bmStar = bm
      ? `<button class="bookmark-btn bookmarked" style="display:block;" onclick="toggleBookmarkBm(${w.id},event)" title="ブックマーク解除">★</button>`
      : `<button class="bookmark-btn" onclick="toggleBookmarkBm(${w.id},event)" title="ブックマーク追加">☆</button>`;

    html += `
      <div class="word-row" style="grid-template-columns:28px 40px 120px 1fr 90px 32px;">
        <span></span>
        <span class="word-num">${w.id}</span>
        <span class="word-en"><button class="word-voice-btn" onclick="speakWordById(${w.id},event)" title="発音を聞く">${studyActionIcon('audio')}</button>${w.en}${newBadge}${wrongTag}</span>
        <span class="word-jp">${w.jp}</span>
        <span class="word-status"><span class="badge badge-${s || 'none'}">${s || '―'}</span></span>
        <span>${bmStar}</span>
      </div>`;
  });

  html += `</div></div>`;
  listEl.innerHTML = html;
}

function toggleBookmarkBm(wordId, event) {
  event.stopPropagation();
  toggleBookmark(wordId);
  renderBookmarks();
}

// =========================================================
// INIT
// =========================================================
async function init() {
  if (document.body && document.body.dataset && document.body.dataset.rolePage) {
    await initRolePage(document.body.dataset.rolePage);
    return;
  }
  loadProgress();
  restoreClassAssignment();
  window.addEventListener('online', refreshClassTestRange);
  const redirected = await enforceMaintenanceMode();
  if (redirected) return;
  document.getElementById('loading-screen').style.display = 'none';
  renderAuthFab();
  if (!openSharedSelection()) showHome();
  refreshClassTestRange();
  showWelcomeModalIfNeeded();
  if (new URLSearchParams(location.search).get('view') === 'account') showAccountSettings();
}

init().catch(e => {
  console.warn('init error:', e);
  document.getElementById('loading-screen').style.display = 'none';
  renderAuthFab();
  if (!openSharedSelection()) showHome();
}).finally(()=>window.dashcloudlyStartup?.finish('app'));

function showAuthModal() {
  const modal = document.getElementById('auth-choice-modal');
  if (!modal) { const page = document.body.dataset.rolePage; const target = ['admin','teacher'].includes(page) ? page : 'account'; location.href = './login.html?return=' + target; return; }
  modal.classList.add('show');
  modal.setAttribute('aria-hidden', 'false');
  setTimeout(() => {
    const email = document.getElementById('auth-email-input');
    if (email && window.innerWidth > 700) email.focus();
  }, 120);
}

function closeAuthModal() {
  const modal = document.getElementById('auth-choice-modal');
  if (!modal) return;
  modal.classList.remove('show');
  modal.setAttribute('aria-hidden', 'true');
  if (onboardingAuthOpen) { onboardingAuthOpen = false; advanceOnboarding(); }
}

function login(){ if(window.startDashcloudlyLogin)window.startDashcloudlyLogin();else location.href='./login.html'; }

function getEmailAuthValues() {
  const email = (document.getElementById('auth-email-input')?.value || '').trim();
  const password = document.getElementById('auth-password-input')?.value || '';
  return { email, password };
}

function authErrorMessage(e) {
  const code = e && e.code;
  if (code === 'auth/invalid-email') return 'メールアドレスの形式を確認してください';
  if (code === 'auth/user-not-found') return 'このメールアドレスは登録されていません';
  if (code === 'auth/wrong-password') return 'パスワードが違います';
  if (code === 'auth/email-already-in-use') return 'このメールアドレスは登録済みです';
  if (code === 'auth/weak-password') return 'パスワードは6文字以上にしてください';
  if (code === 'auth/operation-not-allowed') return 'このログイン方法は現在利用できません。別の方法をお試しください。';
  if (code === 'auth/popup-closed-by-user') return 'ログイン画面が閉じられました';
  return 'ログインできませんでした。入力内容を確認して、もう一度お試しください。';
}

async function loginGoogle(){
  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    await auth.signInWithPopup(provider);
    storeClassAssignment(null);
    closeAuthModal();
    markWelcomeAccepted();
    showSyncStatus('Googleでログインしました');
  } catch (e) {
    console.warn('loginGoogle error:', e);
    showSyncStatus(authErrorMessage(e), true);
  }
}

async function loginEmail(){
  const { email, password } = getEmailAuthValues();
  if (!email || !password) { showSyncStatus('メールアドレスとパスワードを入力してください', true); return; }
  try {
    await auth.signInWithEmailAndPassword(email, password);
    storeClassAssignment(null);
    closeAuthModal();
    markWelcomeAccepted();
    showSyncStatus('メールでログインしました');
  } catch (e) {
    console.warn('loginEmail error:', e);
    showSyncStatus(authErrorMessage(e), true);
  }
}

async function signupEmail(){
  const { email, password } = getEmailAuthValues();
  if (!email || !password) { showSyncStatus('メールアドレスとパスワードを入力してください', true); return; }
  try {
    await auth.createUserWithEmailAndPassword(email, password);
    storeClassAssignment(null);
    closeAuthModal();
    markWelcomeAccepted();
    showSyncStatus('新規登録してログインしました');
  } catch (e) {
    console.warn('signupEmail error:', e);
    showSyncStatus(authErrorMessage(e), true);
  }
}

async function resetPassword(){
  const { email } = getEmailAuthValues();
  if (!email) { showSyncStatus('リセット用のメールアドレスを入力してください', true); return; }
  try {
    await auth.sendPasswordResetEmail(email);
    showSyncStatus('パスワード再設定メールを送信しました');
  } catch (e) {
    console.warn('resetPassword error:', e);
    showSyncStatus(authErrorMessage(e), true);
  }
}

function startWithoutLogin(){
  storeClassAssignment(null);
  closeAuthModal();
  markWelcomeAccepted();
  showSyncStatus('ログインなしで開始しました');
}


document.addEventListener('keydown', (e) => {
  const modal = document.getElementById('auth-choice-modal');
  if (!modal || !modal.classList.contains('show')) return;
  if (e.key === 'Escape') closeAuthModal();
  if (e.key === 'Enter' && (document.activeElement?.id === 'auth-email-input' || document.activeElement?.id === 'auth-password-input')) {
    loginEmail();
  }
});

let logoutInProgress = false;
async function logout(){
  if (logoutInProgress) return;
  logoutInProgress = true;
  clearTimeout(cloudSaveTimer);
  cloudRestoreComplete = false;
  try {
    await auth.signOut();
    const schoolCode = getSchoolCode();
    storeClassAssignment(null);
    setLocalSchoolCode('', '');
    if (schoolCode) localStorage.removeItem(SCHOOL_LOGO_KEY_PREFIX + schoolCode);
    closeAccountPopover();
    showSyncStatus('ログアウトしました');
    sessionStorage.setItem('dashcloudly-sso-signed-out','1');
    location.assign(`${window.DASHCLOUDLY_CONFIG.hubUrl || location.origin}/logout.html?site=kobun`);
  } catch (e) {
    logoutInProgress = false;
    console.warn('logout error:', e);
    showSyncStatus('ログアウトに失敗しました', true);
  }
}

let startupAuthGeneration=0;
auth.onAuthStateChanged(async user => {
  const startupGeneration=++startupAuthGeneration;
  let startupProfilePrepared=false;
  const finishStartupProfile=()=>{if(startupGeneration===startupAuthGeneration){startupProfilePrepared=true;window.dashcloudlyStartup?.finish('profile');}};
  window.dashcloudlyStartup?.wait('profile');
  try {
  cloudRestoreComplete = false;
  clearTimeout(cloudSaveTimer);
  profileAvatarUnsubscribe?.();profileAvatarUnsubscribe=null;profileAvatarData='';
  if (user) {
    if (await enforceUserSuspendedState(user)) return;
    await loadAccountProfile();
    await loadSchoolCodeFromProfile();
    await refreshClassTestRange();
      renderClassStudyShortcut();
    renderAuthFab();
    console.log('ログイン:', user.uid);
    try {
      await restoreCloudProgress();
      if (auth.currentUser?.uid !== user.uid) return;
      cloudRestoreComplete = true;
      await saveCloudProgress();
      renderClassStudyShortcut();
      if (document.getElementById('screen-home')?.classList.contains('active')) showHome();
    } catch (error) { /* Never overwrite remote data after a failed restore. */ }
    finishStartupProfile();
    await syncLeaderboardProfile();
    await fetchLeaderboard();
    renderHomeRankingPanel();
    if (document.getElementById('screen-ranking') && document.getElementById('screen-ranking').classList.contains('active')) {
      renderRanking();
    }
    if (document.getElementById('screen-account') && document.getElementById('screen-account').classList.contains('active')) {
      renderAccountSettings();
    }
  } else {
    accountProfile = { nickname: '' };
    accountSettingsTab = 'profile';
    renderClassStudyShortcut();
    renderAuthFab();
    leaderboardCache = [];
    myLeaderboardRank = null;
    renderHomeRankingPanel();
    if (document.getElementById('screen-ranking') && document.getElementById('screen-ranking').classList.contains('active')) {
      renderRanking();
    }
    if (document.getElementById('screen-account') && document.getElementById('screen-account').classList.contains('active')) {
      renderAccountSettings();
    }
  }
  } catch(error){console.warn('Startup account state unavailable',error);if(!startupProfilePrepared&&startupGeneration===startupAuthGeneration)window.dashcloudlyStartup?.error('ログイン状態を確認できませんでした。再度お試しください。');} finally{finishStartupProfile();}
});

window.addEventListener('beforeunload', () => {
  if (auth.currentUser) {
    saveCloudProgress();
  }
});

// =========================================================
// UI POLISH HELPERS 2026
// =========================================================
(function(){
  function getActiveScreenId(){
    const active = document.querySelector('.screen.active');
    return active ? active.id : '';
  }

  async function updateRoleNavButtons(){
    // 先生・管理メニューは下部バーから独立させず、「設定」内に統合。
    // 下部バーは ホーム / 復習 / 順位 / 設定 の4項目に固定する。
  }

  function updateUiState(){
    const id = getActiveScreenId();
    document.body.classList.toggle('is-quiz-active', id === 'screen-quiz');
    const nav = document.getElementById('mobile-bottom-nav');
    if (!nav) return;
    nav.classList.toggle('hidden', id === 'screen-quiz');
    nav.querySelectorAll('button[data-target]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.target === id);
      if (btn.dataset.target === id) btn.setAttribute('aria-current', 'page');
      else btn.removeAttribute('aria-current');
      if (btn.dataset.target === 'screen-account') btn.querySelector('span:last-child').textContent = auth.currentUser || activeClassAssignment?.local ? 'マイページ' : 'ログイン';
    });
    requestAnimationFrame(() => positionGlass(nav));
    updateRoleNavButtons();
  }

  function positionGlass(nav, candidate){
    const active = candidate || nav.querySelector('button.active');
    nav.style.setProperty('--glass-visible', active ? '1' : '0');
    if (!active || !nav.offsetWidth) return;
    nav.style.setProperty('--glass-x', active.offsetLeft + 'px');
    nav.style.setProperty('--glass-y', active.offsetTop + 'px');
    nav.style.setProperty('--glass-width', active.offsetWidth + 'px');
    nav.style.setProperty('--glass-height', active.offsetHeight + 'px');
  }

  function buildBottomNav(){
    if (document.getElementById('mobile-bottom-nav')) return;
    const nav = document.createElement('nav');
    nav.id = 'mobile-bottom-nav';
    nav.className = 'mobile-bottom-nav';
    nav.setAttribute('aria-label', '主要ナビゲーション');
    const icon = (paths) => `<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
    nav.innerHTML = `
      <button type="button" data-target="screen-home" onclick="showHome()">${icon('<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>')}<span>学習</span></button>
      <button type="button" data-target="screen-bookmark" onclick="showBookmarks()">${icon('<circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5"/><path d="M8 10h5M8 13h3"/>')}<span>復習・検索</span></button>
      <button type="button" data-target="screen-results-dashboard" onclick="showResultsDashboard()">${icon('<path d="M4 20V12m5 8V8m5 12v-5m5 5V4"/><path d="M3 4h5l4 4 4-4h5"/>')}<span>成績</span></button>
      <button type="button" data-target="screen-account" onclick="showAccountTab()">${icon('<circle cx="12" cy="8" r="3.5"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/>')}<span>ログイン</span></button>
    `;
    document.body.appendChild(nav);
    new ResizeObserver(() => positionGlass(nav)).observe(nav);
    let drag = null, suppressClick = false;
    const buttons = [...nav.querySelectorAll('button[data-target]')];
    const closestButton = x => buttons.reduce((best, button) => {
      const box = button.getBoundingClientRect();
      const distance = Math.abs(x - (box.left + box.width / 2));
      return !best || distance < best.distance ? {button, distance} : best;
    }, null)?.button;
    nav.addEventListener('pointerdown', event => {
      if (!event.isPrimary || event.button !== 0) return;
      drag = {id:event.pointerId, startX:event.clientX, startY:event.clientY, moved:false, candidate:closestButton(event.clientX)};
    });
    nav.addEventListener('pointermove', event => {
      if (!drag || drag.id !== event.pointerId) return;
      if (!drag.moved && Math.abs(event.clientY - drag.startY) > Math.abs(event.clientX - drag.startX)) return;
      if (Math.abs(event.clientX - drag.startX) < 8 && !drag.moved) return;
      drag.moved = true;
      if (!nav.hasPointerCapture(event.pointerId)) nav.setPointerCapture(event.pointerId);
      nav.classList.add('is-dragging');
      drag.candidate = closestButton(event.clientX);
      positionGlass(nav, drag.candidate);
      const box = nav.getBoundingClientRect();
      const half = drag.candidate.offsetWidth / 2;
      nav.style.setProperty('--glass-x', Math.max(8, Math.min(event.clientX - box.left - half, nav.clientWidth - half * 2 - 8)) + 'px');
    });
    const finish = (event, cancelled) => {
      if (!drag || drag.id !== event.pointerId) return;
      const completed = drag;
      drag = null;
      nav.classList.remove('is-dragging');
      if (nav.hasPointerCapture(event.pointerId)) nav.releasePointerCapture(event.pointerId);
      if (completed.moved && !cancelled) {
        suppressClick = true;
        completed.candidate.click();
        setTimeout(() => { suppressClick = false; }, 0);
      }
      requestAnimationFrame(() => positionGlass(nav));
    };
    nav.addEventListener('pointerup', event => finish(event, false));
    nav.addEventListener('pointercancel', event => finish(event, true));
    nav.addEventListener('lostpointercapture', event => { if (event.target === nav) finish(event, true); });
    nav.addEventListener('click', event => {
      if (suppressClick && event.isTrusted) { event.preventDefault(); event.stopImmediatePropagation(); }
    }, true);
  }

  function wrapScreenFunction(name){
    if (typeof window[name] !== 'function') return;
    const original = window[name];
    if (original.__uiPolished) return;
    const wrapped = function(){
      const result = original.apply(this, arguments);
      setTimeout(updateUiState, 0);
      return result;
    };
    wrapped.__uiPolished = true;
    window[name] = wrapped;
  }

  buildBottomNav();
  let previousScrollY = window.scrollY;
  let scrollFramePending = false;
  window.addEventListener('scroll', () => {
    if (scrollFramePending) return;
    scrollFramePending = true;
    requestAnimationFrame(() => {
      const currentY = window.scrollY;
      const nav = document.getElementById('mobile-bottom-nav');
      if (nav && window.matchMedia('(max-width: 700px)').matches && !document.body.classList.contains('is-quiz-active')) {
        if (currentY > 90 && currentY > previousScrollY + 8) nav.classList.add('compact');
        else if (currentY < previousScrollY - 8 || currentY < 40) nav.classList.remove('compact');
      }
      previousScrollY = currentY;
      scrollFramePending = false;
    });
  }, { passive: true });
  document.querySelector('.study-word-list')?.addEventListener('toggle', event => {
    const summary = event.currentTarget.querySelector('summary');
    if (summary) summary.textContent = event.currentTarget.open ? '単語リストを閉じる' : '単語リストを開く';
  });
  ['showHome','showSearch','showProgress','showResultsDashboard','showAccountTab','showBookmarks','showRanking','showAccountSettings','showSetScreen','showQuiz','showResult','quitQuiz','nextQuestion'].forEach(wrapScreenFunction);
  try {
    if (auth && typeof auth.onAuthStateChanged === 'function') {
      auth.onAuthStateChanged(() => setTimeout(updateUiState, 80));
    }
  } catch (e) {}

  const app = document.getElementById('app');
  if (app && 'MutationObserver' in window) {
    new MutationObserver(updateUiState).observe(app, { attributes: true, subtree: true, attributeFilter: ['class'] });
  }
  window.addEventListener('resize', updateUiState, { passive: true });
  setTimeout(updateUiState, 0);
})();

// =========================================================
// PWA INSTALL HELPER
// =========================================================
let deferredPwaPrompt = null;
window.addEventListener('beforeinstallprompt', (event) => {
  deferredPwaPrompt = event;
  window.dispatchEvent(new Event('pwa-install-ready'));
});
window.addEventListener('appinstalled', () => {
  deferredPwaPrompt = null;
  if (typeof showSyncStatus === 'function') showSyncStatus('アプリとしてインストールされました');
});
async function installPwaApp() {
  if (!deferredPwaPrompt) {
    if (typeof showSyncStatus === 'function') showSyncStatus('ブラウザの「ホーム画面に追加」からインストールできます');
    return;
  }
  deferredPwaPrompt.prompt();
  await deferredPwaPrompt.userChoice.catch(() => null);
  deferredPwaPrompt = null;
}


// =========================================================
// FULL UI UPGRADE HELPERS 2026-04
// 既存ロジックを壊さず、導線・検索・キーボード操作・表示状態だけを追加
// =========================================================
(function(){
  const $ = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));
  let setFilter = 'all';
  let setSearch = '';

  function toast(message) {
    let el = $('#ui-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'ui-toast';
      el.className = 'ui-toast';
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('show'), 1800);
  }
  window.uiToast = toast;

  function getStatsSafe(){
    try { return typeof getTotalStats === 'function' ? getTotalStats() : {'':0,'○':0,'◎':0,'×':0}; }
    catch(e){ return {'':0,'○':0,'◎':0,'×':0}; }
  }

  function nextRecommendedSet(){
    try {
      if (typeof TOTAL_SETS !== 'number' || typeof isSetCompleted !== 'function' || typeof getSetStats !== 'function') return 0;
      for (let i=0; i<TOTAL_SETS; i++) {
        if (!isSetCompleted(i)) {
          const s = getSetStats(i);
          if ((s['○'] || 0) + (s['×'] || 0) + (s['◎'] || 0) > 0) return i;
        }
      }
      for (let i=0; i<TOTAL_SETS; i++) if (!isSetCompleted(i)) return i;
    } catch(e) {}
    return 0;
  }

  function ensureHomeCommandCenter(){
    const content = $('#screen-home .content');
    const existing = $('#home-command-center');
    if ((getStatsSafe()['×'] || 0) < WRONG_THRESHOLD) { existing?.remove(); return; }
    const before = $('#home-bookmark-panel');
    if (!content || !before || before.parentElement !== content) return;
    let box = $('#home-command-center');
    const stats = getStatsSafe();
    const total = typeof WORDS !== 'undefined' ? WORDS.length : ((stats['']||0)+(stats['○']||0)+(stats['◎']||0)+(stats['×']||0));
    const done = (stats['○']||0) + (stats['◎']||0) + (stats['×']||0);
    const percent = total ? Math.round(done / total * 100) : 0;
    const wrong = stats['×'] || 0;
    if (wrong < WRONG_THRESHOLD) { box?.remove(); return; }
    const rec = nextRecommendedSet();
    if (!box) {
      box = document.createElement('div');
      box.id = 'home-command-center';
      box.className = 'home-command-center';
      content.insertBefore(box, before);
    }
    box.innerHTML = `
      <div>
        <div class="home-command-kicker">Today&apos;s study</div>
        <div class="home-command-title">全体進捗 ${percent}% — 次は Unit ${rec + 1} から</div>
        <div class="home-command-sub">迷ったら「続きから」。×が多い日は復習を先にすると定着しやすいです。</div>
      </div>
      <div class="home-command-actions">
        <button type="button" class="ui-chip-btn primary" onclick="showSet(${rec})">続きから</button>
        <button type="button" class="ui-chip-btn danger" ${wrong ? 'onclick="startReviewQuiz()"' : 'disabled'}>×復習 ${wrong}</button>
        <button type="button" class="ui-chip-btn" onclick="showBookmarks()">マイリスト</button>
      </div>`;
  }

  function ensureHomeTools(){
    const title = $$('#screen-home .section-title').find(el => /学習セット/.test(el.textContent || ''));
    const grid = $('#sets-grid');
    if (!title || !grid || grid.querySelector('.word-picker-card')) return;
    let tools = $('#home-tools');
    if (!tools) {
      tools = document.createElement('div');
      tools.id = 'home-tools';
      tools.className = 'home-tools';
      tools.innerHTML = `
        <input id="home-set-search" class="home-search" type="search" placeholder="Unit番号で検索（例: 12）" autocomplete="off">
        <div class="home-filter-pills" aria-label="セット表示フィルター">
          <button type="button" class="ui-chip-btn active" data-filter="all">すべて</button>
          <button type="button" class="ui-chip-btn" data-filter="active">学習中</button>
          <button type="button" class="ui-chip-btn" data-filter="done">完了</button>
        </div>`;
      title.insertAdjacentElement('afterend', tools);
      $('#home-set-search', tools).addEventListener('input', e => { setSearch = e.target.value.trim(); applySetFilters(); });
      $$('.home-filter-pills button', tools).forEach(btn => {
        btn.addEventListener('click', () => {
          setFilter = btn.dataset.filter || 'all';
          $$('.home-filter-pills button', tools).forEach(b => b.classList.toggle('active', b === btn));
          applySetFilters();
        });
      });
    }
    const input = $('#home-set-search', tools);
    if (input && input.value !== setSearch) input.value = setSearch;
    applySetFilters();
  }

  function applySetFilters(){
    const q = String(setSearch || '').replace(/[^0-9]/g, '');
    $$('#sets-grid .set-card').forEach((card, idx) => {
      const active = !!card.querySelector('.tag-active');
      const done = card.classList.contains('completed') || !!card.querySelector('.tag-done');
      let ok = true;
      if (setFilter === 'active') ok = active;
      if (setFilter === 'done') ok = done;
      if (q) ok = ok && String(idx + 1).includes(q);
      card.hidden = !ok;
      card.setAttribute('tabindex', ok ? '0' : '-1');
      card.setAttribute('role', 'button');
      card.setAttribute('aria-label', `Unit ${idx + 1} を開く`);
      if (!card.dataset.keyReady) {
        card.addEventListener('keydown', ev => {
          if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); card.click(); }
        });
        card.dataset.keyReady = '1';
      }
    });
  }

  function improveScreenState(){
    const active = $('.screen.active');
    const id = active ? active.id : '';
    document.body.classList.toggle('is-quiz-active', id === 'screen-quiz');
    $$('.screen').forEach(s => s.setAttribute('aria-hidden', s === active ? 'false' : 'true'));
    const map = { 'screen-home':'古文学習', 'screen-set':'学習セット', 'screen-quiz':'クイズ中', 'screen-bookmark':'マイリスト', 'screen-ranking':'ランキング', 'screen-account':'アカウント設定', 'screen-result':'結果' };
    if (map[id]) document.title = `${map[id]} | 古文学習`;
  }

  function installBackToTop(){
    if ($('#back-to-top')) return;
    const btn = document.createElement('button');
    btn.id = 'back-to-top';
    btn.className = 'back-to-top';
    btn.type = 'button';
    btn.textContent = '↑';
    btn.setAttribute('aria-label', 'ページ上部へ戻る');
    btn.addEventListener('click', () => window.scrollTo({top:0, behavior:'smooth'}));
    document.body.appendChild(btn);
    window.addEventListener('scroll', () => btn.classList.toggle('show', window.scrollY > 500), {passive:true});
  }

  function installKeyboardShortcuts(){
    if (window.__fullUiShortcutsReady) return;
    window.__fullUiShortcutsReady = true;
    document.addEventListener('keydown', ev => {
      const tag = (ev.target && ev.target.tagName || '').toLowerCase();
      const typing = tag === 'input' || tag === 'textarea' || ev.isComposing;
      const activeId = $('.screen.active')?.id || '';
      if (activeId === 'screen-quiz') {
        if (!typing && /^[1-6]$/.test(ev.key)) {
          const btn = $$('.choice-btn')[Number(ev.key)-1];
          if (btn && !btn.disabled) { ev.preventDefault(); btn.click(); }
        }
        if (!typing && ev.key.toLowerCase() === 'b') {
          const bm = $('#quiz-bm-btn');
          if (bm) { ev.preventDefault(); bm.click(); toast('ブックマークを切り替えました'); }
        }
        if (!typing && ev.key === 'Enter') {
          const next = $('.next-btn[style*="block"], .next-btn:not([style*="display: none"])');
          const confirm = $('.confirm-btn');
          if (next && getComputedStyle(next).display !== 'none') { ev.preventDefault(); next.click(); }
          else if (confirm && getComputedStyle(confirm).display !== 'none') { ev.preventDefault(); confirm.click(); }
        }
      }
      if (!typing && ev.key === '/' && activeId === 'screen-home') {
        const input = $('#home-set-search');
        if (input) { ev.preventDefault(); input.focus(); }
      }
    });
  }

  function wrap(name, after){
    if (typeof window[name] !== 'function') return;
    const original = window[name];
    if (original.__fullUiWrapped) return;
    const wrapped = function(){
      const result = original.apply(this, arguments);
      setTimeout(() => after(name), 0);
      return result;
    };
    wrapped.__fullUiWrapped = true;
    window[name] = wrapped;
  }

  function afterAnyRender(name){
    improveScreenState();
    if (name === 'renderHome' || name === 'showHome') {
      ensureHomeCommandCenter();
      ensureHomeTools();
    }
    if (name === 'renderSet' || name === 'showSet') {
      $$('#word-table-body .word-row').forEach(row => row.setAttribute('tabindex', '0'));
    }
  }

  function boot(){
    installBackToTop();
    installKeyboardShortcuts();
    ['showScreen','showHome','showSet','showBookmarks','showRanking','showAccountSettings','showQuiz','showResult','quitQuiz','nextQuestion','renderHome','renderSet','renderQuestion'].forEach(n => wrap(n, afterAnyRender));
    setTimeout(() => {
      improveScreenState();
      ensureHomeCommandCenter();
      ensureHomeTools();
    }, 0);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

/* Mobile hamburger menu removed: smartphone navigation is now handled by the bottom bar. */
(function(){
  function removeOldMobileMenu(){
    document.body.classList.remove('mobile-menu-open');
    document.querySelectorAll('.mobile-hamburger-btn,.mobile-menu-backdrop,.mobile-menu-drawer').forEach(el => el.remove());
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', removeOldMobileMenu);
  else removeOldMobileMenu();
})();


function updateOfflineToast() {
  const toast = document.getElementById('offline-toast');
  const text = document.getElementById('offline-toast-text');
  if (!toast) return;
  const offline = !navigator.onLine;
  if (text) text.textContent = offline ? 'オフラインで利用中です' : 'オンラインに戻りました';
  toast.classList.add('show');
  clearTimeout(window.__offlineToastTimer);
  window.__offlineToastTimer = setTimeout(() => {
    if (navigator.onLine) toast.classList.remove('show');
  }, offline ? 4000 : 1800);
}

function initOfflineSupportUI() {
  window.addEventListener('offline', updateOfflineToast);
  window.addEventListener('online', updateOfflineToast);
  if (!navigator.onLine) updateOfflineToast();
}


// =========================================================
// HOME GLOBAL WORD SEARCH 2026-05-16
// 全単語検索をホーム画面に統合。Unit画面内検索は使わない。
// =========================================================
(function(){
  let homeWordQuery = '';

  function normalizeSearch(value) {
    return String(value || '')
      .normalize('NFKC')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  function safeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function highlight(value, query) {
    const raw = String(value || '');
    const q = normalizeSearch(query);
    const escaped = safeHtml(raw);
    if (!q) return escaped;
    const safeQ = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    try { return escaped.replace(new RegExp(`(${safeQ})`, 'ig'), '<mark class="home-word-search-mark">$1</mark>'); }
    catch(e) { return escaped; }
  }

  function getUnitIndexByWordId(id) {
    try {
      if (typeof SET_SIZE === 'number') return Math.max(0, Math.floor((Number(id) - 1) / SET_SIZE));
    } catch(e) {}
    return 0;
  }

  function matchWord(word, query) {
    const q = normalizeSearch(query);
    if (!q) return false;
    const hay = normalizeSearch(`${word.id} ${word.en} ${word.jp}`);
    return hay.includes(q);
  }

  function statusLabel(id) {
    try { return (typeof getStatus === 'function' ? getStatus(id) : '') || '―'; }
    catch(e) { return '―'; }
  }

  function renderHomeWordSearch() {
    const input = document.getElementById('home-word-search-input');
    const count = document.getElementById('home-word-search-count');
    const results = document.getElementById('home-word-search-results');
    const panel = document.getElementById('home-word-search-panel');
    if (!input || !count || !results || typeof WORDS === 'undefined') return;

    if (input.value !== homeWordQuery) input.value = homeWordQuery;
    const q = normalizeSearch(homeWordQuery);
    panel.classList.toggle('is-searching', !!q);

    if (!q) {
      count.textContent = `${WORDS.length}語`;
      results.innerHTML = '<div class="home-word-search-guide">検索すると、全Unitの単語がここに表示されます。</div>';
      return;
    }

    const matched = WORDS.filter(w => matchWord(w, q));
    const shown = matched.slice(0, 80);
    count.textContent = matched.length > 80 ? `${matched.length}語中80件表示` : `${matched.length}語`;

    if (matched.length === 0) {
      results.innerHTML = `<div class="home-word-search-empty">「${safeHtml(homeWordQuery)}」に一致する単語がありません。</div>`;
      return;
    }

    results.innerHTML = shown.map(w => {
      const unitIdx = getUnitIndexByWordId(w.id);
      const unitLabel = unitIdx + 1;
      const bm = (typeof isBookmarked === 'function' && isBookmarked(w.id));
      const newBadge = w.isNew ? '<span class="home-word-new">新</span>' : '';
      return `<div class="home-word-result" data-word-id="${w.id}">
        <button class="home-word-result-main" type="button" onclick="showSearchWord(${w.id})" aria-label="${safeHtml(w.en)} を選択する">
          <span class="home-word-no">${w.id}</span>
          <span class="home-word-text">
            <span class="home-word-en">${highlight(w.en, homeWordQuery)}${newBadge}</span>
            <span class="home-word-jp">${highlight(w.jp, homeWordQuery)}</span>
          </span>
          <span class="home-word-meta"><span>Unit ${unitLabel}</span><span class="home-word-status">${statusLabel(w.id)}</span></span>
        </button>
        <div class="home-word-actions">
          <button type="button" class="home-word-action" onclick="speakWordById(${w.id}, event)" title="発音を聞く">${studyActionIcon('audio')}</button>
          <button type="button" class="home-word-action ${bm ? 'active' : ''}" onclick="toggleHomeWordBookmark(${w.id}, event)" title="ブックマーク">${bm ? '★' : '☆'}</button>
        </div>
      </div>`;
    }).join('');
  }

  window.toggleHomeWordBookmark = function(id, event) {
    if (event) event.stopPropagation();
    if (typeof toggleBookmark === 'function') toggleBookmark(id);
    renderHomeWordSearch();
  };

  function bindHomeWordSearch() {
    const input = document.getElementById('home-word-search-input');
    const clear = document.getElementById('home-word-search-clear');
    if (!input || input.dataset.homeWordBound === '1') return;
    input.dataset.homeWordBound = '1';
    input.addEventListener('input', () => {
      homeWordQuery = input.value || '';
      renderHomeWordSearch();
    });
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        homeWordQuery = '';
        input.value = '';
        renderHomeWordSearch();
      }
    });
    if (clear) clear.addEventListener('click', () => {
      homeWordQuery = '';
      input.value = '';
      input.focus();
      renderHomeWordSearch();
    });
  }

  function hideUnitSearchUi() {
    document.querySelectorAll('#screen-set .word-search-panel').forEach(el => el.remove());
    const unitSearch = document.getElementById('word-search-input');
    if (unitSearch) unitSearch.closest('.word-search-panel')?.remove();
  }

  function afterHomeRender() {
    bindHomeWordSearch();
    renderHomeWordSearch();
    hideUnitSearchUi();
  }

  function wrap(name) {
    if (typeof window[name] !== 'function') return;
    const original = window[name];
    if (original.__homeGlobalSearchWrapped) return;
    const wrapped = function(){
      const res = original.apply(this, arguments);
      setTimeout(afterHomeRender, 0);
      return res;
    };
    wrapped.__homeGlobalSearchWrapped = true;
    window[name] = wrapped;
  }

  function boot() {
    bindHomeWordSearch();
    renderHomeWordSearch();
    hideUnitSearchUi();
    ['renderHome','showHome','renderSet','showSet'].forEach(wrap);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();


/* Study Dashboard UI placeholder */

function getAccountIconMarkup() {
  const source = (validProfileAvatar(profileAvatarData)?profileAvatarData:'') || 'assets/icons/dashcloudly.svg';
  return '<img class="header-account-avatar" src="' + source + '" alt="">';
}
function closeAccountPopover(restoreFocus = false) {
  document.getElementById('account-popover')?.remove();
  const button = (document.body.classList.contains('profile-only-header')?document.getElementById('floating-profile-button'):document.getElementById('header-account-button'));
  button?.setAttribute('aria-expanded', 'false');
  if (restoreFocus) button?.focus();
}
function positionAccountPopover() {
  const button = (document.body.classList.contains('profile-only-header')?document.getElementById('floating-profile-button'):document.getElementById('header-account-button'));
  const panel = document.getElementById('account-popover');
  if (!button || !panel) return;
  const anchor = button.getBoundingClientRect();
  const viewport = window.visualViewport;
  const width = viewport?.width || window.innerWidth;
  const height = viewport?.height || window.innerHeight;
  const x = viewport?.offsetLeft || 0, y = viewport?.offsetTop || 0;
  panel.style.right = 'auto';
  panel.style.left = Math.max(x + 12, Math.min(anchor.right - panel.offsetWidth, x + width - panel.offsetWidth - 12)) + 'px';
  panel.style.maxHeight = Math.max(120, height - 24) + 'px';
  panel.style.top = Math.max(y + 12, Math.min(anchor.bottom + 10, y + height - panel.offsetHeight - 12)) + 'px';
}
window.addEventListener('resize', positionAccountPopover);
window.addEventListener('scroll', positionAccountPopover, {passive:true, capture:true});
window.visualViewport?.addEventListener('resize', positionAccountPopover);
window.visualViewport?.addEventListener('scroll', positionAccountPopover);
function toggleAccountPopover() {
  if (document.getElementById('account-popover')) { closeAccountPopover(true); return; }
  const button = (document.body.classList.contains('profile-only-header')?document.getElementById('floating-profile-button'):document.getElementById('header-account-button'));
  const user = auth.currentUser;
  const school = getSchoolName();
  const panel = document.createElement('section');
  panel.id = 'account-popover';
  panel.className = 'account-popover';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'ログインプロフィール');
  const name = user && !user.isAnonymous ? getPublicNickname(user) : school || 'ゲスト';
  const signedIn = user && !user.isAnonymous;
  const manage=`${window.DASHCLOUDLY_CONFIG.hubUrl || location.origin}/account.html?site=kobun`;
  panel.innerHTML='<div class="profile-menu-heading">DashCloudly 学習ID<button class="profile-close" type="button" aria-label="プロフィールを閉じる" onclick="closeAccountPopover(true)">×</button></div>'
    + '<div class="profile-account-group"><a class="profile-identity" href="'+manage+'"><div class="profile-popup-avatar">'+getAccountIconMarkup()+'</div><div class="profile-identity-text"><h2>'+escapeHtml(name)+'</h2><p>'+escapeHtml(signedIn?(user.email||'学習IDでログイン中'):'ゲストで学習中')+'</p></div><svg class="profile-identity-chevron" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></a>'
    + (school?'<div class="profile-school">'+escapeHtml(school)+'</div>':'')
    + '<div class="profile-popup-actions">'
    + ((signedIn||school)?'<button class="profile-menu-action" type="button" onclick="closeAccountPopover();logout()"><span class="profile-action-symbol" aria-hidden="true"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4H4v16h5m5-12 4 4-4 4m-6-4h13"/></svg></span><span>ログアウト</span></button>':'<button class="profile-menu-action" type="button" onclick="closeAccountPopover();login()"><span>ログイン・新規登録</span></button>')
    + '</div></div><a class="profile-manage-link" href="'+manage+'"><img src="assets/icons/dashcloudly.svg" alt="" width="22" height="22">DashCloudly 学習IDを管理</a><button class="profile-menu-action profile-learning-settings" type="button" onclick="closeAccountPopover();showAccountTab()">学習の設定</button><div class="profile-menu-footer"><button class="service-info-link" type="button" onclick="openServiceInfo()">サービス情報</button></div>';
  document.body.appendChild(panel);
  positionAccountPopover();
  button.setAttribute('aria-expanded', 'true');
  panel.querySelector('button').focus();
}
document.addEventListener('pointerdown', event => {
  if (!event.target.closest('#account-popover,#header-account-button,#floating-profile-button')) closeAccountPopover();
});
document.addEventListener('keydown', event => {
  const panel = document.getElementById('account-popover');
  if (!panel) return;
  if (event.key === 'Escape') { closeAccountPopover(true); return; }
  if (event.key === 'Tab') {
    const controls = [...panel.querySelectorAll('button,a[href]')];
    const first = controls[0], last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
});
function replayLearningTutorial() { onboardingStep = 1; renderOnboarding(); }
function renderLearningGuide() {
  return '<section class="account-card learning-guide"><h2>使い方</h2>'
    + onboardingTutorial.map(([title, text]) => '<details><summary>' + escapeHtml(title) + '</summary><p>' + escapeHtml(text) + '</p></details>').join('')
    + '<details><summary>学校IDで学習する</summary><p>ログイン画面で「学校IDで参加」を選び、配布された学校IDを入力します。学校が設定した範囲は学習ホームの上部に表示されます。メールまたはGoogleで連携すると、記録を別の端末でも使えます。先生・管理者の操作は専用ページで行います。</p></details>'
    + '<details><summary>アカウントと学習記録</summary><p>ログインなしではこの端末に記録します。メールとパスワード、またはGoogleでログインすると記録を同期できます。Googleのみで登録した場合はGoogleでログインしてください。</p></details>'
    + '<button class="btn btn-primary" type="button" onclick="replayLearningTutorial()">チュートリアルを見る</button></section>';
}

async function syncLearningNow(button) {
  const user = auth.currentUser;
  if (!user) { showSyncStatus('記録の同期にはログインが必要です', true); return false; }
  if (button) button.disabled = true;
  clearTimeout(cloudSaveTimer);
  try {
    await restoreCloudProgress();
    if (auth.currentUser?.uid !== user.uid) return false;
    cloudRestoreComplete = true;
    const saved = await saveCloudProgress();
    if (saved) showSyncStatus('学習記録を同期しました');
    return saved;
  } catch (error) { cloudRestoreComplete = false; return false; }
  finally { if (button) button.disabled = false; }
}
window.addEventListener('online', () => { if (auth.currentUser) syncLearningNow(); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && auth.currentUser && cloudRestoreComplete) {
    clearTimeout(cloudSaveTimer);
    saveCloudProgress();
  }
});

/* Compact profile control while scrolling or studying. */
(()=>{
 const button=document.createElement('button');button.id='floating-profile-button';button.type='button';button.className='header-account-button floating-profile-button';button.setAttribute('aria-label','ログインプロフィールを開く');button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-expanded','false');button.tabIndex=-1;button.innerHTML=getAccountIconMarkup();button.onclick=()=>toggleAccountPopover();document.body.append(button);
 let compact=false,scheduled=false;
 const update=()=>{scheduled=false;const active=document.querySelector('.screen.active');const scroll=Math.max(window.scrollY,document.body.scrollTop,document.documentElement.scrollTop,active?.scrollTop||0,active?.querySelector('.content')?.scrollTop||0);const previous=compact;const studying=active?.id==='screen-quiz';compact=studying||scroll>(compact?32:72);document.body.classList.toggle('profile-only-header',compact);if(previous!==compact)closeAccountPopover();button.tabIndex=compact?0:-1;button.innerHTML=getAccountIconMarkup();
  document.querySelectorAll('.screen > .header,.screen > .quiz-header,.role-page-header').forEach(header=>{header.inert=compact;header.setAttribute('aria-hidden',String(compact));});
  positionAccountPopover();
 };
 const queue=()=>{if(!scheduled){scheduled=true;requestAnimationFrame(update);}};
 addEventListener('scroll',queue,{passive:true,capture:true});
 const observer=new MutationObserver(queue);document.querySelectorAll('.screen').forEach(screen=>observer.observe(screen,{attributes:true,attributeFilter:['class']}));
 update();
})();

(()=>{const progressLabel=document.getElementById('quiz-progress-text'),progressFill=document.getElementById('quiz-progress-fill');if(!progressLabel||!progressFill)return;const hud=document.createElement('div');hud.className='lesson-glass-hud';hud.setAttribute('aria-label','学習の進捗と中断');hud.innerHTML='<button type="button" onclick="quitQuiz()">中断</button><div class="lesson-glass-status"><span id="lesson-glass-count"></span><div class="lesson-glass-track" role="progressbar" aria-label="学習の進捗" aria-valuemin="0" aria-valuemax="100"><i></i></div></div>';document.body.append(hud);const update=()=>{const label=document.getElementById('quiz-progress-text'),fill=document.getElementById('quiz-progress-fill');document.getElementById('lesson-glass-count').textContent=label?.textContent||'';const width=fill?.style.width||'0%';hud.querySelector('i').style.width=width;hud.querySelector('[role="progressbar"]').setAttribute('aria-valuenow',String(parseFloat(width)||0));};const observer=new MutationObserver(update);observer.observe(progressLabel,{childList:true,characterData:true,subtree:true});observer.observe(progressFill,{attributes:true,attributeFilter:['style']});update();})();

// Move the existing controls, preserving their IDs, state and keyboard handlers.
(function installMobileStudyDock(){
 const row=document.querySelector('#screen-quiz .quiz-action-row');if(!row)return;
 const anchor=document.createComment('study controls');row.before(anchor);
 const actions=document.querySelector('#screen-quiz .quiz-bottom-actions');const actionAnchor=document.createComment('answer controls');actions?.before(actionAnchor);
 row.setAttribute('role','toolbar');row.setAttribute('aria-label','学習中の単語操作');
 const voice=row.querySelector('#quiz-voice-btn');if(voice)voice.innerHTML=studyActionIcon('audio');
 const bookmark=row.querySelector('#quiz-bm-btn');if(bookmark)bookmark.innerHTML=studyActionIcon('star');bookmark?.setAttribute('aria-label','ブックマークに追加');bookmark?.setAttribute('aria-pressed','false');
 const mobile=matchMedia('(max-width:900px)');
 function place(){row.classList.toggle('quiz-action-dock',mobile.matches);if(mobile.matches){document.body.append(row);if(actions)row.append(actions);}else{anchor.after(row);if(actions)actionAnchor.after(actions);}}
 mobile.addEventListener('change',place);place();
 function keyboardLayout(){const viewport=window.visualViewport,typing=mobile.matches&&document.activeElement?.matches('#screen-quiz input,#screen-quiz textarea'),inset=viewport&&typing?Math.max(0,innerHeight-viewport.height-viewport.offsetTop):0;document.body.style.setProperty('--study-keyboard-inset',inset>120?inset+'px':'0px');document.body.style.setProperty('--study-visible-height',viewport&&typing?viewport.height+'px':'100dvh');}
 window.visualViewport?.addEventListener('resize',keyboardLayout);window.visualViewport?.addEventListener('scroll',keyboardLayout);document.addEventListener('focusin',keyboardLayout);document.addEventListener('focusout',()=>requestAnimationFrame(keyboardLayout));

})();

function studyActionIcon(name){const icons={'star': '<path d="m12 3 2.8 5.7 6.3.9-4.6 4.4 1.1 6.3-5.6-3-5.6 3 1.1-6.3L3 9.6l6.2-.9Z"/>', 'audio': '<path d="M11 5 6 9H3v6h3l5 4Z"/><path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>', 'logout': '<path d="M9 4H4v16h5m5-12 4 4-4 4m-6-4h13"/>'};return '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+icons[name]+'</svg>';}
