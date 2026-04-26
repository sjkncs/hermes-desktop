# 🏛️ Hermes Desktop

Electron desktop wrapper for **Hermes Agent** CLI — an AI assistant with tool-calling capabilities, powered by xterm.js terminal emulation.

## ✨ Features

- **Interactive Terminal** — Full PTY support via node-pty, enabling real-time interaction with Hermes Agent CLI
- **xterm.js UI** — Modern terminal renderer with 256-color support, cursor styling, and link detection
- **Light/Dark Themes** — Toggle between themes with persistent preference (localStorage)
- **Smart Auto-Scroll** — Auto-scrolls to new output only when you're at the bottom; won't fight you when scrolling up
- **Auto-Start** — Hermes Agent launches automatically on app startup
- **Window Icon** — Custom Hermes Conrad (Futurama) icon
- **External Links** — URLs open in default browser

## 📦 Tech Stack

| Component | Technology |
|-----------|-----------|
| Shell | Electron 33+ |
| Terminal | xterm.js (@xterm/xterm) |
| PTY | node-pty (ConPTY / WinPTY) |
| Fit | @xterm/addon-fit |
| Links | @xterm/addon-web-links |
| IPC | Electron ipcMain/ipcRenderer |

## 🚀 Setup

```bash
# Install dependencies
npm install

# Run in development mode
npx electron .

# Build for distribution
npx electron-builder
```

## ⚙️ Configuration

The app connects to Hermes Agent via:
- **Dev mode**: `python -m hermes_cli.main chat -s super-agent` (from parent `hermes-agent` directory)
- **Production**: Bundled `Hermes.exe` from `resources/hermes/`

Environment variables set for the PTY process:
- `FORCE_COLOR=1` — Enable colored output
- `PYTHONUTF8=1` — Force UTF-8 encoding on Windows
- `PYTHONUNBUFFERED=1` — Disable output buffering
- `TERM=xterm-256color` — 256-color terminal support

## 📁 Project Structure

```
hermes-desktop/
├── main.js              # Electron main process (PTY spawn, IPC handlers)
├── preload.js           # Preload script (empty — using nodeIntegration)
├── package.json         # Dependencies & Electron config
├── assets/
│   ├── icon.png         # App icon (256x256)
│   ├── icon.ico         # Windows icon
│   ├── icon.svg         # Source SVG (Hermes Conrad)
│   └── icon-{16,32,48}.png  # Multi-size icons
└── renderer/
    ├── index.html       # Main window HTML
    ├── app.js           # Terminal init, theme toggle, IPC listeners
    └── styles.css       # Light/dark theme CSS variables
```

## 🎨 Themes

| Theme | Background | Foreground |
|-------|-----------|-----------|
| Light | #FFFFFF | #000000 |
| Dark  | #1E1E1E | #FFFFFF |

Toggle via the ☾/☀ button in the title bar. Preference saved to localStorage.

## 📄 License

MIT
