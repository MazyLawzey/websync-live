/*
    ######################################################################
    WebSync Live - copyright (c) 2026 MazyLawzey
    https://github.com/MazyLawzey - MazyLawzey main author of WebSync Live
    https://github.com/rionn11 - rionn11 main contributor of WebSync Live
    https://github.com/MazyLawzey/websync-live - OUR REPO
    GPL-3.0 license
    #######################################################################
*/

const EventEmitter = require('events');
const path = require('path');

// Load ws from various possible locations
let WebSocket;
try {
    WebSocket = require('ws');
} catch (e) {
    try {
        WebSocket = require(path.join(__dirname, '..', 'node_modules', 'ws'));
    } catch (e2) {
        console.error('Failed to load ws package');
    }
}

/**
 * WebSyncClient - WebSocket client for the WebSync Live extension.
 * Used by the extension host to communicate with the WebSync Live server.
 *
 * Events:
 *   connected, disconnected, error,
 *   session_created, session_joined,
 *   user_joined, user_left,
 *   file_update, comment_added, comment_deleted,
 *   role_changed, kicked, session_closed,
 *   server_error, live_reload
 */
class WebSyncClient extends EventEmitter {
    constructor() {
        super();
        this.ws = null;
        this.connected = false;
        this.userId = null;
        this.sessionCode = null;
        this.role = null;
        this.displayName = null;
        this.users = [];
        this.comments = [];
    }

    /**
     * Connect to a WebSync Live server
     * @param {string} url - WebSocket URL (e.g., ws://localhost:3000)
     * @returns {Promise<void>}
     */
    connect(url) {
        return new Promise((resolve, reject) => {
            if (!WebSocket) {
                reject(new Error('WebSocket (ws) package not available'));
                return;
            }

            try {
                this.ws = new WebSocket(url);

                const timeout = setTimeout(() => {
                    reject(new Error('Connection timeout'));
                    this.ws.terminate();
                }, 10000);

                this.ws.on('open', () => {
                    clearTimeout(timeout);
                    this.connected = true;
                    this.emit('connected');
                    resolve();
                });

                this.ws.on('message', (data) => {
                    try {
                        const message = JSON.parse(data.toString());
                        this._handleMessage(message);
                    } catch (err) {
                        console.error('[WebSyncClient] Failed to parse message:', err.message);
                    }
                });

                this.ws.on('close', () => {
                    this.connected = false;
                    this.emit('disconnected');
                });

                this.ws.on('error', (error) => {
                    clearTimeout(timeout);
                    this.emit('error', error);
                    reject(error);
                });
            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Create a new session (becomes Host)
     * @param {string} displayName
     */
    createSession(displayName) {
        this.displayName = displayName;
        this._send({ type: 'create_session', displayName });
    }

    /**
     * Join an existing session
     * @param {string} sessionCode
     * @param {string} displayName
     */
    joinSession(sessionCode, displayName) {
        this.displayName = displayName;
        this._send({ type: 'join_session', sessionCode, displayName });
    }

    /**
     * Send a file change notification
     * @param {string} filePath - Relative file path
     * @param {string} content - Full file content
     */
    sendFileChange(filePath, content) {
        this._send({ type: 'file_change', filePath, content });
    }

    /**
     * Send full workspace sync to a specific user (host only)
     * @param {string} targetUserId
     * @param {Array<{filePath: string, content: string}>} files
     */
    sendFullSync(targetUserId, files) {
        this._send({ type: 'full_sync', targetUserId, files });
    }

    /**
     * Send cursor position to other users
     * @param {string} filePath - Relative file path
     * @param {number} line - 0-based line number
     * @param {number} character - 0-based character offset
     * @param {Object} [selection] - Optional selection range
     */
    sendCursorUpdate(filePath, line, character, selection) {
        const msg = { type: 'cursor_update', filePath, line, character };
        if (selection) {
            msg.selectionStartLine = selection.startLine;
            msg.selectionStartChar = selection.startChar;
            msg.selectionEndLine = selection.endLine;
            msg.selectionEndChar = selection.endChar;
        }
        this._send(msg);
    }

    /**
     * Broadcast the currently active file to all session participants (host/admin only).
     * Viewers will auto-open this file in their editor.
     * @param {string} filePath - Relative file path
     */
    sendFileFocus(filePath) {
        this._send({ type: 'file_focus', filePath });
    }

    /**
     * Send incremental document changes so receivers apply only the diff,
     * not a full file replacement (avoids cursor jumps and save conflicts).
     * @param {string} filePath - Relative file path
     * @param {Array<{range:{startLine,startChar,endLine,endChar}, text:string}>} changes
     */
    sendFileDiff(filePath, changes) {
        this._send({ type: 'file_diff', filePath, changes });
    }

    /**
     * Add a comment
     * @param {string} filePath
     * @param {number} line - 1-based line number
     * @param {string} text - Comment text
     */
    addComment(filePath, line, text) {
        this._send({ type: 'add_comment', filePath, line, text });
    }

    /**
     * Delete a comment
     * @param {string} commentId
     */
    deleteComment(commentId) {
        this._send({ type: 'delete_comment', commentId });
    }

    /**
     * Change a user's role
     * @param {string} targetUserId
     * @param {string} newRole - 'admin', 'editor', or 'viewer'
     */
    changeRole(targetUserId, newRole) {
        this._send({ type: 'change_role', targetUserId, newRole });
    }

    /**
     * Kick a user from the session
     * @param {string} targetUserId
     */
    kickUser(targetUserId) {
        this._send({ type: 'kick_user', targetUserId });
    }

    /**
     * Send a JSON message to the server
     * @param {Object} message
     */
    _send(message) {
        if (this.ws && this.connected) {
            try {
                this.ws.send(JSON.stringify(message));
            } catch (err) {
                console.error('[WebSyncClient] Send error:', err.message);
            }
        }
    }

    /**
     * Disconnect from the server
     */
    disconnect() {
        if (this.ws) {
            try {
                this.ws.close();
            } catch (err) {
                // ignore
            }
            this.ws = null;
            this.connected = false;
        }
        this.userId = null;
        this.sessionCode = null;
        this.role = null;
        this.users = [];
        this.comments = [];
    }

    /**
     * Handle incoming WebSocket messages
     * @param {Object} message
     */
    _handleMessage(message) {
        switch (message.type) {
            case 'session_created':
                this.userId = message.userId;
                this.sessionCode = message.sessionCode;
                this.role = message.role;
                this.users = message.users || [];
                this.emit('session_created', message);
                break;

            case 'session_joined':
                this.userId = message.userId;
                this.sessionCode = message.sessionCode;
                this.role = message.role;
                this.users = message.users || [];
                this.comments = message.comments || [];
                this.emit('session_joined', message);
                break;

            case 'user_joined':
                this.users = message.users || this.users;
                this.emit('user_joined', message);
                break;

            case 'user_left':
                this.users = message.users || this.users;
                this.emit('user_left', message);
                break;

            case 'file_update':
                this.emit('file_update', message);
                break;

            case 'comment_added':
                if (message.comment) {
                    this.comments.push(message.comment);
                }
                this.emit('comment_added', message);
                break;

            case 'comment_deleted':
                this.comments = this.comments.filter(c => c.id !== message.commentId);
                this.emit('comment_deleted', message);
                break;

            case 'role_changed':
                this.users = message.users || this.users;
                if (message.userId === this.userId) {
                    this.role = message.newRole;
                }
                this.emit('role_changed', message);
                break;

            case 'kicked':
                this.emit('kicked', message);
                this.disconnect();
                break;

            case 'session_closed':
                this.emit('session_closed', message);
                this.disconnect();
                break;

            case 'error':
                this.emit('server_error', message);
                break;

            case 'live_reload':
                this.emit('live_reload');
                break;

            case 'sync_request':
                this.emit('sync_request', message);
                break;

            case 'full_sync':
                this.emit('full_sync', message);
                break;

            case 'cursor_update':
                this.emit('cursor_update', message);
                break;

            case 'file_diff':
                this.emit('file_diff', message);
                break;

            case 'file_focus':
                this.emit('file_focus', message);
                break;
        }
    }
}

module.exports = { WebSyncClient };
