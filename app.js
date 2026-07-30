'use strict';

// ─── Constants ────────────────────────────────────────────────────────────────

const PDFJS_WORKER =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';

const MONTH = {
  Jan:'01', Feb:'02', Mar:'03', Apr:'04', May:'05', Jun:'06',
  Jul:'07', Aug:'08', Sep:'09', Oct:'10', Nov:'11', Dec:'12',
};

// ─── State ────────────────────────────────────────────────────────────────────

let tokenClient = null;
let accessToken = null;

// ─── DOM ──────────────────────────────────────────────────────────────────────

const $clientId      = document.getElementById('clientId');
const $parentFolder  = document.getElementById('parentFolder');
const $receiptInput  = document.getElementById('receiptInput');
const $paymentInput  = document.getElementById('paymentInput');
const $btnSignIn     = document.getElementById('btnSignIn');
const $btnSignOut    = document.getElementById('btnSignOut');
const $btnProcess    = document.getElementById('btnProcess');
const $authStatus    = document.getElementById('authStatus');
const $log           = document.getElementById('log');
const $dzReceipt     = document.getElementById('dzReceipt');
const $dzPayment     = document.getElementById('dzPayment');
const $currentOrigin = document.getElementById('currentOrigin');
const $btnCopyOrigin = document.getElementById('btnCopyOrigin');
const $originHint    = document.getElementById('originHint');

// ─── Show current origin (must be added to Google Cloud authorized origins) ───

(function showOrigin() {
  const origin = window.location.origin;
  $currentOrigin.textContent = origin;

  if (origin === 'null' || origin.startsWith('file://')) {
    $originHint.innerHTML =
      '⚠️ 你正用 <b>file://</b> 開啟頁面，Google OAuth 無法在此協定下運作。' +
      '請改用本機 HTTP 伺服器，例如：<br>' +
      '<code>cd reimburse-web && python3 -m http.server 8000</code><br>' +
      '然後開啟 <code>http://localhost:8000</code>';
    $originHint.style.color = '#c62828';
  } else {
    $originHint.textContent = '請確認此網址已加入 Google Cloud Console → 憑證 → OAuth 用戶端 ID → 已授權的 JavaScript 來源';
  }

  $btnCopyOrigin.addEventListener('click', () => {
    navigator.clipboard.writeText(origin).then(() => {
      $btnCopyOrigin.textContent = '已複製';
      setTimeout(() => { $btnCopyOrigin.textContent = '複製'; }, 1500);
    });
  });
})();

// ─── Settings (persisted to localStorage) ────────────────────────────────────

$clientId.value     = localStorage.getItem('reimb_clientId')     || '';
$parentFolder.value = localStorage.getItem('reimb_parentFolder') || '訂閱 Claude Pro';

$clientId.addEventListener('change', () =>
  localStorage.setItem('reimb_clientId', $clientId.value.trim()));
$parentFolder.addEventListener('change', () =>
  localStorage.setItem('reimb_parentFolder', $parentFolder.value.trim()));

// ─── Dropzone UX ─────────────────────────────────────────────────────────────

function setupDropzone(dz, input) {
  input.addEventListener('change', () => {
    const name = input.files[0]?.name;
    if (name) {
      dz.classList.add('selected');
      dz.querySelector('.dz-label').textContent = name;
    }
  });
  dz.addEventListener('dragover',  e => { e.preventDefault(); dz.classList.add('over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('over'));
  dz.addEventListener('drop', e => {
    e.preventDefault();
    dz.classList.remove('over');
    const files = e.dataTransfer?.files;
    if (files?.length) {
      // Transfer dragged file into the file input
      const dt = new DataTransfer();
      dt.items.add(files[0]);
      input.files = dt.files;
      input.dispatchEvent(new Event('change'));
    }
  });
}

setupDropzone($dzReceipt, $receiptInput);
setupDropzone($dzPayment, $paymentInput);

// ─── Logging ─────────────────────────────────────────────────────────────────

function clearLog() {
  $log.innerHTML = '';
}

function log(msg, type = '') {
  if ($log.textContent === '等待操作...') $log.textContent = '';
  const el = document.createElement('div');
  if (type) el.className = `log-${type}`;
  el.textContent = `▸ ${msg}`;
  $log.appendChild(el);
  $log.scrollTop = $log.scrollHeight;
}

function logLink(label, url) {
  if ($log.textContent === '等待操作...') $log.textContent = '';
  const el = document.createElement('div');
  el.className = 'log-link';
  el.innerHTML = `▸ ${label}: <a href="${url}" target="_blank">${url}</a>`;
  $log.appendChild(el);
  $log.scrollTop = $log.scrollHeight;
}

// ─── Google API: OAuth (GIS only — gapi not needed) ──────────────────────────

// Called by <script onload="gapiLoaded()"> — kept for HTML compatibility but unused
function gapiLoaded() {}

// Called by <script onload="gisLoaded()">
function gisLoaded() {}

function handleSignIn() {
  if (typeof google === 'undefined' || !google.accounts?.oauth2) {
    alert('Google 身份驗證程式庫尚未載入，請重新整理頁面後再試');
    return;
  }
  const clientId = $clientId.value.trim();
  if (!clientId) {
    alert('請先填入 Google Client ID');
    return;
  }
  log('開啟 Google 登入視窗...');
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: DRIVE_SCOPE,
    callback: onTokenResponse,
  });
  tokenClient.requestAccessToken({ prompt: 'consent' });
}

function onTokenResponse(resp) {
  console.log('[OAuth response]', resp);
  if (resp.error) {
    const msg = `授權失敗：${resp.error}` +
      (resp.error_description ? `（${resp.error_description}）` : '');
    log(msg, 'error');
    alert(msg);
    return;
  }
  if (!resp.access_token) {
    const msg = '授權回應中沒有 access_token，請檢查 Client ID 是否正確';
    log(msg, 'error');
    alert(msg);
    return;
  }
  accessToken = resp.access_token;
  setAuthUI(true);
  log('已登入 Google Drive', 'success');
}

function handleSignOut() {
  if (accessToken) google.accounts.oauth2.revoke(accessToken, () => {});
  accessToken = null;
  setAuthUI(false);
  log('已登出');
}

function setAuthUI(signedIn) {
  $btnSignIn.style.display  = signedIn ? 'none' : '';
  $btnSignOut.style.display = signedIn ? ''     : 'none';
  $btnProcess.disabled      = !signedIn;
  $authStatus.textContent   = signedIn ? '已登入' : '尚未登入';
  $authStatus.className     = 'badge' + (signedIn ? ' ok' : '');
}

$btnSignIn.addEventListener('click', handleSignIn);
$btnSignOut.addEventListener('click', handleSignOut);

// ─── PDF.js: initialise worker ────────────────────────────────────────────────

// pdf.min.js is loaded before app.js, so pdfjsLib is available now.
window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;

// ─── PDF.js: extract text from all pages ─────────────────────────────────────

async function extractPDFText(file) {
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page    = await pdf.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map(it => it.str).join(' '));
  }
  return pages.join('\n');
}

// ─── Date range parsing ───────────────────────────────────────────────────────
// Matches Claude Pro receipt text like "Mar 30 – Apr 30, 2026"
// Returns "YYYYMMDD-YYYYMMDD" or null if not found.

function parseDateRange(text) {
  // Allow en-dash (–), em-dash (—), and regular hyphen
  const re = /([A-Z][a-z]{2})\s+(\d{1,2})\s*[–—-]\s*([A-Z][a-z]{2})\s+(\d{1,2}),\s*(\d{4})/;
  const m = text.match(re);
  if (!m) return null;

  const [, m1, d1, m2, d2, yearStr] = m;
  if (!MONTH[m1] || !MONTH[m2]) return null;

  const endYear   = parseInt(yearStr, 10);
  // Cross-year case: e.g. Dec → Jan means start is previous year
  const startYear = parseInt(MONTH[m1], 10) > parseInt(MONTH[m2], 10) ? endYear - 1 : endYear;

  const start = `${startYear}${MONTH[m1]}${d1.padStart(2, '0')}`;
  const end   = `${endYear}${MONTH[m2]}${d2.padStart(2, '0')}`;
  return `${start}-${end}`;
}

// ─── Image combining (matches Python script logic) ───────────────────────────
// 1. Render each PDF page to a canvas at 2× scale.
// 2. Load the payment image.
// 3. Scale all to the same width, stack vertically.
// 4. Encode as JPEG, wrap in a single-page PDF (size = pixels / 2).

async function renderPDFPages(file) {
  const pdf    = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const result = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const vp   = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width  = vp.width;
    canvas.height = vp.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    result.push(canvas);
  }
  return result;
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload  = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

async function buildCombinedCanvas(receiptFile, paymentFile) {
  const pageCanvases = await renderPDFPages(receiptFile);
  const payImg       = await loadImage(paymentFile);

  // Target width = max natural width across all sources
  const maxW = Math.max(
    ...pageCanvases.map(c => c.width),
    payImg.naturalWidth,
  );

  // Build list of {element, destWidth, destHeight}
  const items = [
    ...pageCanvases.map(c => ({
      el: c,
      w: maxW,
      h: Math.round(c.height * maxW / c.width),
    })),
    {
      el: payImg,
      w: maxW,
      h: Math.round(payImg.naturalHeight * maxW / payImg.naturalWidth),
    },
  ];

  const totalH = items.reduce((s, it) => s + it.h, 0);
  const out    = document.createElement('canvas');
  out.width    = maxW;
  out.height   = totalH;

  const ctx = out.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, maxW, totalH);

  let y = 0;
  for (const { el, w, h } of items) {
    ctx.drawImage(el, 0, y, w, h);
    y += h;
  }
  return out;
}

function canvasToJpegBytes(canvas, quality = 0.9) {
  return new Promise(resolve => {
    canvas.toBlob(
      blob => blob.arrayBuffer().then(resolve),
      'image/jpeg',
      quality,
    );
  });
}

async function buildOutputPDF(canvas) {
  const jpegBytes = await canvasToJpegBytes(canvas);

  const { PDFDocument } = PDFLib;
  const doc = await PDFDocument.create();

  // Page size = pixel size / 2  →  72 dpi, matching the Python script
  const pageW = canvas.width  / 2;
  const pageH = canvas.height / 2;

  const page = doc.addPage([pageW, pageH]);
  const img  = await doc.embedJpg(jpegBytes);
  page.drawImage(img, { x: 0, y: 0, width: pageW, height: pageH });

  return doc.save();  // returns Uint8Array
}

// ─── Google Drive helpers ─────────────────────────────────────────────────────

function authHeader() {
  return { Authorization: `Bearer ${accessToken}` };
}

async function driveRequest(url, opts = {}) {
  const resp = await fetch(url, { headers: authHeader(), ...opts });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Drive API ${resp.status}: ${text}`);
  }
  return resp.json();
}

// Find or create a folder; returns {id, webViewLink}.
async function findOrCreateFolder(name, parentId = null) {
  // Escape single quotes for the Drive query language
  const escaped = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  let q = `name='${escaped}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  if (parentId) q += ` and '${parentId}' in parents`;

  const found = await driveRequest(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,webViewLink)`,
  );
  if (found.files?.length) return found.files[0];

  const meta = { name, mimeType: 'application/vnd.google-apps.folder' };
  if (parentId) meta.parents = [parentId];

  return driveRequest(
    'https://www.googleapis.com/drive/v3/files?fields=id,webViewLink',
    {
      method:  'POST',
      headers: { ...authHeader(), 'Content-Type': 'application/json' },
      body:    JSON.stringify(meta),
    },
  );
}

// Upload any file (File, Blob, or ArrayBuffer) to a Drive folder.
async function uploadToDrive(data, name, mimeType, folderId) {
  const blob = data instanceof Blob
    ? data
    : new Blob([data], { type: mimeType });

  const meta = JSON.stringify({ name, parents: [folderId] });
  const form = new FormData();
  form.append('metadata', new Blob([meta], { type: 'application/json' }));
  form.append('file', blob);

  return driveRequest(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',
    { method: 'POST', headers: authHeader(), body: form },
  );
}

// ─── Main handler ─────────────────────────────────────────────────────────────

$btnProcess.addEventListener('click', async () => {
  const receiptFile = $receiptInput.files[0];
  const paymentFile = $paymentInput.files[0];

  if (!receiptFile) { alert('請選擇收據 PDF');    return; }
  if (!paymentFile) { alert('請選擇刷卡通知截圖'); return; }

  clearLog();
  $btnProcess.disabled = true;

  try {
    // ── 1. Extract date range from receipt ────────────────────────────────
    log('正在讀取收據文字...');
    const text = await extractPDFText(receiptFile);
    const folderName = parseDateRange(text);
    if (!folderName) {
      throw new Error(
        '無法從收據辨識日期區間。\n' +
        '請確認收據包含類似「Mar 30 – Apr 30, 2026」的文字。',
      );
    }
    log(`識別到日期區間：${folderName}`, 'success');

    // ── 2. Build combined PDF ─────────────────────────────────────────────
    log('合併收據與刷卡通知截圖...');
    const combined     = await buildCombinedCanvas(receiptFile, paymentFile);
    const pdfBytes     = await buildOutputPDF(combined);
    log('附件.pdf 已產生', 'success');

    // ── 3. Create folder structure in Google Drive ────────────────────────
    const parentName = $parentFolder.value.trim() || '訂閱 Claude Pro';
    log(`Google Drive：尋找或建立「${parentName}」...`);
    const parent = await findOrCreateFolder(parentName);

    log(`Google Drive：尋找或建立「${folderName}」...`);
    const folder = await findOrCreateFolder(folderName, parent.id);
    log('資料夾就緒', 'success');

    // ── 4. Upload all three files ─────────────────────────────────────────
    log(`上傳 ${receiptFile.name}...`);
    await uploadToDrive(receiptFile, receiptFile.name, 'application/pdf', folder.id);
    log(`已上傳 ${receiptFile.name}`, 'success');

    log(`上傳 ${paymentFile.name}...`);
    await uploadToDrive(paymentFile, paymentFile.name, paymentFile.type, folder.id);
    log(`已上傳 ${paymentFile.name}`, 'success');

    log('上傳 附件.pdf...');
    await uploadToDrive(
      new Blob([pdfBytes], { type: 'application/pdf' }),
      '附件.pdf',
      'application/pdf',
      folder.id,
    );
    log('已上傳 附件.pdf', 'success');

    // ── Done ──────────────────────────────────────────────────────────────
    log('───────────────────────────');
    log('全部完成！');
    logLink('開啟 Google Drive 資料夾', folder.webViewLink);

  } catch (err) {
    log(err.message, 'error');
    console.error(err);
  } finally {
    $btnProcess.disabled = false;
  }
});
