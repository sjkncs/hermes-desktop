# Hermes Desktop

**Super Intelligent AI Agent Desktop App** — powered by [Hermes Agent](https://github.com/NousResearch/hermes-agent).

## Features

- **Agent Chat** — Interactive terminal with Hermes AI agent (super-agent skill)
- **Session History** — Sidebar with saved sessions, auto-save on exit, resume any past session
- **API Settings** — Configure provider (OpenAI/Anthropic/OpenRouter/Custom), model, API key
- **Agent Parameters** — Sliders for Max Turns, Gateway Timeout, API Retries, Terminal Timeout
- **Workspace Directory** — Configurable project directory for file/code operations
- **Auto Update** — Checks GitHub releases every 30 min, red badge notification
- **Update & Rollback** — One-click update (`git pull + pip install`) or rollback to any version tag
- **Windows Shortcuts** — Ctrl+C copy, Ctrl+V paste, Ctrl+Z undo, Ctrl+A select all
- **Dark/Light Theme** — Toggle with one click

## Quick Start

### Dev Mode (requires Python + Node.js)

```bash
git clone https://github.com/sjkncs/hermes-desktop.git
cd hermes-desktop
npm install
npm start
```

Prerequisites:
- [Git for Windows](https://git-scm.com/download/win) (required on Windows for shell commands)
- Python 3.11+ with `hermes-agent` installed (`pip install -e .`)
- Node.js 18+

### Build EXE

```bash
npm run build
```

Output: `dist/Hermes-Desktop.exe` (portable, no installer needed)

## Configuration

All settings are stored in `~/.hermes/`:

| File | Purpose |
|------|---------|
| `config.yaml` | Model, provider, agent parameters, terminal settings |
| `.env` | API keys (OPENAI_API_KEY, ANTHROPIC_API_KEY, etc.) |
| `sessions/` | Saved session history (JSON) |

## Architecture

```
hermes-desktop/
├── main.js          # Electron main process (IPC, PTY, update/rollback)
├── preload.js       # Preload script
├── renderer/
│   ├── index.html   # UI layout (titlebar, sidebar, terminal, settings modal)
│   ├── app.js       # Renderer logic (terminal, sidebar, shortcuts, session history)
│   └── styles.css   # Styling (light/dark themes, modal, sidebar, sliders)
├── assets/
│   └── icon.png     # App icon
└── package.json     # Dependencies & build config
```

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl+C | Copy selection (or send SIGINT if no selection) |
| Ctrl+V | Paste from clipboard |
| Ctrl+Shift+C | Force copy |
| Ctrl+Shift+V | Force paste |
| Ctrl+Z | Undo (pass to shell) |
| Ctrl+A | Select all |

## License

MIT
