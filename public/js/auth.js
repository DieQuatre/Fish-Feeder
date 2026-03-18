const API_BASE = window.location.origin;

// Check if already logged in
document.addEventListener('DOMContentLoaded', () => {
  const token = localStorage.getItem('ff_token');
  if (token) {
    window.location.href = '/dashboard';
    return;
  }
});

// Toggle between login and register
let isLogin = true;
document.getElementById('toggleAuth').addEventListener('click', (e) => {
  e.preventDefault();
  isLogin = !isLogin;

  document.getElementById('loginForm').style.display = isLogin ? 'block' : 'none';
  document.getElementById('registerForm').style.display = isLogin ? 'none' : 'block';
  document.getElementById('toggleLink').innerHTML = isLogin
    ? 'Hesabınız yok mu? <a href="#" id="toggleAuth">Kayıt Ol</a>'
    : 'Zaten hesabınız var mı? <a href="#" id="toggleAuth">Giriş Yap</a>';

  // Re-attach event listener
  document.getElementById('toggleAuth').addEventListener('click', arguments.callee.bind(null, e));

  hideMessages();
});

function showError(msg) {
  const el = document.getElementById('errorMsg');
  el.textContent = msg;
  el.style.display = 'block';
  document.getElementById('successMsg').style.display = 'none';
}

function showSuccess(msg) {
  const el = document.getElementById('successMsg');
  el.textContent = msg;
  el.style.display = 'block';
  document.getElementById('errorMsg').style.display = 'none';
}

function hideMessages() {
  document.getElementById('errorMsg').style.display = 'none';
  document.getElementById('successMsg').style.display = 'none';
}

// Login
document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  hideMessages();

  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;

  if (!username || !password) {
    showError('Kullanıcı adı ve şifre gerekli.');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const data = await res.json();

    if (!res.ok) {
      showError(data.error || 'Giriş başarısız.');
      return;
    }

    localStorage.setItem('ff_token', data.token);
    localStorage.setItem('ff_user', JSON.stringify(data.user));
    window.location.href = '/dashboard';
  } catch (err) {
    showError('Sunucuya bağlanılamadı.');
  }
});

// Register
document.getElementById('registerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  hideMessages();

  const username = document.getElementById('regUsername').value.trim();
  const password = document.getElementById('regPassword').value;
  const passwordConfirm = document.getElementById('regPasswordConfirm').value;

  if (!username || !password || !passwordConfirm) {
    showError('Tüm alanları doldurun.');
    return;
  }

  if (password !== passwordConfirm) {
    showError('Şifreler eşleşmiyor.');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const data = await res.json();

    if (!res.ok) {
      showError(data.error || 'Kayıt başarısız.');
      return;
    }

    localStorage.setItem('ff_token', data.token);
    localStorage.setItem('ff_user', JSON.stringify(data.user));
    window.location.href = '/dashboard';
  } catch (err) {
    showError('Sunucuya bağlanılamadı.');
  }
});
