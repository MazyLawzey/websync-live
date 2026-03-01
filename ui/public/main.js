/*
    ######################################################################
    WebSync Live - copyright (c) 2026 MazyLawzey
    https://github.com/MazyLawzey - MazyLawzey main author of WebSync Live
    https://github.com/rionn11 - rionn11 main contributor of WebSync Live
    https://github.com/MazyLawzey/websync-live - OUR REPO
    GPL-3.0 license
    #######################################################################
*/

// ─── VS Code API ────────────────────────────────────────────────────────────

const vscode = (function () {
    try {
        return window.acquireVsCodeApi();
    } catch (e) {
        return null;
    }
})();

// ─── Application State ──────────────────────────────────────────────────────

const state = {
    connected: false,
    sessionCode: null,
    userId: null,
    role: null,
    users: [],
    comments: [],
    serverUrl: "http://localhost:3000",
};

// ─── Screen Management ──────────────────────────────────────────────────────

function showScreen(screenId) {
    document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
    const screen = document.getElementById(screenId);
    if (screen) screen.classList.add("active");
}

// ─── Tab Management ─────────────────────────────────────────────────────────

function switchTab(tabId, btn) {
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    const panel = document.getElementById(tabId);
    if (panel) panel.classList.add("active");
    if (btn) btn.classList.add("active");
}

// ─── Session Actions ────────────────────────────────────────────────────────

function createSession() {
    const displayName = document.getElementById("displayName").value.trim() || "Host";
    if (!vscode) {
        console.warn("VS Code API not available");
        return;
    }
    // Disable button to prevent double-click
    const btn = document.getElementById("btn-create");
    btn.disabled = true;
    btn.textContent = "Creating...";

    vscode.postMessage({ command: "createSession", displayName });
}

function joinSession() {
    const displayName = document.getElementById("displayName").value.trim() || "User";
    const sessionCode = document.getElementById("sessionCode").value.trim().toUpperCase();
    const serverUrl = document.getElementById("serverUrl").value.trim() || "ws://localhost:3000";

    if (!sessionCode) {
        showToast("Please enter a session code");
        return;
    }

    if (!vscode) {
        console.warn("VS Code API not available");
        return;
    }

    const btn = document.getElementById("btn-join");
    btn.disabled = true;
    btn.textContent = "Joining...";

    vscode.postMessage({ command: "joinSession", displayName, sessionCode, serverUrl });
}

function disconnect() {
    if (!vscode) return;
    vscode.postMessage({ command: "disconnect" });
    resetState();
    showScreen("screen-connect");
}

function resetState() {
    state.connected = false;
    state.sessionCode = null;
    state.userId = null;
    state.role = null;
    state.users = [];
    state.comments = [];
    state.serverUrl = "http://localhost:3000";
}

// ─── Session Info Display ───────────────────────────────────────────────────

function updateSessionDisplay() {
    const codeEl = document.getElementById("session-code-display");
    const roleEl = document.getElementById("role-display");
    const circleEl = document.getElementById("circle_status");
    const statusEl = document.getElementById("server_status");

    if (codeEl) codeEl.textContent = state.sessionCode || "—";
    if (roleEl) {
        roleEl.textContent = state.role || "—";
        roleEl.className = "role-badge role-" + (state.role || "");
    }
    if (circleEl) circleEl.classList.toggle("running", state.connected);
    if (statusEl) statusEl.textContent = state.connected ? "Connected" : "Disconnected";
}

function copySessionCode() {
    if (!state.sessionCode) return;
    try {
        navigator.clipboard.writeText(state.sessionCode);
        showToast("Session code copied!");
    } catch (e) {
        // Fallback
        const badge = document.getElementById("session-code-display");
        if (badge) {
            const orig = badge.textContent;
            badge.textContent = "Copied!";
            setTimeout(() => (badge.textContent = orig), 1200);
        }
    }
}

// ─── Preview ────────────────────────────────────────────────────────────────

function loadPreview() {
    const iframe = document.getElementById("preview-frame");
    if (iframe) {
        iframe.src = state.serverUrl || "http://localhost:3000";
    }
}

function refreshPreview() {
    const iframe = document.getElementById("preview-frame");
    if (iframe && iframe.src && iframe.src !== "about:blank") {
        try {
            const url = new URL(iframe.src);
            url.searchParams.set('_t', Date.now());
            iframe.src = url.toString();
        } catch (e) {
            iframe.src = iframe.src;
        }
    }
}

function openPreviewPanel() {
    if (!vscode) return;
    vscode.postMessage({ command: "openPreview" });
}

function startServerOnly() {
    if (!vscode) return;
    vscode.postMessage({ command: "startServer" });
    showToast("Starting server...");
}

function addCommentFromEditor() {
    if (!vscode) return;
    vscode.postMessage({ command: "addCommentFromEditor" });
}

// ─── Ngrok Tunnel ───────────────────────────────────────────────────────────

function toggleNgrokPanel() {
    const panel = document.getElementById("ngrok-panel");
    if (!panel) return;
    const isOpening = panel.style.display === "none";
    panel.style.display = isOpening ? "block" : "none";
    // When opening, ask extension for saved token to pre-fill
    if (isOpening && vscode) {
        vscode.postMessage({ command: "requestNgrokToken" });
    }
}

function startNgrok() {
    if (!vscode) return;
    const authtoken = document.getElementById("ngrok-authtoken")?.value?.trim();
    if (!authtoken) {
        showToast("Enter your ngrok authtoken first");
        return;
    }
    const btn = document.getElementById("btn-ngrok-start");
    if (btn) {
        btn.disabled = true;
        btn.textContent = "Connecting...";
    }
    vscode.postMessage({ command: "startNgrok", authtoken });
}

function clearNgrokToken() {
    if (!vscode) return;
    const input = document.getElementById("ngrok-authtoken");
    if (input) input.value = "";
    const clearBtn = document.getElementById("btn-clear-token");
    if (clearBtn) clearBtn.style.display = "none";
    vscode.postMessage({ command: "clearNgrokToken" });
    showToast("Saved token removed");
}

function stopNgrok() {
    if (!vscode) return;
    vscode.postMessage({ command: "stopNgrok" });
}

function showNgrokActive(url, wsUrl) {
    const setup = document.getElementById("ngrok-setup");
    const active = document.getElementById("ngrok-active");
    const wsInput = document.getElementById("ngrok-ws-url");
    const toggleBtn = document.getElementById("btn-ngrok-toggle");

    if (setup) setup.style.display = "none";
    if (active) active.style.display = "block";
    if (wsInput) wsInput.value = wsUrl || "";
    if (toggleBtn) toggleBtn.classList.add("ngrok-active-indicator");

    // Auto-open panel
    const panel = document.getElementById("ngrok-panel");
    if (panel) panel.style.display = "block";
}

function showNgrokSetup() {
    const setup = document.getElementById("ngrok-setup");
    const active = document.getElementById("ngrok-active");
    const toggleBtn = document.getElementById("btn-ngrok-toggle");
    const btn = document.getElementById("btn-ngrok-start");

    if (setup) setup.style.display = "block";
    if (active) active.style.display = "none";
    if (toggleBtn) toggleBtn.classList.remove("ngrok-active-indicator");
    if (btn) {
        btn.disabled = false;
        btn.textContent = "Start Tunnel";
    }
}

function copyNgrokUrl() {
    const input = document.getElementById("ngrok-url");
    if (input?.value) {
        try { navigator.clipboard.writeText(input.value); } catch (e) {}
        showToast("Public URL copied!");
    }
}

function copyNgrokWsUrl() {
    const input = document.getElementById("ngrok-ws-url");
    if (input?.value) {
        try { navigator.clipboard.writeText(input.value); } catch (e) {}
        showToast("Server URL copied!");
    }
}

function copyJoinInfo() {
    const wsInput = document.getElementById("ngrok-ws-url");
    const wsUrl = wsInput?.value || "";
    const code = state.sessionCode || "";
    if (!code || !wsUrl) {
        showToast("No session or URL to copy");
        return;
    }
    const joinText = `WebSync Live - Join Info\nSession Code: ${code}\nServer URL: ${wsUrl}\n\nPaste the Server URL into the \"Server URL\" field and the Session Code into \"Session Code\" in WebSync Live.`;
    try {
        navigator.clipboard.writeText(joinText);
        showToast("Join info copied! Send it to your students.");
    } catch (e) {
        showToast("Failed to copy");
    }
}

// ─── Users Rendering ────────────────────────────────────────────────────────

function renderUsers() {
    const container = document.getElementById("users-list");
    const countEl = document.getElementById("users-count");
    if (!container) return;

    if (countEl) countEl.textContent = state.users.length;

    if (state.users.length === 0) {
        container.innerHTML = '<p class="empty-state">No users connected yet</p>';
        return;
    }

    const canManageUsers = state.role === "host" || state.role === "admin";

    container.innerHTML = state.users
        .map((user) => {
            const isMe = user.id === state.userId;
            const isHost = user.role === "host";

            // Determine if current user can manage this user
            let canManageThis = false;
            if (!isMe) {
                if (state.role === "host" && !isHost) canManageThis = true;
                if (state.role === "admin" && user.role !== "host" && user.role !== "admin") canManageThis = true;
            }

            // Build role options (Host cannot assign others as host)
            let actionsHtml = "";
            if (canManageThis) {
                let roleOptions = "";
                if (state.role === "host") {
                    // Host can assign admin/editor/viewer
                    roleOptions = `
                        <option value="admin" ${user.role === "admin" ? "selected" : ""}>Admin</option>
                        <option value="editor" ${user.role === "editor" ? "selected" : ""}>Editor</option>
                        <option value="viewer" ${user.role === "viewer" ? "selected" : ""}>Viewer</option>
                    `;
                } else {
                    // Admin can only assign editor/viewer
                    roleOptions = `
                        <option value="editor" ${user.role === "editor" ? "selected" : ""}>Editor</option>
                        <option value="viewer" ${user.role === "viewer" ? "selected" : ""}>Viewer</option>
                    `;
                }

                actionsHtml = `
                    <div class="user-actions">
                        <select class="role-select" onchange="changeRole('${user.id}', this.value)">
                            ${roleOptions}
                        </select>
                        <button class="btn btn-danger btn-xs" onclick="kickUser('${user.id}')" title="Kick user">Kick</button>
                    </div>
                `;
            }

            return `
                <div class="user-card ${isMe ? "user-me" : ""}">
                    <div class="user-info">
                        <span class="user-avatar">${getInitials(user.displayName)}</span>
                        <div class="user-details">
                            <span class="user-name">${escapeHtml(user.displayName)}${isMe ? " (You)" : ""}</span>
                            <span class="user-role role-${user.role}">${user.role}</span>
                        </div>
                    </div>
                    ${actionsHtml}
                </div>
            `;
        })
        .join("");
}

function changeRole(userId, newRole) {
    if (!vscode) return;
    vscode.postMessage({ command: "changeRole", targetUserId: userId, newRole });
}

function kickUser(userId) {
    if (!vscode) return;
    const user = state.users.find((u) => u.id === userId);
    const name = user ? user.displayName : "this user";
    if (confirm(`Kick ${name} from the session?`)) {
        vscode.postMessage({ command: "kickUser", targetUserId: userId });
    }
}

// ─── Comments Rendering ────────────────────────────────────────────────────

function renderComments() {
    const container = document.getElementById("comments-list");
    const countEl = document.getElementById("comments-count");
    if (!container) return;

    if (countEl) countEl.textContent = state.comments.length;

    if (state.comments.length === 0) {
        container.innerHTML = '<p class="empty-state">No comments yet. Add one above or use the command palette.</p>';
        return;
    }

    // Sort by most recent first
    const sorted = [...state.comments].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    container.innerHTML = sorted
        .map((comment) => {
            const canDelete =
                comment.authorId === state.userId ||
                state.role === "host" ||
                state.role === "admin";
            const time = comment.createdAt ? new Date(comment.createdAt).toLocaleTimeString() : "";

            return `
                <div class="comment-card">
                    <div class="comment-header">
                        <span class="comment-author">${escapeHtml(comment.author || "Unknown")}</span>
                        <span class="comment-location">${escapeHtml(comment.filePath || "")}:${comment.line || "?"}</span>
                        <span class="comment-time">${time}</span>
                    </div>
                    <p class="comment-body">${escapeHtml(comment.text || "")}</p>
                    ${canDelete ? `<button class="btn btn-danger btn-xs comment-delete" onclick="deleteComment('${comment.id}')">Delete</button>` : ""}
                </div>
            `;
        })
        .join("");
}

function addComment() {
    const fileInput = document.getElementById("comment-file");
    const lineInput = document.getElementById("comment-line");
    const textInput = document.getElementById("comment-text");

    const filePath = fileInput.value.trim();
    const line = parseInt(lineInput.value, 10);
    const text = textInput.value.trim();

    if (!filePath || !line || !text) {
        showToast("Please fill in file path, line number, and comment text");
        return;
    }

    if (!vscode) return;

    vscode.postMessage({ command: "addComment", filePath, line, text });

    // Clear the text field after sending
    textInput.value = "";
}

function deleteComment(commentId) {
    if (!vscode) return;
    vscode.postMessage({ command: "deleteComment", commentId });
}

// ─── Utilities ──────────────────────────────────────────────────────────────

function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}

function getInitials(name) {
    if (!name) return "?";
    return name
        .split(" ")
        .map((w) => w[0])
        .join("")
        .toUpperCase()
        .slice(0, 2);
}

function showToast(message) {
    // Simple toast notification
    let toast = document.getElementById("toast");
    if (!toast) {
        toast = document.createElement("div");
        toast.id = "toast";
        toast.className = "toast";
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 2500);
}

// ─── Message Handler (from VS Code Extension) ──────────────────────────────

window.addEventListener("message", (event) => {
    const message = event.data;

    switch (message.command) {
        case "sessionCreated":
            state.connected = true;
            state.sessionCode = message.sessionCode;
            state.userId = message.userId;
            state.role = message.role;
            state.users = message.users || [];
            state.comments = [];
            if (message.serverUrl) state.serverUrl = message.serverUrl;
            showScreen("screen-main");
            updateSessionDisplay();
            renderUsers();
            renderComments();
            loadPreview();
            break;

        case "sessionJoined":
            state.connected = true;
            state.sessionCode = message.sessionCode;
            state.userId = message.userId;
            state.role = message.role;
            state.users = message.users || [];
            state.comments = message.comments || [];
            if (message.serverUrl) state.serverUrl = message.serverUrl;
            showScreen("screen-main");
            updateSessionDisplay();
            renderUsers();
            renderComments();
            loadPreview();
            break;

        case "restoreSession":
            state.connected = true;
            state.sessionCode = message.sessionCode;
            state.userId = message.userId;
            state.role = message.role;
            state.users = message.users || [];
            state.comments = message.comments || [];
            if (message.serverUrl) state.serverUrl = message.serverUrl;
            showScreen("screen-main");
            updateSessionDisplay();
            renderUsers();
            renderComments();
            loadPreview();
            break;

        case "userJoined":
            state.users = message.users || state.users;
            renderUsers();
            break;

        case "userLeft":
            state.users = message.users || state.users;
            renderUsers();
            break;

        case "commentAdded":
            if (message.comment) {
                // Avoid duplicates
                if (!state.comments.find((c) => c.id === message.comment.id)) {
                    state.comments.push(message.comment);
                }
            }
            renderComments();
            break;

        case "commentDeleted":
            state.comments = state.comments.filter((c) => c.id !== message.commentId);
            renderComments();
            break;

        case "roleChanged":
            state.users = message.users || state.users;
            if (message.userId === state.userId) {
                state.role = message.newRole;
                updateSessionDisplay();
            }
            renderUsers();
            break;

        case "kicked":
            showToast("You have been kicked from the session");
            resetState();
            showScreen("screen-connect");
            break;

        case "sessionClosed":
            showToast("Session closed: " + (message.reason || ""));
            resetState();
            showScreen("screen-connect");
            break;

        case "disconnected":
            resetState();
            showScreen("screen-connect");
            resetButtons();
            break;

        case "error":
            showToast(message.message || "An error occurred");
            resetButtons();
            break;

        case "reloadPreview":
            // Live reload triggered by file change
            refreshPreview();
            break;

        case "triggerJoin":
            // Triggered from command palette
            if (message.sessionCode) {
                document.getElementById("sessionCode").value = message.sessionCode;
            }
            break;

        case "serverStarted":
            // Legacy compatibility
            break;

        case "ngrokStarted":
            showNgrokActive(message.url, message.wsUrl);
            showToast("ngrok tunnel active!");
            break;

        case "ngrokConnecting":
            showToast("Connecting to ngrok...");
            break;

        case "ngrokStopped":
            showNgrokSetup();
            showToast("ngrok tunnel closed");
            break;

        case "ngrokError":
            showNgrokSetup();
            showToast("ngrok error: " + (message.message || "Unknown error"));
            break;

        case "ngrokTokenLoaded": {
            const input = document.getElementById("ngrok-authtoken");
            const clearBtn = document.getElementById("btn-clear-token");
            if (input && message.token) {
                input.value = message.token;
                if (clearBtn) clearBtn.style.display = "";
            } else if (clearBtn) {
                clearBtn.style.display = "none";
            }
            break;
        }

        case "ngrokTokenCleared": {
            const clearBtn = document.getElementById("btn-clear-token");
            if (clearBtn) clearBtn.style.display = "none";
            break;
        }

        // ─── File navigation ──────────────────────────────────────
        case "fileFocus": {
            const banner = document.getElementById("host-focus-banner");
            const txt    = document.getElementById("host-focus-text");
            if (banner && txt && state.role !== "host") {
                txt.textContent = `\uD83D\uDC41\uFE0F Host is viewing: ${message.filePath || "—"}`;
                banner.style.display = "flex";
                clearTimeout(banner._hideTimer);
                banner._hideTimer = setTimeout(() => { banner.style.display = "none"; }, 5000);
            }
            break;
        }

        // ─── Change folder ────────────────────────────────────
        case "serverFolderChanged":
            showToast(`Server root: ${message.folder}`);
            break;

        // ─── Code runner ──────────────────────────────────────
        case "runnerStarted": {
            const fileLabel = document.getElementById("console-file-label");
            if (fileLabel) fileLabel.textContent = `Running: ${message.filePath || ""}`;
            const stopBtn = document.getElementById("btn-stop-console");
            const runBtn  = document.getElementById("btn-run-console");
            if (stopBtn) stopBtn.style.display = "";
            if (runBtn)  runBtn.style.display = "none";
            // Switch to Console tab automatically
            const consoleTab = document.querySelector('[data-tab="tab-console"]');
            if (consoleTab) switchTab("tab-console", consoleTab);
            clearConsole();
            break;
        }
        case "runnerStopped": {
            const stopBtn = document.getElementById("btn-stop-console");
            const runBtn  = document.getElementById("btn-run-console");
            if (stopBtn) stopBtn.style.display = "none";
            if (runBtn)  runBtn.style.display = "";
            break;
        }
        case "consoleOutput": {
            const out = document.getElementById("console-output");
            if (out) {
                const span = document.createElement("span");
                span.className = `c-${message.stream || "out"}`;
                span.textContent = message.text;
                out.appendChild(span);
                out.scrollTop = out.scrollHeight;
            }
            break;
        }
    }
});

function resetButtons() {
    const createBtn = document.getElementById("btn-create");
    const joinBtn = document.getElementById("btn-join");
    if (createBtn) {
        createBtn.disabled = false;
        createBtn.textContent = "Create Session";
    }
    if (joinBtn) {
        joinBtn.disabled = false;
        joinBtn.textContent = "Join Session";
    }
}

// ─── Change Folder ────────────────────────────────────────────

function changeFolder() {
    if (!vscode) return;
    vscode.postMessage({ command: "changeFolder" });
}

// ─── Code Runner ────────────────────────────────────────────

function runCode() {
    if (!vscode) return;
    vscode.postMessage({ command: "runCode" });
}

function stopCode() {
    if (!vscode) return;
    vscode.postMessage({ command: "stopCode" });
}

function clearConsole() {
    const out = document.getElementById("console-output");
    if (out) out.innerHTML = "";
    const label = document.getElementById("console-file-label");
    if (label) label.textContent = "";
}

// ─── Initialization ─────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
    // Check if server is already running
    if (vscode) {
        vscode.postMessage({ command: "checkServerStatus" });
    }

    // Allow Enter key to submit forms
    const sessionCodeInput = document.getElementById("sessionCode");
    if (sessionCodeInput) {
        sessionCodeInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") joinSession();
        });
    }

    const displayNameInput = document.getElementById("displayName");
    if (displayNameInput) {
        displayNameInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") createSession();
        });
    }

    // Ask extension to restore session if one is active
    // (handles the case when webview is re-created after tab switch)
    if (vscode) {
        vscode.postMessage({ command: "requestRestore" });
    }
});
