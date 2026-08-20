
/* ============================================================
   CONFIG
   ============================================================ */
// const SHEET_ID = "1zrhLerx15lT8xp55OzhXA5M5k7eDd9aW"; // local test sheet
const SHEET_ID = "1PHBmq5O0yvU87yrlBbJ-inuWTGJMLNYgHnfZ0IXBS7I"; // live sheet
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv`;
// const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwzoIp8TjW-1Ep8OqwPYDejn6Nc5mrB9pL-kM9F3jInPXRoYTV0aqOJ6ZZArYOA4WCPNg/exec"; // local test sheet
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzdqH02gUYfWAcH2KRUat6yLT2SmHQQV4RkK_DHmVGQXMbPF_Ekzo5d5-0NH0RwGLVFeg/exec"; // live sheet
const DATA_SOURCE_MODE = "apps-script"; // apps-script | direct-sheet | auto
const REFRESH_MS = 300 * 60 * 1000;

const PALETTE = ['#10B981','#2563EB','#F59E0B','#7C3AED','#8B5CF6','#EF4444','#0D9488','#94A3B8','#F97316','#22C55E','#EC4899','#0EA5E9','#CA8A04','#334155'];
const LOG_PAGE_SIZE = 25;

/* ============================================================
   STATE
   ============================================================ */
let ALL_ROWS = [];
let charts = {};
let logPage = 1;
let logRowsCache = [];
let trendYMax = 1;
// Cache of the full (already-trimmed) trend series so the zoom/scrub slider can re-slice
// and redraw just this one chart locally, without recomputing from rows or touching FILTERS.
let trendCache = { days: [], labels: [], titles: [], counts: [] };
const FILTERS = { observer:'All', designation:'All', status:'All', search:'', category:null, location:null, quick:null, _sev:null };

/* ============================================================
   HELPERS
   ============================================================ */
function setSync(bad, text){
  const dot = document.getElementById('syncDot');
  const syncText = document.getElementById('syncText');
  if(dot) dot.className = 'dot' + (bad?' bad':'');
  if(syncText) syncText.textContent = text;
}
function showBanner(html){ const b=document.getElementById('banner'); b.innerHTML=html; b.style.display='block'; }
function hideBanner(){ document.getElementById('banner').style.display='none'; }
function formatTrendLabel(date){
  return [
    new Intl.DateTimeFormat('en-US', {weekday:'short'}).format(date),
    new Intl.DateTimeFormat('en-US', {day:'2-digit', month:'short'}).format(date),
  ];
}
function formatTrendTitle(date){
  return new Intl.DateTimeFormat('en-US', {weekday:'long', year:'numeric', month:'short', day:'2-digit'}).format(date);
}
function normLoc(loc){ return (loc||'').replace(/\(.*?\)/g,'').trim().replace(/\s+/g,' ').toUpperCase(); }

// Designator field in the source form is free text, so it collects a mix of real
// job titles, case/abbreviation variants of the same title, and outright mistakes
// (names, sentences, unrelated words typed into the wrong field). This normalizes
// known variants to one canonical label and buckets clearly-not-a-title entries
// into "Other / Unclear" so charts/filters aren't cluttered -- without discarding
// the original text, which stays available on the row as designationRaw.
const DESIGNATION_ALIASES = {
  'hse officer': 'HSE Officer',
  'hseo': 'HSE Officer',
  'safety officer': 'HSE Officer',
  'hsse officer': 'HSE Officer',
  'truck driver': 'Truck Driver',
  'bus driver': 'Bus Driver',
  'civil site supervisor': 'Civil Site Supervisor',
  'formen': 'Foreman',
  'foreman': 'Foreman',
  'helper': 'Helper',
  'jcb operator': 'JCB Operator',
  'sms coordinator': 'SMS Coordinator',
};
const DESIGNATION_DENYLIST = new Set([
  'noor zaman',
  'deviation from ptw and not follow safety protocols',
  'fire extinguisher',
  'safety observation',
  'take the shelter above the dana',
  'observed that during pipe stringing workers were not maintained safe distance. its leads to accident',
]);
function normalizeDesignation(raw){
  const trimmed = (raw||'').trim();
  if(!trimmed) return 'N/A';
  // Normalize hyphens/underscores to spaces too, so variants like "HSE-OFFICER" match
  // the same alias as "HSE OFFICER" without needing a separate map entry for every
  // punctuation style someone happens to type.
  const key = trimmed.toLowerCase().replace(/[-_]+/g,' ').replace(/\s+/g,' ').trim();
  if(DESIGNATION_ALIASES[key]) return DESIGNATION_ALIASES[key];
  if(DESIGNATION_DENYLIST.has(key)) return 'Other / Unclear';
  const wordCount = trimmed.split(/\s+/).length;
  const looksLikeSentence = wordCount > 4 || /[.,!?]/.test(trimmed);
  if(looksLikeSentence) return 'Other / Unclear';
  return trimmed.replace(/\w\S*/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase());
}
// The "Category of Unsafe Act/Condition/Near Miss" form question has been revised a few
// times -- options renamed, split, or added -- so historical rows carry a mix of old and
// current wording, plus a long tail of free-text "Other" entries. Everything below maps
// each raw variant to the CURRENT form wording (as of the latest edit) so history and new
// submissions read as one consistent set. "Procedure Violation" was renamed to "Procedure
// Compliance" on the form -- assuming that's a neutral topic label (paired with the
// separate Type of Observation field to say whether it was a violation or a compliant
// example), so legacy violation-flavored text rolls up there too; flag if that's wrong.
const CATEGORY_ALIASES = {
  'vehicle/forklift operation': 'Vehicle/Equipment Operation',
  'road safety': 'Vehicle/Equipment Operation',
  'road safety violation': 'Vehicle/Equipment Operation',
  '360 camera': 'Vehicle/Equipment Operation',
  'hmi': 'Vehicle/Equipment Operation',
  'heavy equipments operation': 'Vehicle/Equipment Operation',

  'heat stress': 'Heat Stress',
  'occupation health safety/heat stress': 'Heat Stress',
  'heat stress prevention': 'Heat Stress',

  'access slip trip': 'Slips, Trips & Falls',
  'slips and trips': 'Slips, Trips & Falls',
  'slip and trips': 'Slips, Trips & Falls',
  'slip trip': 'Slips, Trips & Falls',

  'safe distance/line of fire': 'Line of Fire',

  'welfare facility': 'Health & Welfare',
  'welfare facilities': 'Health & Welfare',
  'welfare': 'Health & Welfare',
  'walefare facilities': 'Health & Welfare',
  'facilities': 'Health & Welfare',
  'facility welfare': 'Health & Welfare',
  'welfare/facility': 'Health & Welfare',
  'health': 'Health & Welfare',
  'health concerned': 'Health & Welfare',
  'unwareness regarding personnel health': 'Health & Welfare',
  'safety health of workers': 'Health & Welfare',
  'workers wellbeing': 'Health & Welfare',

  'barricades/signage': 'Barrication & Signages',
  'barricade': 'Barrication & Signages',
  'barricading': 'Barrication & Signages',

  'hand tools': 'Tools/Equipment Defects or Misuse',
  'hand and power tools': 'Tools/Equipment Defects or Misuse',
  'hand tools power tools safety': 'Tools/Equipment Defects or Misuse',
  'end cap missing': 'Tools/Equipment Defects or Misuse',
  'tuv/calineration': 'Tools/Equipment Defects or Misuse', // was 'tuv /calineration' -- fixed key to match categoryKey()'s slash-space collapsing, which was silently preventing this alias from ever matching
  'wind speed': 'Environmental',
  'monthly color code': 'Tools/Equipment Defects or Misuse',
  'hose safety': 'Tools/Equipment Defects or Misuse',
  'abrasive blasting safety': 'Tools/Equipment Defects or Misuse',
  'scc': 'Tools/Equipment Defects or Misuse',

  'rpe': 'Personal Protective Equipment (PPE) Violation/Lack of PPE',
  'personal protective equipment (ppe) violation/lack of': 'Personal Protective Equipment (PPE) Violation/Lack of PPE',

  'electrical hazards/lockout tagout (loto)': 'Electrical Hazards/Lockout Tagout',
  'the rcd electrical socket enclosure was found damaged and not properly secured': 'Electrical Hazards/Lockout Tagout',

  'unsecured working platform': 'Working at Height/Fall Protection',

  'fire safety/egress issues': 'Hot work / Fire Safety / Egress Issues',
  'fire extinguisher': 'Hot work / Fire Safety / Egress Issues',
  'no fire watch': 'Hot work / Fire Safety / Egress Issues',

  'refresher training & stan-down meeting': 'Training',
  'refresher training for firewatch men and stand down meeting': 'Training',
  'certificate) training card': 'Training',
  'drill assessment': 'Training',

  'good practice': 'Positive Observation',
  'safe practice': 'Positive Observation',
  'behavior safety': 'Positive Observation',
  'positive observation': 'Positive Observation', // normalizes case variant "Positive observation"

  'procedure violation': 'Procedure Compliance',
  'procedure violation/lack of training': 'Procedure Compliance',
  'working without permit': 'Procedure Compliance',
  'working without valid work permit and the work permit receiver was not present': 'Procedure Compliance',
  'work procedure followed': 'Procedure Compliance',
  'racs standard violation (mmsr)': 'Procedure Compliance',
  'tpi': 'Procedure Compliance',
  'manual excavation': 'Excavation/Trench/Confined Space',
  'confined space': 'Excavation/Trench/Confined Space',
  'standards/trench/confined…': 'Excavation/Trench/Confined Space', // truncated in the source sheet cell itself; "What was observed" confirms this is a trench/barricade report
  'unwareness regarding company assets': 'Procedure Compliance', // weak match, flagging as uncertain
};
// Shared key used for both alias lookup and known-category matching, so spacing quirks
// around slashes (e.g. "Hot work / Fire Safety" vs "Hot work/Fire Safety") never cause a
// mismatch between the two -- both call this same function.
function categoryKey(c){
  return (c||'').trim().toLowerCase().replace(/\s*\/\s*/g,'/').replace(/\s+/g,' ').trim();
}
function normalizeCategoryString(raw){
  return (raw||'').split(',').map(c=>c.trim()).filter(Boolean).map(c=>{
    return CATEGORY_ALIASES[categoryKey(c)] || c;
  }).join(', ');
}
// The Category question offers a fixed checklist plus a free-text "Other" field.
// Anything not in this recognized set (current form wording, matched via the aliases
// above) is left out of the Categories chart entirely rather than shown as its own slice
// or grouped into a catch-all -- the full, original text is still preserved on each row
// (tags in the log, search) and nothing here changes what's actually stored.
const KNOWN_CATEGORIES = new Set([
  'personal protective equipment (ppe) violation/lack of ppe',
  'housekeeping/clutter',
  'working at height/fall protection',
  'tools/equipment defects or misuse',
  'manual handling/lifting',
  'electrical hazards/lockout tagout',
  'vehicle/equipment operation',
  'chemical/material handling',
  'hot work/fire safety/egress issues',
  'environmental',
  'training',
  'barrication & signages',
  'slips, trips & falls',
  'line of fire',
  'health & welfare',
  'heat stress',
  'positive observation',
  'procedure compliance',
  'excavation/trench/confined space',
]);
function isKnownCategory(c){ return KNOWN_CATEGORIES.has(categoryKey(c)); }
function natureOf(type){
  const t=(type||'').toLowerCase();
  if(t.includes('positive')) return 'positive';
  if(t.includes('near miss')) return 'nearmiss';
  return 'unsafe';
}
function isPositive(type){ return natureOf(type)==='positive'; }
// The source form's "Type of Observation" field distinguishes Unsafe Act (a person's
// behavior) from Unsafe Condition (an environmental hazard) -- two genuinely different
// HSE categories that natureOf() intentionally lumps into one 'unsafe' bucket (kept as-is
// so charts like Monthly Comparison, which track the simpler 3-way split, are unaffected).
// This is the finer-grained classifier used wherever the Act/Condition distinction itself
// matters: KPI cards, quick filters, and the log/report labels. A handful of entries use
// free text that names both ("UC and UA") or neither (e.g. "Non compliance", "Equipment
// breakdown") -- rather than guess, those fall into 'unsafeother' so they're never silently
// mislabeled as one or the other.
function detailedNature(type){
  const n = natureOf(type);
  if(n !== 'unsafe') return n;
  const t=(type||'').toLowerCase();
  const hasAct = /unsafe act|\bua\b/.test(t);
  const hasCondition = /unsafe condition|\buc\b/.test(t);
  if(hasCondition && !hasAct) return 'unsafecondition';
  if(hasAct && !hasCondition) return 'unsafeact';
  return 'unsafeother';
}
// Maps any detailedNature() value back to one of the three existing pill color styles
// (positive/nearmiss/unsafe) so Unsafe Act, Unsafe Condition, and Unsafe Other all reuse
// the same red "unsafe" visual treatment in compact views like the log table.
function pillClassFor(dn){
  if(dn==='positive') return 'positive';
  if(dn==='nearmiss') return 'nearmiss';
  return 'unsafe';
}
function isOpenStatus(status){ return /open/i.test(status||''); }
function isCorrected(text){ return /^\s*yes/i.test(text||''); }
function sevColor(s){
  if(s===null || s===undefined) return '#CBD5E1';
  return s>=5?'#991B1B':s===4?'#DC2626':s===3?'#EF4444':s===2?'#F59E0B':'#10B981';
}
function parseDate(str){
  if(!str) return null;
  const d = new Date(str.trim());
  return isNaN(d.getTime()) ? null : d;
}
function monthKey(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'); }
function monthLabel(k){
  const [y,m] = k.split('-');
  return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(m)-1] + ' ' + y.slice(2);
}
function weekKey(d){
  const onejan = new Date(d.getFullYear(),0,1);
  const week = Math.ceil((((d - onejan) / 86400000) + onejan.getDay()+1)/7);
  return d.getFullYear()+'-W'+String(week).padStart(2,'0');
}

function setLogPage(page){
  logPage = Math.max(1, page);
  renderAll();
}

function buildPager(totalPages){
  if(totalPages <= 1) return '';
  const pages = [];
  const pushPage = (value, label = String(value), disabled = false, active = false) => {
    pages.push(`<button class="pager-btn ${active ? 'active' : ''}" data-page="${value}" ${disabled ? 'disabled' : ''}>${label}</button>`);
  };

  pushPage(logPage - 1, 'Prev', logPage === 1);

  const visible = new Set([1, totalPages, logPage - 1, logPage, logPage + 1]);
  const ordered = Array.from(visible).filter(page => page >= 1 && page <= totalPages).sort((a, b) => a - b);
  let last = 0;
  ordered.forEach(page => {
    if(page - last > 1){
      if(page - last === 2){
        pages.push(`<button class="pager-btn" data-page="${last + 1}">${last + 1}</button>`);
      } else {
        pages.push('<span class="pager-ellipsis">…</span>');
      }
    }
    pages.push(`<button class="pager-btn ${page === logPage ? 'active' : ''}" data-page="${page}">${page}</button>`);
    last = page;
  });

  pushPage(logPage + 1, 'Next', logPage === totalPages);
  return pages.join('');
}

function openReportModal(row){
  const modal = document.getElementById('reportModal');
  const body = document.getElementById('reportModalBody');
  const title = document.getElementById('reportModalTitle');
  if(!modal || !body || !title) return;
  const dn = detailedNature(row.type);
  const natureLabel = {positive:'Positive', nearmiss:'Near miss', unsafeact:'Unsafe act', unsafecondition:'Unsafe condition'}[dn] || 'Unsafe';
  title.textContent = `${row.observer || 'Observation'} · ${row.location || 'Report'}`;
  const section = (key, titleText, bodyHtml, open=true) => `
    <section class="report-section ${open ? 'open' : 'collapsed'}" data-section="${key}">
      <div class="report-section-head">
        <div>
          <h3>${titleText}</h3>
        </div>
        <button type="button" class="report-section-toggle" data-section-toggle="${key}" aria-expanded="${open ? 'true' : 'false'}">${open ? '▾' : '▸'}</button>
      </div>
      <div class="report-section-body">
        ${bodyHtml}
      </div>
    </section>`;

  body.innerHTML = `
    <div class="modal-meta">
      <span class="pill ${pillClassFor(dn)}">${natureLabel}</span>
      <span class="modal-meta-item"><b>Date</b>${escapeHtml(row.dateObs || '—')}</span>
      <span class="modal-meta-item"><b>Status</b>${escapeHtml(row.status || '—')}</span>
      <span class="modal-meta-item"><b>Severity</b>${row.severity ? 'Level ' + row.severity : 'Not specified'}</span>
    </div>
    ${section('summary', 'Summary', `
      <div class="detail-grid modal-grid">
        <p><b>Observer</b>${escapeHtml(row.observer || '—')}</p>
        <p><b>Designation</b>${escapeHtml(row.designation || '—')}${row.designation==='Other / Unclear' && row.designationRaw ? ' <span class="raw-note">(as entered: '+escapeHtml(row.designationRaw)+')</span>' : ''}</p>
        <p><b>Location</b>${escapeHtml(row.location || '—')}</p>
        <p><b>Responsible person</b>${escapeHtml(row.responsible || '—')}</p>
      </div>
    `)}
    ${section('observation', 'Observation Details', `
      <div class="detail-grid modal-grid">
        <p><b>Findings</b>${escapeHtml(row.what || '—')}</p>
        <p><b>Immediate action</b>${escapeHtml(row.immediateAction || '—')}</p>
        <p><b>Corrected on the spot</b>${escapeHtml(row.correctedOnSpot || '—')}</p>
        <p><b>Corrective action taken</b>${escapeHtml(row.correctiveAction || '—')}</p>
      </div>
    `)}
    ${section('evidence', 'Evidence & Closeout', `
      <div>
        <p><b>Photo / Evidence / Closeout</b></p>
        ${renderEvidencePreviewCards(row.evidenceUrls)}
      </div>
    `)}
  `;
  Array.from(body.querySelectorAll('.report-section-toggle')).forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const sectionEl = btn.closest('.report-section');
      if(!sectionEl) return;
      const isCollapsed = sectionEl.classList.toggle('collapsed');
      sectionEl.classList.toggle('open', !isCollapsed);
      btn.textContent = isCollapsed ? '▸' : '▾';
      btn.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
    });
  });
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
}

function closeReportModal(){
  const modal = document.getElementById('reportModal');
  if(!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
}

function extractEvidenceUrls(text){
  if(!text) return [];
  const matches = String(text).match(/https?:\/\/[^\s,]+/g) || [];
  const cleaned = matches.map(u=>u.trim().replace(/[)\]\}"']+$/,'')).filter(Boolean);
  return Array.from(new Set(cleaned));
}

function getDriveFileId(url){
  if(!url) return null;
  const byQuery = /[?&]id=([^&]+)/.exec(url);
  if(byQuery && byQuery[1]) return byQuery[1];
  const byPath = /\/file\/d\/([^/]+)/.exec(url);
  if(byPath && byPath[1]) return byPath[1];
  return null;
}

function getEvidencePreviewUrl(url){
  const fileId = getDriveFileId(url);
  if(fileId) return `https://drive.google.com/uc?export=view&id=${fileId}`;
  return url;
}

function isLikelyImageUrl(url){
  if(!url) return false;
  if(/\.(png|jpe?g|gif|webp|bmp|svg)(\?|#|$)/i.test(url)) return true;
  return !!getDriveFileId(url);
}

// Adds thousands separators to any number that reaches the screen. Passes strings
// (like an already-formatted "91.2%") straight through unchanged.
function fmtNum(n){
  if(typeof n === 'number' && isFinite(n)) return n.toLocaleString('en-US');
  return n;
}
function escapeHtml(text){
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function copyCanvasBitmap(sourceCanvas, targetCanvas){
  if(!sourceCanvas || !targetCanvas) return;
  const sourceRect = sourceCanvas.getBoundingClientRect();
  const width = sourceCanvas.width || Math.max(1, Math.round(sourceRect.width));
  const height = sourceCanvas.height || Math.max(1, Math.round(sourceRect.height));
  targetCanvas.width = width;
  targetCanvas.height = height;
  const context = targetCanvas.getContext('2d');
  if(!context) return;
  context.clearRect(0, 0, width, height);
  context.drawImage(sourceCanvas, 0, 0, width, height);
}

function openPanelModal(targetId){
  const source = document.getElementById(targetId);
  const modal = document.getElementById('panelModal');
  const body = document.getElementById('panelModalBody');
  const title = document.getElementById('panelModalTitle');
  if(!source || !modal || !body || !title) return;

  const panel = source.closest('.t-panel');
  if(!panel) return;

  const clone = panel.cloneNode(true);
  clone.querySelectorAll('.panel-maximize-btn').forEach(btn=>btn.remove());
  clone.querySelectorAll('canvas').forEach((canvas, index)=>{
    const sourceCanvas = panel.querySelectorAll('canvas')[index];
    copyCanvasBitmap(sourceCanvas, canvas);
  });
  // This is a static snapshot (cloned nodes + a bitmap copy of the chart canvas), so none
  // of the original click-to-filter interactions carry over. Swap any "click to filter/jump"
  // hint text for a neutral note and strip pointer affordances so it doesn't look clickable.
  clone.querySelectorAll('.hint').forEach(h=>{ h.textContent = 'Static snapshot — close this to interact with the panel.'; });
  clone.querySelectorAll('.leg-row, .rep-row, .hs-row, .aging-row, [data-loc], [data-name]').forEach(el=>{
    el.style.cursor = 'default';
    el.style.pointerEvents = 'none';
  });

  const headText = panel.querySelector('.panel-head-main')?.textContent || panel.querySelector('.panel-head')?.textContent || 'Report view';
  title.textContent = headText.trim();
  body.innerHTML = '';
  body.appendChild(clone);
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
}

function closePanelModal(){
  const modal = document.getElementById('panelModal');
  if(!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
}

function renderEvidenceLinksHtml(urls){
  if(!urls || !urls.length) return '—';
  return `<div class="evidence-links">${urls.map((url, idx)=>{
    const safe = escapeHtml(url);
    return `<button type="button" class="evidence-link" data-url="${safe}">Evidence ${idx + 1}</button>`;
  }).join('')}</div>`;
}

function renderEvidencePreviewCards(urls){
  if(!urls || !urls.length) return '<p>—</p>';
  return `<div class="evidence-preview-grid">${urls.map((url, idx)=>{
    const safe = escapeHtml(url);
    const preview = escapeHtml(getEvidencePreviewUrl(url));
    const thumb = isLikelyImageUrl(url)
      ? `<img class="evidence-thumb" src="${preview}" alt="Evidence ${idx + 1}" loading="lazy">`
      : '<div class="evidence-thumb evidence-thumb-file">Open evidence</div>';
    return `<button type="button" class="evidence-preview-item evidence-link" data-url="${safe}">${thumb}<span>Evidence ${idx + 1}</span></button>`;
  }).join('')}</div>`;
}

function openEvidenceModal(url){
  const modal = document.getElementById('evidenceModal');
  const body = document.getElementById('evidenceModalBody');
  const title = document.getElementById('evidenceModalTitle');
  if(!modal || !body || !title) return;

  const previewUrl = getEvidencePreviewUrl(url);
  const safeOriginal = escapeHtml(url);
  const safePreview = escapeHtml(previewUrl);
  title.textContent = 'Observation evidence';

  if(isLikelyImageUrl(url)){
    body.innerHTML = `
      <div class="evidence-view-wrap">
        <img class="evidence-view" src="${safePreview}" alt="Observation evidence" loading="lazy">
      </div>
      <a class="evidence-open-link" href="${safeOriginal}" target="_blank" rel="noopener noreferrer">Open original link</a>
    `;
  } else {
    body.innerHTML = `
      <a class="evidence-open-link" href="${safeOriginal}" target="_blank" rel="noopener noreferrer">Open evidence link in new tab</a>
    `;
  }

  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
}

function closeEvidenceModal(){
  const modal = document.getElementById('evidenceModal');
  if(!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
}

function parseRows(csvText){
  const parsed = Papa.parse(csvText, {header:true, skipEmptyLines:true});
  return parsed.data.map(r=>{
    const keys = Object.keys(r);
    const find = (needle) => { const k = keys.find(k=>k.toLowerCase().includes(needle)); return k?(r[k]||'').trim():''; };
    return {
      dateObs: find('date and time of observation') || find('timestamp'),
      location: find('location of observation') || find('location'),
      observer: find("observer's name") || find('observer name') || 'Unknown',
      type: find('type of observation'),
      what: find('what specifically'),
      category: normalizeCategoryString(find('category of unsafe')),
      severity: (()=>{ const n=parseInt(find('severity potential')); return isNaN(n)?null:Math.min(Math.max(n,1),5); })(),
      immediateAction: find('immediate action'),
      correctedOnSpot: find('corrected on the spot'),
      evidenceRaw: find('photo or evidence/closeout'),
      evidenceUrls: extractEvidenceUrls(find('photo or evidence/closeout')),
      responsible: find('responsible person'),
      correctiveAction: find('corrective action taken'),
      designationRaw: find('observer designation'),
      designation: normalizeDesignation(find('observer designation')),
      status: find('status - open') || find('status') || 'Closed',
    };
  }).filter(r=>r.location);
}

function parseRowsFromObjects(flat){
  if(!Array.isArray(flat)) return [];
  return flat.map(r=>{
    const keys = Object.keys(r || {});
    const find = (needle) => {
      const k = keys.find(key => String(key).toLowerCase().includes(needle));
      return k ? String(r[k] ?? '').trim() : '';
    };
    const sev = parseInt(find('severity potential'), 10);
    return {
      dateObs: find('date and time of observation') || find('timestamp'),
      location: find('location of observation') || find('location'),
      observer: find("observer's name") || find('observer name') || 'Unknown',
      type: find('type of observation'),
      what: find('what specifically'),
      category: normalizeCategoryString(find('category of unsafe')),
      severity: Number.isNaN(sev) ? null : Math.min(Math.max(sev,1),5),
      immediateAction: find('immediate action'),
      correctedOnSpot: find('corrected on the spot'),
      evidenceRaw: find('photo or evidence/closeout'),
      evidenceUrls: extractEvidenceUrls(find('photo or evidence/closeout')),
      responsible: find('responsible person'),
      correctiveAction: find('corrective action taken'),
      designationRaw: find('observer designation'),
      designation: normalizeDesignation(find('observer designation')),
      status: find('status - open') || find('status') || 'Closed',
    };
  }).filter(r=>r.location);
}

function parseRowsFromGviz(gviz){
  const table = gviz && gviz.table;
  if(!table || !Array.isArray(table.cols) || !Array.isArray(table.rows)) return [];
  const headers = table.cols.map((c, i)=> (c && (c.label || c.id)) ? String(c.label || c.id).trim() : `col_${i}`);
  const cellText = (cell)=>{
    if(!cell) return '';
    if(cell.f !== undefined && cell.f !== null) return String(cell.f).trim();
    if(cell.v === undefined || cell.v === null) return '';
    return String(cell.v).trim();
  };

  const flat = table.rows.map(row=>{
    const item = {};
    headers.forEach((h, i)=>{ item[h] = cellText(row.c && row.c[i]); });
    return item;
  });

  return parseRowsFromObjects(flat);
}

function loadRowsFromGvizJsonp(){
  return new Promise((resolve, reject)=>{
    const cbName = `__gviz_cb_${Date.now()}_${Math.floor(Math.random()*1000000)}`;
    const script = document.createElement('script');
    let done = false;

    const clean = ()=>{
      if(script.parentNode) script.parentNode.removeChild(script);
      try { delete window[cbName]; } catch(_){ window[cbName] = undefined; }
    };

    const timeout = setTimeout(()=>{
      if(done) return;
      done = true;
      clean();
      reject(new Error('GViz request timed out'));
    }, 15000);

    window[cbName] = (response)=>{
      if(done) return;
      done = true;
      clearTimeout(timeout);
      clean();
      try{
        resolve(parseRowsFromGviz(response));
      }catch(parseErr){
        reject(parseErr);
      }
    };

    script.onerror = ()=>{
      if(done) return;
      done = true;
      clearTimeout(timeout);
      clean();
      reject(new Error('GViz script failed to load'));
    };

    script.src = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json;responseHandler:${cbName}`;
    document.head.appendChild(script);
  });
}

async function loadRowsFromAppsScript(){
  const res = await fetch(APPS_SCRIPT_URL, {cache:'no-store'});
  if(!res.ok) throw new Error('HTTP ' + res.status);
  const payload = await res.json();
  const rows = parseRowsFromObjects(payload);
  if(!rows.length) throw new Error('No rows parsed from Apps Script');
  return rows;
}

async function loadRowsFromDirectSheet(){
  if(window.location.protocol === 'file:' || window.location.origin === 'null'){
    throw new Error('direct-sheet mode requires HTTP(S) hosting. Opening index.html via file:// is blocked by browser CORS for Google CSV export.');
  }

  try{
    const res = await fetch(CSV_URL, {cache:'no-store'});
    if(!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    if(text.trim().startsWith('<')) throw new Error('Sheet returned a sign-in page, not CSV');
    const rows = parseRows(text);
    if(!rows.length) throw new Error('No rows parsed');
    return rows;
  }catch(err){
    const message = err && err.message ? err.message : String(err);
    throw new Error(`direct-sheet load failed: ${message}`);
  }
}

function applyLoadedRows(rows, sourceLabel){
  ALL_ROWS = rows;
  hideBanner();
  document.getElementById('sourceNote').textContent = sourceLabel;
  populateDropdowns();
  syncDropdowns();
  renderAll();
  setSync(false, 'Data loaded ' + new Date().toLocaleTimeString());
}

/* ============================================================
   FILTERING
   ============================================================ */
function rowMatchesCategory(r, cat){
  return (r.category||'').split(',').map(s=>s.trim()).includes(cat);
}
function getFilteredRows(){
  return ALL_ROWS.filter(r=>{
    if(FILTERS.observer!=='All' && r.observer!==FILTERS.observer) return false;
    if(FILTERS.designation!=='All' && r.designation!==FILTERS.designation) return false;
    if(FILTERS.status!=='All'){
      const wantOpen = FILTERS.status==='Open';
      if(isOpenStatus(r.status)!==wantOpen) return false;
    }
    if(FILTERS.search){
      const hay = (r.what+' '+r.category+' '+r.location+' '+r.observer).toLowerCase();
      if(!hay.includes(FILTERS.search.toLowerCase())) return false;
    }
    if(FILTERS.category && !rowMatchesCategory(r, FILTERS.category)) return false;
    if(FILTERS.location && normLoc(r.location)!==FILTERS.location) return false;
    if(FILTERS.quick && detailedNature(r.type)!==FILTERS.quick) return false;
    if(FILTERS._sev){
      if(FILTERS._sev==='NA'){ if(r.severity!==null) return false; }
      else if(r.severity!==FILTERS._sev) return false;
    }
    return true;
  });
}

function renderChips(){
  const chips = [];
  if(FILTERS.category) chips.push(['Category: '+FILTERS.category, ()=>{FILTERS.category=null; renderAll();}]);
  if(FILTERS.location) chips.push(['Location: '+FILTERS.location, ()=>{FILTERS.location=null; renderAll();}]);
  if(FILTERS.quick){
    const QUICK_LABELS = { unsafeact:'Quick: Unsafe Act only', unsafecondition:'Quick: Unsafe Condition only', nearmiss:'Quick: Near miss only', positive:'Quick: Positive only' };
    const qLabel = QUICK_LABELS[FILTERS.quick] || 'Quick filter';
    chips.push([qLabel, ()=>{FILTERS.quick=null; renderAll();}]);
  }
  if(FILTERS._sev) chips.push(['Severity: '+(FILTERS._sev==='NA'?'N/A':'Sev '+FILTERS._sev), ()=>{FILTERS._sev=null; renderAll();}]);
  const row = document.getElementById('chipRow');
  row.innerHTML = chips.map((c,i)=>`<span class="chip-x">${escapeHtml(c[0])}<button data-i="${i}">X</button></span>`).join('');
  Array.from(row.querySelectorAll('button')).forEach((btn,i)=>btn.addEventListener('click', chips[i][1]));
}

/* ============================================================
   MAIN RENDER PIPELINE
   ============================================================ */
function renderAll(){
  const rows = getFilteredRows();
  renderChips();
  renderKpis(rows);
  renderTrend(rows);
  renderCategoryDonut(rows);
  renderDesignation(rows);
  renderTopReporters(rows);
  renderSeverity(rows);
  renderHotspots(rows);
  renderCadence(rows);
  renderMonthly(rows);
  renderRateAndAging(rows);
  renderTable(rows);
  document.getElementById('logCount').textContent = rows.length + ' shown of ' + ALL_ROWS.length;
}

function svgIcon(path, extra){ return `<svg class="ic" style="${extra||''}" viewBox="0 0 24 24">${path}</svg>`; }
// Lucide-equivalent glyphs (ClipboardList, ShieldCheck, TriangleAlert, HardHat, Activity, CheckCircle2).
// Same object keys as before -- every call site (renderKpis) is unchanged.
const ICONS = {
  doc: '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  warn: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  check: '<path d="M21.801 10A10 10 0 1 1 17 3.335"/><path d="m9 11 3 3L22 4"/>',
  pulse: '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>',
  hazard: '<path d="M10 20a1 1 0 0 0 .553.895l2 1a1 1 0 0 0 .894 0l2-1A1 1 0 0 0 16 20v-2a4 4 0 1 0-6 0z"/><path d="M12 3v2"/><path d="M3 7h18"/><path d="M6 7v-2"/><path d="M18 7v-2"/><path d="M9 7v10"/><path d="M15 7v10"/>'
};

// Real day-over-day comparison for the KPI trend row (not decorative filler):
// counts how many of the currently-filtered rows fall on today's calendar date vs
// yesterday's, per KPI category, and expresses that as a percent change. Returns
// null when there's nothing to meaningfully compare (no rows on either day).
function dayOverDayTrend(rows, matchFn){
  const today = new Date();
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate()-1);
  const sameDay = (d, ref) => d && d.getFullYear()===ref.getFullYear() && d.getMonth()===ref.getMonth() && d.getDate()===ref.getDate();
  let todayCount = 0, yestCount = 0;
  rows.forEach(r=>{
    if(!matchFn(r)) return;
    const d = parseDate(r.dateObs);
    if(!d) return;
    if(sameDay(d, today)) todayCount++;
    else if(sameDay(d, yesterday)) yestCount++;
  });
  if(todayCount===0 && yestCount===0) return null;
  if(yestCount===0) return {dir:'up', value:'New', label:'Today'};
  const pct = Math.round(((todayCount-yestCount)/yestCount)*100);
  if(pct===0) return {dir:'flat', value:'0%', label:'vs Yesterday'};
  return {dir: pct>0?'up':'down', value:`${pct>0?'+':''}${pct}%`, label:'vs Yesterday'};
}
// Executive two-line format: a prominent value line (arrow + number) with a smaller,
// secondary comparison label underneath -- e.g. "▲ +143%" over "vs Yesterday".
function kpiTrendHtml(trend){
  if(!trend) return '';
  const arrow = trend.dir==='up' ? '▲' : trend.dir==='down' ? '▼' : '●';
  return `<div class="kpi-trend trend-${trend.dir}">
      <div class="trend-value">${arrow} ${trend.value}</div>
      <div class="trend-label">${trend.label}</div>
    </div>`;
}

function renderKpis(rows){
  const total = ALL_ROWS.length;
  const shown = rows.length;
  const natures = rows.map(r=>detailedNature(r.type));
  const positive = natures.filter(n=>n==='positive').length;
  const nearmiss = natures.filter(n=>n==='nearmiss').length;
  const unsafeAct = natures.filter(n=>n==='unsafeact').length;
  const unsafeCondition = natures.filter(n=>n==='unsafecondition').length;
  // A small number of entries name neither ("Non compliance", "Equipment breakdown") or
  // both ("UC and UA") -- they still count toward Total Reports but, same as an unclear
  // designation, aren't forced into either headline card. See detailedNature() above.
  const closed = rows.filter(r=>!isOpenStatus(r.status)).length;
  const closureRate = shown ? ((closed/shown)*100).toFixed(1) : '0.0';
  const pctPositive = shown ? Math.round(100*positive/shown) : 0;
  const pctUnsafeAct = shown ? Math.round(100*unsafeAct/shown) : 0;
  const pctUnsafeCondition = shown ? Math.round(100*unsafeCondition/shown) : 0;
  const pctNearmiss = shown ? Math.round(100*nearmiss/shown) : 0;

  const trendTotal = dayOverDayTrend(rows, ()=>true);
  const trendPositive = dayOverDayTrend(rows, r=>detailedNature(r.type)==='positive');
  const trendUnsafeAct = dayOverDayTrend(rows, r=>detailedNature(r.type)==='unsafeact');
  const trendUnsafeCondition = dayOverDayTrend(rows, r=>detailedNature(r.type)==='unsafecondition');
  const trendNearmiss = dayOverDayTrend(rows, r=>detailedNature(r.type)==='nearmiss');
  // Closure rate isn't a daily count -- it's compared as a percentage-point shift between
  // "rate as of yesterday" and "rate as of today" (cumulative), which is the only reading
  // of "vs yesterday" that means anything for a running rate rather than a per-day tally.
  const trendClosure = (()=>{
    const today = new Date(); const yesterday = new Date(today); yesterday.setDate(yesterday.getDate()-1);
    const asOf = (cutoff) => {
      const subset = rows.filter(r=>{ const d=parseDate(r.dateObs); return d && d<=cutoff; });
      if(!subset.length) return null;
      return 100*subset.filter(r=>!isOpenStatus(r.status)).length/subset.length;
    };
    const endOfToday = new Date(today); endOfToday.setHours(23,59,59,999);
    const endOfYesterday = new Date(yesterday); endOfYesterday.setHours(23,59,59,999);
    const rateToday = asOf(endOfToday), rateYesterday = asOf(endOfYesterday);
    if(rateToday===null || rateYesterday===null) return null;
    const delta = +(rateToday-rateYesterday).toFixed(1);
    if(delta===0) return {dir:'flat', value:'0.0pt', label:'vs Yesterday'};
    return {dir: delta>0?'up':'down', value:`${delta>0?'+':''}${delta}pt`, label:'vs Yesterday'};
  })();

  const cards = [
    {cls:'k-blue', quick:null, icon:ICONS.doc, badge:null, badgeLabel:null, num:shown, lbl:'TOTAL REPORTS', cap:`${fmtNum(total)} database entries`, trend:trendTotal},
    {cls:'k-green', quick:'positive', icon:ICONS.shield, badge:pctPositive+'%', badgeLabel:'Positive', num:positive, lbl:'SAFE PRACTICES', cap:'Positive observations', trend:trendPositive},
    {cls:'k-red', quick:'unsafeact', icon:ICONS.warn, badge:pctUnsafeAct+'%', badgeLabel:'Unsafe', num:unsafeAct, lbl:'UNSAFE ACTS', cap:'Behavior-related', trend:trendUnsafeAct},
    {cls:'k-navy', quick:'unsafecondition', icon:ICONS.hazard, badge:pctUnsafeCondition+'%', badgeLabel:'Conditions', num:unsafeCondition, lbl:'UNSAFE CONDITIONS', cap:'Environment/hazard-related', trend:trendUnsafeCondition},
    {cls:'k-teal', quick:'nearmiss', icon:ICONS.pulse, badge:pctNearmiss+'%', badgeLabel:'Near Misses', num:nearmiss, lbl:'NEAR MISSES', cap:'Could have been worse', trend:trendNearmiss},
    {cls:'k-olive', quick:null, icon:ICONS.check, badge:null, badgeLabel:null, num:closureRate+'%', lbl:'CLOSURE RATE', cap:`${fmtNum(closed)} issues resolved`, trend:trendClosure},
  ];
  document.getElementById('kpiRow').innerHTML = cards.map(c=>`
    <div class="kpi ${c.cls} ${FILTERS.quick===c.quick && c.quick ? 'active':''}" data-quick="${c.quick||''}">
      <div class="kpi-top"><div class="kpi-ic">${svgIcon(c.icon,'width:15px;height:15px')}</div>${c.badge?`<div class="kpi-badge"><span class="badge-val">${c.badge}</span><span class="badge-lbl">${c.badgeLabel}</span></div>`:''}</div>
      <div class="num">${fmtNum(c.num)}</div>
      <div class="lbl">${c.lbl}</div>
      ${kpiTrendHtml(c.trend)}
      <div class="cap">${c.cap}</div>
    </div>`).join('');
  Array.from(document.querySelectorAll('.kpi')).forEach(el=>{
    const q = el.getAttribute('data-quick');
    if(q){ el.addEventListener('click', ()=>{ FILTERS.quick = FILTERS.quick===q ? null : q; renderAll(); }); }
  });
}

// Finds where the real reporting cadence begins by skipping a small handful of
// leading days that sit isolated (a large date gap) far before the main cluster of
// activity -- e.g. a single mis-dated entry shouldn't stretch the whole axis and
// flatten the real trend. Only looks within the first ~3% of days, so it can never
// eat into genuine gradual ramp-up data.
function pickTrendStartIndex(days){
  const n = days.length;
  if(n < 8) return 0;
  const GAP_THRESHOLD_DAYS = 21;
  const maxLeadIndex = Math.max(2, Math.ceil(n * 0.03));
  let cut = 0;
  for(let i=0; i<Math.min(maxLeadIndex, n-1); i++){
    const gap = (new Date(days[i+1]) - new Date(days[i])) / 86400000;
    if(gap > GAP_THRESHOLD_DAYS) cut = i+1;
  }
  return cut;
}

function renderTrend(rows){
  const byDay = new Map();
  rows.forEach(r=>{
    const d = parseDate(r.dateObs);
    if(!d) return;
    const key = d.toISOString().slice(0,10);
    byDay.set(key, (byDay.get(key) || 0) + 1);
  });
  const allDays = Array.from(byDay.keys()).sort();
  const cut = pickTrendStartIndex(allDays);
  const excludedDays = allDays.slice(0, cut);
  const days = allDays.length ? allDays.slice(cut) : allDays;

  trendCache = {
    days,
    labels: days.map(day => formatTrendLabel(new Date(day + 'T00:00:00'))),
    titles: days.map(day => formatTrendTitle(new Date(day + 'T00:00:00'))),
    counts: days.map(d => byDay.get(d) || 0)
  };

  const slider = document.getElementById('trendSlider');
  const startInput = document.getElementById('trendSliderStart');
  const endInput = document.getElementById('trendSliderEnd');
  if(slider && startInput && endInput){
    if(days.length > 1){
      slider.style.display = 'block';
      startInput.min = endInput.min = 0;
      startInput.max = endInput.max = days.length - 1;
      // A fresh render (new filters/data) always resets the scrub window back to the full range.
      startInput.value = 0;
      endInput.value = days.length - 1;
    } else {
      slider.style.display = 'none';
    }
  }
  applyTrendWindow();

  const note = document.getElementById('trendNote');
  if(note){
    if(excludedDays.length && days.length){
      const excludedCount = excludedDays.reduce((sum,d)=>sum+(byDay.get(d)||0),0);
      const startLabel = formatTrendTitle(new Date(days[0] + 'T00:00:00'));
      note.textContent = `Showing trend from ${startLabel} onward — ${excludedCount} earlier report(s) fall well outside this range and are excluded from the chart to keep it readable. They're still counted everywhere else and visible in the Observation Log.`;
      note.style.display = 'block';
    } else {
      note.textContent = '';
      note.style.display = 'none';
    }
  }
}

// Redraws the Reporting Trend chart from the cached full series, sliced to whatever
// window the scrub slider currently has selected. Purely a local view of the same data
// -- doesn't touch FILTERS, doesn't call renderAll(), and doesn't affect any other chart,
// KPI, or the log table.
function applyTrendWindow(){
  const startInput = document.getElementById('trendSliderStart');
  const endInput = document.getElementById('trendSliderEnd');
  const rangeEl = document.getElementById('trendSliderRange');
  const startLbl = document.getElementById('trendSliderStartLabel');
  const endLbl = document.getElementById('trendSliderEndLabel');
  const { days, labels, titles, counts } = trendCache;

  let startIdx = 0, endIdx = days.length - 1;
  if(startInput && endInput && days.length > 1){
    startIdx = Math.min(parseInt(startInput.value), parseInt(endInput.value));
    endIdx = Math.max(parseInt(startInput.value), parseInt(endInput.value));
    const maxIdx = days.length - 1;
    if(rangeEl){
      const leftPct = maxIdx ? (startIdx / maxIdx) * 100 : 0;
      const rightPct = maxIdx ? (endIdx / maxIdx) * 100 : 100;
      rangeEl.style.left = leftPct + '%';
      rangeEl.style.width = (rightPct - leftPct) + '%';
    }
    if(startLbl) startLbl.textContent = titles[startIdx] ? titles[startIdx].split(',').slice(0,2).join(',') : '';
    if(endLbl) endLbl.textContent = titles[endIdx] ? titles[endIdx].split(',').slice(0,2).join(',') : '';
  }

  const winCounts = counts.slice(startIdx, endIdx + 1);
  trendYMax = Math.max(1, ...winCounts, 0);
  drawLineChart('trendChart', labels.slice(startIdx, endIdx + 1), winCounts, titles.slice(startIdx, endIdx + 1));
}

function renderCategoryDonut(rows){
  const counts = {};
  // Only chart recognized categories -- unmatched free text (typos, "Other:" entries not
  // yet formalized) is skipped here rather than shown as its own slice or grouped into a
  // catch-all. It's not hidden from the dashboard entirely: it's still on each row's tags
  // in the Observation Log and matches Global Search, just not summarized in this chart.
  rows.forEach(r=> (r.category||'').split(',').forEach(c=>{
    c=c.trim(); if(!c || !isKnownCategory(c)) return;
    counts[c]=(counts[c]||0)+1;
  }));
  const sorted = Object.entries(counts).sort((a,b)=>b[1]-a[1]);
  const labels = sorted.map(s=>s[0]);
  const data = sorted.map(s=>s[1]);
  const colors = labels.map((l,i)=> PALETTE[i % PALETTE.length]);
  drawDoughnut('catDonut', labels, data, colors, (label)=>{ selectCategory(label); });
  document.getElementById('catLegend').innerHTML = labels.map((l,i)=>`
    <div class="leg-row ${FILTERS.category===l?'active':''}" data-l="${i}">
      <span class="leg-dot" style="background:${colors[i]}"></span>
      <span class="leg-name" title="${l}">${l}</span>
      <span class="leg-count">${fmtNum(data[i])}</span>
    </div>`).join('');
  Array.from(document.querySelectorAll('#catLegend .leg-row')).forEach((el,i)=>{
    el.addEventListener('click', ()=>{ selectCategory(labels[i]); });
  });
}

function selectCategory(label){
  FILTERS.category = FILTERS.category===label ? null : label;
  renderAll();
  if(FILTERS.category){
    document.querySelector('.tab-btn[data-tab="log"]')?.click();
  }
}

function renderDesignation(rows){
  const counts = {};
  rows.forEach(r=>{ const d=r.designation||'N/A'; counts[d]=(counts[d]||0)+1; });
  const sorted = Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,12);
  drawBar('desigChart', sorted.map(s=>s[0]), sorted.map(s=>s[1]), (label)=>{ FILTERS.designation = FILTERS.designation===label?'All':label; syncDropdowns(); renderAll(); });
}

function renderTopReporters(rows){
  const counts = {};
  rows.forEach(r=>{ counts[r.observer]=(counts[r.observer]||0)+1; });
  const sorted = Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,10);
  document.getElementById('topReporters').innerHTML = sorted.map((s,i)=>`
    <div class="rep-row ${FILTERS.observer===s[0]?'active':''}" data-name="${escapeHtml(s[0])}">
      <div class="rep-rank ${i===0?'gold':''}">${i+1}</div>
      <div class="rep-name">${escapeHtml(s[0])}</div>
      <div class="rep-count">${fmtNum(s[1])} reports</div>
    </div>`).join('');
  Array.from(document.querySelectorAll('#topReporters .rep-row')).forEach(el=>{
    el.addEventListener('click', ()=>{
      const name = el.getAttribute('data-name');
      FILTERS.observer = FILTERS.observer===name ? 'All' : name;
      syncDropdowns(); renderAll();
    });
  });
}

function renderSeverity(rows){
  const counts = {1:0,2:0,3:0,4:0,5:0,NA:0};
  rows.forEach(r=>{ if(r.severity===null){counts.NA++;} else {counts[r.severity]=(counts[r.severity]||0)+1;} });
  const labels = ['Sev 1','Sev 2','Sev 3','Sev 4','Sev 5','N/A'];
  const data = [counts[1],counts[2],counts[3],counts[4],counts[5],counts.NA];
  const colors = ['#10B981','#F59E0B','#EF4444','#DC2626','#991B1B','#CBD5E1'];
  drawBar('sevChart', labels, data, (label)=>{
    const sevVal = label==='N/A' ? 'NA' : parseInt(label.split(' ')[1]);
    FILTERS._sev = FILTERS._sev===sevVal ? null : sevVal;
    renderAll();
  }, colors);
}

function renderHotspots(rows){
  const map = new Map();
  rows.forEach(r=>{ const loc=normLoc(r.location); if(!map.has(loc)) map.set(loc,[]); map.get(loc).push(r); });
  const sorted = Array.from(map.entries()).sort((a,b)=>b[1].length-a[1].length).slice(0,12);
  const maxCount = sorted.length ? sorted[0][1].length : 1;
  document.getElementById('hotspotList').innerHTML = sorted.map(([loc, items])=>{
    const maxSev = Math.max(...items.map(r=>r.severity||1));
    const pct = Math.round(100*items.length/maxCount);
    return `<div class="hs-row ${FILTERS.location===loc?'active':''}" data-loc="${escapeHtml(loc)}">
      <span class="hs-km" title="${escapeHtml(loc)}">${escapeHtml(loc)}</span>
      <span class="hs-bar-track"><span class="hs-bar-fill" style="width:${pct}%; background:${sevColor(maxSev)}"></span></span>
      <span class="hs-count">${fmtNum(items.length)}</span>
    </div>`;
  }).join('');
  Array.from(document.querySelectorAll('#hotspotList .hs-row')).forEach(el=>{
    el.addEventListener('click', ()=>{
      const loc = el.getAttribute('data-loc');
      FILTERS.location = FILTERS.location===loc ? null : loc;
      renderAll();
    });
  });
}

function renderCadence(rows){
  const byWeek = {};
  rows.forEach(r=>{ const d=parseDate(r.dateObs); if(!d) return; const k=weekKey(d); byWeek[k]=(byWeek[k]||0)+1; });
  const weeks = Object.keys(byWeek).sort();
  drawBar('cadenceChart', weeks.map(w=>w.split('-W')[1]?('W'+w.split('-W')[1]):w), weeks.map(w=>byWeek[w]), null, '#2563EB');
}

function renderMonthly(rows){
  const buckets = {};
  rows.forEach(r=>{
    const d = parseDate(r.dateObs); if(!d) return;
    const k = monthKey(d);
    if(!buckets[k]) buckets[k] = {positive:0, unsafeact:0, unsafecondition:0, unsafeother:0, nearmiss:0};
    buckets[k][detailedNature(r.type)]++;
  });
  const months = Object.keys(buckets).sort();
  const ctx = document.getElementById('monthlyChart');
  if(charts.monthlyChart) charts.monthlyChart.destroy();
  charts.monthlyChart = new Chart(ctx, {
    type:'bar',
    data:{
      labels: months.map(monthLabel),
      datasets:[
        // Only the topmost segment in each stack ("Other") gets a rounded cap; the rest
        // stay flat so adjoining segments sit flush against each other instead of leaving
        // small rounded-corner gaps between colors.
        { label:'Positive', data: months.map(m=>buckets[m].positive), backgroundColor:'#10B981', hoverBackgroundColor:'#0DA271', borderRadius:0, barPercentage:0.55, categoryPercentage:0.7 },
        { label:'Unsafe Act', data: months.map(m=>buckets[m].unsafeact), backgroundColor:'#EF4444', hoverBackgroundColor:'#E23636', borderRadius:0, barPercentage:0.55, categoryPercentage:0.7 },
        { label:'Unsafe Condition', data: months.map(m=>buckets[m].unsafecondition), backgroundColor:'#7C3AED', hoverBackgroundColor:'#6D28D9', borderRadius:0, barPercentage:0.55, categoryPercentage:0.7 },
        { label:'Near miss', data: months.map(m=>buckets[m].nearmiss), backgroundColor:'#F59E0B', hoverBackgroundColor:'#E08E0B', borderRadius:0, barPercentage:0.55, categoryPercentage:0.7 },
        { label:'Other', data: months.map(m=>buckets[m].unsafeother), backgroundColor:'#94A3B8', hoverBackgroundColor:'#84919F', borderRadius:{topLeft:6,topRight:6,bottomLeft:0,bottomRight:0}, barPercentage:0.55, categoryPercentage:0.7 },
      ]
    },
    options:{
      responsive:true, maintainAspectRatio:false,
      animation:{duration:600, easing:'easeOutQuart'},
      plugins:{
        legend:{ position:'bottom', labels:{ font:{family:'Inter',size:11}, color:'#475569', boxWidth:10, padding:14, usePointStyle:true, pointStyle:'circle' } },
        tooltip:{ backgroundColor:'#fff', titleColor:'#0F172A', bodyColor:'#475569', borderColor:'#E7EAF1', borderWidth:1, padding:10, cornerRadius:10, titleFont:{family:'Inter',weight:'700',size:12}, bodyFont:{family:'Inter',size:11.5} }
      },
      scales:{
        x:{ stacked:true, grid:{display:false}, ticks:{font:{family:'Inter',size:10.5}, color:'#64748B'} },
        y:{ stacked:true, grid:{color:'rgba(15,23,42,.05)'}, ticks:{font:{family:'Inter',size:10.5}, color:'#94A3B8'} }
      }
    }
  });
}

function renderRateAndAging(rows){
  const withAnswer = rows.filter(r=>r.correctedOnSpot);
  const correctedYes = withAnswer.filter(r=>isCorrected(r.correctedOnSpot)).length;
  const pct = withAnswer.length ? Math.round(100*correctedYes/withAnswer.length) : 0;
  document.getElementById('rateCard').innerHTML = `
    <div class="rc-num">${pct}%</div>
    <div class="rc-body">
      <div class="rc-lbl">Corrected on the spot (${fmtNum(correctedYes)} of ${fmtNum(withAnswer.length)} answered)</div>
      <div class="rc-bar"><div class="rc-fill" style="width:${pct}%"></div></div>
    </div>`;

  const now = new Date();
  const openRows = rows.filter(r=>isOpenStatus(r.status)).map(r=>{
    const d = parseDate(r.dateObs);
    const days = d ? Math.max(0, Math.round((now - d)/86400000)) : null;
    return {...r, days};
  }).sort((a,b)=> (b.days||0)-(a.days||0));

  const list = document.getElementById('agingList');
  if(!openRows.length){
    list.innerHTML = `<div class="aging-empty">No open items in the current filter — nothing overdue.</div>`;
    return;
  }
  list.innerHTML = openRows.slice(0,25).map(r=>{
    const days = r.days===null ? '—' : r.days+'d';
    const cls = r.days>=30 ? 'hot' : r.days>=14 ? 'warm' : '';
    return `<div class="aging-row" data-loc="${escapeHtml(normLoc(r.location))}">
      <span class="aging-days ${cls}">${days}</span>
      <span class="aging-meta"><b>${escapeHtml(r.location||'—')}</b> · ${escapeHtml(r.observer||'—')} · ${escapeHtml((r.what||'').slice(0,50))}</span>
    </div>`;
  }).join('');
  Array.from(list.querySelectorAll('.aging-row')).forEach(el=>{
    el.addEventListener('click', ()=>{
      FILTERS.location = el.getAttribute('data-loc');
      renderAll();
      document.querySelector('.tab-btn[data-tab="insights"]').click();
    });
  });
}

function renderTable(rows){
  const sorted = [...rows].sort((a,b)=>{
    const da = parseDate(a.dateObs), db = parseDate(b.dateObs);
    return (db?db.getTime():0) - (da?da.getTime():0);
  });
  logRowsCache = sorted;
  const totalPages = Math.max(1, Math.ceil(sorted.length / LOG_PAGE_SIZE));
  if(logPage > totalPages) logPage = totalPages;
  const start = (logPage - 1) * LOG_PAGE_SIZE;
  const visibleRows = sorted.slice(start, start + LOG_PAGE_SIZE);

  const body = document.getElementById('logBody');
  const summary = document.getElementById('logSummary');
  const pager = document.getElementById('logPager');
  if(summary){
    if(sorted.length){
      const end = Math.min(start + LOG_PAGE_SIZE, sorted.length);
      summary.textContent = `Showing ${fmtNum(start + 1)}-${fmtNum(end)} of ${fmtNum(sorted.length)} records`;
    } else {
      summary.textContent = 'No records available for the current filter';
    }
  }
  if(pager){
    pager.innerHTML = buildPager(totalPages);
    Array.from(pager.querySelectorAll('button[data-page]')).forEach(btn=>{
      btn.addEventListener('click', ()=>{
        if(btn.disabled) return;
        setLogPage(parseInt(btn.getAttribute('data-page')));
      });
    });
  }

  if(!visibleRows.length){
    body.innerHTML = `<tr><td colspan="6" class="no-results">No observations match the current filters.</td></tr>`;
    return;
  }
  body.innerHTML = visibleRows.map((r,i)=>{
    const rowIndex = start + i;
    const dn = detailedNature(r.type);
    const natureLabel = {positive:'POSITIVE', nearmiss:'NEAR MISS', unsafeact:'UNSAFE ACT', unsafecondition:'UNSAFE CONDITION'}[dn] || 'UNSAFE';
    const open = isOpenStatus(r.status);
    const tags = (r.category||'').split(',').map(s=>s.trim()).filter(Boolean).map(t=>`<span class="tag">${escapeHtml(t)}</span>`).join('');
    return `
    <tr class="main-row" data-i="${rowIndex}">
      <td class="km-cell">${(r.dateObs||'').split(' ')[0]||'—'}</td>
      <td class="person"><b>${escapeHtml(r.observer)}</b><span>${escapeHtml(r.designation)}</span></td>
      <td><span class="pill ${pillClassFor(dn)}">${natureLabel}</span></td>
      <td class="findings-cell">${escapeHtml((r.what||'').slice(0,90))}${(r.what||'').length>90?'…':''}</td>
      <td><span class="pill ${open?'open':'closed'}">${open?'OPEN':'CLOSED'}</span></td>
      <td class="action-cell">
        <button class="expand-btn" data-i="${rowIndex}" title="Expand details">▾</button>
        <button class="maximize-btn" data-i="${rowIndex}" title="Maximize report">⤢</button>
      </td>
    </tr>
    <tr class="detail-row" id="detail-${rowIndex}" style="display:none;"><td colspan="6">
      <div class="detail-grid">
        <p><b>Location</b>${escapeHtml(r.location||'—')}</p>
        <p><b>Severity</b>${r.severity ? 'Level '+r.severity+' of 5' : 'Not specified'}</p>
        <p><b>Category tags</b>${tags||'—'}</p>
        <p><b>Immediate action</b>${escapeHtml(r.immediateAction||'—')}</p>
        <p><b>Corrected on the spot</b>${escapeHtml(r.correctedOnSpot||'—')}</p>
        <p><b>Photo / Evidence / Closeout</b>${renderEvidenceLinksHtml(r.evidenceUrls)}</p>
        <p><b>Responsible person</b>${escapeHtml(r.responsible||'—')}</p>
        <p><b>Corrective action taken</b>${escapeHtml(r.correctiveAction||'—')}</p>
      </div>
    </td></tr>`;
  }).join('');
  Array.from(document.querySelectorAll('.expand-btn')).forEach(btn=>{
    btn.addEventListener('click', (e)=>{
      e.stopPropagation();
      const i = btn.getAttribute('data-i');
      const row = document.getElementById('detail-'+i);
      const isOpenRow = row.style.display==='table-row';
      row.style.display = isOpenRow ? 'none' : 'table-row';
      btn.textContent = isOpenRow ? '▾' : '▴';
    });
  });
  Array.from(document.querySelectorAll('.maximize-btn')).forEach(btn=>{
    btn.addEventListener('click', (e)=>{
      e.stopPropagation();
      const row = logRowsCache[parseInt(btn.getAttribute('data-i'))];
      if(row) openReportModal(row);
    });
  });
  Array.from(document.querySelectorAll('tr.main-row')).forEach(tr=>{
    tr.addEventListener('click', ()=>{ tr.querySelector('.expand-btn').click(); });
  });
}

/* ============================================================
   CHART DRAWING
   ============================================================ */
function drawLineChart(id, labels, data, fullLabels){
  const ctx = document.getElementById(id);
  if(charts[id]) charts[id].destroy();
  charts[id] = new Chart(ctx, {
    type:'line',
    data:{ labels, datasets:[{ label:'Reports', data, borderColor:'#2563EB', backgroundColor:'rgba(37,99,235,0.10)', fill:true, tension:.4, pointRadius:0, pointHoverRadius:5, pointHoverBackgroundColor:'#2563EB', pointHoverBorderColor:'#fff', pointHoverBorderWidth:2, borderWidth:2.5 }] },
    options:{
      responsive:true, maintainAspectRatio:false,
      interaction:{mode:'nearest', intersect:false},
      animation:{duration:600, easing:'easeOutQuart'},
      plugins:{
        legend:{display:false},
        tooltip:{
          backgroundColor:'#fff', titleColor:'#0F172A', bodyColor:'#475569', borderColor:'#E7EAF1', borderWidth:1,
          padding:10, cornerRadius:10, displayColors:false,
          titleFont:{family:'Inter',weight:'700',size:12}, bodyFont:{family:'Inter',size:11.5},
          callbacks:{
            title:(items)=>{
              const index = items[0].dataIndex;
              return fullLabels && fullLabels[index] ? fullLabels[index] : items[0].label;
            },
            label:(item)=>`Reports: ${fmtNum(item.parsed.y)}`
          }
        }
      },
      scales:{
        x:{
          ticks:{
            color:'#64748B',
            font:{family:'Inter',size:10.5},
            maxRotation:0,
            autoSkip:true,
            maxTicksLimit:10,
            callback:(value, index)=>Array.isArray(labels[index]) ? labels[index].join(' ') : labels[index]
          },
          grid:{display:false}
        },
        y:{
          grid:{color:'rgba(15,23,42,.05)'},
          ticks:{
            font:{family:'Inter',size:10.5},
            color:'#94A3B8',
            precision:0,
            callback:(value)=>fmtNum(Math.round(value))
          },
          beginAtZero:true,
          suggestedMax: trendYMax,
          max: trendYMax,
          grace:0
        }
      }
    }
  });
}
function drawDoughnut(id, labels, data, colors, onClick){
  const ctx = document.getElementById(id);
  if(charts[id]) charts[id].destroy();
  charts[id] = new Chart(ctx, {
    type:'doughnut',
    data:{ labels, datasets:[{ data, backgroundColor:colors, borderWidth:3, borderColor:'#fff', hoverOffset:6 }] },
    options:{
      responsive:true, cutout:'66%', maintainAspectRatio:false,
      animation:{duration:600, easing:'easeOutQuart'},
      plugins:{
        legend:{display:false},
        tooltip:{
          backgroundColor:'#fff', titleColor:'#0F172A', bodyColor:'#475569', borderColor:'#E7EAF1', borderWidth:1,
          padding:10, cornerRadius:10, titleFont:{family:'Inter',weight:'700',size:12}, bodyFont:{family:'Inter',size:11.5}
        }
      },
      onClick:(evt,els)=>{ if(els.length) onClick(labels[els[0].index]); },
      onHover:(evt,els)=>{ evt.native.target.style.cursor = els.length?'pointer':'default'; }
    }
  });
}
function drawBar(id, labels, data, onClick, colors){
  const ctx = document.getElementById(id);
  if(charts[id]) charts[id].destroy();
  const bg = Array.isArray(colors) ? colors : (colors || '#2563EB');
  charts[id] = new Chart(ctx, {
    type:'bar',
    data:{ labels, datasets:[{ data, backgroundColor:bg, borderRadius:5, maxBarThickness:26 }] },
    options:{
      indexAxis:'y',
      responsive:true, maintainAspectRatio:false,
      animation:{duration:500, easing:'easeOutQuart'},
      plugins:{
        legend:{display:false},
        tooltip:{
          backgroundColor:'#fff', titleColor:'#0F172A', bodyColor:'#475569', borderColor:'#E7EAF1', borderWidth:1,
          padding:10, cornerRadius:10, displayColors:false, titleFont:{family:'Inter',weight:'700',size:12}, bodyFont:{family:'Inter',size:11.5}
        }
      },
      scales:{
        x:{ grid:{color:'rgba(15,23,42,.05)'}, ticks:{font:{family:'Inter',size:10.5}, color:'#64748B', precision:0, callback:(value)=>fmtNum(Math.round(value))} , beginAtZero:true },
        y:{ grid:{display:false}, ticks:{font:{family:'Inter',size:11,weight:'500'}, color:'#0F172A'} }
      },
      onClick: onClick ? (evt,els)=>{ if(els.length) onClick(labels[els[0].index]); } : undefined,
      onHover: onClick ? (evt,els)=>{ evt.native.target.style.cursor = els.length?'pointer':'default'; } : undefined
    }
  });
}

/* ============================================================
   TABS
   ============================================================ */
Array.from(document.querySelectorAll('.tab-btn')).forEach(btn=>{
  btn.addEventListener('click', ()=>{
    const tab = btn.getAttribute('data-tab');
    Array.from(document.querySelectorAll('.tab-btn')).forEach(b=>b.classList.toggle('active', b===btn));
    Array.from(document.querySelectorAll('.tab-content')).forEach(c=>c.classList.toggle('active', c.getAttribute('data-tab')===tab));
    document.querySelector('.tab-panels')?.classList.toggle('log-view', tab === 'log');
  });
});

document.querySelector('.tab-panels')?.classList.toggle('log-view', document.querySelector('.tab-btn.active')?.getAttribute('data-tab') === 'log');

/* ============================================================
   FILTER BAR WIRING
   ============================================================ */
function syncDropdowns(){
  document.getElementById('fObserver').value = FILTERS.observer;
  document.getElementById('fDesignation').value = FILTERS.designation;
  document.getElementById('fStatus').value = FILTERS.status;
}
function populateDropdowns(){
  const observers = Array.from(new Set(ALL_ROWS.map(r=>r.observer))).sort();
  const designations = Array.from(new Set(ALL_ROWS.map(r=>r.designation))).sort();
  document.getElementById('fObserver').innerHTML = '<option>All</option>' + observers.map(o=>`<option>${escapeHtml(o)}</option>`).join('');
  document.getElementById('fDesignation').innerHTML = '<option>All</option>' + designations.map(d=>`<option>${escapeHtml(d)}</option>`).join('');
}
document.getElementById('fObserver').addEventListener('change', e=>{ FILTERS.observer = e.target.value; renderAll(); });
document.getElementById('fDesignation').addEventListener('change', e=>{ FILTERS.designation = e.target.value; renderAll(); });
document.getElementById('fStatus').addEventListener('change', e=>{ FILTERS.status = e.target.value; renderAll(); });
let searchDebounceTimer = null;
document.getElementById('fSearch').addEventListener('input', e=>{
  const value = e.target.value;
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(()=>{ FILTERS.search = value; renderAll(); }, 200);
});
document.getElementById('clearFiltersBtn').addEventListener('click', ()=>{
  clearTimeout(searchDebounceTimer);
  FILTERS.observer='All'; FILTERS.designation='All'; FILTERS.status='All'; FILTERS.search=''; FILTERS.category=null; FILTERS.location=null; FILTERS.quick=null; FILTERS._sev=null;
  document.getElementById('fSearch').value=''; syncDropdowns(); renderAll();
});

/* ============================================================
   EXPORT (CSV / print-to-PDF) -- reads getFilteredRows(), never writes to
   ALL_ROWS/FILTERS/any chart state. Purely takes what's already on screen
   and serializes it; no calculations beyond the same summary counts renderKpis()
   already performs.
   ============================================================ */
function csvCell(value){
  const s = String(value===null || value===undefined ? '' : value);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g,'""') + '"' : s;
}
function currentFilterSummary(){
  const parts = [];
  if(FILTERS.observer && FILTERS.observer!=='All') parts.push('Observer: '+FILTERS.observer);
  if(FILTERS.designation && FILTERS.designation!=='All') parts.push('Designation: '+FILTERS.designation);
  if(FILTERS.status && FILTERS.status!=='All') parts.push('Status: '+FILTERS.status);
  if(FILTERS.search) parts.push('Search: "'+FILTERS.search+'"');
  if(FILTERS.category) parts.push('Category: '+FILTERS.category);
  if(FILTERS.location) parts.push('Location: '+FILTERS.location);
  if(FILTERS.quick) parts.push('Quick filter: '+FILTERS.quick);
  if(FILTERS._sev) parts.push('Severity: '+(FILTERS._sev==='NA'?'N/A':FILTERS._sev));
  return parts.length ? parts.join(' | ') : 'No filters applied (showing all observations)';
}
function exportToCsv(){
  const rows = getFilteredRows();
  const headers = ['Date','Observer','Designation','Nature','Category','Location','Severity','Status','Findings','Immediate Action','Corrected On Spot','Responsible Person','Corrective Action'];
  const natureLabel = {positive:'Positive', nearmiss:'Near miss', unsafeact:'Unsafe act', unsafecondition:'Unsafe condition'};
  const lines = [headers.map(csvCell).join(',')];
  rows.forEach(r=>{
    const dn = detailedNature(r.type);
    lines.push([
      r.dateObs, r.observer, r.designation, natureLabel[dn] || 'Unsafe', r.category, r.location,
      r.severity===null||r.severity===undefined ? 'N/A' : r.severity, r.status, r.what,
      r.immediateAction, r.correctedOnSpot, r.responsible, r.correctiveAction
    ].map(csvCell).join(','));
  });
  const blob = new Blob(['\uFEFF'+lines.join('\r\n')], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'hse-observations-' + new Date().toISOString().slice(0,10) + '.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
function exportToPdf(){
  const rows = getFilteredRows();
  const natureLabel = {positive:'Positive', nearmiss:'Near miss', unsafeact:'Unsafe act', unsafecondition:'Unsafe condition'};
  const counts = {positive:0, unsafeact:0, unsafecondition:0, nearmiss:0};
  rows.forEach(r=>{ const dn = detailedNature(r.type); if(counts[dn]!==undefined) counts[dn]++; });
  const closed = rows.filter(r=>!isOpenStatus(r.status)).length;
  const closureRate = rows.length ? Math.round(100*closed/rows.length) : 0;
  const logoUrl = new URL('assets/logo.png', window.location.href).href;

  const tableRows = rows.map(r=>{
    const dn = detailedNature(r.type);
    return '<tr>'
      + '<td>' + escapeHtml((r.dateObs||'').split(' ')[0]) + '</td>'
      + '<td>' + escapeHtml(r.observer) + '<br><span class="muted">' + escapeHtml(r.designation) + '</span></td>'
      + '<td>' + escapeHtml(natureLabel[dn] || 'Unsafe') + '</td>'
      + '<td>' + escapeHtml(r.location||'') + '</td>'
      + '<td>' + (r.severity===null||r.severity===undefined ? 'N/A' : escapeHtml(String(r.severity))) + '</td>'
      + '<td>' + escapeHtml(r.status||'') + '</td>'
      + '<td>' + escapeHtml(r.what||'') + '</td>'
      + '</tr>';
  }).join('');

  const doc = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>HSE Observation Export</title><style>'
    + '@page{size:A4 landscape; margin:14mm;}'
    + 'body{font-family:Arial,Helvetica,sans-serif; color:#0F172A; margin:0;}'
    + '.head{display:flex; align-items:center; gap:14px; border-bottom:2px solid #0F172A; padding-bottom:12px; margin-bottom:14px;}'
    + '.head img{height:40px;}'
    + '.head h1{font-size:18px; margin:0;}'
    + '.head p{font-size:11px; color:#475569; margin:2px 0 0;}'
    + '.meta{font-size:10.5px; color:#475569; margin-bottom:14px;}'
    + '.summary{display:flex; gap:18px; margin-bottom:16px; flex-wrap:wrap;}'
    + '.summary div{border:1px solid #E2E8F0; border-radius:8px; padding:8px 14px;}'
    + '.summary b{display:block; font-size:16px;}'
    + '.summary span{font-size:9.5px; text-transform:uppercase; color:#64748B;}'
    + 'table{width:100%; border-collapse:collapse; font-size:9.5px;}'
    + 'th{text-align:left; background:#F6F8FB; padding:6px 8px; border-bottom:1px solid #E2E8F0; text-transform:uppercase; font-size:8.5px; color:#475569;}'
    + 'td{padding:6px 8px; border-bottom:1px solid #EEF1F6; vertical-align:top;}'
    + '.muted{color:#94A3B8; font-size:8.5px;}'
    + '@media print{a{display:none;}}'
    + '</style></head><body>'
    + '<div class="head"><img src="' + logoUrl + '" onerror="this.style.display=\'none\'"><div><h1>HSE Observation Report</h1><p>Bin Quraya Company LTD. &middot; Master Gas System III &middot; Package 05</p></div></div>'
    + '<div class="meta">Generated ' + escapeHtml(new Date().toLocaleString()) + ' &middot; Filters: ' + escapeHtml(currentFilterSummary()) + '</div>'
    + '<div class="summary">'
    + '<div><b>' + fmtNum(rows.length) + '</b><span>Total shown</span></div>'
    + '<div><b>' + fmtNum(counts.positive) + '</b><span>Safe practices</span></div>'
    + '<div><b>' + fmtNum(counts.unsafeact) + '</b><span>Unsafe acts</span></div>'
    + '<div><b>' + fmtNum(counts.unsafecondition) + '</b><span>Unsafe conditions</span></div>'
    + '<div><b>' + fmtNum(counts.nearmiss) + '</b><span>Near misses</span></div>'
    + '<div><b>' + closureRate + '%</b><span>Closure rate</span></div>'
    + '</div>'
    + '<table><thead><tr><th>Date</th><th>Personnel</th><th>Nature</th><th>Location</th><th>Sev</th><th>Status</th><th>Findings</th></tr></thead><tbody>' + tableRows + '</tbody></table>'
    + '</body></html>';

  const win = window.open('', '_blank');
  if(!win){ alert('Please allow pop-ups to export a PDF.'); return; }
  win.document.open();
  win.document.write(doc);
  win.document.close();
  win.onload = () => { win.focus(); win.print(); };
}
document.getElementById('exportCsvBtn')?.addEventListener('click', exportToCsv);
document.getElementById('exportPdfBtn')?.addEventListener('click', exportToPdf);

// Reporting Trend scrub/zoom slider -- a local view control on trendCache only.
// Deliberately does NOT call renderAll()/renderTrend(): those recompute from rows and
// would wipe out whatever window the user just dragged to.
(function(){
  const startInput = document.getElementById('trendSliderStart');
  const endInput = document.getElementById('trendSliderEnd');
  const resetBtn = document.getElementById('trendSliderReset');
  if(!startInput || !endInput) return;
  startInput.addEventListener('input', applyTrendWindow);
  endInput.addEventListener('input', applyTrendWindow);
  if(resetBtn){
    resetBtn.addEventListener('click', ()=>{
      startInput.value = startInput.min;
      endInput.value = endInput.max;
      applyTrendWindow();
    });
  }
})();
const reportModal = document.getElementById('reportModal');
const closeReportModalBtn = document.getElementById('closeReportModal');
const evidenceModal = document.getElementById('evidenceModal');
const closeEvidenceModalBtn = document.getElementById('closeEvidenceModal');
if(reportModal){
  reportModal.addEventListener('click', (event)=>{
    if(event.target === reportModal) closeReportModal();
  });
}
if(closeReportModalBtn){
  closeReportModalBtn.addEventListener('click', closeReportModal);
}
if(evidenceModal){
  evidenceModal.addEventListener('click', (event)=>{
    if(event.target === evidenceModal) closeEvidenceModal();
  });
}
if(closeEvidenceModalBtn){
  closeEvidenceModalBtn.addEventListener('click', closeEvidenceModal);
}
document.addEventListener('click', (event)=>{
  const btn = event.target.closest('.evidence-link');
  if(!btn) return;
  const url = btn.getAttribute('data-url');
  if(url) openEvidenceModal(url);
});
// .panel-maximize-btn buttons, and the panel modal's own close controls, are static
// elements defined once in index.html (not regenerated per render), so they're bound
// here a single time rather than inside renderTable (which re-runs on every filter change).
Array.from(document.querySelectorAll('.panel-maximize-btn')).forEach(btn=>{
  btn.addEventListener('click', (e)=>{
    e.stopPropagation();
    openPanelModal(btn.getAttribute('data-panel-target'));
  });
});
document.getElementById('closePanelModal')?.addEventListener('click', closePanelModal);
document.getElementById('panelModal')?.addEventListener('click', (e)=>{ if(e.target.id === 'panelModal') closePanelModal(); });

document.addEventListener('keydown', (event)=>{
  if(event.key === 'Escape'){
    closeReportModal();
    closeEvidenceModal();
    closePanelModal();
  }
});

/* ============================================================
   LOAD
   ============================================================ */
let refreshTimer = null;
async function loadData(){
  setSync(false, 'Loading data');
  try{
    if(DATA_SOURCE_MODE === 'apps-script'){
      const rows = await loadRowsFromAppsScript();
      applyLoadedRows(rows, 'Source: Apps Script');
    }else if(DATA_SOURCE_MODE === 'direct-sheet'){
      const rows = await loadRowsFromDirectSheet();
      applyLoadedRows(rows, 'Source: Google Sheet');
    }else if(DATA_SOURCE_MODE === 'auto'){
      try{
        const rows = await loadRowsFromAppsScript();
        applyLoadedRows(rows, 'Source: Apps Script (auto)');
      }catch(appsErr){
        try{
          const rows = await loadRowsFromDirectSheet();
          applyLoadedRows(rows, 'Source: Google Sheet (auto fallback)');
        }catch(sheetErr){
          throw new Error(`auto mode failed: Apps Script error: ${appsErr.message}; Direct Sheet error: ${sheetErr.message}`);
        }
      }
    }else{
      throw new Error(`Unsupported DATA_SOURCE_MODE: ${DATA_SOURCE_MODE}. Use "apps-script", "direct-sheet", or "auto".`);
    }
  }catch(err){
    if(!ALL_ROWS.length) ALL_ROWS = [];
    document.getElementById('sourceNote').textContent = 'Source unavailable';
    populateDropdowns(); syncDropdowns(); renderAll();
    setSync(true, 'Live data unavailable');
    showBanner(`<b>Could not load configured source</b> (${err.message}). Current mode: <b>${DATA_SOURCE_MODE}</b>. Check only this mode configuration for Sheet ID ${SHEET_ID}.`);
  }
  document.getElementById('countNote').textContent = fmtNum(ALL_ROWS.length) + ' total observations loaded';
}
loadData();
refreshTimer = setInterval(loadData, REFRESH_MS);

