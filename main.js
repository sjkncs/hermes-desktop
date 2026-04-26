const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const os = require('os');
const pty = require('node-pty');

let mainWindow;
let ptyProcess = null;
const isDev = !app.isPackaged;
let hermesAgent = 'super-agent';

function getHermesCommand() {
  if (isDev) {
    return {
      cmd: 'C:\\Users\\Administrator\\AppData\\Local\\Python\\pythoncore-3.14-64\\python.exe',
      args: ['-m', 'hermes_cli.main', 'chat', '-s', hermesAgent],
      cwd: path.join(__dirname, '..', 'hermes-agent'),
    };
  }
  return {
    cmd: path.join(process.resourcesPath, 'hermes', 'Hermes.exe'),
    args: ['chat', '-s', hermesAgent],
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
  // In dev mode, check if python executable exists
  try {
    await fs.promises.access(hermes.cmd, fs.constants.R_OK);
    return { exists: true, path: hermes.cmd + ' ' + hermes.args.join(' ') };
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

    // Replace the model block (model: + default + provider + optional base_url)
    // Match the exact model: section at the top of the file
    const modelBlockRegex = /model:\s*\n(\s*default:.*\n)(\s*provider:.*\n)(\s*base_url:.*\n)?/;
    const newBaseUrl = cfg.base_url ? `  base_url: ${cfg.base_url}\n` : '';
    const replacement = `model:\n  default: ${cfg.model}\n  provider: ${cfg.provider}\n${newBaseUrl}`;

    if (modelBlockRegex.test(yaml)) {
      yaml = yaml.replace(modelBlockRegex, replacement);
    } else {
      // Fallback: just replace default and provider lines after model:
      yaml = yaml.replace(/(model:\s*\n\s*)default:.*\n/, `$1default: ${cfg.model}\n`);
      yaml = yaml.replace(/(model:\s*\n\s*default:.*\n\s*)provider:.*\n/, `$1provider: ${cfg.provider}\n`);
      if (cfg.base_url && !yaml.includes('base_url:')) {
        yaml = yaml.replace(
          /(model:\s*\n\s*default:.*\n\s*provider:.*\n)/,
          `$1  base_url: ${cfg.base_url}\n`
        );
      }
    }

    fs.writeFileSync(CONFIG_PATH, yaml, 'utf8');

    // --- Update .env with API key (only if user provided a new one) ---
    if (cfg.api_key && cfg.api_key !== '') {
      let envContent = '';
      try { envContent = fs.readFileSync(ENV_PATH, 'utf8'); } catch {}

      const keyEnvMap = {
        custom: 'CUSTOM_API_KEY',
        openai: 'OPENAI_API_KEY',
        anthropic: 'ANTHROPIC_API_KEY',
        openrouter: 'OPENROUTER_API_KEY',
        nous: 'NOUS_API_KEY',
      };
      const keyName = keyEnvMap[cfg.provider] || 'CUSTOM_API_KEY';

      const keyRegex = new RegExp(`^${keyName}=.*$`, 'm');
      if (keyRegex.test(envContent)) {
        envContent = envContent.replace(keyRegex, `${keyName}=${cfg.api_key}`);
      } else {
        envContent = envContent.trimEnd() + `\n${keyName}=${cfg.api_key}\n`;
      }

      fs.writeFileSync(ENV_PATH, envContent, 'utf8');
    }

    // --- Update agent skill ---
    if (cfg.agent) {
      hermesAgent = cfg.agent;
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
    // Only match model section (first occurrence after 'model:')
    const modelSection = yaml.match(/model:\s*\n\s*default:\s*(.+)\n\s*provider:\s*(.+)\n(?:\s*base_url:\s*(.+)\n)?/);
    const model = modelSection ? modelSection[1].trim() : '';
    const provider = modelSection ? modelSection[2].trim() : 'custom';
    const baseUrl = modelSection && modelSection[3] ? modelSection[3].trim() : '';

    // Try to read API key from .env (return masked version for security)
    let apiKeyMasked = '';
    try {
      const envContent = fs.readFileSync(ENV_PATH, 'utf8');
      const keyEnvMap = {
        custom: 'CUSTOM_API_KEY',
        openai: 'OPENAI_API_KEY',
        anthropic: 'ANTHROPIC_API_KEY',
        openrouter: 'OPENROUTER_API_KEY',
        nous: 'NOUS_API_KEY',
      };
      const keyName = keyEnvMap[provider] || 'CUSTOM_API_KEY';
      const keyMatch = envContent.match(new RegExp(`^${keyName}=(.+)$`, 'm'));
      if (keyMatch) {
        const full = keyMatch[1].trim();
        // Mask: show first 4 and last 4 chars, rest dots
        apiKeyMasked = full.length > 8 ? full.slice(0, 4) + '...' + full.slice(-4) : full;
      }
    } catch {}

    return {
      model,
      provider,
      base_url: baseUrl,
      api_key: apiKeyMasked,
      agent: hermesAgent,
    };
  } catch {
    return { model: '', provider: 'custom', base_url: '', api_key: '', agent: hermesAgent };
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
