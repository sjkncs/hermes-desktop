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
      args: ['-m', 'hermes_cli.main', 'chat', '-s', 'super-agent'],
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
    // python is always available
    return { exists: true, path: hermes.cmd + ' ' + hermes.args.join(' ') };
  }
  try {
    await fs.promises.access(hermes.cmd, fs.constants.R_OK);
    return { exists: true, path: hermes.cmd };
  } catch {
    return { exists: false, path: hermes.cmd };
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
