/*
    ######################################################################
    WebSync Live - copyright (c) 2026 MazyLawzey
    https://github.com/MazyLawzey - MazyLawzey main author of WebSync Live
    https://github.com/rionn11 - rionn11 main contributor of WebSync Live
    https://github.com/MazyLawzey/websync-live - OUR REPO
    GPL-3.0 license
    #######################################################################
*/

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// require server/server.js as a child process
function turnOnServer() {
    const serverPath = path.join(__dirname, '../server/server.js');
    const logFile = fs.createWriteStream(path.join(__dirname, '../server.log'));
    
    const serverProcess = spawn('node', [serverPath], {
        detached: true,
        stdio: ['ignore', logFile, logFile]
    });
    
    serverProcess.unref();
    console.log('Server started as separate process. Check server.log for details');
}


// require nodb/nodb.js
require('./nodb/nodb.js');

module.exports = { turnOnServer };