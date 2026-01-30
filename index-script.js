let mode = 'login';
const status = document.getElementById('status');

function toggleMode(target) {
    mode = target;
    const title = document.getElementById('main-title');
    const mainBtn = document.getElementById('mainBtn');
    const toggleBtn = document.getElementById('toggle-btn');
    const confirmGroup = document.getElementById('confirm-group');
    const passwordGroup = document.getElementById('password-group');
    const emailGroup = document.getElementById('email-group');

    status.innerText = "";

    if (mode === 'register') {
        title.innerText = "Join Us";
        mainBtn.innerText = "Create Account";
        toggleBtn.innerText = "Back to Login";
        toggleBtn.onclick = () => toggleMode('login');
        confirmGroup.classList.add('hidden');
    } else if (mode === 'reset') {
        title.innerText = "Recover";
        mainBtn.innerText = "Send Reset Link";
        passwordGroup.classList.add('hidden');
        toggleBtn.innerText = "Back to Login";
        toggleBtn.onclick = () => toggleMode('login');
    } else if (mode === 'update') {
        title.innerText = "Update Key";
        mainBtn.innerText = "Set New Password";
        emailGroup.classList.add('hidden');
        confirmGroup.classList.remove('hidden');
        toggleBtn.classList.add('hidden');
    } else {
        title.innerText = "Authorize";
        mainBtn.innerText = "Enter Workspace";
        toggleBtn.innerText = "New Member?";
        toggleBtn.onclick = () => toggleMode('register');
        passwordGroup.classList.remove('hidden');
        emailGroup.classList.remove('hidden');
        confirmGroup.classList.add('hidden');
        toggleBtn.classList.remove('hidden');
    }
}

document.getElementById('mainBtn').onclick = async () => {

    const {
        data: {
            session
        }
    } = await sb.auth.getSession();
    if (session) {
        window.location.href = 'portal.html';
        return; // Stop the login attempt for User B
    }
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const confirm = document.getElementById('confirm-password').value;

    status.innerText = "Processing...";

    if (mode === 'update') {
        if (password !== confirm) {
            status.innerText = "❌ Keys do not match";
            return;
        }
        const {
            error
        } = await sb.auth.updateUser({
            password
        });
        if (error) status.innerText = "❌ " + error.message;
        else {
            status.innerText = "✅ Success!";
            setTimeout(() => toggleMode('login'), 2000);
        }
    } else if (mode === 'reset') {
        const {
            error
        } = await sb.auth.resetPasswordForEmail(email, {
            redirectTo: window.location.origin + '/index.html'
        });
        status.innerText = error ? "❌ " + error.message : "✅ Link Sent!";
    } else if (mode === 'register') {
        const {
            error
        } = await sb.auth.signUp({
            email,
            password
        });
        if (error) status.innerText = "❌ " + error.message;
        else {
            status.innerText = "✅ Account Created!";
            setTimeout(() => toggleMode('login'), 2000);
        }
    } else {
        const {
            error
        } = await sb.auth.signInWithPassword({
            email,
            password
        });
        if (error) status.innerText = "❌ Login Failed";
        else window.location.href = 'portal.html';
    }
};

document.getElementById('magicBtn').onclick = async () => {
    const email = document.getElementById('email').value;
    if (!email) {
        status.innerText = "❌ Email required";
        return;
    }
    const {
        error
    } = await sb.auth.signInWithOtp({
        email,
        options: {
            emailRedirectTo: window.location.origin + '/portal.html'
        }
    });
    status.innerText = error ? "❌ " + error.message : "✅ Check Inbox!";
};

document.getElementById('googleBtn').onclick = async () => {
    await sb.auth.signInWithOAuth({
        provider: 'google',
        options: {
            redirectTo: window.location.origin + '/portal.html'
        }
    });
};

// 1. BROADCAST LISTENER: If another tab logs in, redirect this tab immediately
window.addEventListener('storage', (event) => {
    // Supabase stores auth data in localStorage
    // If the auth token appears or changes, it means a session is now active
    if (event.key && event.key.includes('supabase.auth.token') && event.newValue) {
        console.log("Session detected from another tab. Redirecting...");
        window.location.href = 'portal.html';
    }
});

window.onload = async () => {
    // 1. Check for an existing session immediately
    const {
        data: {
            session
        },
        error
    } = await sb.auth.getSession();

    // 2. If a session exists, redirect to portal.html and stop execution
    if (session && session.user) {
        console.log("Active session detected, redirecting...");
        window.location.href = 'portal.html';
        return;
    }

    // 3. Existing logic for password recovery
    if (window.location.hash.includes("type=recovery")) toggleMode('update');
};

// Auto-fill logic for Invited Clients
window.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    const emailFromUrl = params.get('email');
    const modeFromUrl = params.get('mode');

    // 1. Pre-fill the email field if it exists in URL
    if (emailFromUrl && document.getElementById('email')) {
        document.getElementById('email').value = emailFromUrl;
    }

    // 2. Automatically switch to Register Mode if the link says so
    if (modeFromUrl === 'register') {
        // This targets your existing toggleMode function
        if (typeof toggleMode === 'function') {
            toggleMode('register');
        }
    }
});