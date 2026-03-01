/*
    ######################################################################
    WebSync Live - copyright (c) 2026 MazyLawzey
    https://github.com/MazyLawzey - MazyLawzey main author of WebSync Live
    https://github.com/rionn11 - rionn11 main contributor of WebSync Live
    https://github.com/MazyLawzey/websync-live - OUR REPO
    GPL-3.0 license
    #######################################################################
*/

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

function generateUserId() {
  const randomBytes = crypto.randomBytes(3).toString('hex');
  return `u_${randomBytes}`;
}

function getPlatform() {
  const platform = os.platform();
  const platformMap = {
    'darwin': 'darwin',
    'win32': 'win32',
    'linux': 'linux',
    'freebsd': 'freebsd'
  };
  return platformMap[platform] || platform;
}

function getArchitecture() {
  return os.arch();
}

function getDisplayName() {
  return os.userInfo().username || 'user';
}

function getTheme() {
  return 'dark';
}

function initializeUser() {
  const config = {
    app: {
      name: 'websync-live',
      extensionVersion: '1.0.0',
      protocolVersion: 1,
      language: 'en'
    },
    user: {
      id: generateUserId(),
      displayName: getDisplayName()
    },
    device: {
      platform: getPlatform(),
      arch: getArchitecture(),
      theme: getTheme()
    }
  };

  return config;
}

function saveConfig(config) {
  const initPath = path.join(__dirname, 'init.json');
  
  try {
    fs.writeFileSync(initPath, JSON.stringify(config, null, 2));
    return true;
  } catch (error) {
    console.error('✗ Ошибка при сохранении конфигурации:', error.message);
    return false;
  }
}

function loadConfig() {
  const initPath = path.join(__dirname, 'init.json');
  
  try {
    if (fs.existsSync(initPath)) {
      const data = fs.readFileSync(initPath, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error(error.message);
  }
  
  return null;
}


function init() {
  const existingConfig = loadConfig();
  
  if (existingConfig) {
    return existingConfig;
  }

  const config = initializeUser();
  saveConfig(config);
  
  return config;
}

module.exports = {
  init,
  loadConfig,
  saveConfig,
  initializeUser,
  generateUserId,
  getPlatform,
  getArchitecture,
  getDisplayName,
  getTheme
};

if (require.main === module) {
  const config = init();
}
