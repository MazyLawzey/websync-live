/*
    ######################################################################
    WebSync Live - copyright (c) 2026 MazyLawzey
    https://github.com/MazyLawzey - MazyLawzey main author of WebSync Live
    https://github.com/rionn11 - rionn11 main contributor of WebSync Live
    https://github.com/MazyLawzey/websync-live - OUR REPO
    GPL-3.0 license
    #######################################################################
*/

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '.env_server') });

// Import server modules
const { ROLES, canEdit, canComment, canKick, canChangeRole } = require('./server/permissions/permissions');
const { injectLiveReload } = require('./server/webview/updater');
const { CommentStore } = require('./server/code/comments');

// Try to load ws from multiple locations
let WebSocketServer;
try {
    WebSocketServer = require('ws').WebSocketServer;
} catch (e) {
    try {
        WebSocketServer = require(path.join(__dirname, '..', 'node_modules', 'ws')).WebSocketServer;
    } catch (e2) {
        console.error('Failed to load ws package. Please run: npm install ws');
        process.exit(1);
    }
}

// ─── Configuration ───────────────────────────────────────────────────────────

const WORKSPACE_PATH = process.env.WORKSPACE_PATH || process.argv[2] || process.cwd();
const PORT = process.env.PORT || 3000;
const PROTOCOL = process.env.PROTOCOL || 'http';
const HOST = process.env.HOST || 'localhost';

// ─── Express App ─────────────────────────────────────────────────────────────

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// ─── Session Storage ─────────────────────────────────────────────────────────

const sessions = new Map();

// ─── Utility Functions ───────────────────────────────────────────────────────

function generateSessionCode() {
    return crypto.randomBytes(3).toString('hex').toUpperCase();
}

function generateUserId() {
    return 'u_' + crypto.randomBytes(4).toString('hex');
}

function getUserList(session) {
    const users = [];
    session.users.forEach(user => {
        users.push({
            id: user.id,
            displayName: user.displayName,
            role: user.role
        });
    });
    return users;
}

function broadcastToSession(session, message, excludeUserId = null) {
    const data = JSON.stringify(message);
    session.users.forEach((user) => {
        if (user.id !== excludeUserId && user.ws && user.ws.readyState === 1) {
            try {
                user.ws.send(data);
            } catch (err) {
                console.error(`Failed to send to user ${user.id}:`, err.message);
            }
        }
    });
}

function broadcastLiveReload() {
    const data = JSON.stringify({ type: 'live_reload' });
    wss.clients.forEach(client => {
        if (client.readyState === 1) {
            try {
                client.send(data);
            } catch (err) {
                // ignore send errors
            }
        }
    });
}

// ─── MIME Types ──────────────────────────────────────────────────────────────

const MIME_TYPES = {
    '.html': 'text/html',
    '.htm': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.mjs': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.eot': 'application/vnd.ms-fontobject',
    '.otf': 'font/otf',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.pdf': 'application/pdf',
    '.xml': 'application/xml',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.webp': 'image/webp'
};

// ─── HTTP Routes (Serve Workspace Files) ─────────────────────────────────────

app.use((req, res) => {
    let reqPath = decodeURIComponent(req.path);
    let filePath = path.join(WORKSPACE_PATH, reqPath === '/' ? 'index.html' : reqPath);

    // Security: prevent path traversal
    if (!filePath.startsWith(WORKSPACE_PATH)) {
        res.status(403).send('Forbidden');
        return;
    }

    // If path is a directory, look for index.html
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
        filePath = path.join(filePath, 'index.html');
    }

    if (!fs.existsSync(filePath)) {
        // Fallback error page
        const fallbackPath = path.join(__dirname, 'ui/index.html');
        if (fs.existsSync(fallbackPath)) {
            res.status(404).sendFile(fallbackPath);
        } else {
            res.status(404).send('<!DOCTYPE html><html><body><h1>404 - File not found</h1></body></html>');
        }
        return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.status(500).send('Error reading file');
            return;
        }

        // Inject live reload script into HTML files
        if (ext === '.html' || ext === '.htm') {
            const html = injectLiveReload(data.toString());
            res.type(contentType).send(html);
        } else {
            res.type(contentType).send(data);
        }
    });
});

// ─── WebSocket Message Handlers ──────────────────────────────────────────────

function handleCreateSession(ws, message) {
    const sessionCode = generateSessionCode();
    const userId = generateUserId();
    const displayName = message.displayName || 'Host';

    const session = {
        code: sessionCode,
        hostId: userId,
        users: new Map(),
        comments: new CommentStore(),
        createdAt: Date.now()
    };

    session.users.set(userId, {
        id: userId,
        displayName: displayName,
        role: ROLES.HOST,
        ws: ws
    });

    sessions.set(sessionCode, session);

    ws.userId = userId;
    ws.sessionCode = sessionCode;
    ws.role = ROLES.HOST;
    ws.displayName = displayName;

    ws.send(JSON.stringify({
        type: 'session_created',
        sessionCode,
        userId,
        role: ROLES.HOST,
        users: getUserList(session)
    }));

    console.log(`[Session] Created: ${sessionCode} by ${displayName} (${userId})`);
}

function handleJoinSession(ws, message) {
    const session = sessions.get(message.sessionCode);

    if (!session) {
        ws.send(JSON.stringify({ type: 'error', message: 'Session not found. Check the session code.' }));
        return;
    }

    const userId = generateUserId();
    const displayName = message.displayName || 'User';
    const role = ROLES.VIEWER; // Default role for new joiners

    session.users.set(userId, {
        id: userId,
        displayName: displayName,
        role: role,
        ws: ws
    });

    ws.userId = userId;
    ws.sessionCode = message.sessionCode;
    ws.role = role;
    ws.displayName = displayName;

    // Send session info to the new user
    ws.send(JSON.stringify({
        type: 'session_joined',
        sessionCode: message.sessionCode,
        userId,
        role,
        users: getUserList(session),
        comments: session.comments.getAll()
    }));

    // Notify all other users
    broadcastToSession(session, {
        type: 'user_joined',
        userId,
        displayName,
        role,
        users: getUserList(session)
    }, userId);

    // Ask the host to send all files to the new user
    const host = session.users.get(session.hostId);
    if (host && host.ws && host.ws.readyState === 1) {
        host.ws.send(JSON.stringify({
            type: 'sync_request',
            targetUserId: userId
        }));
    }

    console.log(`[Session] ${displayName} (${userId}) joined ${message.sessionCode} as ${role}`);
}

function handleFileChange(ws, message) {
    const session = sessions.get(ws.sessionCode);
    if (!session) return;

    if (!canEdit(ws.role)) {
        ws.send(JSON.stringify({ type: 'error', message: 'You do not have permission to edit files.' }));
        return;
    }

    // Broadcast file change to all other users
    broadcastToSession(session, {
        type: 'file_update',
        filePath: message.filePath,
        content: message.content,
        userId: ws.userId
    }, ws.userId);

    // Trigger live reload for all preview connections
    broadcastLiveReload();
}

function handleCursorUpdate(ws, message) {
    const session = sessions.get(ws.sessionCode);
    if (!session) return;

    // Broadcast cursor position to all other users
    broadcastToSession(session, {
        type: 'cursor_update',
        userId: ws.userId,
        displayName: ws.displayName,
        filePath: message.filePath,
        line: message.line,
        character: message.character,
        // Optional: selection range
        selectionStartLine: message.selectionStartLine,
        selectionStartChar: message.selectionStartChar,
        selectionEndLine: message.selectionEndLine,
        selectionEndChar: message.selectionEndChar,
    }, ws.userId);
}

function handleAddComment(ws, message) {
    const session = sessions.get(ws.sessionCode);
    if (!session) return;

    if (!canComment(ws.role)) {
        ws.send(JSON.stringify({ type: 'error', message: 'You do not have permission to comment.' }));
        return;
    }

    const comment = {
        id: 'c_' + crypto.randomBytes(4).toString('hex'),
        filePath: message.filePath,
        line: message.line,
        text: message.text,
        author: ws.displayName,
        authorId: ws.userId,
        createdAt: Date.now()
    };

    session.comments.add(comment);

    // Broadcast to all users (including sender - for confirmation)
    broadcastToSession(session, {
        type: 'comment_added',
        comment
    });

    console.log(`[Comment] ${ws.displayName} commented on ${message.filePath}:${message.line}`);
}

function handleDeleteComment(ws, message) {
    const session = sessions.get(ws.sessionCode);
    if (!session) return;

    const comment = session.comments.findById(message.commentId);
    if (!comment) {
        ws.send(JSON.stringify({ type: 'error', message: 'Comment not found.' }));
        return;
    }

    // Only author, host, or admin can delete comments
    if (comment.authorId !== ws.userId && ws.role !== ROLES.HOST && ws.role !== ROLES.ADMIN) {
        ws.send(JSON.stringify({ type: 'error', message: 'You do not have permission to delete this comment.' }));
        return;
    }

    session.comments.delete(message.commentId);

    broadcastToSession(session, {
        type: 'comment_deleted',
        commentId: message.commentId
    });
}

function handleChangeRole(ws, message) {
    const session = sessions.get(ws.sessionCode);
    if (!session) return;

    const targetUser = session.users.get(message.targetUserId);
    if (!targetUser) {
        ws.send(JSON.stringify({ type: 'error', message: 'User not found.' }));
        return;
    }

    if (!canChangeRole(ws.role, targetUser.role, message.newRole)) {
        ws.send(JSON.stringify({ type: 'error', message: 'You do not have permission to change this role.' }));
        return;
    }

    const oldRole = targetUser.role;
    targetUser.role = message.newRole;

    // Update the target user's ws metadata
    if (targetUser.ws) {
        targetUser.ws.role = message.newRole;
    }

    broadcastToSession(session, {
        type: 'role_changed',
        userId: message.targetUserId,
        oldRole,
        newRole: message.newRole,
        users: getUserList(session)
    });

    console.log(`[Role] ${ws.displayName} changed ${targetUser.displayName}'s role: ${oldRole} -> ${message.newRole}`);
}

function handleKickUser(ws, message) {
    const session = sessions.get(ws.sessionCode);
    if (!session) return;

    const targetUser = session.users.get(message.targetUserId);
    if (!targetUser) {
        ws.send(JSON.stringify({ type: 'error', message: 'User not found.' }));
        return;
    }

    if (!canKick(ws.role, targetUser.role)) {
        ws.send(JSON.stringify({ type: 'error', message: 'You do not have permission to kick this user.' }));
        return;
    }

    // Notify the kicked user
    if (targetUser.ws && targetUser.ws.readyState === 1) {
        targetUser.ws.send(JSON.stringify({ type: 'kicked', reason: `Kicked by ${ws.displayName}` }));
        targetUser.ws.close();
    }

    session.users.delete(message.targetUserId);

    broadcastToSession(session, {
        type: 'user_left',
        userId: message.targetUserId,
        displayName: targetUser.displayName,
        reason: 'kicked',
        users: getUserList(session)
    });

    console.log(`[Kick] ${ws.displayName} kicked ${targetUser.displayName}`);
}

function handleFullSync(ws, message) {
    // Host sends full file sync to a specific user
    const session = sessions.get(ws.sessionCode);
    if (!session) return;

    // Only host can send full sync
    if (ws.role !== ROLES.HOST) return;

    const targetUser = session.users.get(message.targetUserId);
    if (!targetUser || !targetUser.ws || targetUser.ws.readyState !== 1) return;

    // Forward all the files to the target user
    targetUser.ws.send(JSON.stringify({
        type: 'full_sync',
        files: message.files || []
    }));

    console.log(`[Sync] Host sent ${(message.files || []).length} files to ${targetUser.displayName}`);
}

function handleFileDiff(ws, message) {
    const session = sessions.get(ws.sessionCode);
    if (!session) return;
    if (!canEdit(ws.role)) return;

    broadcastToSession(session, {
        type: 'file_diff',
        filePath: message.filePath,
        changes: message.changes || [],
        userId: ws.userId
    }, ws.userId);

    broadcastLiveReload();
}

function handleFileFocus(ws, message) {
    const session = sessions.get(ws.sessionCode);
    if (!session) return;
    // Only host/admin can push "follow me" file focus to others
    if (ws.role !== ROLES.HOST && ws.role !== ROLES.ADMIN) return;

    broadcastToSession(session, {
        type: 'file_focus',
        filePath: message.filePath,
        userId: ws.userId,
        displayName: ws.displayName
    }, ws.userId);
}

function handleDisconnect(ws) {
    if (!ws.sessionCode) return;

    const session = sessions.get(ws.sessionCode);
    if (!session) return;

    const displayName = ws.displayName || 'Unknown';
    session.users.delete(ws.userId);

    // If host left, close the entire session
    if (ws.role === ROLES.HOST) {
        console.log(`[Session] Host ${displayName} disconnected. Closing session ${ws.sessionCode}`);

        broadcastToSession(session, {
            type: 'session_closed',
            reason: 'Host disconnected'
        });

        // Close all remaining connections
        session.users.forEach(user => {
            if (user.ws && user.ws.readyState === 1) {
                user.ws.close();
            }
        });

        sessions.delete(ws.sessionCode);
    } else {
        console.log(`[Session] ${displayName} left ${ws.sessionCode}`);

        broadcastToSession(session, {
            type: 'user_left',
            userId: ws.userId,
            displayName: displayName,
            reason: 'disconnected',
            users: getUserList(session)
        });
    }
}

// ─── WebSocket Connection Handler ────────────────────────────────────────────

wss.on('connection', (ws) => {
    ws.userId = null;
    ws.sessionCode = null;
    ws.role = null;
    ws.displayName = null;
    ws.isPreviewClient = false;

    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data.toString());

            switch (message.type) {
                case 'create_session':
                    handleCreateSession(ws, message);
                    break;
                case 'join_session':
                    handleJoinSession(ws, message);
                    break;
                case 'file_change':
                    handleFileChange(ws, message);
                    break;
                case 'add_comment':
                    handleAddComment(ws, message);
                    break;
                case 'delete_comment':
                    handleDeleteComment(ws, message);
                    break;
                case 'change_role':
                    handleChangeRole(ws, message);
                    break;
                case 'kick_user':
                    handleKickUser(ws, message);
                    break;
                case 'full_sync':
                    handleFullSync(ws, message);
                    break;
                case 'cursor_update':
                    handleCursorUpdate(ws, message);
                    break;
                case 'file_diff':
                    handleFileDiff(ws, message);
                    break;
                case 'file_focus':
                    handleFileFocus(ws, message);
                    break;
                default:
                    // Could be a preview client - just ignore unknown messages
                    break;
            }
        } catch (err) {
            console.error('Failed to parse WebSocket message:', err.message);
        }
    });

    ws.on('close', () => {
        handleDisconnect(ws);
    });

    ws.on('error', (err) => {
        console.error('WebSocket error:', err.message);
    });
});

// ─── Start Server ────────────────────────────────────────────────────────────

server.listen(PORT, () => {
    console.log(`[WebSync Live] Server running at ${PROTOCOL}://${HOST}:${PORT}`);
    console.log(`[WebSync Live] Workspace: ${WORKSPACE_PATH}`);
    console.log(`[WebSync Live] Waiting for connections...`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('[WebSync Live] Shutting down...');
    wss.close();
    server.close();
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('[WebSync Live] Shutting down...');
    wss.close();
    server.close();
    process.exit(0);
});
