lucide.createIcons();
marked.setOptions({
  highlight: function (code, lang) {
    return hljs.highlightAuto(code).value;
  },
  breaks: true,
  gfm: true,
});
const API_BASE = "https://longflatworm-n8n.cloudfy.live/webhook";
const CHAT_URL = `${API_BASE}/sameka-AgentRag`;
const UPLOAD_URL = `${API_BASE}/sameka-index-drive`;
const SESSIONS_URL = `${API_BASE}/sameka-sessions`;
const HISTORY_URL = `${API_BASE}/sameka-history`;
const DELETE_URL = `${API_BASE}/sameka-session`;
const RESET_URL = `${API_BASE}/sameka-DatabaseSetup`;
const PRUNE_URL = `${API_BASE}/sameka-prune-history`;
const HEALTH_URL = `${API_BASE}/sameka_health`;

let currentSessionId = null;
let sessions = [];
let isLoading = false;
let abortController = null;
let isEditing = false;
let uploadAbortController = null;
let appStarted = false; // Moved to top for hoisting safety
const elements = {
  sessionList: document.getElementById("sessionList"),
  messagesContainer: document.getElementById("messagesContainer"),
  messageInput: document.getElementById("messageInput"),
  sendBtn: document.getElementById("sendBtn"),
  newChatBtn: document.getElementById("newChatBtn"),
  loading: document.getElementById("loading"),
  statusMessage: document.getElementById("statusMessage"),
  attachBtn: document.getElementById("attachBtn"),
  fileInput: document.getElementById("fileInput"),
  themeToggleBtn: document.getElementById("themeToggleBtn"),
  logoutBtn: document.getElementById("logoutBtn"),
  loginOverlay: document.getElementById("loginOverlay"),
  loginForm: document.getElementById("loginForm"),
  emailInput: document.getElementById("emailInput"),
  passwordInput: document.getElementById("passwordInput"),
  loginError: document.getElementById("loginError"),
  loginBtn: document.getElementById("loginBtn"),
  confirmModal: document.getElementById("confirmModal"),
  cancelDeleteBtn: document.getElementById("cancelDeleteBtn"),
  confirmDeleteBtn: document.getElementById("confirmDeleteBtn"),
  resetRagBtn: document.getElementById("resetRagBtn"),
  emptyState: document.getElementById("emptyState"),
  inputForm: document.getElementById("inputForm"),
  userAvatar: document.getElementById("userAvatar"),
  userName: document.getElementById("userName"),
  userRole: document.getElementById("userRole"),
  manageUsersBtn: document.getElementById("manageUsersBtn"),
};

const cancelEditBtn = document.createElement("button");
cancelEditBtn.className = "action-btn";
cancelEditBtn.innerHTML = '<i data-lucide="x"></i>';
cancelEditBtn.title = "Cancelar Edição";
cancelEditBtn.style.display = "none";
cancelEditBtn.style.background = "#f0f0f0";
cancelEditBtn.style.color = "#666";
cancelEditBtn.type = "button";
cancelEditBtn.addEventListener("click", cancelEdit);

elements.sendBtn.parentNode.insertBefore(cancelEditBtn, elements.sendBtn);

const AUTH_CONFIG = {
  SUPABASE_URL: "https://longflatworm-supabase.cloudfy.live",
  SUPABASE_ANON_KEY:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzczNjY1NzE2LCJleHAiOjE4MDUyMDE3MTZ9.nM55mAkSiyvvaIoUACEw4pY4GSJVfvrMX7b1q5JVwyg",
  STORAGE_KEY: "sameka-auth",
  ADMIN_ROLE: "admin",
  DEFAULT_ROLE: "representante",
  ROLE_LABELS: {
    admin: "Administrador",
    representante: "Rep. Vendas",
  },
};

const authStorage = buildAuthStorage();
diagnoseAuthStorage(authStorage, AUTH_CONFIG.STORAGE_KEY);

const supabaseClient = supabase.createClient(
  AUTH_CONFIG.SUPABASE_URL,
  AUTH_CONFIG.SUPABASE_ANON_KEY,
  {
    auth: {
      storage: authStorage,
      storageKey: AUTH_CONFIG.STORAGE_KEY,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
      flowType: "implicit",
      lock: function (_name, _acquireTimeout, fn) {
        return fn();
      },
    },
  },
);

let currentUserRole = null;
let currentUserId = null;
let currentUserMeta = {};

function toggleLogin(loggedIn) {
  if (!elements.loginOverlay) return;
  elements.loginOverlay.style.display = loggedIn ? "none" : "flex";
  if (!loggedIn)
    setTimeout(
      () => elements.emailInput && elements.emailInput.focus(),
      100,
    );
}

function showLoginError(msg) {
  if (!elements.loginError) return;
  elements.loginError.textContent = msg || "E-mail ou senha incorretos.";
  elements.loginError.style.display = "block";
}

function applySession(session) {
  const meta = session.user.user_metadata || {};
  const name = meta.full_name || session.user.email || "Usuário";
  const initials = name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
  currentUserId = session.user.id;
  currentUserRole = meta.role || AUTH_CONFIG.DEFAULT_ROLE;
  currentUserMeta = meta;
  if (elements.userAvatar) elements.userAvatar.textContent = initials;
  if (elements.userName) elements.userName.textContent = name;
  if (elements.userRole)
    elements.userRole.textContent =
      AUTH_CONFIG.ROLE_LABELS[currentUserRole] || currentUserRole;
  applyRoleUI();
}

function applyRoleUI() {
  const isAdmin = currentUserRole === AUTH_CONFIG.ADMIN_ROLE;
  document.querySelectorAll("[data-admin-only]").forEach((el) => {
    el.style.display = isAdmin ? "" : "none";
  });
}

async function handleSession(session) {
  if (!session) {
    toggleLogin(false);
    return;
  }
  applySession(session);
  toggleLogin(true);
  appStarted = false;
  if (typeof window.startApp === "function") {
    window.startApp();
  }
}

async function checkAuth() {
  const {
    data: { session },
  } = await supabaseClient.auth.getSession();
  await handleSession(session);
}

supabaseClient.auth.onAuthStateChange(async (event, session) => {
  if (event === "SIGNED_OUT") {
    toggleLogin(false);
  } else if (event === "SIGNED_IN" && session) {
    await handleSession(session);
  }
});

if (elements.loginForm) {
  elements.loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    elements.loginError.style.display = "none";
    elements.loginBtn.disabled = true;
    const originalText = elements.loginBtn.textContent;
    elements.loginBtn.textContent = "...";
    try {
      const { data, error } =
        await supabaseClient.auth.signInWithPassword({
          email: elements.emailInput.value.trim(),
          password: elements.passwordInput.value,
        });
      if (error) {
        const msg = error.message || "Erro desconhecido";
        if (
          msg.toLowerCase().includes("invalid") ||
          msg.toLowerCase().includes("credentials")
        ) {
          showLoginError("E-mail ou senha incorretos.");
        } else if (msg.toLowerCase().includes("email not confirmed")) {
          showLoginError(
            "E-mail não confirmado. Contate o administrador.",
          );
        } else if (
          msg.toLowerCase().includes("network") ||
          msg.toLowerCase().includes("fetch")
        ) {
          showLoginError("Erro de rede. Verifique sua conexão.");
        } else {
          showLoginError(msg);
        }
        return;
      }
      await handleSession(data.session);
    } catch (err) {
      showLoginError(
        "Erro ao conectar: " + (err.message || "Tente novamente."),
      );
    } finally {
      elements.loginBtn.disabled = false;
      elements.loginBtn.textContent = originalText;
    }
  });
}

if (elements.logoutBtn) {
  elements.logoutBtn.addEventListener("click", async () => {
    await supabaseClient.auth.signOut();
    toggleLogin(false);
    if (elements.emailInput) elements.emailInput.value = "";
    if (elements.passwordInput) elements.passwordInput.value = "";
    clearChatArea();
    elements.sessionList.innerHTML = "";
    sessions = [];
    currentSessionId = null;
    appStarted = false;
    currentUserRole = null;
    currentUserId = null;
  });
}

window.supabaseClient = supabaseClient;
window.AUTH_CONFIG = AUTH_CONFIG;
window.applyRoleUI = applyRoleUI;
window.getCurrentUserRole = () => currentUserRole;
window.getCurrentUserId = () => currentUserId;

checkAuth();

function safeStorageGet(key) {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    return null;
  }
}
function safeStorageSet(key, val) {
  try {
    localStorage.setItem(key, val);
  } catch (e) {}
}

function initTheme() {
  const savedTheme = safeStorageGet("theme") || "light";
  document.documentElement.setAttribute("data-theme", savedTheme);
  updateThemeIcon(savedTheme);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme");
  const next = current === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  safeStorageSet("theme", next);
  updateThemeIcon(next);
}

function updateThemeIcon(theme) {
  elements.themeToggleBtn.innerHTML = "";
  if (theme === "dark") {
    elements.themeToggleBtn.innerHTML = `<i data-lucide="sun" style="width: 14px; height: 14px;"></i><span>Light</span>`;
  } else {
    elements.themeToggleBtn.innerHTML = `<i data-lucide="moon" style="width: 14px; height: 14px;"></i><span>Dark</span>`;
  }
  lucide.createIcons();
}

elements.themeToggleBtn.addEventListener("click", toggleTheme);
initTheme();
let healthCheckInterval = null;

function setOfflineState(isOffline) {
  const statusContainer = document.querySelector(".connection-status");
  const dot = document.querySelector(".connection-dot");
  const text = statusContainer.querySelector("span");

  if (!statusContainer || !dot || !text) return;

  if (isOffline) {
    text.textContent = "Offline";
    statusContainer.style.color = "#f44336";
    statusContainer.style.background = "rgba(244, 67, 54, 0.1)";
    statusContainer.style.borderColor = "rgba(244, 67, 54, 0.2)";
    dot.style.background = "#f44336";
    dot.style.boxShadow = "0 0 5px #f44336";
    dot.style.animation = "none";

    if (!healthCheckInterval) {
      healthCheckInterval = setInterval(checkHealth, 10000); // 10 segundos
    }
  } else {
    text.textContent = "Online";
    statusContainer.style.color = "#4CAF50";
    statusContainer.style.background = "rgba(76, 175, 80, 0.1)";
    statusContainer.style.borderColor = "rgba(76, 175, 80, 0.2)";
    dot.style.background = "#4CAF50";
    dot.style.boxShadow = "0 0 5px #4CAF50";
    dot.style.animation = "pulse 2s infinite";

    if (healthCheckInterval) {
      clearInterval(healthCheckInterval);
      healthCheckInterval = null;
    }
  }
}

async function checkHealth() {
  try {
    const response = await fetch(HEALTH_URL, { cache: "no-store" });
    if (!response.ok) {
      setOfflineState(true);
      return;
    }
    const data = await response.json();
    if (data && data.status === "ok") {
      setOfflineState(false);
    } else {
      setOfflineState(true);
    }
  } catch (error) {
    setOfflineState(true);
  }
}

const originalFetch = window.fetch;
window.fetch = async function (...args) {
  let url = "";
  if (typeof args[0] === "string") {
    url = args[0];
  } else if (args[0] && args[0].url) {
    url = args[0].url;
  }

  try {
    const response = await originalFetch(...args);
    if (url.startsWith(API_BASE) && !url.includes("sameka_health")) {
      if (response.ok) {
        setOfflineState(false);
      } else if (response.status >= 500) {
        setOfflineState(true);
      }
    }
    return response;
  } catch (error) {
    if (url.startsWith(API_BASE) && !url.includes("sameka_health")) {
      if (error.name !== "AbortError") {
        setOfflineState(true);
      }
    }
    throw error;
  }
};

async function fetchSessions() {
  try {
    const uid = currentUserId || "";
    const sessionsUrlWithUser = `${SESSIONS_URL}?userId=${encodeURIComponent(uid)}`;
    const response = await fetch(sessionsUrlWithUser, {
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error("Failed to fetch sessions");
    }

    const text = await response.text();
    if (!text || text.trim().length === 0) {
      return [];
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return [];
    }

    if (data && !Array.isArray(data)) {
      return [data];
    }
    return Array.isArray(data) ? data : [];
  } catch (error) {
    return [];
  }
}
async function fetchHistory(sessionId) {
  try {
    const response = await fetch(`${HISTORY_URL}?sessionId=${sessionId}`);
    if (!response.ok) throw new Error("Failed to fetch history");

    const text = await response.text();
    if (!text || text.trim().length === 0) {
      return [];
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return [];
    }

    return data.map((item) => {
      let processedItem = item;

      if (item.message) {
        processedItem = {
          id: item.id, // Preserve ID from DB
          role: item.message.type === "human" ? "user" : "assistant",
          content: item.message.content || "",
          timestamp:
            item.created_at || item.message.timestamp || item.timestamp,
        };
      }

      const legacyMatch =
        processedItem.content &&
        processedItem.content.match(/^Enviando arquivo: (.+)$/);
      const newMatch =
        processedItem.content &&
        processedItem.content.match(
          /^Arquivo (.+) enviado para an?lise\.$/,
        );

      if ((legacyMatch || newMatch) && processedItem.role === "user") {
        processedItem.file = newMatch ? newMatch[1] : legacyMatch[1];
      }

      if (processedItem.content && processedItem.role === "user") {
        processedItem.content = processedItem.content.replace(
          /^\s*\[CONTEXTO[^\]]*\]\s*/i,
          "",
        );
      }

      return processedItem;
    });
  } catch (error) {
    return [];
  }
}
async function deleteSession(sessionId) {
  try {
    const response = await fetch(`${DELETE_URL}?sessionId=${sessionId}`, {
      method: "DELETE",
    });
    if (!response.ok) throw new Error("Failed to delete session");
    return true;
  } catch (error) {
    return false;
  }
}
async function resetRagDatabase() {
  try {
    const response = await fetch(RESET_URL, {
      method: "POST",
    });

    if (!response.ok) throw new Error("Failed to reset database");

    const text = await response.text();
    if (!text || text.trim().length === 0) {
      return {
        status: "success",
        message: "Resetado com sucesso (Sem retorno do servidor)",
      };
    }

    try {
      return JSON.parse(text);
    } catch (e) {
      return { status: "success", message: "Resetado com sucesso!" }; // Assume success if 200 OK
    }
  } catch (error) {
    return null;
  }
}
async function sendMessage(message, sessionId, onChunk) {
  abortController = new AbortController();
  try {
    const userName = currentUserMeta.full_name || "";
    const userRole = currentUserRole || "representante";
    const userEstados =
      (currentUserMeta.estados || []).join(", ") || "Nacional";
    const userCidades =
      (currentUserMeta.cidades || []).join(", ") || "Todas";
    const userContext = `[CONTEXTO DO USUÁRIO: Nome="${userName}" | Papel="${userRole}" | Estados="${userEstados}" | Cidades="${userCidades}" | ID="${currentUserId || ""}"]\n\n`;

    const response = await fetch(CHAT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chatInput: userContext + message,
        sessionId: sessionId,
        userId: currentUserId || "",
      }),
      signal: abortController.signal,
    });

    if (!response.ok) throw new Error("Failed to send message");

    const contentType = response.headers.get("content-type");
    if (contentType && contentType.includes("application/json")) {
      const rawText = await response.text();
      if (!rawText || rawText.trim().length === 0) {
        return "Sem resposta do servidor.";
      }
      try {
        const data = JSON.parse(rawText);
        const extracted =
          data.output ||
          data.message ||
          data.text ||
          data.response ||
          data.content ||
          data.result ||
          (data.data &&
            (data.data.output || data.data.message || data.data.text)) ||
          null;
        if (
          extracted &&
          typeof extracted === "string" &&
          extracted.trim().length > 0
        ) {
          return extracted;
        }
        const keys = Object.keys(data);
        if (keys.length === 1 && typeof data[keys[0]] === "string") {
          return data[keys[0]];
        }
        return JSON.stringify(data, null, 2);
      } catch (parseErr) {
        return rawText;
      }
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = "";
    let isSSE = false; // Track if stream uses SSE format

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });

      const lines = chunk.split("\n");
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          isSSE = true; // Mark as SSE stream
          if (line.trim() === "data: [DONE]") continue;
          try {
            const data = JSON.parse(line.slice(6));
            const newText =
              data.output || data.message || data.text || "";
            if (newText) {
              if (
                newText.length >= fullText.length &&
                newText.startsWith(fullText)
              ) {
                fullText = newText; // Replace (snapshot mode)
              } else if (fullText.endsWith(newText)) {
              } else {
                fullText += newText; // Delta mode (append)
              }
            }
          } catch (e) {
            const rawData = line.slice(6).replace(/\\n/g, "\n");
            if (rawData && !fullText.endsWith(rawData)) {
              fullText += rawData;
            }
          }
        } else if (line.trim() !== "" && !isSSE) {
          if (
            !line.startsWith("event: ") &&
            !line.startsWith("id: ") &&
            !line.startsWith("retry: ")
          ) {
            fullText += line.replace(/\\n/g, "\n");
          }
        }
      }
      if (onChunk) onChunk(fullText);
    }

    return fullText || "Resposta recebida";
  } catch (error) {
    if (error.name === "AbortError") {
      return "Geração cancelada.";
    }
    return "Desculpe, ocorreu um erro ao processar sua mensagem.";
  } finally {
    abortController = null;
  }
}
function generateUUID() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(
    /[xy]/g,
    function (c) {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    },
  );
}
function formatDate(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const diffInHours = (now - date) / (1000 * 60 * 60);
  if (diffInHours < 24) {
    return date.toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } else if (diffInHours < 48) {
    return "Ontem";
  } else {
    return date.toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
    });
  }
}
function renderSessionList() {
  elements.sessionList.innerHTML = "";
  if (sessions.length === 0) {
    elements.sessionList.innerHTML =
      '<div style="color: #999; text-align: center; padding: 20px; font-size: 12px;">Nenhuma conversa ainda</div>';
    return;
  }
  sessions.forEach((session) => {
    const sessionDiv = document.createElement("div");
    sessionDiv.className = "session-item";
    if (session.session_id === currentSessionId) {
      sessionDiv.classList.add("active");
    }

    let titulo = "Nova conversa";
    if (session.titulo) {
      if (typeof session.titulo === "object" && session.titulo.content) {
        titulo = session.titulo.content;
      } else if (typeof session.titulo === "string") {
        titulo = session.titulo;
      }
    }
    titulo = titulo.replace(/^\[CONTEXTO[^\]]*\]\s*/i, "");

    sessionDiv.innerHTML = `
<div class="session-content">
<div class="session-title">${titulo}</div>
<div class="session-date">${formatDate(session.data_inicio)}</div>
</div>
<button class="delete-btn" onclick="handleDeleteSession('${session.session_id}', event)">
<i data-lucide="x"></i>
</button>
`;
    sessionDiv.addEventListener("click", (e) => {
      if (!e.target.classList.contains("delete-btn")) {
        loadSession(session.session_id);
      }
    });
    elements.sessionList.appendChild(sessionDiv);
  });
  lucide.createIcons();
}
function startEdit(messageDiv, content) {
  isEditing = true;
  elements.messageInput.value = content;
  elements.messageInput.focus();

  elements.messageInput.style.height = "auto";
  elements.messageInput.style.height =
    elements.messageInput.scrollHeight + "px";

  cancelEditBtn.style.display = "flex";

  const msgId = messageDiv.getAttribute("data-id");
  const msgTimestamp = messageDiv.getAttribute("data-timestamp");

  elements.inputForm.dataset.editingId = msgId || msgTimestamp;
  elements.inputForm.dataset.editingType = msgId ? "id" : "timestamp";

  setStatus("Editando mensagem...", "warning");
}

function cancelEdit() {
  if (!isEditing) return;

  isEditing = false;
  elements.messageInput.value = "";
  elements.messageInput.style.height = "auto";
  cancelEditBtn.style.display = "none";
  elements.inputForm.removeAttribute("data-editingId");
  setStatus("");
}

async function pruneHistoryFrom(identifier) {
  const type = elements.inputForm.dataset.editingType || "timestamp";
  const value = parseInt(identifier);
  if (!value) return;

  let targetMsg;
  if (type === "id") {
    targetMsg = Array.from(elements.messagesContainer.children).find(
      (m) => m.getAttribute("data-id") == value,
    );
  } else {
    targetMsg = Array.from(elements.messagesContainer.children).find(
      (m) => m.getAttribute("data-timestamp") == value,
    );
  }

  if (targetMsg) {
    let current = targetMsg;
    while (current) {
      const next = current.nextElementSibling;
      current.remove();
      current = next;
    }
  }

  if (currentSessionId && type === "id") {
    try {
      const payload = {
        sessionId: currentSessionId,
        id: value,
      };

      await fetch(PRUNE_URL, {
        method: "POST",
        body: JSON.stringify(payload),
        headers: { "Content-Type": "application/json" },
      });
    } catch (e) {
    }
  } else if (type !== "id") {
  }
}

function getSocialIcon(url) {
  if (!url) return "globe";
  const u = url.toLowerCase();
  if (u.includes("instagram")) return "instagram";
  if (u.includes("facebook") || u.includes("fb.com")) return "facebook";
  if (u.includes("linkedin")) return "linkedin";
  if (u.includes("twitter") || u.includes("x.com")) return "twitter";
  if (u.includes("tiktok")) return "video";
  if (u.includes("youtube")) return "youtube";
  if (u.includes("wa.me") || u.includes("whatsapp"))
    return "message-circle";
  return "globe";
}
function getSocialLabel(url) {
  if (!url) return "Link";
  const u = url.toLowerCase();
  if (u.includes("instagram")) return "Instagram";
  if (u.includes("facebook") || u.includes("fb.com")) return "Facebook";
  if (u.includes("linkedin")) return "LinkedIn";
  if (u.includes("twitter") || u.includes("x.com")) return "X/Twitter";
  if (u.includes("tiktok")) return "TikTok";
  if (u.includes("youtube")) return "YouTube";
  if (u.includes("wa.me") || u.includes("whatsapp")) return "WhatsApp";
  return "Site";
}
function getScoreClass(c) {
  if (!c) return "lead-score-default";
  const cl = c.toUpperCase();
  if (cl === "A") return "lead-score-a";
  if (cl === "B") return "lead-score-b";
  if (cl === "C") return "lead-score-c";
  return "lead-score-default";
}
function getSocialClass(url) {
  if (!url) return "";
  const u = url.toLowerCase();
  if (u.includes("instagram")) return "social-instagram";
  if (u.includes("facebook") || u.includes("fb.com"))
    return "social-facebook";
  if (u.includes("wa.me") || u.includes("whatsapp"))
    return "social-whatsapp";
  if (u.includes("linkedin")) return "social-linkedin";
  if (u.includes("tiktok")) return "social-tiktok";
  if (u.includes("youtube")) return "social-youtube";
  return "";
}
const MISMATCH_KEYWORDS = [
  "veículo",
  "veiculo",
  "veiculos",
  "mecânica",
  "mecanica",
  "oficina",
  "restaurante",
  "bar ",
  "advocacia",
  "advogado",
  "clínica",
  "clinica",
  "construtora",
  "construção",
  "engenharia",
  "contabilidade",
  "açougue",
  "padaria",
  "farmácia",
  "farmacia",
  "posto de gasolina",
  "combustível",
  "combustivel",
  "supermercado",
  "autopeças",
  "autopecas",
  "fora do perfil",
];
function isMismatch(lead) {
  const text = (
    (lead.empresa || "") +
    " " +
    (lead.natureza || "") +
    " " +
    (lead.matchSameka || "") +
    " " +
    (lead.dicaAbordagem || "")
  ).toLowerCase();
  return MISMATCH_KEYWORDS.some((kw) => text.includes(kw));
}

function renderLeadCards(leads) {
  if (!leads || !leads.length) return "";
  let html = '<div class="lead-cards-container">';
  leads.forEach((lead, idx) => {
    const hasImages = lead.imagens && lead.imagens.length > 0;
    const hasPhones = lead.telefones && lead.telefones.length > 0;
    const hasEmails = lead.emails && lead.emails.length > 0;
    const hasSocial = lead.redesSociais && lead.redesSociais.length > 0;
    const hasScore =
      lead.score &&
      (lead.score.nota !== null || lead.score.classificacao);
    const mismatch = isMismatch(lead);
    const presenceHtml =
      lead.possuiPresencaDigital === "SIM"
        ? '<span class="lead-presence-yes">● Digital</span>'
        : '<span class="lead-presence-no">● Sem presença</span>';
    const tagClass = mismatch
      ? "lead-match-tag tag-mismatch"
      : "lead-match-tag";
    html += `
          <div class="lead-card${mismatch ? " lead-mismatch" : ""}" data-carousel-idx="0">
              <div class="lead-card-header" onclick="this.parentElement.classList.toggle('open')">
                  <div class="lead-card-header-left">
                      <div class="lead-card-header-top">
                          <div class="lead-card-icon"><i data-lucide="${mismatch ? "alert-triangle" : "store"}"></i></div>
                          <span class="lead-card-title">${lead.empresa || "Empresa"}</span>
                      </div>
                      <div class="lead-card-tags">
                          ${lead.matchSameka ? `<span class="${tagClass}">${mismatch ? "⚠ " : ""}${lead.matchSameka}</span>` : ""}
                          ${presenceHtml}
                      </div>
                  </div>
                  <i data-lucide="chevron-down" class="lead-chevron" style="width:18px;height:18px"></i>
              </div>
              <div class="lead-card-body">`;
    if (mismatch) {
      html += `<div class="lead-mismatch-banner">
                  <i data-lucide="alert-triangle"></i>
                  <span>Empresa fora do perfil ideal Sameka — baixa prioridade de abordagem</span>
              </div>`;
    }
    if (lead.endereco) {
      html += `<div class="lead-section">
                  <div class="lead-section-label"><i data-lucide="map-pin"></i> Endereço</div>
                  <div class="lead-address">${lead.endereco}</div>
              </div>`;
    }
    if (lead.dicaAbordagem) {
      html += `<div class="lead-section">
                  <div class="lead-section-label"><i data-lucide="lightbulb"></i> Dica de Abordagem</div>
                  <div class="lead-tip">${lead.dicaAbordagem}</div>
              </div>`;
    }
    if (hasPhones || hasEmails) {
      html += `<div class="lead-section">
                  <div class="lead-section-label"><i data-lucide="contact"></i> Contatos</div>
                  <div class="lead-badges">`;
      if (hasPhones)
        lead.telefones.forEach((t) => {
          html += `<a href="tel:${t.replace(/\D/g, "")}" class="lead-badge"><i data-lucide="phone"></i>${t}</a>`;
        });
      if (hasEmails)
        lead.emails.forEach((e) => {
          html += `<a href="mailto:${e}" class="lead-badge"><i data-lucide="mail"></i>${e}</a>`;
        });
      html += `</div></div>`;
    }
    if (hasSocial) {
      html += `<div class="lead-section">
                  <div class="lead-section-label"><i data-lucide="share-2"></i> Redes Sociais</div>
                  <div class="lead-social-links">`;
      lead.redesSociais.forEach((s) => {
        html += `<a href="${s}" target="_blank" rel="noopener" class="lead-social-link ${getSocialClass(s)}"><i data-lucide="${getSocialIcon(s)}"></i>${getSocialLabel(s)}</a>`;
      });
      html += `</div></div>`;
    }
    if (hasImages) {
      const cid = `carousel-${idx}-${Date.now()}`;
      html += `<div class="lead-section">
                  <div class="lead-section-label"><i data-lucide="image"></i> Imagens</div>
                  <div class="lead-carousel" id="${cid}">
                      <div class="lead-carousel-track">`;
      lead.imagens.forEach((img) => {
        html += `<div class="lead-carousel-slide"><img src="${img}" alt="Foto" loading="lazy" onerror="this.parentElement.style.display='none'"></div>`;
      });
      html += `</div>`;
      if (lead.imagens.length > 1) {
        html += `<button class="lead-carousel-btn lead-carousel-prev" onclick="moveCarousel('${cid}',-1)"><i data-lucide="chevron-left" style="width:16px;height:16px"></i></button>`;
        html += `<button class="lead-carousel-btn lead-carousel-next" onclick="moveCarousel('${cid}',1)"><i data-lucide="chevron-right" style="width:16px;height:16px"></i></button>`;
        html += `<div class="lead-carousel-dots">`;
        lead.imagens.forEach((_, i) => {
          html += `<div class="lead-carousel-dot${i === 0 ? " active" : ""}" onclick="goToSlide('${cid}',${i})"></div>`;
        });
        html += `</div>`;
      }
      html += `</div></div>`;
    }
    if (hasScore) {
      const sc = lead.score;
      const cls = getScoreClass(sc.classificacao);
      html += `<div class="lead-section">
                  <div class="lead-section-label"><i data-lucide="award"></i> Score</div>
                  <span class="lead-score-badge ${cls}">
                      ${sc.classificacao ? sc.classificacao : "—"}${sc.nota !== null ? " · " + sc.nota + " pts" : ""}${sc.descricao ? " — " + sc.descricao : ""}
                  </span>
              </div>`;
    }
    if (lead.natureza) {
      html += `<div class="lead-section">
                  <div class="lead-section-label"><i data-lucide="building-2"></i> Natureza</div>
                  <div style="font-size:0.85rem;color:var(--text-secondary)">${lead.natureza}</div>
              </div>`;
    }
    html += `</div></div>`;
  });
  html += "</div>";
  return html;
}

function moveCarousel(cid, dir) {
  const el = document.getElementById(cid);
  if (!el) return;
  const track = el.querySelector(".lead-carousel-track");
  const slides = track.querySelectorAll(".lead-carousel-slide");
  let idx = parseInt(el.dataset.idx || "0") + dir;
  if (idx < 0) idx = slides.length - 1;
  if (idx >= slides.length) idx = 0;
  el.dataset.idx = idx;
  track.style.transform = `translateX(-${idx * 100}%)`;
  el.querySelectorAll(".lead-carousel-dot").forEach((d, i) =>
    d.classList.toggle("active", i === idx),
  );
}
function goToSlide(cid, idx) {
  const el = document.getElementById(cid);
  if (!el) return;
  el.dataset.idx = idx;
  el.querySelector(".lead-carousel-track").style.transform =
    `translateX(-${idx * 100}%)`;
  el.querySelectorAll(".lead-carousel-dot").forEach((d, i) =>
    d.classList.toggle("active", i === idx),
  );
}

function processLeadBlocks(container) {
  const codeBlocks = container.querySelectorAll(
    "code.language-sameka-leads",
  );
  codeBlocks.forEach((code) => {
    const pre = code.closest("pre");
    if (!pre) return;
    try {
      const json = JSON.parse(code.textContent);
      if (Array.isArray(json) && json.length > 0) {
        const wrapper = document.createElement("div");
        wrapper.innerHTML = renderLeadCards(json);
        pre.replaceWith(wrapper);
        lucide.createIcons();
      }
    } catch (e) {
    }
  });
}

function processInfoSections(container) {
  const headings = container.querySelectorAll("h3");
  headings.forEach((h3) => {
    const text = h3.textContent.toLowerCase();
    let boxClass = "";
    let icon = "";
    if (
      text.includes("inteligência") ||
      text.includes("intelig") ||
      text.includes("pré-visita")
    ) {
      boxClass = "info-box-intel";
      icon = "💎";
    } else if (
      text.includes("argumento") ||
      text.includes("autoridade") ||
      text.includes("negociação")
    ) {
      boxClass = "info-box-authority";
      icon = "🧠";
    }
    if (!boxClass) return;

    const box = document.createElement("div");
    box.className = `sameka-info-box ${boxClass}`;
    const title = document.createElement("h4");
    const cleanText = h3.textContent
      .replace(
        /^[\s\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]+/u,
        "",
      )
      .trim();
    title.textContent = `${icon} ${cleanText}`;
    box.appendChild(title);

    const siblings = [];
    let next = h3.nextElementSibling;
    while (next && !["H2", "H3", "HR"].includes(next.tagName)) {
      siblings.push(next);
      next = next.nextElementSibling;
    }
    siblings.forEach((s) => box.appendChild(s.cloneNode(true)));
    siblings.forEach((s) => s.remove());
    h3.replaceWith(box);
  });
}
function renderMessage(message) {
  hideEmptyState(); // Ensure empty state is gone
  const messageDiv = document.createElement("div");
  messageDiv.className = `message ${message.role}`;
  if (message.id) messageDiv.setAttribute("data-id", message.id);

  const timestamp = message.timestamp
    ? new Date(message.timestamp).getTime()
    : Date.now();
  messageDiv.setAttribute("data-timestamp", timestamp);

  const avatarDiv = document.createElement("div");
  avatarDiv.className = "message-avatar";

  if (message.role === "user") {
    avatarDiv.innerHTML = '<i data-lucide="user"></i>';
  } else {
    avatarDiv.innerHTML = '<i data-lucide="bot"></i>';
  }

  const content = document.createElement("div");
  content.className = "message-content";

  let editBtn = null;

  if (message.role === "assistant") {
    content.innerHTML = marked.parse(message.content || "");

    content.querySelectorAll("a").forEach((link) => {
      link.setAttribute("target", "_blank");
      link.setAttribute("rel", "noopener noreferrer");
    });

    processLeadBlocks(content);
    processInfoSections(content);
  } else {
    if (message.file) {
    } else {
      const cleanContent = (message.content || "").replace(/^\s*\[CONTEXTO[^\]]*\]\s*/i, "");
      content.textContent = cleanContent;

      editBtn = document.createElement("button");
      editBtn.className = "btn-edit";
      editBtn.innerHTML =
        '<i data-lucide="pencil" style="width: 14px; height: 14px;"></i>';
      editBtn.onclick = () => {
        startEdit(messageDiv, cleanContent);
      };
    }
  }

  if (message.file) {
    const fileDiv = document.createElement("div");
    fileDiv.className = "file-attachment";
    fileDiv.innerHTML = `<i data-lucide="file"></i><span>${message.file}</span>`;
    content.appendChild(fileDiv);
  }

  if (message.role === "assistant") {
    messageDiv.appendChild(avatarDiv);
    messageDiv.appendChild(content);
  } else {
    messageDiv.appendChild(avatarDiv);
    messageDiv.appendChild(content);
    if (editBtn) {
      messageDiv.appendChild(editBtn);
    }
  }

  elements.messagesContainer.appendChild(messageDiv);
  elements.messagesContainer.scrollTop =
    elements.messagesContainer.scrollHeight;
  lucide.createIcons();

  return messageDiv;
}
function clearChatArea() {
  elements.messagesContainer.innerHTML = "";
  showEmptyState();
}

function showEmptyState() {
  if (elements.emptyState) {
    elements.emptyState.classList.add("show");
    elements.messagesContainer.style.display = "none";
    lucide.createIcons();
  }
}

function hideEmptyState() {
  if (elements.emptyState) {
    elements.emptyState.classList.remove("show");
    elements.messagesContainer.style.display = "block";
  }
}

function showSkeletonSessions() {
  elements.sessionList.innerHTML = "";
  for (let i = 0; i < 3; i++) {
    const skeletonDiv = document.createElement("div");
    skeletonDiv.className = "skeleton-session";
    skeletonDiv.innerHTML = `
<div class="skeleton skeleton-session-title"></div>
<div class="skeleton skeleton-session-date"></div>
`;
    elements.sessionList.appendChild(skeletonDiv);
  }
}

function showSkeletonMessages() {
  hideEmptyState(); // Ensure empty state is hidden so skeletons show
  elements.messagesContainer.innerHTML = "";
  for (let i = 0; i < 3; i++) {
    const skeletonDiv = document.createElement("div");
    skeletonDiv.className = "skeleton-message";
    skeletonDiv.innerHTML = `
<div class="skeleton skeleton-avatar"></div>
<div class="skeleton-content">
<div class="skeleton skeleton-text"></div>
<div class="skeleton skeleton-text"></div>
<div class="skeleton skeleton-text"></div>
</div>
`;
    elements.messagesContainer.appendChild(skeletonDiv);
  }
}

function showTypingIndicator() {
  const typingDiv = document.createElement("div");
  typingDiv.className = "typing-indicator";
  typingDiv.id = "typingIndicator";
  typingDiv.innerHTML = `
<div class="message-avatar">
<i data-lucide="bot"></i>
</div>
<div class="typing-dots">
<span></span>
<span></span>
<span></span>
</div>
`;
  elements.messagesContainer.appendChild(typingDiv);
  elements.messagesContainer.scrollTop =
    elements.messagesContainer.scrollHeight;
  lucide.createIcons();
}

function hideTypingIndicator() {
  const typingIndicator = document.getElementById("typingIndicator");
  if (typingIndicator) {
    typingIndicator.remove();
  }
}

function setLoading(loading) {
  isLoading = loading;
  const sendBtnIcon = elements.sendBtn.querySelector("i");

  if (loading) {
    elements.sendBtn.innerHTML = "";
    const stopIcon = document.createElement("i");
    stopIcon.setAttribute("data-lucide", "square");
    stopIcon.style.fill = "white";
    elements.sendBtn.appendChild(stopIcon);
    elements.sendBtn.style.backgroundColor = "var(--text-secondary)";
    elements.sendBtn.title = "Parar Geração";
  } else {
    elements.sendBtn.innerHTML = '<i data-lucide="send"></i>';
    elements.sendBtn.style.backgroundColor = "";
    elements.sendBtn.title = "Enviar";
  }
  lucide.createIcons();

  elements.loading.classList.toggle("show", loading);

  const interactiveElements = [
    elements.messageInput,
    elements.resetRagBtn,
    elements.attachBtn,
    elements.fileInput,
  ];

  interactiveElements.forEach((el) => {
    if (el) el.disabled = loading;
  });

  if (pendingAction === "resetProcessing") {
    if (loading && elements.resetRagBtn) {
      elements.resetRagBtn.innerHTML = `<i data-lucide="loader-2" class="animate-spin" style="width:12px; height:12px;"></i><span>Resetando...</span>`;
    } else if (!loading && elements.resetRagBtn) {
      elements.resetRagBtn.innerHTML = `<i data-lucide="database-backup" style="width:12px; height:12px;"></i><span>Resetar</span>`;
      pendingAction = null;
    }
    lucide.createIcons();
  }

  document.body.style.cursor = loading ? "wait" : "default";
}

function setStatus(message, type = "") {
  elements.statusMessage.textContent = message;
  elements.statusMessage.style.color =
    type === "error"
      ? "#d32f2f"
      : type === "success"
        ? "#388e3c"
        : "#7A1818";
  setTimeout(() => (elements.statusMessage.textContent = ""), 3000);
}
let pendingAction = null; // 'delete' or 'reset'

let sessionToDeleteId = null;

function showConfirmModal(type, sessionId = null) {
  const titleEl = elements.confirmModal.querySelector(".confirm-title");
  const textEl = elements.confirmModal.querySelector(".confirm-text");
  const confirmBtn = elements.confirmDeleteBtn;

  if (type === "delete") {
    pendingAction = "delete";
    sessionToDeleteId = sessionId;
    titleEl.textContent = "Excluir conversa";
    textEl.textContent =
      "Tem certeza que deseja excluir esta conversa permanentemente? Esta ação não pode ser desfeita.";
    confirmBtn.textContent = "Excluir";
    confirmBtn.style.background = "var(--color-primary)";
  } else if (type === "reset") {
    pendingAction = "reset";
    titleEl.textContent = "Resetar Memória RAG";
    textEl.textContent =
      "Tem certeza que deseja limpar e recriar o banco de dados vetorial? Isso apagará o conhecimento atual.";
    confirmBtn.textContent = "Resetar";
    confirmBtn.style.background = "#d32f2f"; // Warning color
  }

  elements.confirmModal.style.display = "flex";
}

function hideDeleteModal() {
  pendingAction = null;
  sessionToDeleteId = null;
  elements.confirmModal.style.display = "none";
}

elements.cancelDeleteBtn.addEventListener("click", hideDeleteModal);

elements.confirmDeleteBtn.addEventListener("click", async () => {
  if (pendingAction === "delete" && sessionToDeleteId) {
    const originalText = elements.confirmDeleteBtn.textContent;
    elements.confirmDeleteBtn.textContent = "Excluindo...";
    elements.confirmDeleteBtn.disabled = true;

    try {
      const success = await deleteSession(sessionToDeleteId);
      if (success) {
        sessions = await fetchSessions();

        if (currentSessionId === sessionToDeleteId) {
          if (sessions.length > 0) {
            renderSessionList(); // Update list first
            loadSession(sessions[0].session_id);
          } else {
            startNewChat();
          }
        } else {
          renderSessionList();
        }
      } else {
        setStatus("Erro ao excluir conversa.", "error");
      }
    } catch (e) {
      setStatus("Erro inesperado ao excluir.", "error");
    } finally {
      hideDeleteModal();
      elements.confirmDeleteBtn.textContent = originalText;
      elements.confirmDeleteBtn.disabled = false;
    }
  } else if (pendingAction === "reset") {
    hideDeleteModal();

    pendingAction = "resetProcessing";

    setLoading(true);
    setStatus("Reiniciando base de conhecimento...", "warning");

    const result = await resetRagDatabase();

    setLoading(false); // Restore UI

    if (result && result.status === "success") {
      setStatus(
        result.message || "Memória RAG resetada com sucesso!",
        "success",
      );

      sessions = await fetchSessions(); // Update sidebar (likely clear it)
      renderSessionList();
      startNewChat(); // Clear current view
    } else {
      setStatus("Erro ao resetar memória RAG.", "error");
    }
  }
});

async function handleDeleteSession(sessionId, event) {
  event.stopPropagation();
  showConfirmModal("delete", sessionId);
}

if (elements.resetRagBtn) {
  elements.resetRagBtn.addEventListener("click", () => {
    showConfirmModal("reset");
  });
}
async function loadSession(sessionId) {

  hideUsersPage();

  if (currentSessionId !== sessionId) {
    sessions = sessions.filter((s) => !s._isTemp);
    renderSessionList();
  }

  currentSessionId = sessionId;
  clearChatArea();
  showSkeletonMessages();
  const history = await fetchHistory(sessionId);
  clearChatArea(); // Shows empty state by default

  if (history && history.length > 0) {
    hideEmptyState(); // Hide if we have content
    history.forEach((message) => renderMessage(message));
  } else {
    showEmptyState(); // Explicit show if empty
  }

  renderSessionList();
  elements.messageInput.focus();
}
function startNewChat() {

  hideUsersPage();

  // If a stream is running, abort it first
  if (isLoading) {
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
    if (uploadAbortController) {
      uploadAbortController.abort();
      uploadAbortController = null;
    }
    hideTypingIndicator();
    setLoading(false);
  }

  sessions = sessions.filter((s) => !s._isTemp);

  currentSessionId = generateUUID();
  clearChatArea();

  const tempSession = {
    session_id: currentSessionId,
    titulo: "Nova conversa",
    data_inicio: new Date().toISOString(),
    _isTemp: true, // Helper flag
  };
  sessions.unshift(tempSession);

  renderSessionList();
  elements.messageInput.focus();
  setStatus("Nova conversa iniciada", "success");
}
async function handleSendMessage(e) {
  e.preventDefault();

  if (isLoading) {
    if (abortController) {
      abortController.abort();
      abortController = null;
      setStatus("Geração interrompida.", "warning");
      hideTypingIndicator();
      setLoading(false);
    }
    if (uploadAbortController) {
      uploadAbortController.abort();
      uploadAbortController = null;
      setStatus("Upload cancelado.", "warning");
      hideTypingIndicator();
      setLoading(false);
    }
    return;
  }

  const message = elements.messageInput.value.trim();
  if (!message) return;

  if (isEditing) {
    const editingId = elements.inputForm.dataset.editingId;
    if (editingId) {
      pruneHistoryFrom(editingId);
      cancelEdit();
    }
  }

  renderMessage({ role: "user", content: message });
  elements.messageInput.value = "";
  elements.messageInput.style.height = "auto";

  setLoading(true);

  showTypingIndicator();

  let messageDiv = null;
  let contentDiv = null;

  const response = await sendMessage(
    message,
    currentSessionId,
    (chunkText) => {
      if ((!chunkText || chunkText.trim() === "") && !messageDiv) return;

      if (!messageDiv) {
        hideTypingIndicator();
        messageDiv = renderMessage({ role: "assistant", content: "" });
        contentDiv = messageDiv.querySelector(".message-content");
      }
      if (contentDiv) {
        contentDiv.innerHTML = marked.parse(chunkText);

        contentDiv.querySelectorAll("a").forEach((link) => {
          link.setAttribute("target", "_blank");
          link.setAttribute("rel", "noopener noreferrer");
        });

        processLeadBlocks(contentDiv);
        processInfoSections(contentDiv);

        elements.messagesContainer.scrollTop =
          elements.messagesContainer.scrollHeight;
      }
    },
  );

  if (!messageDiv) hideTypingIndicator();

  if (response !== "Geração cancelada.") {
    if (!messageDiv) {
      renderMessage({ role: "assistant", content: response });
    } else if (contentDiv) {
      contentDiv.innerHTML = marked.parse(response);
      contentDiv.querySelectorAll("a").forEach((link) => {
        link.setAttribute("target", "_blank");
        link.setAttribute("rel", "noopener noreferrer");
      });
      processLeadBlocks(contentDiv);
      processInfoSections(contentDiv);
    }
  } else if (messageDiv) {
    contentDiv.innerHTML += marked.parse(
      "\n\n*Geração cancelada pelo usuário.*",
    );
  }

  setLoading(false);

  try {
    const latestHistory = await fetchHistory(currentSessionId);
    if (latestHistory && latestHistory.length > 0) {
      const domMessages = Array.from(
        elements.messagesContainer.querySelectorAll(".message"),
      );

      const lastDomMsg = domMessages[domMessages.length - 1];

      if (lastDomMsg) {
        const lastHistoryMsg = latestHistory[latestHistory.length - 1];

        if (lastHistoryMsg && !lastDomMsg.hasAttribute("data-id")) {
          lastDomMsg.setAttribute("data-id", lastHistoryMsg.id);
        }

        if (domMessages.length >= 2) {
          const userDomMsg = domMessages[domMessages.length - 2];
          const userHistoryMsg = latestHistory[latestHistory.length - 2];

          if (
            userDomMsg &&
            !userDomMsg.hasAttribute("data-id") &&
            userHistoryMsg
          ) {
            userDomMsg.setAttribute("data-id", userHistoryMsg.id);
          }
        }
      }
    }
  } catch (e) {
  }

  sessions = await fetchSessions();
  renderSessionList();
}
elements.attachBtn.addEventListener("click", () =>
  elements.fileInput.click(),
);
elements.fileInput.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  renderMessage({
    role: "user",
    content: `Enviando arquivo: ${file.name}`, // Mantém texto para histórico, mas UI oculta
    file: file.name,
  });
  setStatus(`Processando ${file.name}...`, "warning"); // Amarelo/Laranja enquanto processa
  isLoading = true;

  uploadAbortController = new AbortController();

  showTypingIndicator();
  setLoading(true); // Ativa bot?o de stop

  try {
    const formData = new FormData();
    formData.append("file", file);

    if (currentSessionId) {
      formData.append("session_id", currentSessionId);
      formData.append("sessionId", currentSessionId);
    }

    const uploadUrlWithParam = currentSessionId
      ? `${UPLOAD_URL}?sessionId=${currentSessionId}`
      : UPLOAD_URL;

    const response = await fetch(uploadUrlWithParam, {
      method: "POST",
      body: formData,
      signal: uploadAbortController.signal,
    });

    if (!response.ok) throw new Error("Upload failed");

    const text = await response.text();
    let result = {};
    try {
      if (text && text.trim().length > 0) result = JSON.parse(text);
    } catch (e) {}

    hideTypingIndicator();

    setStatus(`${file.name} processado com sucesso!`, "success");

    renderMessage({
      role: "assistant",
      content: `✅ **Arquivo Recebido**\n\nO documento "${file.name}" foi processado. Você pode fazer perguntas sobre ele agora.`,
    });

  } catch (error) {
    if (error.name === "AbortError") {
    } else {
      hideTypingIndicator();
      setStatus(`Erro ao processar ${file.name}`, "error");

      renderMessage({
        role: "assistant",
        content: `❌ **Falha no envio**\n\nNão foi possível processar o arquivo "${file.name}". Tente novamente.`,
      });
    }
  } finally {
    isLoading = false;
    uploadAbortController = null;
    setLoading(false); // Restaura botão send
    e.target.value = "";
  }
});
elements.messageInput.addEventListener("keydown", function (e) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    handleSendMessage(e);
  }
});

elements.messageInput.addEventListener("input", function () {
  this.style.height = "auto";
  this.style.height = this.scrollHeight + "px";
});
async function startApp() {
  if (appStarted) return;
  appStarted = true;

  checkHealth();

  showSkeletonSessions();
  sessions = await fetchSessions();

  if (sessions.length > 0) {
    await loadSession(sessions[0].session_id);
  } else {
    startNewChat();
  }
  renderSessionList();
}
window.startApp = startApp;
elements.sendBtn.addEventListener("click", handleSendMessage);
elements.newChatBtn.addEventListener("click", startNewChat);

const toggleSidebarBtn = document.getElementById("toggleSidebarBtn");
const mainGrid = document.querySelector(".main-grid");
const sidebarBackdrop = document.getElementById("sidebarBackdrop");
if (toggleSidebarBtn) {
  toggleSidebarBtn.addEventListener("click", () => {
    mainGrid.classList.toggle("sidebar-closed");
    lucide.createIcons();
  });
}

if (sidebarBackdrop) {
  sidebarBackdrop.addEventListener("click", () => {
    mainGrid.classList.add("sidebar-closed");
  });
}

function checkMobileAndSetSidebar() {
  if (window.innerWidth <= 768) {
    mainGrid.classList.add("sidebar-closed");
  } else {
    mainGrid.classList.remove("sidebar-closed");
  }
}

checkMobileAndSetSidebar();

window.addEventListener("resize", checkMobileAndSetSidebar);

const SAMEKA_PREFIX = "sameka_";
const USER_RPC = {
  LIST: SAMEKA_PREFIX + "admin_list_users",
  UPDATE: SAMEKA_PREFIX + "admin_update_user",
  DELETE: SAMEKA_PREFIX + "admin_delete_user",
  CONFIRM: SAMEKA_PREFIX + "admin_confirm_user",
};

const IBGE_API = {
  ESTADOS:
    "https://servicodados.ibge.gov.br/api/v1/localidades/estados?orderBy=nome",
  CIDADES: (uf) =>
    `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios?orderBy=nome`,
};

let allEstados = [];
let selectedEstados = [];
let allCidades = [];
let selectedCidades = [];
let cidadesCache = {};

async function fetchEstados() {
  if (allEstados.length) return allEstados;
  try {
    const res = await fetch(IBGE_API.ESTADOS);
    allEstados = await res.json();
  } catch (e) {
    allEstados = [];
  }
  return allEstados;
}

async function fetchCidades(uf) {
  if (cidadesCache[uf]) return cidadesCache[uf];
  try {
    const res = await fetch(IBGE_API.CIDADES(uf));
    cidadesCache[uf] = await res.json();
  } catch (e) {
    cidadesCache[uf] = [];
  }
  return cidadesCache[uf];
}

function buildMultiSelect({
  triggerId,
  dropdownId,
  searchId,
  optionsId,
  items,
  selected,
  allLabel,
  allValue,
  onToggle,
  renderLabel,
}) {
  const trigger = document.getElementById(triggerId);
  const dropdown = document.getElementById(dropdownId);
  const search = document.getElementById(searchId);
  const container = document.getElementById(optionsId);
  if (!trigger || !dropdown || !search || !container) return null;

  function render(filter) {
    const q = (filter || "").toLowerCase();
    container.innerHTML = "";
    const allDiv = document.createElement("div");
    allDiv.className = "ms-option ms-all";
    const allCb = document.createElement("input");
    allCb.type = "checkbox";
    allCb.checked = selected.includes(allValue);
    allDiv.appendChild(allCb);
    allDiv.appendChild(document.createTextNode(allLabel));
    allDiv.addEventListener("click", (e) => {
      e.stopPropagation();
      if (selected.includes(allValue)) {
        selected.length = 0;
      } else {
        selected.length = 0;
        selected.push(allValue);
      }
      render(search.value);
      updateTrigger();
      if (onToggle) onToggle();
    });
    container.appendChild(allDiv);

    const filtered = q
      ? items.filter((i) => renderLabel(i).toLowerCase().includes(q))
      : items;
    filtered.forEach((item) => {
      const lbl = renderLabel(item);
      const val = lbl;
      const div = document.createElement("div");
      div.className = "ms-option";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = selected.includes(allValue) || selected.includes(val);
      div.appendChild(cb);
      div.appendChild(document.createTextNode(lbl));
      div.addEventListener("click", (e) => {
        e.stopPropagation();
        if (selected.includes(allValue)) {
          selected.length = 0;
          items.forEach((it) => {
            const v = renderLabel(it);
            if (v !== val) selected.push(v);
          });
        } else if (selected.includes(val)) {
          selected.splice(selected.indexOf(val), 1);
        } else {
          selected.push(val);
          if (selected.length === items.length) {
            selected.length = 0;
            selected.push(allValue);
          }
        }
        render(search.value);
        updateTrigger();
        if (onToggle) onToggle();
      });
      container.appendChild(div);
    });
  }

  function updateTrigger() {
    let tagsContainer = trigger.querySelector(".ms-tags");
    if (!tagsContainer) {
      tagsContainer = document.createElement("span");
      tagsContainer.className = "ms-tags";
    }
    tagsContainer.innerHTML = "";
    const placeholder = trigger.querySelector(".ms-placeholder");
    if (selected.length === 0) {
      if (placeholder) placeholder.style.display = "";
      tagsContainer.remove();
      return;
    }
    if (placeholder) placeholder.style.display = "none";
    if (selected.includes(allValue)) {
      const tag = document.createElement("span");
      tag.className = "ms-tag";
      tag.textContent = allLabel;
      tagsContainer.appendChild(tag);
    } else if (selected.length <= 3) {
      selected.forEach((v) => {
        const tag = document.createElement("span");
        tag.className = "ms-tag";
        tag.textContent = v;
        tagsContainer.appendChild(tag);
      });
    } else {
      const tag = document.createElement("span");
      tag.className = "ms-tag";
      tag.textContent = selected.length + " selecionados";
      tagsContainer.appendChild(tag);
    }
    trigger.insertBefore(
      tagsContainer,
      trigger.querySelector(".ms-arrow"),
    );
  }

  trigger.addEventListener("click", (e) => {
    e.preventDefault();
    const isOpen = dropdown.classList.contains("open");
    document
      .querySelectorAll(".ms-dropdown.open")
      .forEach((d) => d.classList.remove("open"));
    if (!isOpen) {
      dropdown.classList.add("open");
      search.value = "";
      render("");
      search.focus();
    }
  });
  search.addEventListener("input", () => render(search.value));
  document.addEventListener("click", (e) => {
    if (!trigger.contains(e.target) && !dropdown.contains(e.target))
      dropdown.classList.remove("open");
  });
  return {
    render,
    updateTrigger,
    setItems(newItems) {
      items.length = 0;
      items.push(...newItems);
    },
  };
}

let msEstados = null;
let msCidades = null;

async function initFormMultiSelects() {
  const estados = await fetchEstados();
  msEstados = buildMultiSelect({
    triggerId: "estadosTrigger2",
    dropdownId: "estadosDropdown2",
    searchId: "estadosSearch2",
    optionsId: "estadosOptions2",
    items: estados,
    selected: selectedEstados,
    allLabel: "Todos os Estados",
    allValue: "TODOS",
    onToggle: onEstadosChanged,
    renderLabel: (e) => e.sigla + " — " + e.nome,
  });
  if (msEstados) {
    msEstados.render("");
    msEstados.updateTrigger();
  }
}

let cidadesGroupedData = []; // [{uf, ufNome, cidades: [{nome}]}]

async function onEstadosChanged() {
  selectedCidades.length = 0;
  allCidades.length = 0;
  cidadesGroupedData.length = 0;
  const cidadesOpts = document.getElementById("cidadesOptions2");
  const cidadesTrigger = document.getElementById("cidadesTrigger2");
  const cidadesDropdown = document.getElementById("cidadesDropdown2");
  const cidadesSearch = document.getElementById("cidadesSearch2");
  if (!cidadesOpts || !cidadesTrigger) return;
  const placeholder = cidadesTrigger.querySelector(".ms-placeholder");

  if (selectedEstados.length === 0) {
    cidadesOpts.innerHTML =
      '<div class="ms-loading">Selecione ao menos um estado.</div>';
    if (placeholder) {
      placeholder.textContent = "Selecione estados primeiro...";
      placeholder.style.display = "";
    }
    const tags = cidadesTrigger.querySelector(".ms-tags");
    if (tags) tags.remove();
    return;
  }
  cidadesOpts.innerHTML =
    '<div class="ms-loading">Carregando cidades...</div>';
  if (placeholder) {
    placeholder.textContent = "Carregando cidades...";
    placeholder.style.display = "";
  }

  let ufsToLoad = selectedEstados.includes("TODOS")
    ? allEstados.map((e) => e.sigla)
    : selectedEstados.map((s) => s.split(" — ")[0]);
  ufsToLoad.sort();
  const results = await Promise.all(
    ufsToLoad.map((uf) => fetchCidades(uf)),
  );

  ufsToLoad.forEach((uf, i) => {
    const est = allEstados.find((e) => e.sigla === uf);
    const ufNome = est ? est.nome : uf;
    const cidades = (results[i] || []).map((c) => ({ nome: c.nome, uf }));
    cidades.sort((a, b) => a.nome.localeCompare(b.nome));
    cidadesGroupedData.push({ uf, ufNome, cidades });
    cidades.forEach((c) => allCidades.push(c));
  });

  if (placeholder) {
    placeholder.textContent = "Selecione as cidades...";
    placeholder.style.display = "";
  }

  renderGroupedCidades("");
  updateCidadesTrigger();

  cidadesTrigger.onclick = (e) => {
    e.preventDefault();
    const isOpen = cidadesDropdown.classList.contains("open");
    document
      .querySelectorAll(".ms-dropdown.open")
      .forEach((d) => d.classList.remove("open"));
    if (!isOpen) {
      cidadesDropdown.classList.add("open");
      cidadesSearch.value = "";
      renderGroupedCidades("");
      cidadesSearch.focus();
    }
  };
  cidadesSearch.oninput = () => renderGroupedCidades(cidadesSearch.value);

  document.addEventListener("click", (e) => {
    if (
      !cidadesTrigger.contains(e.target) &&
      !cidadesDropdown.contains(e.target)
    ) {
      cidadesDropdown.classList.remove("open");
    }
  });
}

function renderGroupedCidades(filter) {
  const container = document.getElementById("cidadesOptions2");
  if (!container) return;
  container.innerHTML = "";
  const q = (filter || "").toLowerCase();

  const allDiv = document.createElement("div");
  allDiv.className = "ms-option ms-all";
  const allCb = document.createElement("input");
  allCb.type = "checkbox";
  allCb.checked = selectedCidades.includes("TODAS");
  allDiv.appendChild(allCb);
  allDiv.appendChild(document.createTextNode("Todas as Cidades"));
  allDiv.addEventListener("click", (e) => {
    e.stopPropagation();
    if (selectedCidades.includes("TODAS")) {
      selectedCidades.length = 0;
    } else {
      selectedCidades.length = 0;
      selectedCidades.push("TODAS");
    }
    renderGroupedCidades(filter);
    updateCidadesTrigger();
  });
  container.appendChild(allDiv);

  cidadesGroupedData.forEach((group) => {
    const filteredCidades = q
      ? group.cidades.filter((c) => c.nome.toLowerCase().includes(q))
      : group.cidades;
    if (q && filteredCidades.length === 0) return; // hide empty groups in search

    const selectedInGroup = selectedCidades.includes("TODAS")
      ? filteredCidades.length
      : group.cidades.filter((c) =>
          selectedCidades.includes(c.nome + " - " + c.uf),
        ).length;
    const allInGroupSelected =
      selectedCidades.includes("TODAS") ||
      (group.cidades.length > 0 &&
        group.cidades.every((c) =>
          selectedCidades.includes(c.nome + " - " + c.uf),
        ));

    const header = document.createElement("div");
    header.className = "ms-group-header";
    const headerCb = document.createElement("input");
    headerCb.type = "checkbox";
    headerCb.checked = allInGroupSelected;
    headerCb.style.accentColor = "var(--color-primary)";
    headerCb.style.width = "15px";
    headerCb.style.height = "15px";
    headerCb.style.cursor = "pointer";
    header.appendChild(headerCb);

    const headerLabel = document.createElement("span");
    headerLabel.textContent = group.uf + " — " + group.ufNome;
    header.appendChild(headerLabel);

    const countBadge = document.createElement("span");
    countBadge.className = "ms-group-count";
    countBadge.textContent =
      selectedInGroup > 0
        ? "(" + selectedInGroup + "/" + group.cidades.length + ")"
        : "(" + group.cidades.length + ")";
    header.appendChild(countBadge);

    const chevron = document.createElement("span");
    chevron.className = "ms-group-chevron";
    chevron.textContent = "▼";
    header.appendChild(chevron);
    container.appendChild(header);

    const body = document.createElement("div");
    body.className = "ms-group-body";

    filteredCidades.forEach((c) => {
      const val = c.nome + " - " + c.uf;
      const div = document.createElement("div");
      div.className = "ms-option";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked =
        selectedCidades.includes("TODAS") ||
        selectedCidades.includes(val);
      div.appendChild(cb);
      div.appendChild(document.createTextNode(c.nome));
      div.addEventListener("click", (e) => {
        e.stopPropagation();
        if (selectedCidades.includes("TODAS")) {
          selectedCidades.length = 0;
          allCidades.forEach((ac) => {
            const v = ac.nome + " - " + ac.uf;
            if (v !== val) selectedCidades.push(v);
          });
        } else if (selectedCidades.includes(val)) {
          selectedCidades.splice(selectedCidades.indexOf(val), 1);
        } else {
          selectedCidades.push(val);
          if (selectedCidades.length === allCidades.length) {
            selectedCidades.length = 0;
            selectedCidades.push("TODAS");
          }
        }
        renderGroupedCidades(filter);
        updateCidadesTrigger();
      });
      body.appendChild(div);
    });
    container.appendChild(body);

    header.addEventListener("click", (e) => {
      if (e.target === headerCb) {
        e.stopPropagation();
        if (selectedCidades.includes("TODAS")) {
          selectedCidades.length = 0;
          allCidades.forEach((ac) => {
            if (ac.uf !== group.uf)
              selectedCidades.push(ac.nome + " - " + ac.uf);
          });
        } else if (allInGroupSelected) {
          group.cidades.forEach((c) => {
            const v = c.nome + " - " + c.uf;
            const idx = selectedCidades.indexOf(v);
            if (idx !== -1) selectedCidades.splice(idx, 1);
          });
        } else {
          group.cidades.forEach((c) => {
            const v = c.nome + " - " + c.uf;
            if (!selectedCidades.includes(v)) selectedCidades.push(v);
          });
          if (selectedCidades.length === allCidades.length) {
            selectedCidades.length = 0;
            selectedCidades.push("TODAS");
          }
        }
        renderGroupedCidades(filter);
        updateCidadesTrigger();
        return;
      }
      header.classList.toggle("collapsed");
      body.classList.toggle("collapsed");
    });
  });
}

function updateCidadesTrigger() {
  const trigger = document.getElementById("cidadesTrigger2");
  if (!trigger) return;
  let tagsContainer = trigger.querySelector(".ms-tags");
  if (!tagsContainer) {
    tagsContainer = document.createElement("span");
    tagsContainer.className = "ms-tags";
  }
  tagsContainer.innerHTML = "";
  const placeholder = trigger.querySelector(".ms-placeholder");

  if (selectedCidades.length === 0) {
    if (placeholder) placeholder.style.display = "";
    tagsContainer.remove();
    return;
  }
  if (placeholder) placeholder.style.display = "none";

  if (selectedCidades.includes("TODAS")) {
    const tag = document.createElement("span");
    tag.className = "ms-tag";
    tag.textContent = "Todas as Cidades";
    tagsContainer.appendChild(tag);
  } else {
    const perUf = {};
    selectedCidades.forEach((v) => {
      const parts = v.split(" - ");
      const uf = parts[parts.length - 1];
      perUf[uf] = (perUf[uf] || 0) + 1;
    });
    const entries = Object.entries(perUf).sort((a, b) =>
      a[0].localeCompare(b[0]),
    );
    if (entries.length <= 4) {
      entries.forEach(([uf, count]) => {
        const tag = document.createElement("span");
        tag.className = "ms-tag";
        tag.textContent = uf + " (" + count + ")";
        tagsContainer.appendChild(tag);
      });
    } else {
      const tag = document.createElement("span");
      tag.className = "ms-tag";
      tag.textContent = selectedCidades.length + " cidades";
      tagsContainer.appendChild(tag);
    }
  }
  trigger.insertBefore(tagsContainer, trigger.querySelector(".ms-arrow"));
}

function getSelectedEstadosArray() {
  if (selectedEstados.includes("TODOS")) return ["TODOS"];
  return selectedEstados.map((s) => s.split(" — ")[0]);
}
function getSelectedCidadesArray() {
  if (selectedCidades.includes("TODAS")) return ["TODAS"];
  return [...selectedCidades];
}

const formRoleSelect = document.getElementById("formRole");
if (formRoleSelect) {
  formRoleSelect.addEventListener("change", async () => {
    if (formRoleSelect.value === "admin") {
      selectedEstados.length = 0;
      selectedEstados.push("TODOS");
      if (msEstados) {
        msEstados.render("");
        msEstados.updateTrigger();
      }
      await onEstadosChanged();
      selectedCidades.length = 0;
      selectedCidades.push("TODAS");
      renderGroupedCidades("");
      updateCidadesTrigger();
    }
  });
}

let editingUserId = null;
let deletingUserId = null;

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function showUsersPage() {
  document.getElementById("chatArea").style.display = "none";
  const up = document.getElementById("usersPage");
  up.style.display = "flex";
  document.getElementById("userFormPanel").style.display = "none";
  loadUsersPage();
  initFormMultiSelects();
}

function hideUsersPage() {
  document.getElementById("usersPage").style.display = "none";
  document.getElementById("chatArea").style.display = "";
}

async function loadUsersPage() {
  const loading = document.getElementById("usersLoading2");
  const table = document.getElementById("usersTable2");
  if (loading) loading.style.display = "block";
  if (table) table.style.display = "none";
  try {
    const { data, error } = await supabaseClient.rpc(USER_RPC.LIST);
    if (error) throw error;
    const countEl = document.getElementById("usersCount2");
    if (countEl) countEl.textContent = "(" + data.length + ")";
    const tbody = document.getElementById("usersTableBody2");
    tbody.innerHTML = "";
    data.forEach((u) => {
      const tr = document.createElement("tr");
      const created = new Date(u.created_at).toLocaleDateString("pt-BR");
      const role = u.role || AUTH_CONFIG.DEFAULT_ROLE;
      const roleLbl = AUTH_CONFIG.ROLE_LABELS[role] || role;
      const roleBadgeColor =
        role === "admin" ? "var(--color-primary)" : "var(--color-wine)";
      const uEstados = u.estados || [];
      const uCidades = u.cidades || [];
      let coverageTxt = "";
      if (uEstados.length === 0 && uCidades.length === 0) {
        coverageTxt = '<span style="opacity:0.4">—</span>';
      } else if (
        uEstados.includes("TODOS") &&
        uCidades.includes("TODAS")
      ) {
        coverageTxt =
          '<span style="font-weight:600">Todo o Brasil</span>';
      } else {
        const ePart = uEstados.includes("TODOS")
          ? "Todos UFs"
          : uEstados.join(", ");
        const cPart = uCidades.includes("TODAS")
          ? "Todas cidades"
          : uCidades.length > 3
            ? uCidades.length + " cidades"
            : uCidades.join(", ");
        coverageTxt =
          escapeHtml(ePart) +
          (cPart
            ? '<br><span style="font-size:0.8rem;opacity:0.7">' +
              escapeHtml(cPart) +
              "</span>"
            : "");
      }
      tr.innerHTML =
        '<td class="users-td">' +
        escapeHtml(u.full_name || "—") +
        "</td>" +
        '<td class="users-td" style="font-size:0.85rem">' +
        escapeHtml(u.email) +
        "</td>" +
        '<td class="users-td"><span style="padding:3px 10px;border-radius:20px;font-size:0.75rem;font-weight:600;background:' +
        roleBadgeColor +
        ';color:white">' +
        roleLbl +
        "</span></td>" +
        '<td class="users-td" style="max-width:220px;font-size:0.85rem">' +
        coverageTxt +
        "</td>" +
        '<td class="users-td" style="font-size:0.85rem;color:var(--text-secondary)">' +
        created +
        "</td>" +
        '<td class="users-td" style="text-align:right;white-space:nowrap">' +
        '<button class="reset-badge-btn edit-user-btn" style="width:auto;font-size:11px;padding:4px 10px;margin-right:4px" title="Editar"><i data-lucide="pencil" style="width:12px;height:12px"></i></button>' +
        (u.user_id === currentUserId
          ? ""
          : '<button class="reset-badge-btn delete-user-btn" style="width:auto;font-size:11px;padding:4px 10px;color:#dc2626;border-color:rgba(220,38,38,0.3)" title="Excluir"><i data-lucide="trash-2" style="width:12px;height:12px"></i></button>') +
        "</td>";
      tr.querySelector(".edit-user-btn").addEventListener("click", () =>
        openEditUser(u),
      );
      const delBtn = tr.querySelector(".delete-user-btn");
      if (delBtn)
        delBtn.addEventListener("click", () => openDeleteUser(u));
      tbody.appendChild(tr);
    });
    if (loading) loading.style.display = "none";
    if (table) table.style.display = "table";
    lucide.createIcons();
  } catch (err) {
    if (loading) loading.style.display = "none";
  }
}

async function loadUsers() {
  await loadUsersPage();
}

async function openEditUser(u) {
  editingUserId = u.user_id;
  document.getElementById("userFormTitle").textContent = "Editar Usuário";
  document.getElementById("emailField2").style.display = "none";
  document.getElementById("passwordField2").style.display = "none";
  document.getElementById("formPassword").required = false;
  document.getElementById("formFullName").value = u.full_name || "";
  const roleSelect = document.getElementById("formRole");
  roleSelect.value = u.role || AUTH_CONFIG.DEFAULT_ROLE;
  const isSelf = u.user_id === currentUserId;
  if (isSelf && currentUserRole === AUTH_CONFIG.ADMIN_ROLE) {
    roleSelect.disabled = true;
    roleSelect.title = "Você não pode rebaixar seu próprio perfil.";
  } else {
    roleSelect.disabled = false;
    roleSelect.title = "";
  }
  document.getElementById("formError").style.display = "none";

  selectedEstados.length = 0;
  selectedCidades.length = 0;
  const uEstados = u.estados || [];
  const uCidades = u.cidades || [];
  if (uEstados.includes("TODOS")) {
    selectedEstados.push("TODOS");
  } else {
    uEstados.forEach((sigla) => {
      const est = allEstados.find((e) => e.sigla === sigla);
      if (est) selectedEstados.push(est.sigla + " — " + est.nome);
      else selectedEstados.push(sigla);
    });
  }
  if (msEstados) {
    msEstados.render("");
    msEstados.updateTrigger();
  }
  await onEstadosChanged();
  uCidades.forEach((c) => selectedCidades.push(c));
  renderGroupedCidades("");
  updateCidadesTrigger();

  document.getElementById("userFormPanel").style.display = "block";
  lucide.createIcons();
}

function openCreateUser() {
  editingUserId = null;
  document.getElementById("userFormTitle").textContent = "Novo Usuário";
  document.getElementById("emailField2").style.display = "";
  document.getElementById("passwordField2").style.display = "";
  document.getElementById("formPassword").required = true;
  document.getElementById("userForm2").reset();
  const roleSelect = document.getElementById("formRole");
  roleSelect.disabled = false;
  roleSelect.title = "";
  document.getElementById("formError").style.display = "none";

  selectedEstados.length = 0;
  selectedCidades.length = 0;
  allCidades.length = 0;
  if (msEstados) {
    msEstados.render("");
    msEstados.updateTrigger();
  }
  const cidadesOpts = document.getElementById("cidadesOptions2");
  if (cidadesOpts)
    cidadesOpts.innerHTML =
      '<div class="ms-loading">Selecione ao menos um estado.</div>';
  const cidadesTrigger = document.getElementById("cidadesTrigger2");
  const ph = cidadesTrigger
    ? cidadesTrigger.querySelector(".ms-placeholder")
    : null;
  if (ph) {
    ph.textContent = "Selecione estados primeiro...";
    ph.style.display = "";
  }
  const tags = cidadesTrigger
    ? cidadesTrigger.querySelector(".ms-tags")
    : null;
  if (tags) tags.remove();

  document.getElementById("userFormPanel").style.display = "block";
  lucide.createIcons();
}

function openDeleteUser(u) {
  deletingUserId = u.user_id;
  document.getElementById("deleteUserName").textContent =
    u.full_name || u.email;
  document.getElementById("deleteModalError").style.display = "none";
  document.getElementById("deleteModal").style.display = "flex";
}

const addUserBtn2 = document.getElementById("addUserBtn2");
if (addUserBtn2) addUserBtn2.addEventListener("click", openCreateUser);

const usersBackBtn = document.getElementById("usersBackBtn");
if (usersBackBtn) usersBackBtn.addEventListener("click", hideUsersPage);

const userFormCloseBtn = document.getElementById("userFormCloseBtn");
if (userFormCloseBtn)
  userFormCloseBtn.addEventListener("click", () => {
    document.getElementById("userFormPanel").style.display = "none";
  });
const formCancelBtn = document.getElementById("formCancelBtn");
if (formCancelBtn)
  formCancelBtn.addEventListener("click", () => {
    document.getElementById("userFormPanel").style.display = "none";
  });

const manageUsersBtn = document.getElementById("manageUsersBtn");
if (manageUsersBtn) {
  manageUsersBtn.addEventListener("click", showUsersPage);
}

const userForm2 = document.getElementById("userForm2");
if (userForm2) {
  userForm2.addEventListener("submit", async (e) => {
    e.preventDefault();
    const saveBtn = document.getElementById("formSaveBtn");
    const errorEl = document.getElementById("formError");
    errorEl.style.display = "none";
    saveBtn.disabled = true;
    try {
      if (editingUserId) {
        const roleSelect = document.getElementById("formRole");
        const chosenRole = roleSelect.disabled
          ? currentUserRole
          : roleSelect.value;
        const { error } = await supabaseClient.rpc(USER_RPC.UPDATE, {
          p_user_id: editingUserId,
          p_full_name: document
            .getElementById("formFullName")
            .value.trim(),
          p_role: chosenRole,
          p_estados: JSON.stringify(getSelectedEstadosArray()),
          p_cidades: JSON.stringify(getSelectedCidadesArray()),
        });
        if (error) throw error;
      } else {
        const email = document.getElementById("formEmail").value.trim();
        const password = document.getElementById("formPassword").value;
        const fullName = document
          .getElementById("formFullName")
          .value.trim();
        const role = document.getElementById("formRole").value;
        const { data: signupData, error: signupError } =
          await supabaseClient.auth.signUp({
            email,
            password,
            options: {
              data: {
                full_name: fullName,
                role,
                company_name: "sameka",
                estados: getSelectedEstadosArray(),
                cidades: getSelectedCidadesArray(),
              },
            },
          });
        if (signupError) throw signupError;
        if (signupData.user) {
          const { error: confirmError } = await supabaseClient.rpc(
            USER_RPC.CONFIRM,
            { p_user_id: signupData.user.id },
          );
          if (confirmError) { /* warn suppressed */ }
        }
      }
      document.getElementById("userFormPanel").style.display = "none";
      await loadUsersPage();
    } catch (err) {
      errorEl.textContent = err.message || "Erro ao salvar usuário.";
      errorEl.style.display = "block";
    } finally {
      saveBtn.disabled = false;
    }
  });
}

const deleteCancelBtn2 = document.getElementById("deleteCancelBtn");
if (deleteCancelBtn2) {
  deleteCancelBtn2.addEventListener("click", () => {
    document.getElementById("deleteModal").style.display = "none";
  });
}
const deleteConfirmBtn2 = document.getElementById("deleteConfirmBtn");
if (deleteConfirmBtn2) {
  deleteConfirmBtn2.addEventListener("click", async () => {
    const errorEl = document.getElementById("deleteModalError");
    errorEl.style.display = "none";
    deleteConfirmBtn2.disabled = true;
    try {
      const { error } = await supabaseClient.rpc(USER_RPC.DELETE, {
        p_user_id: deletingUserId,
      });
      if (error) throw error;
      document.getElementById("deleteModal").style.display = "none";
      await loadUsersPage();
    } catch (err) {
      errorEl.textContent = err.message || "Erro ao excluir usuário.";
      errorEl.style.display = "block";
    } finally {
      deleteConfirmBtn2.disabled = false;
    }
  });
}

window.loadUsers = loadUsersPage;

document.addEventListener("DOMContentLoaded", () => {
  lucide.createIcons();
});