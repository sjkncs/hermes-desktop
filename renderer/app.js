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
const settingsBtn = document.getElementById('settings-btn');
const settingsModal = document.getElementById('settings-modal');
const settingsClose = document.getElementById('settings-close');
const settingsCancel = document.getElementById('settings-cancel');
const settingsSave = document.getElementById('settings-save');
const toggleKeyVis = document.getElementById('toggle-key-vis');
const cfgProvider = document.getElementById('cfg-provider');
const cfgModel = document.getElementById('cfg-model');
const cfgBaseurl = document.getElementById('cfg-baseurl');
const cfgApikey = document.getElementById('cfg-apikey');
const cfgAgent = document.getElementById('cfg-agent');

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

// --- Settings Modal ---
const PROVIDER_PRESETS = {
  custom: { model: '', base_url: '', key_env: 'CUSTOM_API_KEY' },
  openai: { model: 'gpt-4o', base_url: 'https://api.openai.com/v1', key_env: 'OPENAI_API_KEY' },
  anthropic: { model: 'claude-sonnet-4-20250514', base_url: 'https://api.anthropic.com', key_env: 'ANTHROPIC_API_KEY' },
  openrouter: { model: 'anthropic/claude-sonnet-4', base_url: 'https://openrouter.ai/api/v1', key_env: 'OPENROUTER_API_KEY' },
  nous: { model: 'Hermes-3-Llama-3.1-70B', base_url: 'https://api.nousresearch.com/v1', key_env: 'NOUS_API_KEY' },
};

cfgProvider.addEventListener('change', () => {
  const preset = PROVIDER_PRESETS[cfgProvider.value];
  if (preset) {
    cfgModel.value = preset.model;
    cfgBaseurl.value = preset.base_url;
    cfgApikey.placeholder = preset.key_env + '=...';
  }
});

function openSettings() {
  settingsModal.classList.remove('hidden');
  // Load current config
  ipcRenderer.invoke('hermes:getCurrentProvider').then(current => {
    cfgProvider.value = current.provider || 'custom';
    cfgModel.value = current.model || '';
    cfgBaseurl.value = current.base_url || '';
    // Don't overwrite api_key input with masked value — show placeholder if key exists
    cfgApikey.value = '';
    cfgApikey.placeholder = current.api_key ? 'Current: ' + current.api_key + ' (leave empty to keep)' : 'sk-...';
    cfgAgent.value = current.agent || 'super-agent';
  }).catch(() => {});
}

function closeSettings() {
  settingsModal.classList.add('hidden');
}

settingsBtn.addEventListener('click', openSettings);
settingsClose.addEventListener('click', closeSettings);
settingsCancel.addEventListener('click', closeSettings);

settingsModal.addEventListener('click', (e) => {
  if (e.target === settingsModal) closeSettings();
});

toggleKeyVis.addEventListener('click', () => {
  const input = cfgApikey;
  input.type = input.type === 'password' ? 'text' : 'password';
});

settingsSave.addEventListener('click', async () => {
  const config = {
    provider: cfgProvider.value,
    model: cfgModel.value.trim(),
    base_url: cfgBaseurl.value.trim(),
    api_key: cfgApikey.value.trim(),
    agent: cfgAgent.value,
  };

  if (!config.model) {
    cfgModel.focus();
    return;
  }

  closeSettings();
  if (terminal) terminal.writeln('\r\nSaving config and restarting...');
  isRunning = false;
  setStatus('starting', 'Switching...');

  const result = await ipcRenderer.invoke('hermes:saveConfig', config);
  if (result.status === 'saved') {
    if (terminal) terminal.writeln('Config saved: ' + config.provider + ' / ' + config.model);
    setTimeout(() => startHermes(), 1500);
  } else {
    if (terminal) terminal.writeln('\r\nSave failed: ' + (result.message || 'Unknown error'));
    setStatus('error', 'Config error');
  }
});

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
  // Don't override status if we're in the middle of switching providers
  if (statusText.textContent !== 'Switching...') {
    if (terminal) terminal.writeln('\r\nProcess exited with code ' + code);
    setStatus('offline', 'Exited (' + code + ')');
  }
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

  // Load current provider info for display
  try {
    const current = await ipcRenderer.invoke('hermes:getCurrentProvider');
    if (current.model) {
      statusText.textContent = current.model;
    }
  } catch {}

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
