/*
    ######################################################################
    WebSync Live - copyright (c) 2026 MazyLawzey
    https://github.com/MazyLawzey - MazyLawzey main author of WebSync Live
    https://github.com/rionn11 - rionn11 main contributor of WebSync Live
    https://github.com/MazyLawzey/websync-live - OUR REPO
    GPL-3.0 license
    #######################################################################
*/

/**
 * Live reload script injected into HTML pages served by the preview server.
 * Connects via WebSocket and reloads the page when file changes are detected.
 */
const LIVE_RELOAD_SCRIPT = `<script>
(function() {
    var ws;
    var reconnectDelay = 1000;

    function connect() {
        ws = new WebSocket('ws://' + location.host);

        ws.onopen = function() {
            console.log('[WebSync Live] Live reload connected');
            reconnectDelay = 1000;
        };

        ws.onmessage = function(e) {
            try {
                var msg = JSON.parse(e.data);
                if (msg.type === 'live_reload') {
                    console.log('[WebSync Live] Reloading...');
                    location.reload();
                }
            } catch(err) {}
        };

        ws.onclose = function() {
            setTimeout(connect, reconnectDelay);
            reconnectDelay = Math.min(reconnectDelay * 1.5, 5000);
        };

        ws.onerror = function() {
            ws.close();
        };
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        connect();
    } else {
        window.addEventListener('DOMContentLoaded', connect);
    }
})();
</script>`;

/**
 * Inject the live reload script into an HTML string (before </body>)
 * @param {string} html - The HTML content
 * @returns {string} HTML with live reload script injected
 */
function injectLiveReload(html) {
    if (html.includes('</body>')) {
        return html.replace('</body>', LIVE_RELOAD_SCRIPT + '\n</body>');
    }
    return html + LIVE_RELOAD_SCRIPT;
}

module.exports = { LIVE_RELOAD_SCRIPT, injectLiveReload };
