/*
    ######################################################################
    WebSync Live - copyright (c) 2026 MazyLawzey
    https://github.com/MazyLawzey - MazyLawzey main author of WebSync Live
    https://github.com/rionn11 - rionn11 main contributor of WebSync Live
    https://github.com/MazyLawzey/websync-live - OUR REPO
    GPL-3.0 license
    #######################################################################
*/

const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { WebSyncClient } = require("./client/client");

// ─── State ───────────────────────────────────────────────────────────────────

let serverProcess = null;
let client = null;
let webviewView = null;
let previewPanel = null;
let commentDecorationType = null;
let fileWatcher = null;
let liveReloadWatcher = null;
let reloadDebounce = null;
let ngrokProcess = null;
let ngrokUrl = null;
let currentServerUrl = null;  // track the HTTP base URL for preview
let outputChannel = null;  // debug output channel
let viewerReadOnlyDisposable = null;  // blocks editing for viewers
let viewerWarningDebounce = null;  // debounce "viewer can't edit" warning
let suppressFileWatcher = false;  // suppress watcher while applying remote updates
let cursorListenerDisposable = null;  // cursor position listener
let remoteCursorDecorations = new Map();  // userId → { decorationType, filePath }
let pendingJoin = null;  // saved join params for auto-rejoin after workspace change
let statusBarItem = null;  // statusbar: shows nick + session info
let diffListener = null;   // onDidChangeTextDocument listener for incremental diff sync
let runCodeProcess = null; // currently running code subprocess
let extensionContext = null; // VS Code extension context (persisted storage)

function log(msg) {
    if (!outputChannel) {
        outputChannel = vscode.window.createOutputChannel("WebSync Live");
    }
    const ts = new Date().toLocaleTimeString();
    outputChannel.appendLine(`[${ts}] ${msg}`);
    console.log(`[WebSync] ${msg}`);
}

// ─── Comment Decorations ─────────────────────────────────────────────────────

function createCommentDecoration() {
    return vscode.window.createTextEditorDecorationType({
        after: {
            margin: "0 0 0 1.5em",
            color: "#FFD700",
            fontStyle: "italic",
        },
        backgroundColor: "rgba(255, 215, 0, 0.04)",
        isWholeLine: true,
    });
}

function updateCommentDecorations() {
    if (!client || !commentDecorationType) return;

    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const filePath = vscode.workspace.asRelativePath(editor.document.uri);
    const fileComments = (client.comments || []).filter(
        (c) => c.filePath === filePath
    );

    const decorations = fileComments.map((comment) => {
        const line = Math.max(0, (comment.line || 1) - 1);
        const range = new vscode.Range(line, 0, line, 0);
        return {
            range,
            renderOptions: {
                after: {
                    contentText: ` \u{1F4AC} ${comment.author}: ${comment.text}`,
                    color: "#FFD700",
                    fontStyle: "italic",
                },
            },
        };
    });

    editor.setDecorations(commentDecorationType, decorations);
}

// ─── Webview Provider ────────────────────────────────────────────────────────

class WebsyncViewProvider {
    resolveWebviewView(webviewViewArg, context) {
        webviewView = webviewViewArg;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.file(path.join(__dirname, "ui")),
            ],
        };

        // Keep the webview alive when switching tabs
        webviewViewArg.onDidChangeVisibility(() => {
            // When becoming visible again, restore session if needed
            if (webviewViewArg.visible && client && client.connected && client.sessionCode) {
                webviewViewArg.webview.postMessage({
                    command: "restoreSession",
                    sessionCode: client.sessionCode,
                    userId: client.userId,
                    role: client.role,
                    users: client.users || [],
                    comments: client.comments || [],
                    serverUrl: currentServerUrl || "http://localhost:3000",
                });
            }
        });

        webviewView.webview.html = getHtml(webviewView.webview);

        webviewView.webview.onDidReceiveMessage((message) => {
            handleWebviewMessage(message);
        });

        // Restore session state if we already have an active connection
        // (happens when webview is re-created after being disposed)
        if (client && client.connected && client.sessionCode) {
            // Wait for webview JS to fully load before sending restore
            setTimeout(() => {
                webviewView.webview.postMessage({
                    command: "restoreSession",
                    sessionCode: client.sessionCode,
                    userId: client.userId,
                    role: client.role,
                    users: client.users || [],
                    comments: client.comments || [],
                    serverUrl: currentServerUrl || "http://localhost:3000",
                });
            }, 800);
        }

        webviewView.onDidDispose(() => {
            webviewView = null;
        });
    }
}

// Helper to persist pendingJoin across extension host reloads
function setPendingJoin(data) {
    pendingJoin = data;
    if (extensionContext) extensionContext.workspaceState.update('pendingJoin', data || null);
}

function getPendingJoin() {
    if (pendingJoin) return pendingJoin;
    if (extensionContext) return extensionContext.workspaceState.get('pendingJoin') || null;
    return null;
}

function clearPendingJoin() {
    pendingJoin = null;
    if (extensionContext) extensionContext.workspaceState.update('pendingJoin', null);
}

// ─── Message Router ──────────────────────────────────────────────────────────

function handleWebviewMessage(message) {
    switch (message.command) {
        case "createSession":
            handleCreateSession(message);
            break;
        case "joinSession":
            handleJoinSession(message);
            break;
        case "disconnect":
            handleDisconnect();
            break;
        case "changeRole":
            client?.changeRole(message.targetUserId, message.newRole);
            break;
        case "kickUser":
            client?.kickUser(message.targetUserId);
            break;
        case "addComment":
            client?.addComment(message.filePath, message.line, message.text);
            break;
        case "deleteComment":
            client?.deleteComment(message.commentId);
            break;
        case "openPreview":
            openPreview();
            break;
        case "startServer":
            startServer()
                .then(() => {
                    vscode.window.showInformationMessage(
                        "WebSync Live: Server started on http://localhost:3000"
                    );
                    postToWebview({ command: "serverStarted" });
                })
                .catch((err) => {
                    vscode.window.showErrorMessage(
                        "WebSync Live: Failed to start server - " + err.message
                    );
                });
            break;
        case "addCommentFromEditor": {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage("WebSync Live: No active editor");
                break;
            }
            if (!client || !client.connected) {
                vscode.window.showWarningMessage("WebSync Live: No active session");
                break;
            }
            vscode.window.showInputBox({
                prompt: "Enter your comment",
                placeHolder: "Type a comment for this line...",
            }).then((text) => {
                if (text) {
                    const filePath = vscode.workspace.asRelativePath(editor.document.uri);
                    const line = editor.selection.active.line + 1;
                    client.addComment(filePath, line, text);
                }
            });
            break;
        }
        case "checkServerStatus":
            if (serverProcess && client && client.connected) {
                postToWebview({ command: "serverStarted" });
            }
            break;
        case "requestRestore":
            if (client && client.connected && client.sessionCode) {
                log("requestRestore: restoring session " + client.sessionCode);
                postToWebview({
                    command: "restoreSession",
                    sessionCode: client.sessionCode,
                    userId: client.userId,
                    role: client.role,
                    users: client.users || [],
                    comments: client.comments || [],
                    serverUrl: currentServerUrl || "http://localhost:3000",
                });
            } else {
                const pj = getPendingJoin();
                if (pj) {
                    // Webview was re-created after workspace folder change — auto-rejoin
                    log("requestRestore: found pendingJoin, auto-joining session " + pj.sessionCode);
                    clearPendingJoin();
                    handleJoinSession(pj);
                }
            }
            break;
        case "startNgrok":
            handleStartNgrok(message);
            break;
        case "stopNgrok":
            handleStopNgrok();
            break;
        case "requestNgrokToken":
            // Send saved token (if any) back to the webview to pre-fill the input
            if (extensionContext) {
                extensionContext.secrets.get("websync.ngrok.token").then((token) => {
                    postToWebview({ command: "ngrokTokenLoaded", token: token || "" });
                });
            }
            break;
        case "clearNgrokToken":
            if (extensionContext) {
                extensionContext.secrets.delete("websync.ngrok.token");
                postToWebview({ command: "ngrokTokenCleared" });
                showToast && vscode.window.showInformationMessage("WebSync Live: ngrok token cleared");
            }
            break;
        case "runCode":
            handleRunCode();
            break;
        case "stopCode":
            handleStopCode();
            break;
        case "changeFolder":
            vscode.commands.executeCommand("websync.changeFolder");
            break;
    }
}

// ─── Session Handlers ────────────────────────────────────────────────────────

async function handleCreateSession(message) {
    try {
        // Start server first
        await startServer();
        currentServerUrl = "http://localhost:3000";

        // Give server a moment to be ready
        await new Promise((resolve) => setTimeout(resolve, 500));

        // Connect as WebSocket client
        client = new WebSyncClient();
        setupClientListeners();

        await client.connect("ws://localhost:3000");
        client.createSession(message.displayName || "Host");

        // Start file watcher for live sync
        startFileWatcher();
    } catch (err) {
        vscode.window.showErrorMessage(
            "Failed to create session: " + err.message
        );
        postToWebview({
            command: "error",
            message: "Failed to create session: " + err.message,
        });
    }
}

async function handleJoinSession(message) {
    try {
        // Ensure the student has a workspace folder open
        let workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            // Save join params to persistent storage — survives extension host reload
            setPendingJoin({ ...message });
            log(`No workspace folder. Saving pendingJoin and creating temp dir...`);

            // Create a temp folder for the student's synced files
            const os = require("os");
            const sessionDir = path.join(os.tmpdir(), `websync-${message.sessionCode || "session"}`);
            if (!fs.existsSync(sessionDir)) {
                fs.mkdirSync(sessionDir, { recursive: true });
            }
            log(`Created temp dir: ${sessionDir}`);

            // Add the folder to the workspace (may trigger webview re-create)
            const added = vscode.workspace.updateWorkspaceFolders(0, 0, {
                uri: vscode.Uri.file(sessionDir),
                name: `WebSync - ${message.sessionCode || "Session"}`,
            });

            if (!added) {
                pendingJoin = null;
                postToWebview({
                    command: "error",
                    message: "Failed to create workspace folder. Please open a folder manually.",
                });
                return;
            }

            // Wait for workspace to settle — if webview was re-created,
            // requestRestore will pick up pendingJoin and call us again
            await new Promise((resolve) => setTimeout(resolve, 1500));

            // If pendingJoin was already consumed by requestRestore, stop here
            if (!getPendingJoin()) {
                log("pendingJoin already consumed by requestRestore — skipping");
                return;
            }
            // Still pending — workspace didn't re-create webview, continue normally
            clearPendingJoin();
        }

        client = new WebSyncClient();
        setupClientListeners();

        const serverUrl = message.serverUrl || "ws://localhost:3000";
        // Derive the HTTP URL from the WS URL for preview
        currentServerUrl = serverUrl
            .replace(/^wss:\/\//, "https://")
            .replace(/^ws:\/\//, "http://");
        await client.connect(serverUrl);
        client.joinSession(
            message.sessionCode,
            message.displayName || "User"
        );
    } catch (err) {
        vscode.window.showErrorMessage(
            "Failed to join session: " + err.message
        );
        postToWebview({
            command: "error",
            message: "Failed to connect: " + err.message,
        });
    }
}

// ─── Client Event Listeners ─────────────────────────────────────────────────

// Helper: always send to the current live webview (survives tab switches)
function postToWebview(msg) {
    if (webviewView && webviewView.webview) {
        webviewView.webview.postMessage(msg);
    }
}

// StatusBar: show nick + session + role
function updateStatusBar(displayName, sessionCode, role) {
    if (!statusBarItem) return;
    const roleIcon = { HOST: "$(megaphone)", ADMIN: "$(shield)", EDITOR: "$(edit)", VIEWER: "$(eye)" }[role] || "$(person)";
    statusBarItem.text = `$(broadcast) ${displayName} | ${sessionCode} ${roleIcon} ${role}`;
    statusBarItem.tooltip = `WebSync Live — ${displayName}\nSession: ${sessionCode}\nRole: ${role}\nClick to disconnect`;
    statusBarItem.show();
}

function setupClientListeners() {
    client.on("session_created", (data) => {
        log(`session_created: code=${data.sessionCode} role=${data.role} userId=${data.userId}`);
        postToWebview({ command: "sessionCreated", ...data, serverUrl: currentServerUrl });
        vscode.window.showInformationMessage(
            `WebSync Live: Session created! Code: ${data.sessionCode}`
        );
        updateStatusBar(client.displayName || "Host", data.sessionCode, data.role);
    });

    client.on("session_joined", (data) => {
        log(`session_joined: code=${data.sessionCode} role=${data.role} userId=${data.userId}`);
        postToWebview({ command: "sessionJoined", ...data, serverUrl: currentServerUrl });
        vscode.window.showInformationMessage(
            `WebSync Live: Joined session ${data.sessionCode}`
        );
        updateStatusBar(client.displayName || "User", data.sessionCode, data.role);

        // Start file watcher for editors/admins so their changes sync
        if (data.role === "editor" || data.role === "admin") {
            startFileWatcher();
        }

        // Enforce read-only for viewers
        updateViewerReadOnly(data.role);
    });

    client.on("user_joined", (data) => {
        postToWebview({ command: "userJoined", ...data });
        vscode.window.showInformationMessage(
            `WebSync Live: ${data.displayName} joined`
        );
    });

    client.on("user_left", (data) => {
        postToWebview({ command: "userLeft", ...data });
        removeRemoteCursor(data.userId);
    });

    client.on("file_update", (data) => {
        isApplyingRemoteEdit = true;
        suppressFileWatcher = true;
        // applyFileUpdate uses WorkspaceEdit+save when file is open → no "content is newer" conflict
        applyFileUpdate(data).finally(() => {
            setTimeout(() => {
                isApplyingRemoteEdit = false;
                suppressFileWatcher = false;
            }, 200);
        });
        postToWebview({ command: "fileUpdate", ...data });
    });

    // Incremental diff from host/editor — only the changed ranges are replaced
    client.on("file_diff", (data) => {
        isApplyingRemoteEdit = true;
        suppressFileWatcher = true;
        applyFileDiff(data.filePath, data.changes).finally(() => {
            setTimeout(() => { isApplyingRemoteEdit = false; suppressFileWatcher = false; }, 200);
        });
        refreshAllPreviews();
        postToWebview({ command: "fileUpdate", filePath: data.filePath });
    });

    // Host switched file — viewers auto-open the same file
    client.on("file_focus", (data) => {
        log(`file_focus: ${data.filePath} by ${data.displayName}`);
        postToWebview({ command: "fileFocus", filePath: data.filePath, displayName: data.displayName });
        if (!data.filePath) return;
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) return;
        const fullPath = path.join(workspaceFolders[0].uri.fsPath, data.filePath);
        if (!fs.existsSync(fullPath)) return;
        vscode.workspace.openTextDocument(vscode.Uri.file(fullPath)).then((doc) => {
            vscode.window.showTextDocument(doc, { preview: false, preserveFocus: true });
        }).catch((err) => log(`file_focus open error: ${err.message}`));
    });

    client.on("comment_added", (data) => {
        postToWebview({ command: "commentAdded", ...data });
        updateCommentDecorations();
    });

    client.on("comment_deleted", (data) => {
        postToWebview({ command: "commentDeleted", ...data });
        updateCommentDecorations();
    });

    client.on("role_changed", (data) => {
        postToWebview({ command: "roleChanged", ...data });
        if (data.userId === client.userId) {
            vscode.window.showInformationMessage(
                `WebSync Live: Your role changed to ${data.newRole}`
            );
            updateStatusBar(client.displayName || "User", client.sessionCode, data.newRole);

            // Update file watcher and read-only based on new role
            if (data.newRole === "editor" || data.newRole === "admin") {
                startFileWatcher();
            } else if (data.newRole === "viewer") {
                // Stop file watcher — viewers don't sync edits
                if (fileWatcher) {
                    fileWatcher.dispose();
                    fileWatcher = null;
                }
            }
            updateViewerReadOnly(data.newRole);
        }
    });

    client.on("kicked", () => {
        postToWebview({ command: "kicked" });
        vscode.window.showWarningMessage(
            "WebSync Live: You have been kicked from the session"
        );
        cleanup();
    });

    client.on("session_closed", (data) => {
        postToWebview({ command: "sessionClosed", ...data });
        vscode.window.showInformationMessage(
            "WebSync Live: Session closed - " + (data.reason || "")
        );
        cleanup();
    });

    client.on("server_error", (data) => {
        vscode.window.showErrorMessage(
            "WebSync Live: " + (data.message || "Server error")
        );
    });

    client.on("disconnected", () => {
        postToWebview({ command: "disconnected" });
    });

    client.on("live_reload", () => {
        refreshAllPreviews();
    });

    // ─── Cursor tracking ─────────────────────────────────────────────
    // Receive remote cursor positions
    client.on("cursor_update", (data) => {
        renderRemoteCursor(data);
    });

    // Send our cursor position on selection change
    startCursorTracking();

    // Host: when a new user joins, server asks us to send all files
    client.on("sync_request", (data) => {
        log(`sync_request received. client.role=${client.role}, targetUserId=${data.targetUserId}`);
        if (client.role !== "host") {
            log("Ignoring sync_request — not host");
            return;
        }
        const targetUserId = data.targetUserId;
        // Save all open documents before gathering so disk matches editor buffers
        vscode.workspace.saveAll(false).then(() => {
            return gatherWorkspaceFiles();
        }).then((files) => {
            log(`Gathered ${files.length} files, sending to ${targetUserId}`);
            files.forEach(f => log(`  - ${f.filePath} (${f.content.length} bytes)`));
            client.sendFullSync(targetUserId, files);
        }).catch((err) => {
            log(`Error gathering files: ${err.message}`);
        });
    });

    // Student: receive all files from host
    client.on("full_sync", (data) => {
        const files = data.files || [];
        log(`full_sync received with ${files.length} files`);

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            log("ERROR: No workspace folder open! Files cannot be written.");
            vscode.window.showErrorMessage(
                "WebSync Live: No folder open — cannot write synced files."
            );
            return;
        }

        isApplyingRemoteEdit = true;
        suppressFileWatcher = true;

        log(`Writing to workspace: ${workspaceFolders[0].uri.fsPath}`);
        vscode.window.showInformationMessage(
            `WebSync Live: Receiving ${files.length} files from host...`
        );
        let firstHtmlFile = null;
        for (const file of files) {
            log(`  Writing: ${file.filePath}`);
            applyFileUpdate(file);
            if (!firstHtmlFile && file.filePath && file.filePath.endsWith(".html")) {
                firstHtmlFile = file.filePath;
            }
        }
        // Open the main file in the editor so the student can see the code
        const fileToOpen = firstHtmlFile || (files.length > 0 ? files[0].filePath : null);
        if (fileToOpen) {
            const fullPath = path.join(workspaceFolders[0].uri.fsPath, fileToOpen);
            log(`Opening file: ${fullPath}`);
            // Small delay to let FS writes settle
            setTimeout(() => {
                vscode.workspace.openTextDocument(vscode.Uri.file(fullPath)).then((doc) => {
                    vscode.window.showTextDocument(doc, { preview: false });
                    log(`File opened in editor: ${fileToOpen}`);
                }).catch((err) => {
                    log(`Error opening file: ${err.message}`);
                });
            }, 300);
        } else {
            log("No file to open after sync");
        }
        // Allow the FS writes and editor updates to settle before re-enabling
        setTimeout(() => {
            isApplyingRemoteEdit = false;
            suppressFileWatcher = false;
        }, 500);
        postToWebview({ command: "syncComplete", fileCount: files.length });
    });
}

// ─── File Watcher ────────────────────────────────────────────────────────────

function startFileWatcher() {
    if (fileWatcher) fileWatcher.dispose();
    if (diffListener) { diffListener.dispose(); diffListener = null; }

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return;

    const ignorePaths = [
        "node_modules", ".git", "ext/", "server/", "client/", "ui/",
        ".env", "package.json", "package-lock.json",
    ];
    const isIgnored = (rel) =>
        ignorePaths.some((p) => rel.startsWith(p) || rel.includes("/" + p));

    // ── FS watcher: detect new file creation only ────────────────────────
    const pattern = new vscode.RelativePattern(
        workspaceFolders[0],
        "**/*.{html,htm,css,js,json,svg,xml,md,txt,py,ts,cpp,c,h,swift,go,rb,sh}"
    );
    fileWatcher = vscode.workspace.createFileSystemWatcher(pattern);

    fileWatcher.onDidCreate((uri) => {
        if (!client || !client.connected || client.role === "viewer") return;
        if (suppressFileWatcher || isApplyingRemoteEdit) return;
        const relativePath = vscode.workspace.asRelativePath(uri);
        if (isIgnored(relativePath)) return;
        try {
            const content = fs.readFileSync(uri.fsPath, "utf-8");
            client.sendFileChange(relativePath, content);
        } catch {}
        refreshAllPreviews();
    });

    // ── Real-time incremental sync via onDidChangeTextDocument ──────────
    // Sends only the changed ranges (throttled 50 ms/file) so viewers
    // apply a surgical edit instead of a full file replacement.
    const lastSendTime = new Map();
    diffListener = vscode.workspace.onDidChangeTextDocument((e) => {
        if (!client || !client.connected) return;
        if (suppressFileWatcher || isApplyingRemoteEdit) return;
        if (client.role === "viewer") return;
        const uri = e.document.uri;
        if (uri.scheme !== "file") return;
        const relativePath = vscode.workspace.asRelativePath(uri);
        if (isIgnored(relativePath)) return;
        if (e.contentChanges.length === 0) return;

        const now = Date.now();
        if (now - (lastSendTime.get(relativePath) || 0) < 50) return;
        lastSendTime.set(relativePath, now);

        const changes = e.contentChanges.map((c) => ({
            range: {
                startLine: c.range.start.line,
                startChar: c.range.start.character,
                endLine:   c.range.end.line,
                endChar:   c.range.end.character,
            },
            text: c.text,
        }));
        client.sendFileDiff(relativePath, changes);
        refreshAllPreviews();
    });

    // ── Full content sync on save (reliable fallback for all cases) ──────
    // Ensures students who don't have the file open stay in sync.
    const saveListener = vscode.workspace.onDidSaveTextDocument((doc) => {
        if (!client || !client.connected) return;
        if (suppressFileWatcher || isApplyingRemoteEdit) return;
        if (client.role === "viewer") return;
        if (doc.uri.scheme !== "file") return;
        const relativePath = vscode.workspace.asRelativePath(doc.uri);
        if (isIgnored(relativePath)) return;
        client.sendFileChange(relativePath, doc.getText());
        refreshAllPreviews();
    });

    // Store all listeners together for disposal
    const prevDiffDispose = diffListener.dispose.bind(diffListener);
    diffListener = {
        dispose: () => {
            prevDiffDispose();
            saveListener.dispose();
        }
    };
}

// ─── Live Reload Watcher (works without session) ────────────────────────────

function startLiveReloadWatcher() {
    if (liveReloadWatcher) return;

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return;

    const pattern = new vscode.RelativePattern(
        workspaceFolders[0],
        "**/*.{html,htm,css,js}"
    );
    liveReloadWatcher = vscode.workspace.createFileSystemWatcher(pattern);

    const handleLiveChange = (uri) => {
        const relativePath = vscode.workspace.asRelativePath(uri);

        // Ignore internal extension files
        const ignorePaths = ["node_modules", ".git", "ext/", "server/", "client/", "ui/"];
        if (ignorePaths.some((p) => relativePath.startsWith(p) || relativePath.includes(p))) {
            return;
        }

        // Debounce to avoid rapid reloads
        if (reloadDebounce) clearTimeout(reloadDebounce);
        reloadDebounce = setTimeout(() => {
            refreshAllPreviews();
        }, 300);
    };

    liveReloadWatcher.onDidChange(handleLiveChange);
    liveReloadWatcher.onDidCreate(handleLiveChange);
    liveReloadWatcher.onDidDelete(handleLiveChange);
}

// ─── Preview Refresh ─────────────────────────────────────────────────────────

function refreshAllPreviews() {
    // Refresh the separate preview panel
    if (previewPanel) {
        previewPanel.webview.postMessage({ command: "reload" });
        // Re-fetch title after reload
        setTimeout(fetchPreviewTitle, 500);
    }
    // Refresh the sidebar iframe
    if (webviewView) {
        webviewView.webview.postMessage({ command: "reloadPreview" });
    }
}

// ─── File Update (for non-host users) ────────────────────────────────────────

/**
 * Apply full file content received from host.
 * If file is open in editor: WorkspaceEdit + save (no "content is newer" conflict).
 * If not open: write directly to disk.
 */
async function applyFileUpdate(data) {
    if (!data.filePath || data.content === undefined) return;

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return;

    const filePath = path.join(workspaceFolders[0].uri.fsPath, data.filePath);
    if (!filePath.startsWith(workspaceFolders[0].uri.fsPath)) return;

    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const uri = vscode.Uri.file(filePath);
    const openDoc = vscode.workspace.textDocuments.find(d => d.uri.fsPath === uri.fsPath);

    if (openDoc) {
        if (openDoc.getText() === data.content) return; // already in sync
        const edit = new vscode.WorkspaceEdit();
        edit.replace(uri, new vscode.Range(
            openDoc.positionAt(0),
            openDoc.positionAt(openDoc.getText().length)
        ), data.content);
        await vscode.workspace.applyEdit(edit);
        await openDoc.save();
    } else {
        try { fs.writeFileSync(filePath, data.content, "utf-8"); } catch (err) {
            log(`applyFileUpdate write error: ${err.message}`);
        }
    }
}

/**
 * Apply incremental diff (array of {range, text}) received from host.
 * Opens the document silently if it isn’t already open.
 */
async function applyFileDiff(filePath, changes) {
    if (!filePath || !changes || changes.length === 0) return;

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return;

    const fullPath = path.join(workspaceFolders[0].uri.fsPath, filePath);
    if (!fs.existsSync(fullPath)) return; // not synced yet — full_sync will cover it

    const uri = vscode.Uri.file(fullPath);
    let openDoc = vscode.workspace.textDocuments.find(d => d.uri.fsPath === uri.fsPath);

    if (!openDoc) {
        try { openDoc = await vscode.workspace.openTextDocument(uri); } catch { return; }
    }

    const edit = new vscode.WorkspaceEdit();
    for (const change of changes) {
        edit.replace(uri, new vscode.Range(
            change.range.startLine, change.range.startChar,
            change.range.endLine,   change.range.endChar
        ), change.text);
    }
    await vscode.workspace.applyEdit(edit);
    await openDoc.save();
}

// ─── Viewer Read-Only Enforcement ────────────────────────────────────────────

// Flag to avoid reverting our own undo or sync edits
let isApplyingRemoteEdit = false;

/**
 * Enable or disable read-only mode for the viewer role.
 * Viewers cannot type or paste — every change is immediately undone.
 */
function updateViewerReadOnly(role) {
    // Dispose previous listener
    if (viewerReadOnlyDisposable) {
        viewerReadOnlyDisposable.dispose();
        viewerReadOnlyDisposable = null;
    }

    if (role !== "viewer") return;

    log("Viewer mode enabled — editor is read-only");

    viewerReadOnlyDisposable = vscode.workspace.onDidChangeTextDocument(async (e) => {
        // Skip if the change was triggered by us (remote sync)
        if (isApplyingRemoteEdit) return;
        // Only care about real content changes
        if (e.contentChanges.length === 0) return;

        const doc = e.document;
        if (doc.uri.scheme !== "file") return;

        // Restore document to its last saved (disk) state.
        // Do NOT use `undo` — it would roll back remote edits from the host.
        isApplyingRemoteEdit = true;
        try {
            const diskContent = fs.readFileSync(doc.uri.fsPath, "utf-8");
            const edit = new vscode.WorkspaceEdit();
            edit.replace(
                doc.uri,
                new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)),
                diskContent
            );
            await vscode.workspace.applyEdit(edit);
            await doc.save();
        } catch (err) {
            log(`Viewer restore error: ${err.message}`);
        } finally {
            isApplyingRemoteEdit = false;
        }

        // Show debounced warning
        if (!viewerWarningDebounce) {
            vscode.window.showWarningMessage(
                "WebSync Live: You are in Viewer mode — editing is disabled"
            );
            viewerWarningDebounce = setTimeout(() => {
                viewerWarningDebounce = null;
            }, 3000);
        }
    });
}

// ─── Collaborative Cursors (Figma-style) ─────────────────────────────────────

// Color palette for remote cursors
const CURSOR_COLORS = [
    { bg: "rgba(255, 107, 107, 0.25)", border: "#FF6B6B", text: "#FF6B6B" },  // red
    { bg: "rgba(78, 205, 196, 0.25)",  border: "#4ECDC4", text: "#4ECDC4" },  // teal
    { bg: "rgba(255, 217, 61, 0.25)",  border: "#FFD93D", text: "#FFD93D" },  // yellow
    { bg: "rgba(108, 92, 231, 0.25)",  border: "#6C5CE7", text: "#6C5CE7" },  // purple
    { bg: "rgba(253, 121, 168, 0.25)", border: "#FD79A8", text: "#FD79A8" },  // pink
    { bg: "rgba(0, 206, 209, 0.25)",   border: "#00CED1", text: "#00CED1" },  // cyan
    { bg: "rgba(255, 165, 2, 0.25)",   border: "#FFA502", text: "#FFA502" },  // orange
    { bg: "rgba(46, 213, 115, 0.25)",  border: "#2ED573", text: "#2ED573" },  // green
];

// Map userId → color index (stable assignment)
const userColorMap = new Map();
let nextColorIndex = 0;

function getUserColor(userId) {
    if (!userColorMap.has(userId)) {
        userColorMap.set(userId, nextColorIndex % CURSOR_COLORS.length);
        nextColorIndex++;
    }
    return CURSOR_COLORS[userColorMap.get(userId)];
}

/**
 * Start tracking local cursor and sending updates to the server
 */
function startCursorTracking() {
    // Dispose previous listener
    if (cursorListenerDisposable) {
        cursorListenerDisposable.dispose();
        cursorListenerDisposable = null;
    }

    let cursorThrottle = null;

    const selectionListener = vscode.window.onDidChangeTextEditorSelection((e) => {
        if (!client || !client.connected) return;

        // Throttle to max ~10 updates/sec
        if (cursorThrottle) return;
        cursorThrottle = setTimeout(() => { cursorThrottle = null; }, 100);

        const editor = e.textEditor;
        const sel = e.selections[0];
        const filePath = vscode.workspace.asRelativePath(editor.document.uri);

        const selection = sel.isEmpty ? null : {
            startLine: sel.start.line,
            startChar: sel.start.character,
            endLine: sel.end.line,
            endChar: sel.end.character,
        };

        client.sendCursorUpdate(filePath, sel.active.line, sel.active.character, selection);
    });

    // When the user switches to a different editor tab, re-render cursors for that file
    const editorChangeListener = vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (!editor) return;
        const filePath = vscode.workspace.asRelativePath(editor.document.uri);

        // Host/admin: tell all viewers which file is now active
        if (client && client.connected && (client.role === "host" || client.role === "admin")) {
            client.sendFileFocus(filePath);
        }

        // Re-render all cursors that are in this file
        remoteCursorDecorations.forEach((cursor, userId) => {
            if (cursor.filePath === filePath && cursor.line != null) {
                renderRemoteCursor({
                    userId,
                    displayName: cursor.displayName,
                    filePath: cursor.filePath,
                    line: cursor.line,
                    character: cursor.character,
                });
            }
        });
    });

    // Combine disposables
    cursorListenerDisposable = {
        dispose: () => {
            selectionListener.dispose();
            editorChangeListener.dispose();
        }
    };
}

/**
 * Render a remote user's cursor as a decoration in the editor
 */
function renderRemoteCursor(data) {
    const { userId, displayName, filePath, line, character } = data;
    if (!filePath || line == null) return;

    const color = getUserColor(userId);

    // Dispose previous decoration for this user
    const prev = remoteCursorDecorations.get(userId);
    if (prev) {
        if (prev.cursorType && prev.cursorType.dispose) prev.cursorType.dispose();
        if (prev.labelType && prev.labelType.dispose) prev.labelType.dispose();
        if (prev.selectionType && prev.selectionType.dispose) prev.selectionType.dispose();
    }

    // Find the editor for this file
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return;

    const fullPath = path.join(workspaceFolders[0].uri.fsPath, filePath);
    const targetUri = vscode.Uri.file(fullPath);

    // Check if the file is open in a visible editor
    const visibleEditor = vscode.window.visibleTextEditors.find(
        (ed) => ed.document.uri.fsPath === targetUri.fsPath
    );

    if (!visibleEditor) {
        // File not visible — just store position for later
        remoteCursorDecorations.set(userId, {
            cursorType: { dispose: () => {} },
            labelType: null,
            filePath,
            line,
            character,
            displayName,
        });
        return;
    }

    const cursorPos = new vscode.Position(line, character);

    // Create cursor line decoration (thin colored border on the left)
    const cursorType = vscode.window.createTextEditorDecorationType({
        borderWidth: "0 0 0 2px",
        borderStyle: "solid",
        borderColor: color.border,
        backgroundColor: color.bg,
        isWholeLine: false,
    });

    // Create label decoration (shows user name above cursor)
    const labelType = vscode.window.createTextEditorDecorationType({
        after: {
            contentText: ` ${displayName}`,
            color: color.text,
            backgroundColor: color.border + "22",
            fontStyle: "normal",
            fontWeight: "bold",
            fontSize: "11px",
            margin: "0 0 0 4px",
            border: `1px solid ${color.border}44`,
            textDecoration: ";border-radius:3px;padding:0 4px;",
        },
    });

    // Selection highlight
    let selectionType = null;
    if (data.selectionStartLine != null && data.selectionEndLine != null) {
        selectionType = vscode.window.createTextEditorDecorationType({
            backgroundColor: color.bg,
        });

        const selRange = new vscode.Range(
            data.selectionStartLine,
            data.selectionStartChar || 0,
            data.selectionEndLine,
            data.selectionEndChar || 0
        );

        visibleEditor.setDecorations(selectionType, [selRange]);
    }

    // Apply cursor decoration (the character position)
    const cursorRange = new vscode.Range(cursorPos, cursorPos.translate(0, 1));
    visibleEditor.setDecorations(cursorType, [cursorRange]);

    // Apply label on the same line (after the cursor character)
    visibleEditor.setDecorations(labelType, [{
        range: new vscode.Range(cursorPos, cursorPos),
    }]);

    remoteCursorDecorations.set(userId, {
        cursorType,
        labelType,
        selectionType,
        filePath,
        line,
        character,
        displayName,
    });
}

/**
 * Remove a remote user's cursor decoration
 */
function removeRemoteCursor(userId) {
    const cursor = remoteCursorDecorations.get(userId);
    if (cursor) {
        if (cursor.cursorType && cursor.cursorType.dispose) cursor.cursorType.dispose();
        if (cursor.labelType && cursor.labelType.dispose) cursor.labelType.dispose();
        if (cursor.selectionType && cursor.selectionType.dispose) cursor.selectionType.dispose();
        remoteCursorDecorations.delete(userId);
    }
}

/**
 * Clear all remote cursor decorations
 */
function clearAllRemoteCursors() {
    remoteCursorDecorations.forEach((cursor, userId) => {
        removeRemoteCursor(userId);
    });
    remoteCursorDecorations.clear();
    userColorMap.clear();
    nextColorIndex = 0;
}

async function gatherWorkspaceFiles() {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return [];

    const rootPath = workspaceFolders[0].uri.fsPath;
    const files = [];

    const ignoreDirs = new Set([
        "node_modules", ".git", ".vscode", "ext", "server", "client", "ui",
        ".DS_Store", "dist", "build", ".next", "__pycache__"
    ]);

    const supportedExts = new Set([
        ".html", ".htm", ".css", ".js", ".json", ".svg", ".xml",
        ".txt", ".md", ".ts", ".jsx", ".tsx", ".mjs", ".scss",
        ".less", ".yaml", ".yml", ".toml", ".py", ".php"
    ]);

    function walkDir(dir, relativeTo) {
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch (e) {
            return;
        }

        for (const entry of entries) {
            if (entry.name.startsWith(".")) continue;
            const fullPath = path.join(dir, entry.name);
            const relPath = path.relative(relativeTo, fullPath);

            if (entry.isDirectory()) {
                if (!ignoreDirs.has(entry.name)) {
                    walkDir(fullPath, relativeTo);
                }
            } else if (entry.isFile()) {
                const ext = path.extname(entry.name).toLowerCase();
                if (supportedExts.has(ext)) {
                    try {
                        const stat = fs.statSync(fullPath);
                        // Skip files larger than 500KB
                        if (stat.size > 500 * 1024) continue;

                        const content = fs.readFileSync(fullPath, "utf-8");
                        files.push({ filePath: relPath, content });
                    } catch (e) {
                        // skip unreadable files
                    }
                }
            }
        }
    }

    walkDir(rootPath, rootPath);
    return files;
}

// ─── Server Management ──────────────────────────────────────────────────────

function startServer() {
    if (serverProcess) {
        return Promise.resolve();
    }

    const workspaceFolders = vscode.workspace.workspaceFolders;
    const workspacePath = workspaceFolders
        ? workspaceFolders[0].uri.fsPath
        : __dirname;

    return new Promise((resolve, reject) => {
        const serverPath = path.join(__dirname, "server/server.js");

        // Use the same Node/Electron binary that VS Code is running on.
        // spawn("node", ...) fails with ENOENT when node is not in PATH.
        // ELECTRON_RUN_AS_NODE=1 makes the VS Code binary behave as plain Node.js.
        serverProcess = spawn(process.execPath, [serverPath], {
            env: {
                ...process.env,
                ELECTRON_RUN_AS_NODE: "1",
                WORKSPACE_PATH: workspacePath,
                PORT: "3000",
            },
            detached: false,
            stdio: "pipe",
        });

        serverProcess.stdout.on("data", (data) => {
            console.log("[WebSync Server]", data.toString().trim());
        });

        serverProcess.stderr.on("data", (data) => {
            console.error("[WebSync Server Error]", data.toString().trim());
        });

        serverProcess.on("error", (error) => {
            log(`Server start error: ${error.message} (code: ${error.code})`);
            console.error("[WebSync] Server start error:", error.message);
            serverProcess = null;
            reject(error);
        });

        serverProcess.on("exit", (code) => {
            console.log(`[WebSync] Server exited with code ${code}`);
            serverProcess = null;
        });

        // Give server time to start listening
        setTimeout(resolve, 1500);
    });
}

// ─── Preview Panel ──────────────────────────────────────────────────────────

function fetchPreviewTitle() {
    const previewUrl = currentServerUrl || "http://localhost:3000";
    const httpModule = previewUrl.startsWith("https") ? require("https") : require("http");
    httpModule.get(previewUrl, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
            const match = data.match(/<title[^>]*>([^<]+)<\/title>/i);
            if (match && match[1] && previewPanel) {
                previewPanel.title = "WebSync - " + match[1].trim();
            }
        });
    }).on("error", () => {});
}

function openPreview() {
    if (previewPanel) {
        previewPanel.reveal();
        fetchPreviewTitle();
        return;
    }

    previewPanel = vscode.window.createWebviewPanel(
        "websync-preview",
        "WebSync",
        vscode.ViewColumn.Beside,
        {
            enableScripts: true,
            retainContextWhenHidden: true,
        }
    );

    previewPanel.webview.html = `<!DOCTYPE html>
<html>
<head>
    <style>
        body, html { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: #1e1e1e; }
        iframe { width: 100%; height: 100%; border: none; }
        .loading { display: flex; align-items: center; justify-content: center; height: 100%; color: #ccc; font-family: sans-serif; }
    </style>
</head>
<body>
    <iframe src="${currentServerUrl || 'http://localhost:3000'}" id="preview"></iframe>
    <script>
        const vscode = acquireVsCodeApi();
        window.addEventListener('message', (event) => {
            const msg = event.data;
            if (msg.command === 'reload') {
                const iframe = document.getElementById('preview');
                if (iframe) {
                    const url = new URL(iframe.src);
                    url.searchParams.set('_t', Date.now());
                    iframe.src = url.toString();
                }
            }
        });
    </script>
</body>
</html>`;

    // Fetch title from server after iframe has time to load
    setTimeout(fetchPreviewTitle, 1000);

    previewPanel.onDidDispose(() => {
        previewPanel = null;
    });
}

// ─── Ngrok Tunnel (CLI-based, cross-platform) ───────────────────────────────

async function handleStartNgrok(message) {
    if (ngrokUrl) {
        postToWebview({ command: "ngrokStarted", url: ngrokUrl });
        return;
    }

    const authtoken = message.authtoken || "";
    if (!authtoken) {
        vscode.window.showErrorMessage(
            "WebSync Live: ngrok authtoken is required. Get one at https://dashboard.ngrok.com/get-started/your-authtoken"
        );
        postToWebview({ command: "ngrokError", message: "Authtoken required" });
        return;
    }

    try {
        // Ensure server is running first
        await startServer();

        postToWebview({ command: "ngrokConnecting" });

        // Find ngrok executable
        const ngrokCmd = process.platform === "win32" ? "ngrok.exe" : "ngrok";

        // Spawn ngrok CLI process
        ngrokProcess = spawn(ngrokCmd, [
            "http", "3000",
            "--authtoken", authtoken,
            "--log", "stdout",
            "--log-format", "json"
        ], {
            shell: true,
            stdio: ["ignore", "pipe", "pipe"],
            env: { ...process.env }
        });

        let resolved = false;

        // Wait for tunnel URL from ngrok's local API
        const tunnelUrl = await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    reject(new Error("ngrok timed out after 15 seconds. Make sure ngrok is installed and in PATH."));
                }
            }, 15000);

            ngrokProcess.stdout.on("data", (chunk) => {
                const lines = chunk.toString().split("\n").filter(Boolean);
                for (const line of lines) {
                    try {
                        const json = JSON.parse(line);
                        // ngrok logs the URL in a "start tunnel" message
                        if (json.url && json.url.startsWith("https://")) {
                            if (!resolved) {
                                resolved = true;
                                clearTimeout(timeout);
                                resolve(json.url);
                            }
                        }
                    } catch {
                        // not JSON, try regex fallback
                        const match = line.match(/url=(https:\/\/[^\s"]+)/);
                        if (match && !resolved) {
                            resolved = true;
                            clearTimeout(timeout);
                            resolve(match[1]);
                        }
                    }
                }
            });

            ngrokProcess.stderr.on("data", (chunk) => {
                const text = chunk.toString();
                log(`[ngrok stderr] ${text}`);
                if (text.includes("ERR") && !resolved) {
                    resolved = true;
                    clearTimeout(timeout);
                    reject(new Error(text.trim()));
                }
            });

            ngrokProcess.on("error", (err) => {
                clearTimeout(timeout);
                if (!resolved) {
                    resolved = true;
                    if (err.code === "ENOENT") {
                        reject(new Error(
                            "ngrok not found. Install it from https://ngrok.com/download and make sure it's in your PATH."
                        ));
                    } else {
                        reject(err);
                    }
                }
            });

            ngrokProcess.on("exit", (code) => {
                if (!resolved) {
                    resolved = true;
                    clearTimeout(timeout);
                    reject(new Error(`ngrok exited with code ${code}. Check Output panel for details.`));
                }
            });

            // Also poll the ngrok local API as a reliable fallback
            const pollApi = async () => {
                for (let i = 0; i < 30 && !resolved; i++) {
                    await new Promise(r => setTimeout(r, 500));
                    try {
                        const http = require("http");
                        const data = await new Promise((res, rej) => {
                            const req = http.get("http://127.0.0.1:4040/api/tunnels", (resp) => {
                                let body = "";
                                resp.on("data", c => body += c);
                                resp.on("end", () => res(body));
                            });
                            req.on("error", rej);
                            req.setTimeout(2000, () => { req.destroy(); rej(new Error("timeout")); });
                        });
                        const tunnels = JSON.parse(data);
                        const tunnel = tunnels.tunnels && tunnels.tunnels.find(
                            t => t.proto === "https" || t.public_url.startsWith("https")
                        );
                        if (tunnel && !resolved) {
                            resolved = true;
                            clearTimeout(timeout);
                            resolve(tunnel.public_url);
                        }
                    } catch {
                        // API not ready yet, keep trying
                    }
                }
            };
            pollApi();
        });

        ngrokUrl = tunnelUrl;
        const wsUrl = ngrokUrl.replace(/^https?:\/\//, "wss://");

        // Save token securely for next session
        if (extensionContext) {
            await extensionContext.secrets.store("websync.ngrok.token", authtoken);
            log("[ngrok] authtoken saved to SecretStorage");
        }

        log(`[ngrok] tunnel active: ${ngrokUrl}`);
        vscode.window.showInformationMessage(
            `WebSync Live: ngrok tunnel active at ${ngrokUrl}`
        );

        postToWebview({
            command: "ngrokStarted",
            url: ngrokUrl,
            wsUrl: wsUrl,
        });
    } catch (err) {
        log(`[ngrok error] ${err.stack || err.message || err}`);
        await stopNgrok();
        const errMsg = err.message || String(err);
        vscode.window.showErrorMessage(
            "WebSync Live: Failed to start ngrok - " + errMsg
        );
        postToWebview({
            command: "ngrokError",
            message: errMsg,
        });
    }
}

async function handleStopNgrok() {
    await stopNgrok();
    postToWebview({ command: "ngrokStopped" });
    vscode.window.showInformationMessage("WebSync Live: ngrok tunnel closed");
}

async function stopNgrok() {
    if (ngrokProcess) {
        try {
            ngrokProcess.kill();
        } catch (e) {
            // ignore
        }
        ngrokProcess = null;
        ngrokUrl = null;
    }
}

// ─── Cleanup ─────────────────────────────────────────────────────────────────

function handleDisconnect() {
    cleanup();
    postToWebview({ command: "disconnected" });
    vscode.window.showInformationMessage("WebSync Live: Disconnected");
}

function cleanup() {
    if (client) {
        client.disconnect();
        client = null;
    }

    if (fileWatcher) {
        fileWatcher.dispose();
        fileWatcher = null;
    }

    if (diffListener) {
        diffListener.dispose();
        diffListener = null;
    }

    // Remove viewer read-only enforcement
    if (viewerReadOnlyDisposable) {
        viewerReadOnlyDisposable.dispose();
        viewerReadOnlyDisposable = null;
    }
    isApplyingRemoteEdit = false;
    suppressFileWatcher = false;
    if (viewerWarningDebounce) {
        clearTimeout(viewerWarningDebounce);
        viewerWarningDebounce = null;
    }

    // Remove cursor tracking and decorations
    if (cursorListenerDisposable) {
        cursorListenerDisposable.dispose();
        cursorListenerDisposable = null;
    }
    clearAllRemoteCursors();

    pendingJoin = null;
    clearPendingJoin();

    if (liveReloadWatcher) {
        liveReloadWatcher.dispose();
        liveReloadWatcher = null;
    }

    if (serverProcess) {
        try {
            serverProcess.kill();
        } catch (e) {
            // ignore
        }
        serverProcess = null;
    }

    if (runCodeProcess) {
        try { runCodeProcess.kill(); } catch {}
        runCodeProcess = null;
    }

    stopNgrok();
    currentServerUrl = null;

    // Hide statusbar
    if (statusBarItem) {
        statusBarItem.hide();
    }
}

// ─── HTML Generator ──────────────────────────────────────────────────────────

function getHtml(webview) {
    const htmlPath = path.join(__dirname, "ui", "index.html");
    let html = fs.readFileSync(htmlPath, "utf-8");

    const uiDir = vscode.Uri.file(path.join(__dirname, "ui"));
    const webviewUri = webview.asWebviewUri(uiDir);

    html = html.replace(/href="public\//g, `href="${webviewUri}/public/`);
    html = html.replace(/src="public\//g, `src="${webviewUri}/public/`);

    return html;
}

// ─── Extension Activation ───────────────────────────────────────────────────

function activate(context) {
    extensionContext = context;
    commentDecorationType = createCommentDecoration();

    // Create statusbar item
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBarItem.command = "websync.disconnect";
    context.subscriptions.push(statusBarItem);

    // Register the sidebar webview provider
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            "websync-live-view",
            new WebsyncViewProvider()
        )
    );

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand("websync.open", () => {
            openPreview();
        }),

        vscode.commands.registerCommand("websync.startServer", () => {
            startServer()
                .then(() => {
                    vscode.window.showInformationMessage(
                        "WebSync Live: Server started on http://localhost:3000"
                    );
                })
                .catch((err) => {
                    vscode.window.showErrorMessage(
                        "WebSync Live: Failed to start server - " + err.message
                    );
                });
        }),

        vscode.commands.registerCommand("websync.createSession", () => {
            vscode.commands.executeCommand("websyncLive.focus");
        }),

        vscode.commands.registerCommand("websync.joinSession", async () => {
            const code = await vscode.window.showInputBox({
                prompt: "Enter the session code to join",
                placeHolder: "e.g., A1B2C3",
            });
            if (code && webviewView) {
                webviewView.webview.postMessage({
                    command: "triggerJoin",
                    sessionCode: code,
                });
            }
        }),

        vscode.commands.registerCommand("websync.addComment", async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || !client || !client.connected) {
                vscode.window.showWarningMessage(
                    "WebSync Live: No active session or editor"
                );
                return;
            }

            const text = await vscode.window.showInputBox({
                prompt: "Enter your comment",
                placeHolder: "Type a comment for this line...",
            });

            if (text) {
                const filePath = vscode.workspace.asRelativePath(
                    editor.document.uri
                );
                const line = editor.selection.active.line + 1;
                client.addComment(filePath, line, text);
            }
        }),

        vscode.commands.registerCommand("websync.disconnect", () => {
            if (webviewView) {
                handleDisconnect();
            } else {
                cleanup();
                vscode.window.showInformationMessage(
                    "WebSync Live: Disconnected"
                );
            }
        }),

        vscode.commands.registerCommand("websync.changeFolder", async () => {
            const folders = await vscode.window.showOpenDialog({
                canSelectFolders: true,
                canSelectFiles: false,
                canSelectMany: false,
                openLabel: "Set as Server Root",
                title: "WebSync Live: Choose Server Root Folder",
            });
            if (!folders || folders.length === 0) return;

            const newPath = folders[0].fsPath;

            // Kill existing server, restart with new workspace path
            if (serverProcess) {
                try { serverProcess.kill(); } catch {}
                serverProcess = null;
            }

            const serverPathFile = path.join(__dirname, "server/server.js");
            serverProcess = spawn(process.execPath, [serverPathFile], {
                env: {
                    ...process.env,
                    ELECTRON_RUN_AS_NODE: "1",
                    WORKSPACE_PATH: newPath,
                    PORT: "3000",
                    HOST: "localhost",
                    PROTOCOL: "http",
                },
                stdio: ["ignore", "pipe", "pipe"],
            });
            serverProcess.stdout.on("data", (d) => log(`[server] ${d.toString().trim()}`));
            serverProcess.stderr.on("data", (d) => log(`[server err] ${d.toString().trim()}`));

            vscode.window.showInformationMessage(
                `WebSync Live: Server root → ${path.basename(newPath)}`
            );
            postToWebview({ command: "serverFolderChanged", folder: path.basename(newPath), fullPath: newPath });
            setTimeout(() => refreshAllPreviews(), 800);
        }),

        vscode.commands.registerCommand("websync.runCode", () => handleRunCode()),
        vscode.commands.registerCommand("websync.stopCode", () => handleStopCode())
    );

    // Start live reload watcher (always on, independent of sessions)
    startLiveReloadWatcher();

    // Update comment decorations when editor changes
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(() => {
            updateCommentDecorations();
        })
    );

    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(() => {
            updateCommentDecorations();
        })
    );
}

// ─── Extension Deactivation ─────────────────────────────────────────────────

function deactivate() {
    cleanup();
    if (commentDecorationType) {
        commentDecorationType.dispose();
        commentDecorationType = null;
    }
    if (statusBarItem) {
        statusBarItem.dispose();
        statusBarItem = null;
    }
}

module.exports = { activate, deactivate };
