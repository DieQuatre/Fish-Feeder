const API_BASE = window.location.origin;
let currentDevice = null;
let pollInterval = null;
let tokenVisible = false;

// ==================== AUTH CHECK ====================
const token = localStorage.getItem('ff_token');
const user = JSON.parse(localStorage.getItem('ff_user') || 'null');

if (!token || !user) {
  window.location.href = '/';
}

// Set user info in header
document.getElementById('userName').textContent = user?.username || 'Kullanıcı';
document.getElementById('userAvatar').textContent = (user?.username || 'U')[0].toUpperCase();

// ==================== API HELPERS ====================
async function apiGet(url) {
  const res = await fetch(`${API_BASE}${url}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (res.status === 401 || res.status === 403) {
    logout();
    return null;
  }
  return res.json();
}

async function apiPost(url, body = {}) {
  const res = await fetch(`${API_BASE}${url}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(body)
  });
  if (res.status === 401 || res.status === 403) {
    logout();
    return null;
  }
  return res.json();
}

async function apiDelete(url) {
  const res = await fetch(`${API_BASE}${url}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (res.status === 401 || res.status === 403) {
    logout();
    return null;
  }
  return res.json();
}

// ==================== TOAST ====================
function showToast(message, type = 'info') {
  // Remove existing toasts
  document.querySelectorAll('.toast').forEach(t => t.remove());

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  toast.innerHTML = `<span>${icons[type] || ''}</span> ${message}`;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(40px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ==================== LOAD DEVICES ====================
async function loadDevices() {
  const data = await apiGet('/api/devices');
  if (!data) return;

  const devices = data.devices;

  if (devices.length === 0) {
    document.getElementById('noDeviceState').style.display = 'block';
    document.getElementById('deviceDashboard').style.display = 'none';
    currentDevice = null;
    return;
  }

  // Use the first device for now
  currentDevice = devices[0];
  document.getElementById('noDeviceState').style.display = 'none';
  document.getElementById('deviceDashboard').style.display = 'block';

  updateDeviceUI();
  loadFeedHistory();
}

// ==================== UPDATE UI ====================
function updateDeviceUI() {
  if (!currentDevice) return;

  const d = currentDevice;

  // Device name
  document.getElementById('deviceName').textContent = d.name;

  // Token (gizli başla)
  if (!tokenVisible) {
    document.getElementById('deviceToken').textContent = '•'.repeat(d.device_token.length);
  } else {
    document.getElementById('deviceToken').textContent = d.device_token;
  }

  // Online status
  const isOnline = d.is_online === true || d.is_online === 1;
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const lastSeenText = document.getElementById('lastSeenText');

  statusDot.className = `pulse-dot ${isOnline ? 'online' : 'offline'}`;
  statusText.textContent = isOnline ? 'Çevrimiçi' : 'Çevrimdışı';
  statusText.className = isOnline ? 'status-online' : 'status-offline';

  if (d.last_seen) {
    const lastSeen = new Date(d.last_seen + 'Z');
    const diff = Math.floor((Date.now() - lastSeen.getTime()) / 1000);
    if (diff < 60) {
      lastSeenText.textContent = `${diff} saniye önce görüldü`;
    } else if (diff < 3600) {
      lastSeenText.textContent = `${Math.floor(diff / 60)} dakika önce görüldü`;
    } else {
      lastSeenText.textContent = `Son görülme: ${lastSeen.toLocaleString('tr-TR')}`;
    }
  } else {
    lastSeenText.textContent = 'Henüz bağlanmadı';
  }

  // Food level
  const foodLevel = d.food_level_percent;
  const foodBar = document.getElementById('foodBar');
  const foodValue = document.getElementById('foodLevelValue');
  const foodText = document.getElementById('foodLevelText');

  if (foodLevel < 0) {
    foodValue.textContent = '—%';
    foodBar.style.width = '0%';
    foodText.textContent = 'Sensör verisi bekleniyor';
    foodBar.className = 'food-bar-fill';
  } else {
    foodValue.textContent = `%${foodLevel}`;
    foodBar.style.width = `${foodLevel}%`;

    if (foodLevel <= 20) {
      foodBar.className = 'food-bar-fill low';
      foodText.textContent = '⚠️ Yem azaldı! Lütfen yem ekleyin.';
    } else if (foodLevel <= 50) {
      foodBar.className = 'food-bar-fill medium';
      foodText.textContent = 'Yem seviyesi orta.';
    } else {
      foodBar.className = 'food-bar-fill';
      foodText.textContent = 'Yem seviyesi iyi.';
    }
  }
}

// ==================== FEED HISTORY ====================
async function loadFeedHistory() {
  if (!currentDevice) return;

  const data = await apiGet(`/api/devices/${currentDevice.id}/logs`);
  if (!data) return;

  const logs = data.logs;
  const tbody = document.getElementById('feedHistoryBody');
  const emptyState = document.getElementById('emptyHistory');

  if (logs.length === 0) {
    tbody.innerHTML = '';
    emptyState.style.display = 'block';
    document.getElementById('feedCountToday').textContent = '0';
    document.getElementById('feedCountSub').textContent = 'Bugün hiç besleme yapılmadı';
    document.getElementById('lastFeedTime').textContent = '—';
    document.getElementById('lastFeedSub').textContent = 'Henüz besleme yapılmadı';
    return;
  }

  emptyState.style.display = 'none';

  // Count today's feeds
  const today = new Date().toDateString();
  const todayCount = logs.filter(l => new Date(l.fed_at + 'Z').toDateString() === today).length;
  document.getElementById('feedCountToday').textContent = todayCount;
  document.getElementById('feedCountSub').textContent = todayCount > 0
    ? `Bugün ${todayCount} kez beslendi`
    : 'Bugün hiç besleme yapılmadı';

  // Last feed
  const lastFeed = new Date(logs[0].fed_at + 'Z');
  document.getElementById('lastFeedTime').textContent = lastFeed.toLocaleString('tr-TR');

  const diffMs = Date.now() - lastFeed.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 60) {
    document.getElementById('lastFeedSub').textContent = `${diffMin} dakika önce`;
  } else if (diffMin < 1440) {
    document.getElementById('lastFeedSub').textContent = `${Math.floor(diffMin / 60)} saat önce`;
  } else {
    document.getElementById('lastFeedSub').textContent = `${Math.floor(diffMin / 1440)} gün önce`;
  }

  // Build table
  tbody.innerHTML = logs.map(log => {
    const date = new Date(log.fed_at + 'Z').toLocaleString('tr-TR');
    const badgeClass = log.triggered_by === 'auto' ? 'badge-auto' : 'badge-manual';
    const badgeText = log.triggered_by === 'auto' ? 'Otomatik' : 'Manuel';
    return `
      <tr>
        <td>${date}</td>
        <td><span class="badge ${badgeClass}">${badgeText}</span></td>
      </tr>
    `;
  }).join('');
}

// ==================== ACTIONS ====================
async function sendFeedCommand() {
  if (!currentDevice) return;

  const btn = document.getElementById('feedBtn');
  btn.classList.add('feeding');
  btn.textContent = '⏳ Komut gönderiliyor...';

  const data = await apiPost(`/api/devices/${currentDevice.id}/feed`);

  setTimeout(() => {
    btn.classList.remove('feeding');
    btn.textContent = '🐟 Şimdi Besle';
  }, 2000);

  if (data) {
    showToast('Besleme komutu gönderildi!', 'success');
  } else {
    showToast('Komut gönderilemedi.', 'error');
  }
}

function toggleToken() {
  if (!currentDevice) return;
  tokenVisible = !tokenVisible;
  const el = document.getElementById('deviceToken');
  const btn = document.getElementById('toggleTokenBtn');
  if (tokenVisible) {
    el.textContent = currentDevice.device_token;
    btn.textContent = '🙈';
  } else {
    el.textContent = '•'.repeat(currentDevice.device_token.length);
    btn.textContent = '👁️';
  }
}

function copyToken() {
  if (!currentDevice) return;
  navigator.clipboard.writeText(currentDevice.device_token).then(() => {
    showToast('Token panoya kopyalandı!', 'success');
  }).catch(() => {
    showToast('Token kopyalanamadı.', 'error');
  });
}

async function deleteDevice() {
  if (!currentDevice) return;
  if (!confirm(`"${currentDevice.name}" cihazını silmek istediğinize emin misiniz?`)) return;

  const data = await apiDelete(`/api/devices/${currentDevice.id}`);
  if (data) {
    showToast('Cihaz silindi.', 'success');
    currentDevice = null;
    loadDevices();
  }
}

// ==================== ADD DEVICE MODAL ====================
function openAddDeviceModal() {
  document.getElementById('addDeviceModal').classList.add('active');
  document.getElementById('newDeviceName').focus();
}

function closeAddDeviceModal() {
  document.getElementById('addDeviceModal').classList.remove('active');
}

async function addDevice() {
  const name = document.getElementById('newDeviceName').value.trim() || 'Balık Yemleyici';

  const data = await apiPost('/api/devices', { name });
  if (data) {
    showToast(`"${name}" cihazı eklendi! Token: ${data.device.device_token}`, 'success');
    closeAddDeviceModal();
    loadDevices();
  }
}

// Close modal on overlay click
document.getElementById('addDeviceModal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeAddDeviceModal();
});

// ==================== LOGOUT ====================
function logout() {
  localStorage.removeItem('ff_token');
  localStorage.removeItem('ff_user');
  window.location.href = '/';
}

// ==================== POLLING ====================
function startPolling() {
  // Poll every 5 seconds
  pollInterval = setInterval(async () => {
    if (!currentDevice) return;
    const data = await apiGet('/api/devices');
    if (data && data.devices.length > 0) {
      currentDevice = data.devices.find(d => d.id === currentDevice.id) || data.devices[0];
      updateDeviceUI();
      loadFeedHistory();
    }
  }, 5000);
}

// ==================== INIT ====================
document.addEventListener('DOMContentLoaded', () => {
  loadDevices();
  startPolling();
});
