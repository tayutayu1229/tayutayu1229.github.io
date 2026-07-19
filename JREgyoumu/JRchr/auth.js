// 輸送障害システム専用の Supabase Authentication ヘルパー。
// パスワードは Auth にのみ保持し、アプリ用テーブルでは照合しません。
(function () {
  const SUPABASE_URL = "https://cgeexdlnpbqslywcbesp.supabase.co";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNnZWV4ZGxucGJxc2x5d2NiZXNwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIwMzU5OTIsImV4cCI6MjA4NzYxMTk5Mn0.KuI5aVvMz2v87EJGviOVw8A5ew8GfzYeqtESIawQmlY";
  const EMAIL_DOMAIN = "tayunet-traininfo.com";
  const ADMIN_EMAILS = new Set([
    "admin@tayunet-traininfo.com",
    "admin.tim@tayunet-traininfo.com"
  ]);

  const client = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  function emailForUserId(userId) {
    const normalized = String(userId || "").trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(normalized)) return null;
    return `${normalized}@${EMAIL_DOMAIN}`;
  }

  async function signIn(userId, password) {
    const email = emailForUserId(userId);
    if (!email) return { error: new Error("invalid_user_id") };
    const result = await client.auth.signInWithPassword({ email, password });
    if (!result.error) localStorage.setItem("incidentUserId", userId.trim());
    return result;
  }

  async function requireUser(options = {}) {
    const { data: { session } } = await client.auth.getSession();
    if (!session) {
      window.location.replace("../JRchrlogin.html");
      return null;
    }
    if (options.adminOnly && !ADMIN_EMAILS.has(session.user.email || "")) {
      alert("この操作には管理者権限が必要です。");
      window.location.replace("JRchr.html");
      return null;
    }
    return session;
  }

  window.incidentAuth = { client, signIn, requireUser, emailForUserId };
})();
