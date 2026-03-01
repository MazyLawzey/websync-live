/*
    ######################################################################
    WebSync Live - copyright (c) 2026 MazyLawzey
    https://github.com/MazyLawzey - MazyLawzey main author of WebSync Live
    https://github.com/rionn11 - rionn11 main contributor of WebSync Live
    https://github.com/MazyLawzey/websync-live - OUR REPO
    GPL-3.0 license
    #######################################################################
*/

// This file aggregates all server-side modules for clean imports.

const permissions = require('./permissions/permissions');
const { CommentStore } = require('./code/comments');
const { LIVE_RELOAD_SCRIPT, injectLiveReload } = require('./webview/updater');

module.exports = {
    ...permissions,
    CommentStore,
    LIVE_RELOAD_SCRIPT,
    injectLiveReload
};

console.log('[WebSync Live] Server modules loaded successfully');
