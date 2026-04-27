const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const os = require('os');
const pty = require('node-pty');

let mainWindow;
let ptyProcess = null;
const isDev = !app.isPackaged;
let hermesAgent = 'super-agent';
let hermesWorkspace = ''; // configurable workspace directory
let hermesResume = '';   // session ID or name to resume
const PYTHON = 'C:\\Users\\Administrator\\AppData\\Local\\Python\\pythoncore-3.14-64\\python.exe';
const HERMES_DIR_SRC = path.join(__dirname, '..', 'hermes-agent');
const HERMES_REPO = 'NousResearch/hermes-agent';

function runGit(args, opts = {}) {
  const { execSync } = require('child_process');
  return execSync(`git ${args}`, {
    encoding: 'utf8',
    timeout: opts.timeout || 30000,
    cwd: HERMES_DIR_SRC,
    env: { ...process.env, GH_TOKEN: undefined },
  });
}

function runGitAsync(args, opts = {}) {
  const { exec } = require('child_process');
  return new Promise((resolve, reject) => {
    exec(`git ${args}`, {
      encoding: 'utf8',
      timeout: opts.timeout || 30000,
      cwd: HERMES_DIR_SRC,
      env: { ...process.env, GH_TOKEN: undefined },
    }, (err, stdout, stderr) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

function runGh(args, opts = {}) {
  const { execSync } = require('child_process');
  return execSync(`gh ${args}`, {
    encoding: 'utf8',
    timeout: opts.timeout || 30000,
    cwd: HERMES_DIR_SRC,
  });
}

function safeKillPty() {
  if (ptyProcess) {
    try { ptyProcess.kill(); } catch {}
    ptyProcess = null;
  }
}

function getHermesCommand() {
  const args = ['-m', 'hermes_cli.main', 'chat', '-s', hermesAgent];
  // Add resume flag if configured
  if (hermesResume) {
    // If it looks like a UUID, use --resume; otherwise --continue
    if (hermesResume.length >= 8 && hermesResume.includes('-')) {
      args.push('--resume', hermesResume);
    } else {
      args.push('--continue', hermesResume);
    }
  }
  // Determine cwd: use workspace if set, otherwise default
  let cwd;
  if (isDev) {
    cwd = hermesWorkspace || path.join(__dirname, '..', 'hermes-agent');
    return { cmd: PYTHON, args, cwd };
  }
  cwd = hermesWorkspace || os.homedir();
  return {
    cmd: path.join(process.resourcesPath, 'hermes', 'Hermes.exe'),
    args: ['chat', '-s', hermesAgent],
    cwd,
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
    // Kill existing process to avoid orphan processes
    safeKillPty();
    await new Promise(r => setTimeout(r, 300));
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
    safeKillPty();
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

// --- Folder Browse ---
ipcMain.handle('dialog:browseFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Select Workspace Directory',
  });
  if (result.canceled) return '';
  return result.filePaths[0];
});

// --- Auto Check for Updates ---
ipcMain.handle('hermes:checkForUpdates', async () => {
  try {
    const localVer = await new Promise((resolve, reject) => {
      const { exec } = require('child_process');
      exec(`"${PYTHON}" -m hermes_cli.main --version`, {
        encoding: 'utf8', timeout: 10000, cwd: HERMES_DIR_SRC,
      }, (err, stdout) => err ? reject(err) : resolve(stdout.trim().split('\n')[0]));
    });

    const latestTag = await new Promise((resolve, reject) => {
      const { exec } = require('child_process');
      exec(`gh api /repos/${HERMES_REPO}/releases/latest --jq ".tag_name"`, {
        encoding: 'utf8', timeout: 15000,
      }, (err, stdout) => err ? reject(err) : resolve(stdout.trim()));
    });

    if (!latestTag) return { hasUpdate: false, current: localVer, latest: '' };

    let currentTag = '';
    try {
      currentTag = (await runGitAsync('describe --tags --abbrev=0', { timeout: 5000 })).trim();
    } catch {}

    return { hasUpdate: latestTag !== currentTag, current: localVer, latest: latestTag, currentTag };
  } catch {
    return { hasUpdate: false, current: '', latest: '' };
  }
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
const SESSIONS_DIR = path.join(HERMES_DIR, 'sessions');

// --- Session History ---
ipcMain.handle('hermes:listSessions', async () => {
  const fs = require('fs');
  try {
    if (!fs.existsSync(SESSIONS_DIR)) return [];
    return fs.readdirSync(SESSIONS_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, f), 'utf8'));
          return { id: data.id, name: data.name, date: data.date, preview: data.preview || '', model: data.model || '' };
        } catch { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.date) - new Date(a.date));
  } catch { return []; }
});

ipcMain.handle('hermes:saveSession', async (event, session) => {
  const fs = require('fs');
  try {
    if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    const filePath = path.join(SESSIONS_DIR, session.id + '.json');
    fs.writeFileSync(filePath, JSON.stringify(session, null, 2), 'utf8');
    return { status: 'saved' };
  } catch (err) { return { status: 'error', message: err.message }; }
});

ipcMain.handle('hermes:loadSession', async (event, id) => {
  const fs = require('fs');
  try {
    const filePath = path.join(SESSIONS_DIR, id + '.json');
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch { return null; }
});

ipcMain.handle('hermes:deleteSession', async (event, id) => {
  const fs = require('fs');
  try {
    const filePath = path.join(SESSIONS_DIR, id + '.json');
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return { status: 'deleted' };
  } catch (err) { return { status: 'error', message: err.message }; }
});

// --- Get Last Session ID ---
ipcMain.handle('hermes:getLastSession', async () => {
  const fs = require('fs');
  try {
    if (!fs.existsSync(SESSIONS_DIR)) return '';
    const files = fs.readdirSync(SESSIONS_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => ({ name: f.replace('.json', ''), mtime: fs.statSync(path.join(SESSIONS_DIR, f)).mtime }))
      .sort((a, b) => b.mtime - a.mtime);
    return files.length ? files[0].name : '';
  } catch {
    return '';
  }
});

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

    // --- Update workspace directory ---
    if (cfg.workspace) {
      hermesWorkspace = cfg.workspace;
      // Create directory if it doesn't exist
      try { fs.mkdirSync(cfg.workspace, { recursive: true }); } catch {}
    } else {
      hermesWorkspace = '';
    }

    // --- Update resume session ---
    hermesResume = cfg.resume || '';

    // --- Update agent parameters (sliders) ---
    if (cfg.max_turns) {
      yaml = yaml.replace(/(agent:\s*\n\s*)max_turns:\s*\d+/, `$1max_turns: ${cfg.max_turns}`);
    }
    if (cfg.gateway_timeout) {
      yaml = yaml.replace(/gateway_timeout:\s*\d+/, `gateway_timeout: ${cfg.gateway_timeout}`);
    }
    if (cfg.api_max_retries !== undefined) {
      yaml = yaml.replace(/api_max_retries:\s*\d+/, `api_max_retries: ${cfg.api_max_retries}`);
    }
    if (cfg.term_timeout) {
      yaml = yaml.replace(/(terminal:[\s\S]*?)timeout:\s*\d+/, `$1timeout: ${cfg.term_timeout}`);
    }
    // Re-write yaml with updated slider values
    fs.writeFileSync(CONFIG_PATH, yaml, 'utf8');

    // Kill current process so it restarts with new config
    safeKillPty();

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
      workspace: hermesWorkspace,
      resume: hermesResume,
      max_turns: parseInt(yaml.match(/max_turns:\s*(\d+)/)?.[1]) || 90,
      gateway_timeout: parseInt(yaml.match(/gateway_timeout:\s*(\d+)/)?.[1]) || 1800,
      api_max_retries: parseInt(yaml.match(/api_max_retries:\s*(\d+)/)?.[1]) ?? 3,
      term_timeout: parseInt(yaml.match(/terminal:[\s\S]*?timeout:\s*(\d+)/)?.[1]) || 180,
    };
  } catch {
    return { model: '', provider: 'custom', base_url: '', api_key: '', agent: hermesAgent, workspace: '', resume: '', max_turns: 90, gateway_timeout: 1800, api_max_retries: 3, term_timeout: 180 };
  }
});

// --- Hermes Version / Update / Rollback ---

ipcMain.handle('hermes:getVersion', async () => {
  const { execSync } = require('child_process');
  try {
    const ver = execSync(`"${PYTHON}" -m hermes_cli.main --version`, {
      encoding: 'utf8', timeout: 10000, cwd: path.join(__dirname, '..', 'hermes-agent'),
    }).trim().split('\n')[0];
    let gitVer = '';
    try {
      gitVer = runGit('describe --tags --always', { timeout: 5000 }).trim();
    } catch {}
    return { version: ver, git: gitVer };
  } catch (err) {
    return { version: 'unknown', git: '', error: err.message };
  }
});

ipcMain.handle('hermes:getTags', async () => {
  try {
    // Try git fetch first, fall back to gh api for remote tags
    try {
      runGit('fetch --tags', { timeout: 30000 });
    } catch {
      // Network failure — use gh api to list remote tags
      try {
        const remoteTags = runGh(`api /repos/${HERMES_REPO}/tags --paginate --jq ".[].name"`, { timeout: 30000 }).trim().split('\n').filter(Boolean);
        // Create local tags from remote
        for (const t of remoteTags) {
          try { runGit(`tag -f ${t}`); } catch {}
        }
      } catch {}
    }
    const tags = runGit('tag -l "v*" --sort=-v:refname', { timeout: 5000 }).trim().split('\n').filter(Boolean);
    return { tags };
  } catch {
    return { tags: [] };
  }
});

// Helper: copy directory recursively, skipping .git
function copyDirRecursive(src, dest) {
  const fs = require('fs');
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name === '.git') continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// Helper: download and extract repo via gh api (async)
async function ghDownloadAndExtract(ref) {
  const { execSync } = require('child_process');
  const fs = require('fs');
  const https = require('https');
  const zipPath = path.join(os.tmpdir(), `hermes-agent-${ref}.zip`);
  const tmpDir = path.join(os.tmpdir(), `hermes-update-${Date.now()}`);

  sendProgress('Getting GitHub auth token...');
  const token = execSync('gh auth token', { encoding: 'utf8', timeout: 10000 }).trim();
  // Use zipball instead of tarball — PowerShell can extract zip natively
  const url = `https://api.github.com/repos/${HERMES_REPO}/zipball/${ref}`;

  sendProgress('Downloading ' + ref + ' from GitHub...');
  const download = (followUrl) => new Promise((resolve, reject) => {
    const req = https.get(followUrl, {
      headers: {
        'User-Agent': 'hermes-desktop',
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
      },
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        download(res.headers.location).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      const file = fs.createWriteStream(zipPath);
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
      file.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(120000, () => { req.destroy(new Error('Download timeout')); });
  });

  await download(url);
  sendProgress('Download complete, extracting...');

  // Extract using PowerShell (handles Windows paths with spaces correctly)
  fs.mkdirSync(tmpDir, { recursive: true });
  try {
    execSync(
      `powershell -NoProfile -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${tmpDir}' -Force"`,
      { timeout: 120000 }
    );
  } catch (e) {
    sendProgress('PowerShell extract failed, trying tar fallback...');
    try {
      execSync(`tar -xzf "${zipPath}" -C "${tmpDir}"`, { timeout: 60000 });
    } catch {
      throw new Error('Failed to extract downloaded archive');
    }
  }

  // Find extracted subfolder
  const entries = fs.readdirSync(tmpDir);
  const srcDir = entries.length === 1
    ? path.join(tmpDir, entries[0])
    : tmpDir;

  // Copy files over (skip .git)
  copyDirRecursive(srcDir, HERMES_DIR_SRC);
  sendProgress('Files copied successfully.');

  // Cleanup
  try { fs.rmSync(tmpDir, { recursive: true }); } catch {}
  try { fs.unlinkSync(zipPath); } catch {}
}

// Helper: send progress message to renderer terminal
function sendProgress(msg) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('hermes:stdout', '\r\n\x1b[36m[Hermes]\x1b[0m ' + msg + '\r\n');
  }
}

// Helper: run a command and stream output to terminal
function runCommandStreaming(cmd, args, opts = {}) {
  const { spawn } = require('child_process');
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      cwd: opts.cwd || HERMES_DIR_SRC,
      env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' },
      timeout: opts.timeout || 120000,
    });
    let stderr = '';
    proc.stdout.on('data', (data) => {
      const text = data.toString();
      sendProgress(text.trimEnd());
    });
    proc.stderr.on('data', (data) => {
      const text = data.toString();
      stderr += text;
      sendProgress(text.trimEnd());
    });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `Exit code ${code}`));
    });
    proc.on('error', reject);
  });
}

ipcMain.handle('hermes:update', async () => {
  try {
    safeKillPty();
    sendProgress('Starting update...');

    // Ensure we're on main branch first
    try {
      sendProgress('Checking out main branch...');
      await runGitAsync('checkout main', { timeout: 10000 });
    } catch {}

    // Try git pull, fall back to gh-based download if network fails
    let pulled = false;
    try {
      sendProgress('Pulling latest code (git pull)...');
      await runGitAsync('pull origin main', { timeout: 60000 });
      pulled = true;
    } catch {
      sendProgress('git pull failed, downloading via GitHub API...');
    }

    if (!pulled) {
      await ghDownloadAndExtract('main');
    }

    sendProgress('Installing updated package (pip install)...');
    await new Promise((resolve, reject) => {
      const { exec } = require('child_process');
      exec(`"${PYTHON}" -m pip install -e .`, {
        encoding: 'utf8', timeout: 120000, cwd: HERMES_DIR_SRC,
      }, (err) => err ? reject(err) : resolve());
    });

    sendProgress('Update complete!');
    return { status: 'updated' };
  } catch (err) {
    sendProgress('Update failed: ' + err.message);
    return { status: 'error', message: err.message };
  }
});

ipcMain.handle('hermes:rollback', async (event, tag) => {
  try {
    safeKillPty();
    sendProgress('Rolling back to ' + tag + '...');

    // Try local git checkout first
    let checkedOut = false;
    try {
      await runGitAsync(`checkout ${tag}`, { timeout: 30000 });
      checkedOut = true;
    } catch {}

    if (!checkedOut) {
      sendProgress('Local checkout failed, downloading ' + tag + ' via GitHub API...');
      await ghDownloadAndExtract(tag);
    }

    sendProgress('Installing version ' + tag + ' (pip install)...');
    await new Promise((resolve, reject) => {
      const { exec } = require('child_process');
      exec(`"${PYTHON}" -m pip install -e .`, {
        encoding: 'utf8', timeout: 120000, cwd: HERMES_DIR_SRC,
      }, (err) => err ? reject(err) : resolve());
    });

    sendProgress('Rollback to ' + tag + ' complete!');
    return { status: 'rolled_back', tag };
  } catch (err) {
    sendProgress('Rollback failed: ' + err.message);
    return { status: 'error', message: err.message };
  }
});

// --- App Lifecycle ---

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  safeKillPty();
  app.quit();
});

app.on('before-quit', () => {
  safeKillPty();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
