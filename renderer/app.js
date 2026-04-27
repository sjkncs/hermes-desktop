const { Terminal } = require('@xterm/xterm');
const { FitAddon } = require('@xterm/addon-fit');
const { WebLinksAddon } = require('@xterm/addon-web-links');
const { ipcRenderer } = require('electron');

let terminal = null;
let fitAddon = null;
let isRunning = false;
let suppressExit = false; // suppress exit handler during update/rollback/switch

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
      // Capture first input line as session name
      if (!sessionFirstInput && data.trim() && data.includes('\r')) {
        const line = data.replace(/\r|\n/g, '').trim();
        if (line && !line.startsWith('\x1b') && line.length > 2) {
          sessionFirstInput = line.slice(0, 60);
        }
      }
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
const cfgVersion = document.getElementById('cfg-version');
const btnUpdate = document.getElementById('btn-update');
const btnRollback = document.getElementById('btn-rollback');
const updateStatus = document.getElementById('update-status');
const cfgWorkspace = document.getElementById('cfg-workspace');
const btnBrowseWs = document.getElementById('btn-browse-ws');
const cfgResume = document.getElementById('cfg-resume');
const btnLastSession = document.getElementById('btn-last-session');
const updateBadge = document.getElementById('update-badge');
const cfgMaxTurns = document.getElementById('cfg-max-turns');
const cfgGwTimeout = document.getElementById('cfg-gw-timeout');
const cfgApiRetries = document.getElementById('cfg-api-retries');
const cfgTermTimeout = document.getElementById('cfg-term-timeout');
const valMaxTurns = document.getElementById('val-max-turns');
const valGwTimeout = document.getElementById('val-gw-timeout');
const valApiRetries = document.getElementById('val-api-retries');
const valTermTimeout = document.getElementById('val-term-timeout');
const historyBtn = document.getElementById('history-btn');
const sidebar = document.getElementById('sidebar');
const sidebarClose = document.getElementById('sidebar-close');
const sidebarList = document.getElementById('sidebar-list');

// Current session tracking
let currentSessionId = null;
let sessionOutputBuffer = [];
let sessionFirstInput = ''; // first user input becomes session name

// Slider value display
cfgMaxTurns.addEventListener('input', () => valMaxTurns.textContent = cfgMaxTurns.value);
cfgGwTimeout.addEventListener('input', () => valGwTimeout.textContent = cfgGwTimeout.value);
cfgApiRetries.addEventListener('input', () => valApiRetries.textContent = cfgApiRetries.value);
cfgTermTimeout.addEventListener('input', () => valTermTimeout.textContent = cfgTermTimeout.value);

function setUpdateStatus(state, text) {
  updateStatus.textContent = text;
  updateStatus.className = 'form-hint update-' + state;
}

function setStatus(state, text) {
  statusIndicator.className = 'status-' + state;
  statusText.textContent = text;
}

// --- Start Hermes ---
async function startHermes() {
  if (isRunning) return;
  setStatus('starting', 'Starting...');

  // Create new session ID
  currentSessionId = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  sessionOutputBuffer = [];
  sessionFirstInput = '';

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

// Browse workspace folder
btnBrowseWs.addEventListener('click', async () => {
  const folder = await ipcRenderer.invoke('dialog:browseFolder');
  if (folder) cfgWorkspace.value = folder;
});

// Get last session ID
btnLastSession.addEventListener('click', async () => {
  const sessionId = await ipcRenderer.invoke('hermes:getLastSession');
  if (sessionId) cfgResume.value = sessionId;
  else if (terminal) terminal.writeln('\r\nNo previous sessions found');
});

// Update badge click opens settings
updateBadge.addEventListener('click', () => {
  settingsModal.classList.remove('hidden');
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
    cfgWorkspace.value = current.workspace || '';
    cfgResume.value = current.resume || '';
    // Load slider values
    if (current.max_turns) { cfgMaxTurns.value = current.max_turns; valMaxTurns.textContent = current.max_turns; }
    if (current.gateway_timeout) { cfgGwTimeout.value = current.gateway_timeout; valGwTimeout.textContent = current.gateway_timeout; }
    if (current.api_max_retries !== undefined) { cfgApiRetries.value = current.api_max_retries; valApiRetries.textContent = current.api_max_retries; }
    if (current.term_timeout) { cfgTermTimeout.value = current.term_timeout; valTermTimeout.textContent = current.term_timeout; }
  }).catch(() => {});
  // Load version info
  ipcRenderer.invoke('hermes:getVersion').then(ver => {
    cfgVersion.textContent = ver.version + (ver.git ? ' (' + ver.git + ')' : '');
  }).catch(() => { cfgVersion.textContent = 'unknown'; });
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

// --- Update / Rollback ---
btnUpdate.addEventListener('click', async () => {
  btnUpdate.disabled = true;
  btnUpdate.textContent = 'Updating...';
  suppressExit = true;
  isRunning = false;
  setUpdateStatus('running', 'Starting update...');
  if (terminal) terminal.writeln('\r\nUpdating Hermes...');
  setStatus('starting', 'Updating...');
  try {
    const result = await ipcRenderer.invoke('hermes:update');
    btnUpdate.disabled = false;
    btnUpdate.textContent = 'Update';
    if (result.status === 'updated') {
      setUpdateStatus('success', 'Update complete! Restarting...');
      if (terminal) terminal.writeln('Update complete, restarting...');
      ipcRenderer.invoke('hermes:getVersion').then(ver => {
        cfgVersion.textContent = ver.version + (ver.git ? ' (' + ver.git + ')' : '');
      }).catch(() => {});
      setTimeout(() => { suppressExit = false; startHermes(); }, 1500);
    } else {
      suppressExit = false;
      setUpdateStatus('error', 'Failed: ' + (result.message || 'Unknown error'));
      if (terminal) terminal.writeln('\r\nUpdate failed: ' + (result.message || 'Unknown error'));
      setStatus('error', 'Update failed');
    }
  } catch (e) {
    btnUpdate.disabled = false;
    btnUpdate.textContent = 'Update';
    suppressExit = false;
    setUpdateStatus('error', 'Error: ' + e.message);
    if (terminal) terminal.writeln('\r\nUpdate error: ' + e.message);
    setStatus('error', 'Update error');
  }
});

btnRollback.addEventListener('click', async () => {
  const tagsResult = await ipcRenderer.invoke('hermes:getTags');
  if (!tagsResult.tags.length) {
    setUpdateStatus('error', 'No version tags found');
    return;
  }
  const tagList = tagsResult.tags.slice(0, 10).join('\n');
  const choice = prompt('Select version to rollback to:\n' + tagList, tagsResult.tags[0]);
  if (!choice) return;
  btnRollback.disabled = true;
  btnRollback.textContent = 'Rolling back...';
  suppressExit = true;
  isRunning = false;
  setUpdateStatus('running', 'Rolling back to ' + choice + '...');
  if (terminal) terminal.writeln('\r\nRolling back to ' + choice + '...');
  setStatus('starting', 'Rolling back...');
  try {
    const result = await ipcRenderer.invoke('hermes:rollback', choice);
    btnRollback.disabled = false;
    btnRollback.textContent = 'Rollback';
    if (result.status === 'rolled_back') {
      setUpdateStatus('success', 'Rolled back to ' + choice + '! Restarting...');
      if (terminal) terminal.writeln('Rolled back to ' + choice + ', restarting...');
      ipcRenderer.invoke('hermes:getVersion').then(ver => {
        cfgVersion.textContent = ver.version + (ver.git ? ' (' + ver.git + ')' : '');
      }).catch(() => {});
      setTimeout(() => { suppressExit = false; startHermes(); }, 1500);
    } else {
      suppressExit = false;
      setUpdateStatus('error', 'Rollback failed: ' + (result.message || 'Unknown error'));
      if (terminal) terminal.writeln('\r\nRollback failed: ' + (result.message || 'Unknown error'));
      setStatus('error', 'Rollback failed');
    }
  } catch (e) {
    btnRollback.disabled = false;
    btnRollback.textContent = 'Rollback';
    suppressExit = false;
    setUpdateStatus('error', 'Error: ' + e.message);
    if (terminal) terminal.writeln('\r\nRollback error: ' + e.message);
    setStatus('error', 'Rollback error');
  }
});

settingsSave.addEventListener('click', async () => {
  const config = {
    provider: cfgProvider.value,
    model: cfgModel.value.trim(),
    base_url: cfgBaseurl.value.trim(),
    api_key: cfgApikey.value.trim(),
    agent: cfgAgent.value,
    workspace: cfgWorkspace.value.trim(),
    resume: cfgResume.value.trim(),
    max_turns: parseInt(cfgMaxTurns.value),
    gateway_timeout: parseInt(cfgGwTimeout.value),
    api_max_retries: parseInt(cfgApiRetries.value),
    term_timeout: parseInt(cfgTermTimeout.value),
  };

  if (!config.model) {
    cfgModel.focus();
    return;
  }

  closeSettings();
  if (terminal) terminal.writeln('\r\nSaving config and restarting...');
  isRunning = false;
  suppressExit = true;
  setStatus('starting', 'Switching...');

  const result = await ipcRenderer.invoke('hermes:saveConfig', config);
  if (result.status === 'saved') {
    if (terminal) terminal.writeln('Config saved: ' + config.provider + ' / ' + config.model);
    setTimeout(() => { suppressExit = false; startHermes(); }, 1500);
  } else {
    suppressExit = false;
    if (terminal) terminal.writeln('\r\nSave failed: ' + (result.message || 'Unknown error'));
    setStatus('error', 'Config error');
  }
});

// --- Sidebar / Session History ---
function toggleSidebar() {
  const isOpen = sidebar.classList.contains('visible');
  if (isOpen) {
    sidebar.classList.remove('visible');
    document.body.classList.remove('sidebar-open');
  } else {
    sidebar.classList.add('visible');
    document.body.classList.add('sidebar-open');
    loadSessionList();
  }
  if (fitAddon) setTimeout(() => fitAddon.fit(), 50);
}

historyBtn.addEventListener('click', toggleSidebar);
sidebarClose.addEventListener('click', toggleSidebar);

async function loadSessionList() {
  try {
    const sessions = await ipcRenderer.invoke('hermes:listSessions');
    sidebarList.innerHTML = '';
    if (!sessions.length) {
      sidebarList.innerHTML = '<div style="padding:12px;color:var(--text-secondary);font-size:12px;">No sessions yet</div>';
      return;
    }
    sessions.forEach(s => {
      const item = document.createElement('div');
      item.className = 'sidebar-item';
      const dateStr = new Date(s.date).toLocaleString();
      item.innerHTML = `
        <button class="btn-delete" title="Delete">&times;</button>
        <div class="sidebar-item-name">${s.name || s.id.slice(0,8)}</div>
        <div class="sidebar-item-meta">${dateStr}${s.model ? ' · ' + s.model : ''}</div>
        <div class="sidebar-item-preview">${s.preview || ''}</div>
      `;
      item.querySelector('.btn-delete').addEventListener('click', async (e) => {
        e.stopPropagation();
        await ipcRenderer.invoke('hermes:deleteSession', s.id);
        loadSessionList();
      });
      item.addEventListener('click', () => resumeSession(s.id));
      sidebarList.appendChild(item);
    });
  } catch {}
}

async function saveCurrentSession() {
  if (!currentSessionId) return;
  const preview = sessionOutputBuffer.slice(-5).join('').replace(/\x1b\[[0-9;]*m/g, '').trim().slice(0, 100);
  const session = {
    id: currentSessionId,
    name: sessionFirstInput || currentSessionId.slice(0, 8),
    date: new Date().toISOString(),
    preview,
    output: sessionOutputBuffer.join(''),
    model: cfgModel ? cfgModel.value : '',
  };
  try {
    await ipcRenderer.invoke('hermes:saveSession', session);
  } catch {}
}

async function resumeSession(id) {
  try {
    const session = await ipcRenderer.invoke('hermes:loadSession', id);
    if (!session || !session.output) return;
    // Stop current process
    if (isRunning) {
      await ipcRenderer.invoke('hermes:stop');
      isRunning = false;
    }
    terminal.clear();
    terminal.write(session.output);
    currentSessionId = id;
    sessionOutputBuffer = [session.output];
    setStatus('offline', 'Viewing: ' + (session.name || id.slice(0,8)));
  } catch {}
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
  // Buffer output for session history
  if (currentSessionId) {
    sessionOutputBuffer.push(data);
    // Auto-save every ~50 chunks to avoid data loss
    if (sessionOutputBuffer.length % 50 === 0) {
      saveCurrentSession();
    }
  }
});

ipcRenderer.on('hermes:exit', (_event, code) => {
  isRunning = false;
  // Save session on exit
  saveCurrentSession();
  // Don't override status during update/rollback/switch operations
  if (suppressExit) return;
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

  // Load current provider info for display
  try {
    const current = await ipcRenderer.invoke('hermes:getCurrentProvider');
    if (current.model) {
      statusText.textContent = current.model;
    }
  } catch {}

  // Auto-check for updates (non-blocking)
  checkForUpdates();
  setInterval(checkForUpdates, 30 * 60 * 1000); // recheck every 30 min

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

async function checkForUpdates() {
  try {
    const result = await ipcRenderer.invoke('hermes:checkForUpdates');
    if (result.hasUpdate) {
      updateBadge.classList.remove('hidden');
      updateBadge.title = `Update available: ${result.latest} (current: ${result.currentTag || result.current})`;
    } else {
      updateBadge.classList.add('hidden');
    }
  } catch {}
}

init();
