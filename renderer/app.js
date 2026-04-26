const { Terminal } = require('@xterm/xterm');
const { FitAddon } = require('@xterm/addon-fit');
const { WebLinksAddon } = require('@xterm/addon-web-links');
const { ipcRenderer } = require('electron');

let terminal = null;
let fitAddon = null;
let isRunning = false;

const THEMES = {
  light: {
    background: '#ffffff',
    foreground: '#000000',
    cursor: '#7c3aed',
    cursorAccent: '#ffffff',
    selectionBackground: 'rgba(124, 58, 237, 0.25)',
    black: '#000000',
    red: '#cc0000',
    green: '#008800',
    yellow: '#886600',
    blue: '#0055cc',
    magenta: '#7700cc',
    cyan: '#008888',
    white: '#444444',
    brightBlack: '#333333',
    brightRed: '#dd0000',
    brightGreen: '#009900',
    brightYellow: '#997700',
    brightBlue: '#0066ee',
    brightMagenta: '#8800ee',
    brightCyan: '#009999',
    brightWhite: '#666666',
  },
  dark: {
    background: '#1e1e1e',
    foreground: '#ffffff',
    cursor: '#7c3aed',
    cursorAccent: '#1e1e1e',
    selectionBackground: 'rgba(124, 58, 237, 0.4)',
    black: '#1e1e1e',
    red: '#ff6666',
    green: '#66ff66',
    yellow: '#ffcc44',
    blue: '#6699ff',
    magenta: '#cc88ff',
    cyan: '#66ffcc',
    white: '#ffffff',
    brightBlack: '#666666',
    brightRed: '#ff8888',
    brightGreen: '#88ff88',
    brightYellow: '#ffdd66',
    brightBlue: '#88bbff',
    brightMagenta: '#dd99ff',
    brightCyan: '#88ffdd',
    brightWhite: '#ffffff',
  },
};

let currentTheme = localStorage.getItem('hermes-theme') || 'light';

function getTerminalTheme() {
  return THEMES[currentTheme] || THEMES.light;
}

function initTerminal() {
  terminal = new Terminal({
    theme: getTerminalTheme(),
    fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', Consolas, monospace",
    fontSize: 14,
    lineHeight: 1.3,
    cursorBlink: true,
    cursorStyle: 'bar',
    scrollback: 10000,
    allowProposedApi: true,
    convertEol: true,
  });

  fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.loadAddon(new WebLinksAddon());

  const container = document.getElementById('terminal-container');
  terminal.open(container);

  setTimeout(() => { if (fitAddon) fitAddon.fit(); }, 100);
  window.addEventListener('resize', () => { if (fitAddon) fitAddon.fit(); });

  // Keyboard input -> PTY
  terminal.onData((data) => {
    if (isRunning) {
      ipcRenderer.invoke('hermes:input', data);
    }
  });

  // Resize -> PTY
  terminal.onResize(({ cols, rows }) => {
    if (isRunning) {
      ipcRenderer.invoke('hermes:resize', cols, rows);
    }
  });
}

// --- UI Elements ---
const statusIndicator = document.getElementById('status-indicator');
const statusText = document.getElementById('status-text');
const appVersion = document.getElementById('app-version');
const themeBtn = document.getElementById('theme-btn');

function setStatus(state, text) {
  statusIndicator.className = 'status-' + state;
  statusText.textContent = text;
}

// --- Start Hermes ---
async function startHermes() {
  if (isRunning) return;
  setStatus('starting', 'Starting...');

  try {
    const result = await ipcRenderer.invoke('hermes:start', []);

    if (result.status === 'started') {
      isRunning = true;
      setStatus('online', 'Running (PID: ' + result.pid + ')');
      if (fitAddon) fitAddon.fit();
    } else if (result.status === 'already_running') {
      isRunning = true;
      setStatus('online', 'Running');
    } else {
      setStatus('error', 'Error: ' + (result.message || 'Failed'));
      if (terminal) terminal.writeln('Error: ' + (result.message || 'Failed to start'));
    }
  } catch (err) {
    setStatus('error', 'Error');
    if (terminal) terminal.writeln('Exception: ' + err.message);
  }
}

// --- Theme Toggle ---
themeBtn.addEventListener('click', () => {
  currentTheme = currentTheme === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', currentTheme);
  localStorage.setItem('hermes-theme', currentTheme);
  themeBtn.textContent = currentTheme === 'light' ? '\u263E' : '\u2600';
  if (terminal) {
    terminal.options.theme = getTerminalTheme();
  }
});

// --- IPC Listeners ---
// Smart scroll: only auto-scroll if user is near bottom
function isNearBottom() {
  if (!terminal) return true;
  const row = terminal.buffer.active.viewportY;
  const maxRow = terminal.buffer.active.length - terminal.rows;
  return row >= maxRow - 3;
}

ipcRenderer.on('hermes:stdout', (_event, data) => {
  if (terminal) {
    const shouldScroll = isNearBottom();
    terminal.write(data);
    if (shouldScroll) {
      terminal.scrollToBottom();
    }
  }
});

ipcRenderer.on('hermes:exit', (_event, code) => {
  isRunning = false;
  if (terminal) terminal.writeln('\r\nProcess exited with code ' + code);
  setStatus('offline', 'Exited (' + code + ')');
});

ipcRenderer.on('hermes:error', (_event, msg) => {
  isRunning = false;
  if (terminal) terminal.writeln('\r\nError: ' + msg);
  setStatus('error', 'Error');
});

// --- Init ---
async function init() {
  document.documentElement.setAttribute('data-theme', currentTheme);
  themeBtn.textContent = currentTheme === 'light' ? '\u263E' : '\u2600';

  initTerminal();

  try {
    const ver = await ipcRenderer.invoke('app:getVersion');
    appVersion.textContent = 'v' + ver;
  } catch {
    appVersion.textContent = 'v0.11.0';
  }

  const check = await ipcRenderer.invoke('hermes:checkExe');
  if (check.exists) {
    terminal.writeln('Hermes.exe found, starting...');
    await startHermes();
  } else {
    terminal.writeln('Hermes.exe NOT found at: ' + check.path);
    terminal.writeln('Build it first: pyinstaller hermes.spec');
    setStatus('offline', 'Exe not found');
  }
}

init();
