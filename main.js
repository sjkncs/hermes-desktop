const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const os = require('os');
const pty = require('node-pty');

let mainWindow;
let ptyProcess = null;
const isDev = !app.isPackaged;

function getHermesCommand() {
  if (isDev) {
    return {
      cmd: 'C:\\Users\\Administrator\\AppData\\Local\\Python\\pythoncore-3.14-64\\python.exe',
      args: ['-m', 'hermes_cli.main', 'chat', '-s', global.__hermesAgent || 'super-agent'],
      cwd: path.join(__dirname, '..', 'hermes-agent'),
    };
  }
  return {
    cmd: path.join(process.resourcesPath, 'hermes', 'Hermes.exe'),
    args: ['chat', '-s', 'super-agent'],
    cwd: os.homedir(),
  };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'Hermes Desktop',
    backgroundColor: '#ffffff',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: false,
      nodeIntegration: true,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Open links externally
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

// --- IPC Handlers ---

ipcMain.handle('hermes:start', async (event, args) => {
  if (ptyProcess) {
    return { status: 'already_running' };
  }

  const hermes = getHermesCommand();
  const allArgs = [...hermes.args, ...(args || [])];
  const cwd = hermes.cwd;

  try {
    const env = {
      ...process.env,
      FORCE_COLOR: '1',
      TERM: 'xterm-256color',
      PYTHONIOENCODING: 'utf-8',
      PYTHONUNBUFFERED: '1',
      PYTHONUTF8: '1',
    };

    ptyProcess = pty.spawn(hermes.cmd, allArgs, {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd: cwd,
      env: env,
      useConpty: false,
    });

    ptyProcess.onData((data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('hermes:stdout', data);
      }
    });

    ptyProcess.onExit(({ exitCode }) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('hermes:exit', exitCode);
      }
      ptyProcess = null;
    });

    return { status: 'started', pid: ptyProcess.pid };
  } catch (err) {
    return { status: 'error', message: err.message };
  }
});

ipcMain.handle('hermes:input', async (event, text) => {
  if (ptyProcess) {
    ptyProcess.write(text);
    return { status: 'sent' };
  }
  return { status: 'not_running' };
});

ipcMain.handle('hermes:resize', async (event, cols, rows) => {
  if (ptyProcess) {
    ptyProcess.resize(cols, rows);
    return { status: 'resized' };
  }
  return { status: 'not_running' };
});

ipcMain.handle('hermes:stop', async () => {
  if (ptyProcess) {
    ptyProcess.kill();
    ptyProcess = null;
    return { status: 'stopped' };
  }
  return { status: 'not_running' };
});

ipcMain.handle('hermes:status', async () => {
  return { running: ptyProcess !== null, pid: ptyProcess?.pid };
});

ipcMain.handle('app:getVersion', async () => {
  return app.getVersion();
});

ipcMain.handle('hermes:checkExe', async () => {
  const hermes = getHermesCommand();
  const fs = require('fs');
  if (hermes.cmd === 'python') {
    return { exists: true, path: hermes.cmd + ' ' + hermes.args.join(' ') };
  }
  try {
    await fs.promises.access(hermes.cmd, fs.constants.R_OK);
    return { exists: true, path: hermes.cmd };
  } catch {
    return { exists: false, path: hermes.cmd };
  }
});

// Model/Provider config — reads and writes ~/.hermes/config.yaml + .env
const HERMES_DIR = path.join(os.homedir(), '.hermes');
const CONFIG_PATH = path.join(HERMES_DIR, 'config.yaml');
const ENV_PATH = path.join(HERMES_DIR, '.env');

ipcMain.handle('hermes:saveConfig', async (event, cfg) => {
  const fs = require('fs');
  try {
    // --- Update config.yaml ---
    let yaml = fs.readFileSync(CONFIG_PATH, 'utf8');

    // Update model section: default, provider, base_url
    yaml = yaml.replace(
      /model:\s*\n(\s*default:.*\n)(\s*provider:.*\n)(\s*base_url:.*\n)?/,
      `model:\n  default: ${cfg.model}\n  provider: ${cfg.provider}\n${cfg.base_url ? '  base_url: ' + cfg.base_url + '\n' : ''}`
    );

    // If base_url line doesn't exist yet (first replacement didn't match), add it
    if (cfg.base_url && !yaml.match(/\s*base_url:/)) {
      yaml = yaml.replace(
        /model:\s*\n(\s*default:.*\n)(\s*provider:.*\n)/,
        `$1$2  base_url: ${cfg.base_url}\n`
      );
    }

    fs.writeFileSync(CONFIG_PATH, yaml, 'utf8');

    // --- Update .env with API key ---
    if (cfg.api_key) {
      let envContent = '';
      try { envContent = fs.readFileSync(ENV_PATH, 'utf8'); } catch {}

      // Determine env var name based on provider
      const keyEnvMap = {
        custom: 'CUSTOM_API_KEY',
        openai: 'OPENAI_API_KEY',
        anthropic: 'ANTHROPIC_API_KEY',
        openrouter: 'OPENROUTER_API_KEY',
        nous: 'NOUS_API_KEY',
      };
      const keyName = keyEnvMap[cfg.provider] || 'CUSTOM_API_KEY';

      // Replace or append the key
      const keyRegex = new RegExp(`^${keyName}=.*$`, 'm');
      if (keyRegex.test(envContent)) {
        envContent = envContent.replace(keyRegex, `${keyName}=${cfg.api_key}`);
      } else {
        envContent = envContent.trimEnd() + `\n${keyName}=${cfg.api_key}\n`;
      }

      fs.writeFileSync(ENV_PATH, envContent, 'utf8');
    }

    // --- Update agent skill in Hermes args ---
    if (cfg.agent) {
      // We'll use this in getHermesCommand dynamically
      global.__hermesAgent = cfg.agent;
    }

    // Kill current process so it restarts with new config
    if (ptyProcess) {
      ptyProcess.kill();
      ptyProcess = null;
    }

    return { status: 'saved' };
  } catch (err) {
    return { status: 'error', message: err.message };
  }
});

ipcMain.handle('hermes:getCurrentProvider', async () => {
  const fs = require('fs');
  try {
    const yaml = fs.readFileSync(CONFIG_PATH, 'utf8');
    const modelMatch = yaml.match(/default:\s*(.+)/);
    const providerMatch = yaml.match(/provider:\s*(.+)/);
    const baseUrlMatch = yaml.match(/base_url:\s*(.+)/);

    // Try to read API key from .env
    let apiKey = '';
    try {
      const envContent = fs.readFileSync(ENV_PATH, 'utf8');
      const keyEnvMap = {
        custom: 'CUSTOM_API_KEY',
        openai: 'OPENAI_API_KEY',
        anthropic: 'ANTHROPIC_API_KEY',
        openrouter: 'OPENROUTER_API_KEY',
        nous: 'NOUS_API_KEY',
      };
      const provider = providerMatch ? providerMatch[1].trim() : 'custom';
      const keyName = keyEnvMap[provider] || 'CUSTOM_API_KEY';
      const keyMatch = envContent.match(new RegExp(`^${keyName}=(.+)$`, 'm'));
      if (keyMatch) apiKey = keyMatch[1].trim();
    } catch {}

    return {
      model: modelMatch ? modelMatch[1].trim() : '',
      provider: providerMatch ? providerMatch[1].trim() : 'custom',
      base_url: baseUrlMatch ? baseUrlMatch[1].trim() : '',
      api_key: apiKey,
      agent: global.__hermesAgent || 'super-agent',
    };
  } catch {
    return { model: '', provider: 'custom', base_url: '', api_key: '', agent: 'super-agent' };
  }
});

// --- App Lifecycle ---

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (ptyProcess) {
    ptyProcess.kill();
  }
  app.quit();
});

app.on('before-quit', () => {
  if (ptyProcess) {
    ptyProcess.kill();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
