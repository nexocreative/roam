/* ========================================
   SICILIA 2025 — Travel Journal App
   Persistencia: localStorage (rápido) + Supabase (sync entre dispositivos)
======================================== */

const DAYS = [
  { num: 1, date: '1', label: 'Llegada',     weekday: 'Martes' },
  { num: 2, date: '2', label: 'Día 2',        weekday: 'Miércoles' },
  { num: 3, date: '3', label: 'Día 3',        weekday: 'Jueves' },
  { num: 4, date: '4', label: 'Día 4',        weekday: 'Viernes' },
  { num: 5, date: '5', label: 'Día 5',        weekday: 'Sábado' },
  { num: 6, date: '6', label: 'Día 6',        weekday: 'Domingo' },
  { num: 7, date: '7', label: 'Día 7',        weekday: 'Lunes' },
  { num: 8, date: '8', label: 'Último día',   weekday: 'Martes' },
];

const CAT_ICONS = {
  cultura:     '🏛',
  naturaleza:  '🌿',
  gastronomia: '🍕',
  playa:       '🏖',
  alojamiento: '🏨',
  transporte:  '🚗',
  otro:        '📍',
};

/* ========================================
   SUPABASE INIT
======================================== */
let db = null;
const SUPABASE_READY = (
  typeof SUPABASE_URL !== 'undefined' &&
  typeof SUPABASE_KEY !== 'undefined' &&
  !SUPABASE_URL.includes('PEGA_AQUI') &&
  !SUPABASE_KEY.includes('PEGA_AQUI')
);

if (SUPABASE_READY) {
  db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
}

/* ========================================
   STATE
======================================== */
let state = {
  activeDay: 1,
  days: {},
  markers: {},
};

let map, miniMap, miniMarker;
let formCoords = null;
let editingId = null;

/* ========================================
   SYNC INDICATOR
======================================== */
function setSyncStatus(status) {
  const el = document.getElementById('sync-badge');
  if (!el) return;
  const labels = {
    syncing: '⟳ Sincronizando...',
    ok:      '✓ Sincronizado',
    offline: '⚠ Sin conexión',
    local:   '💾 Solo local',
  };
  el.textContent = labels[status] || '';
  el.className = 'sync-badge sync-' + status;
}

/* ========================================
   PERSISTENCE — localStorage
======================================== */
function saveLocal() {
  localStorage.setItem('sicilia-2026', JSON.stringify(state.days));
  localStorage.setItem('sicilia-active-day', state.activeDay);
}

function loadLocal() {
  const raw = localStorage.getItem('sicilia-2026');
  if (raw) {
    try { state.days = JSON.parse(raw); } catch (e) { state.days = {}; }
  }
  DAYS.forEach(d => {
    if (!state.days[d.num]) state.days[d.num] = { notes: '', places: [], label: d.label };
  });
  const savedDay = parseInt(localStorage.getItem('sicilia-active-day'));
  if (savedDay && DAYS.find(d => d.num === savedDay)) state.activeDay = savedDay;
}

/* ========================================
   PERSISTENCE — Supabase
======================================== */
async function loadFromSupabase() {
  if (!db) return false;
  try {
    setSyncStatus('syncing');
    const { data, error } = await db.from('itinerary').select('*');
    if (error) throw error;
    if (data && data.length > 0) {
      data.forEach(row => {
        const defaultLabel = DAYS.find(d => d.num === row.day_num)?.label || '';
        state.days[row.day_num] = {
          notes:  row.notes  || '',
          places: row.places || [],
          label:  row.label  || defaultLabel,
        };
      });
      DAYS.forEach(d => {
        if (!state.days[d.num]) state.days[d.num] = { notes: '', places: [], label: d.label };
      });
      saveLocal();
      setSyncStatus('ok');
      return true;
    }
    await pushAllToSupabase();
    setSyncStatus('ok');
    return true;
  } catch (err) {
    console.warn('Supabase load error:', err.message);
    setSyncStatus('offline');
    return false;
  }
}

async function pushAllToSupabase() {
  if (!db) return;
  const rows = DAYS.map(d => ({
    day_num: d.num,
    notes:   state.days[d.num]?.notes  || '',
    places:  state.days[d.num]?.places || [],
    label:   state.days[d.num]?.label  || d.label,
  }));
  const { error } = await db.from('itinerary').upsert(rows, { onConflict: 'day_num' });
  if (error) throw error;
}

async function saveDay(dayNum) {
  saveLocal();
  if (!db) { setSyncStatus('local'); return; }
  try {
    setSyncStatus('syncing');
    const { error } = await db.from('itinerary').upsert({
      day_num: dayNum,
      notes:   state.days[dayNum].notes,
      places:  state.days[dayNum].places,
      label:   state.days[dayNum].label || '',
    }, { onConflict: 'day_num' });
    if (error) throw error;
    setSyncStatus('ok');
  } catch (err) {
    console.warn('Supabase save error:', err.message);
    setSyncStatus('offline');
  }
}

// saveState() es la función pública que el resto del código usa
function saveState(dayNum) {
  if (dayNum) {
    saveDay(dayNum);
  } else {
    saveLocal();
    if (db) {
      pushAllToSupabase()
        .then(() => setSyncStatus('ok'))
        .catch(() => setSyncStatus('offline'));
    } else {
      setSyncStatus('local');
    }
  }
}

/* ========================================
   MAIN MAP
======================================== */
function initMap() {
  map = L.map('map', { center: [37.5, 14.0], zoom: 8 });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
  }).addTo(map);

  new ResizeObserver(() => map.invalidateSize()).observe(document.getElementById('map'));
}

function initMiniMap() {
  miniMap = L.map('mini-map', { center: [37.5, 14.0], zoom: 8, zoomControl: false });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(miniMap);
  miniMap.on('click', (e) => {
    formCoords = { lat: e.latlng.lat, lng: e.latlng.lng };
    updateCoordsDisplay();
    placeMiniMarker(formCoords.lat, formCoords.lng);
  });
}

function placeMiniMarker(lat, lng) {
  if (miniMarker) miniMap.removeLayer(miniMarker);
  miniMarker = L.marker([lat, lng]).addTo(miniMap);
  miniMap.setView([lat, lng], 13);
}

function refreshMapMarkers() {
  Object.values(state.markers).forEach(m => map.removeLayer(m));
  state.markers = {};
  DAYS.forEach(day => {
    (state.days[day.num]?.places || []).forEach(place => {
      if (place.coords) addMapMarker(place, day);
    });
  });
}

function addMapMarker(place, day) {
  const icon = CAT_ICONS[place.category] || '📍';
  const markerIcon = L.divIcon({
    className: '',
    html: `<div class="custom-marker ${place.visited ? 'marker-visited' : 'marker-pending'}"><span>${icon}</span></div>`,
    iconSize: [32, 32], iconAnchor: [16, 32], popupAnchor: [0, -34],
  });
  const marker = L.marker([place.coords.lat, place.coords.lng], { icon: markerIcon })
    .addTo(map)
    .bindPopup(`
      <div class="popup-inner">
        <div class="popup-day">Día ${day.num} · ${day.date}</div>
        <div class="popup-name">${icon} ${escHtml(place.name)}</div>
        ${place.category ? `<div class="popup-cat">${formatCategory(place.category)}</div>` : ''}
        ${place.time    ? `<div class="popup-cat">🕐 ${place.time}</div>` : ''}
        ${place.tickets ? `<div class="popup-cat">🎟 Entrada necesaria</div>` : ''}
      </div>`);
  marker.on('click', () => showMapInfo(place, day));
  state.markers[place.id] = marker;
  return marker;
}

function showMapInfo(place, day) {
  const icon = CAT_ICONS[place.category] || '📍';
  document.getElementById('map-info').innerHTML = `
    <div class="map-info-name">${icon} ${escHtml(place.name)}</div>
    <p>Día ${day.num} · ${day.date} · ${day.weekday}</p>
    ${place.notes  ? `<p style="margin-top:4px;font-style:italic">${escHtml(place.notes)}</p>` : ''}
    ${place.tickets ? `<p style="color:var(--gold);font-weight:600;margin-top:4px">🎟 Entrada${place.ticketInfo ? ': ' + escHtml(place.ticketInfo) : ''}</p>` : ''}
  `;
}

function flyToPlace(place) {
  if (!place?.coords) return;
  const m = state.markers[place.id];
  if (m) {
    map.flyTo([place.coords.lat, place.coords.lng], 14, { duration: 1 });
    setTimeout(() => m.openPopup(), 1100);
  }
}

/* ========================================
   UI: DAYS NAV
======================================== */
function renderDaysNav() {
  ['days-nav', 'days-nav-sticky'].forEach(id => {
    const nav = document.getElementById(id);
    if (!nav) return;
    nav.innerHTML = '';
    DAYS.forEach(day => {
      const count = (state.days[day.num]?.places || []).length;
      const btn = document.createElement('button');
      btn.className = `day-tab ${state.activeDay === day.num ? 'active' : ''}`;
      btn.dataset.day = day.num;
      btn.innerHTML = `${count > 0 ? '<span class="tab-dot"></span>' : ''}Día ${day.num}`;
      btn.addEventListener('click', () => setActiveDay(day.num));
      nav.appendChild(btn);
    });
  });
}

function setActiveDay(num) {
  state.activeDay = num;
  localStorage.setItem('sicilia-active-day', num);
  renderDaysNav();
  renderDayHeader();
  renderDaysContent();
  document.querySelector('.main-wrapper').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ========================================
   UI: DAYS CONTENT
======================================== */
function renderDayHeader() {
  const day      = DAYS.find(d => d.num === state.activeDay);
  const dayData  = state.days[day.num];
  const label    = dayData?.label || day.label;
  const bar      = document.getElementById('day-header-bar');

  bar.innerHTML = `
    <div class="day-header">
      <div class="day-info">
        <div class="day-title-row">
          <h2 class="day-title" id="day-title-text">${escHtml(label)}</h2>
          <button class="day-title-edit-btn" id="day-title-edit" title="Editar nombre del día">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
          </button>
        </div>
        <div class="day-date">${day.weekday}, ${day.date} de Julio</div>
      </div>
      <button class="btn-add-place" data-day="${day.num}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
        Añadir lugar
      </button>
    </div>
  `;

  bar.querySelector('.btn-add-place').addEventListener('click', () => openAddModal(day.num));

  bar.querySelector('#day-title-edit').addEventListener('click', () => {
    const titleEl = bar.querySelector('#day-title-text');
    const current = dayData?.label || day.label;
    titleEl.outerHTML = `<input class="day-title-input" id="day-title-input" value="${escHtml(current)}" maxlength="40" />`;
    const input = bar.querySelector('#day-title-input');
    input.focus();
    input.select();
    const save = () => {
      const val = input.value.trim() || day.label;
      if (!state.days[day.num]) state.days[day.num] = { notes: '', places: [] };
      state.days[day.num].label = val;
      saveState(day.num);
      renderDayHeader();
    };
    input.addEventListener('blur', save);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); if (e.key === 'Escape') { input.value = current; input.blur(); } });
  });
}

function renderDaysContent() {
  const container = document.getElementById('days-content');
  container.innerHTML = '';
  DAYS.forEach(day => {
    const dayData = state.days[day.num];
    const places  = dayData?.places || [];
    const card = document.createElement('div');
    card.className = `day-card ${state.activeDay === day.num ? 'active' : ''}`;
    card.id = `day-card-${day.num}`;
    card.innerHTML = `
      <div class="places-list" id="places-${day.num}">
        ${places.length === 0 ? renderEmptyDay() : places.map(p => renderPlaceItem(p, day.num)).join('')}
      </div>
      <div class="day-notes-section">
        <div class="day-notes-label">Notas del día</div>
        <textarea class="day-notes-input" placeholder="Apuntes, anécdotas, consejos..." data-day="${day.num}">${escHtml(dayData?.notes || '')}</textarea>
      </div>
    `;
    container.appendChild(card);
  });
  bindDayCardEvents();
}

function renderEmptyDay() {
  return `<div class="empty-day">
    <div class="empty-icon">✈️</div>
    <p>Todavía no hay lugares para este día.<br>
    Pulsa <strong>Añadir lugar</strong> para empezar a planificar.</p>
  </div>`;
}

function renderPlaceItem(place, dayNum) {
  const icon = CAT_ICONS[place.category] || '📍';
  return `
    <div class="place-item cat-${place.category} ${place.visited ? 'visited' : ''}" id="place-${place.id}">
      <div class="place-top">
        <div style="flex:1;min-width:0">
          <div class="place-meta">
            ${place.time ? `<span class="place-time">🕐 ${place.time}</span>` : ''}
            <span class="place-category-badge">${icon} ${formatCategory(place.category)}</span>
          </div>
          <div class="place-name ${place.visited ? 'visited-name' : ''}">${escHtml(place.name)}</div>
          ${place.notes ? `<div class="place-notes">${escHtml(place.notes)}</div>` : ''}
          <div style="display:flex;flex-wrap:wrap;gap:0">
            ${place.tickets ? `<div class="place-tickets">🎟 Entrada${place.ticketPrice ? ' · ' + escHtml(place.ticketPrice) : ''}${place.ticketWeb ? ` · <a class="ticket-web-link" href="${place.ticketWeb.startsWith('http') ? place.ticketWeb : 'https://' + place.ticketWeb}" target="_blank" rel="noopener">🔗 ${escHtml(urlDisplay(place.ticketWeb))}</a>` : ''}</div>` : ''}
            ${place.coords  ? `<button class="place-location-btn" onclick="flyToPlace(getPlace(${dayNum},'${place.id}'))">🗺 Ver en mapa</button>` : ''}
          </div>
        </div>
        <div class="place-actions">
          <button class="action-btn done-btn"   title="Marcar visitado" onclick="toggleVisited(${dayNum},'${place.id}')">${place.visited ? '↩' : '✓'}</button>
          <button class="action-btn"            title="Editar"          onclick="openEditModal(${dayNum},'${place.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg></button>
          <button class="action-btn delete-btn" title="Eliminar"        onclick="deletePlace(${dayNum},'${place.id}')">✕</button>
        </div>
      </div>
    </div>
  `;
}

function bindDayCardEvents() {
  document.querySelectorAll('.day-notes-input').forEach(ta => {
    let timer;
    ta.addEventListener('input', () => {
      const d = parseInt(ta.dataset.day);
      if (!state.days[d]) state.days[d] = { notes: '', places: [] };
      state.days[d].notes = ta.value;
      clearTimeout(timer);
      timer = setTimeout(() => saveState(d), 800); // debounce 800ms
    });
  });
}

/* ========================================
   PLACE CRUD
======================================== */
function getPlace(dayNum, placeId) {
  return (state.days[dayNum]?.places || []).find(p => p.id === placeId);
}

function toggleVisited(dayNum, placeId) {
  const place = getPlace(dayNum, placeId);
  if (!place) return;
  place.visited = !place.visited;
  saveState(dayNum);
  refreshAfterChange();
}

function deletePlace(dayNum, placeId) {
  showConfirm(() => {
    state.days[dayNum].places = state.days[dayNum].places.filter(p => p.id !== placeId);
    if (state.markers[placeId]) { map.removeLayer(state.markers[placeId]); delete state.markers[placeId]; }
    saveState(dayNum);
    refreshAfterChange();
  });
}

function showConfirm(onOk) {
  const overlay = document.getElementById('confirm-overlay');
  overlay.classList.add('open');
  const ok     = document.getElementById('confirm-ok');
  const cancel = document.getElementById('confirm-cancel');
  const close  = () => overlay.classList.remove('open');
  ok.onclick     = () => { close(); onOk(); };
  cancel.onclick = close;
  overlay.onclick = e => { if (e.target === overlay) close(); };
}

function openEditModal(dayNum, placeId) {
  const place = getPlace(dayNum, placeId);
  if (!place) return;
  editingId = placeId;
  openModal(dayNum, place);
}

function refreshAfterChange() {
  renderDaysNav();
  renderDayHeader();
  renderDaysContent();
  refreshMapMarkers();
  updateStats();
}

/* ========================================
   MODAL
======================================== */
function openAddModal(dayNum) {
  editingId = null;
  formCoords = null;
  openModal(dayNum, null);
}

function openModal(dayNum, placeData) {
  document.getElementById('place-form').reset();
  document.getElementById('form-day').value = dayNum;
  document.getElementById('form-edit-id').value = editingId || '';
  document.getElementById('coords-display').textContent = 'Sin ubicación';
  document.getElementById('form-location-search').value = '';
  document.querySelector('.ticket-info-input').classList.remove('visible');

  if (placeData) {
    document.getElementById('form-name').value      = placeData.name      || '';
    document.getElementById('form-time').value      = placeData.time      || '';
    document.getElementById('form-category').value  = placeData.category  || 'cultura';
    document.getElementById('form-notes').value     = placeData.notes     || '';
    document.getElementById('form-tickets').checked = !!placeData.tickets;
    document.getElementById('form-ticket-price').value = placeData.ticketPrice || '';
    document.getElementById('form-ticket-web').value   = placeData.ticketWeb   || '';
    document.getElementById('form-visited').checked = !!placeData.visited;
    if (placeData.tickets) document.querySelector('.ticket-info-input').classList.add('visible');
    if (placeData.coords) { formCoords = placeData.coords; updateCoordsDisplay(); }
    document.querySelector('.modal-title').textContent = 'Editar Lugar';
  } else {
    document.querySelector('.modal-title').textContent = 'Añadir Lugar';
    formCoords = null;
  }

  document.getElementById('modal-overlay').classList.add('open');

  setTimeout(() => {
    if (!miniMap) {
      initMiniMap();
    } else {
      miniMap.invalidateSize();
    }
    if (formCoords) {
      placeMiniMarker(formCoords.lat, formCoords.lng);
    } else {
      miniMap.setView([37.5, 14.0], 8);
      if (miniMarker) { miniMap.removeLayer(miniMarker); miniMarker = null; }
    }
  }, 50);
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
  editingId = null;
  formCoords = null;
}

document.getElementById('modal-close').addEventListener('click', closeModal);
document.getElementById('btn-cancel').addEventListener('click', closeModal);

document.getElementById('form-tickets').addEventListener('change', e => {
  document.querySelector('.ticket-info-input').classList.toggle('visible', e.target.checked);
});

document.getElementById('btn-location-search').addEventListener('click', () => {
  const query = document.getElementById('form-location-search').value.trim();
  if (query) searchLocation(query);
});

document.getElementById('form-location-search').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); document.getElementById('btn-location-search').click(); }
});

async function searchLocation(query) {
  const btn = document.getElementById('btn-location-search');
  btn.textContent = '...';
  btn.disabled = true;
  try {
    const res  = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query + ' Sicilia Italia')}&limit=1`);
    const data = await res.json();
    if (data.length > 0) {
      formCoords = { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
      updateCoordsDisplay(data[0].display_name);
      placeMiniMarker(formCoords.lat, formCoords.lng);
    } else {
      document.getElementById('coords-display').textContent = 'No encontrado. Prueba otro nombre o haz clic en el mapa.';
    }
  } catch {
    document.getElementById('coords-display').textContent = 'Error de conexión. Inténtalo de nuevo.';
  } finally {
    btn.textContent = 'Buscar';
    btn.disabled = false;
  }
}

function updateCoordsDisplay(name) {
  const el = document.getElementById('coords-display');
  if (formCoords) {
    el.textContent = name
      ? name.substring(0, 60) + (name.length > 60 ? '…' : '')
      : `${formCoords.lat.toFixed(5)}, ${formCoords.lng.toFixed(5)}`;
  } else {
    el.textContent = 'Sin ubicación';
  }
}

document.getElementById('place-form').addEventListener('submit', e => {
  e.preventDefault();
  const dayNum = parseInt(document.getElementById('form-day').value);
  const name   = document.getElementById('form-name').value.trim();
  if (!name) return;

  const place = {
    id:         editingId || `p-${Date.now()}-${Math.random().toString(36).substr(2,5)}`,
    name,
    time:       document.getElementById('form-time').value,
    category:   document.getElementById('form-category').value,
    notes:      document.getElementById('form-notes').value.trim(),
    tickets:      document.getElementById('form-tickets').checked,
    ticketPrice:  document.getElementById('form-ticket-price').value.trim(),
    ticketWeb:    document.getElementById('form-ticket-web').value.trim(),
    visited:    document.getElementById('form-visited').checked,
    coords:     formCoords ? { ...formCoords } : null,
  };

  if (!state.days[dayNum]) state.days[dayNum] = { notes: '', places: [] };

  if (editingId) {
    const idx = state.days[dayNum].places.findIndex(p => p.id === editingId);
    if (idx !== -1) state.days[dayNum].places[idx] = place;
  } else {
    state.days[dayNum].places.push(place);
  }

  saveState(dayNum);
  closeModal();
  refreshAfterChange();
});

/* ========================================
   STATS
======================================== */
function updateStats() {
  let totalPlaces = 0, totalTickets = 0;
  Object.values(state.days).forEach(day => {
    totalPlaces  += (day.places || []).length;
    totalTickets += (day.places || []).filter(p => p.tickets).length;
  });
  document.getElementById('total-places').textContent  = totalPlaces;
  document.getElementById('total-tickets').textContent = totalTickets;
}

/* ========================================
   HELPERS
======================================== */
function escHtml(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function urlDisplay(url) {
  try { return new URL(url.startsWith('http') ? url : 'https://' + url).hostname.replace(/^www\./, ''); }
  catch (e) { return url; }
}

function formatCategory(cat) {
  return { cultura:'Cultura', naturaleza:'Naturaleza', gastronomia:'Gastronomía',
           playa:'Playa', alojamiento:'Alojamiento', transporte:'Transporte', otro:'Otro' }[cat] || cat;
}

/* ========================================
   INIT
======================================== */
async function init() {
  loadLocal();
  initMap();
  renderDaysNav();
  renderDayHeader();
  renderDaysContent();
  refreshMapMarkers();
  updateStats();

  if (SUPABASE_READY) {
    const synced = await loadFromSupabase();
    if (synced) {
      renderDaysNav();
      renderDayHeader();
      renderDaysContent();
      refreshMapMarkers();
      updateStats();
    }
  } else {
    setSyncStatus('local');
  }
}

init();
