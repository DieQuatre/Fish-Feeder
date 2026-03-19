const API_BASE = window.location.origin;

// Check if already logged in
document.addEventListener('DOMContentLoaded', () => {
  const token = localStorage.getItem('ff_token');
  if (token) {
    window.location.href = '/dashboard';
    return;
  }
});

// State: 'login', 'register', 'forgot'
let formState = 'login';

function showForm(state) {
  formState = state;
  const loginForm = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');
  const forgotForm = document.getElementById('forgotForm');
  const toggleLink = document.getElementById('toggleLink');
  const forgotLink = document.getElementById('forgotLink');

  loginForm.style.display = 'none';
  registerForm.style.display = 'none';
  forgotForm.style.display = 'none';
  hideMessages();

  if (state === 'login') {
    loginForm.style.display = 'block';
    forgotLink.style.display = 'inline';
    toggleLink.innerHTML = `<span data-i18n="login.noAccount">${t('login.noAccount')}</span> <a href="#" id="toggleAuth" data-i18n="login.register">${t('login.register')}</a>`;
  } else if (state === 'register') {
    registerForm.style.display = 'block';
    forgotLink.style.display = 'none';
    toggleLink.innerHTML = `<span data-i18n="login.hasAccount">${t('login.hasAccount')}</span> <a href="#" id="toggleAuth" data-i18n="login.signin">${t('login.signin')}</a>`;
  } else if (state === 'forgot') {
    forgotForm.style.display = 'block';
    forgotLink.style.display = 'none';
    toggleLink.innerHTML = `<a href="#" id="toggleAuth" data-i18n="login.signin">${t('forgot.backToLogin')}</a>`;
    // Reset forgot steps
    document.getElementById('forgotStep1').style.display = 'block';
    document.getElementById('forgotStep2').style.display = 'none';
    document.getElementById('forgotForm').reset();
  }

  // Re-attach toggle listener
  document.getElementById('toggleAuth').addEventListener('click', (e) => {
    e.preventDefault();
    if (formState === 'login') showForm('register');
    else showForm('login');
  });
}

// Toggle auth
document.getElementById('toggleAuth').addEventListener('click', (e) => {
  e.preventDefault();
  if (formState === 'login') showForm('register');
  else showForm('login');
});

// Forgot password link
document.getElementById('forgotLink').addEventListener('click', (e) => {
  e.preventDefault();
  showForm('forgot');
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
    showError(t('err.usernamePassword'));
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
      showError(data.error || 'Login failed.');
      return;
    }

    localStorage.setItem('ff_token', data.token);
    localStorage.setItem('ff_user', JSON.stringify(data.user));
    window.location.href = '/dashboard';
  } catch (err) {
    showError(t('err.serverDown'));
  }
});

// Register
document.getElementById('registerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  hideMessages();

  const username = document.getElementById('regUsername').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const securityQuestion = document.getElementById('regQuestion').value;
  const securityAnswer = document.getElementById('regAnswer').value.trim();
  const password = document.getElementById('regPassword').value;
  const passwordConfirm = document.getElementById('regPasswordConfirm').value;

  if (!username || !email || !password || !passwordConfirm || !securityQuestion || !securityAnswer) {
    showError(t('err.fillAll'));
    return;
  }
  if (password !== passwordConfirm) {
    showError(t('err.passwordMismatch'));
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password, securityQuestion, securityAnswer })
    });
    const data = await res.json();

    if (!res.ok) {
      showError(data.error || 'Registration failed.');
      return;
    }

    localStorage.setItem('ff_token', data.token);
    localStorage.setItem('ff_user', JSON.stringify(data.user));
    window.location.href = '/dashboard';
  } catch (err) {
    showError(t('err.serverDown'));
  }
});

// Forgot Password Step 1 (Get Question)
document.getElementById('getQuestionBtn').addEventListener('click', async () => {
  hideMessages();
  const identifier = document.getElementById('forgotIdentifier').value.trim();
  if (!identifier) {
    showError(t('err.fillAll'));
    return;
  }

  const btn = document.getElementById('getQuestionBtn');
  btn.disabled = true;

  try {
    const res = await fetch(`${API_BASE}/api/auth/get-security-question`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier })
    });
    const data = await res.json();

    if (!res.ok) {
      showError(data.error || 'Account not found.');
      btn.disabled = false;
      return;
    }

    document.getElementById('displayQuestion').textContent = data.question;
    document.getElementById('forgotStep1').style.display = 'none';
    document.getElementById('forgotStep2').style.display = 'block';
  } catch (err) {
    showError(t('err.serverDown'));
    btn.disabled = false;
  }
});

// Forgot Password Step 2 (Reset Password)
document.getElementById('forgotForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  hideMessages();

  const identifier = document.getElementById('forgotIdentifier').value.trim();
  const answer = document.getElementById('forgotAnswer').value.trim();
  const newPassword = document.getElementById('forgotNewPassword').value;

  if (!answer || !newPassword) {
    showError(t('err.fillAll'));
    return;
  }

  const btn = document.getElementById('resetPasswordBtn');
  btn.disabled = true;

  try {
    const res = await fetch(`${API_BASE}/api/auth/reset-password-security`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, answer, newPassword })
    });
    const data = await res.json();

    if (!res.ok) {
      showError(data.error || 'Failed.');
      btn.disabled = false;
      return;
    }

    showSuccess(data.message || 'Password reset successfully!');
    document.getElementById('forgotForm').reset();
    setTimeout(() => { showForm('login'); }, 2500);
  } catch (err) {
    showError(t('err.serverDown'));
    btn.disabled = false;
  }
});
