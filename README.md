<img width="3480" height="800" alt="WebSync Live" src="https://github.com/user-attachments/assets/366c3843-3b90-4654-9eb8-158ef1200461" />

**WebSync Live** — VS Code extension for collaborative web development in education.  
A teacher opens a session, students join and see code, preview, and cursor positions in real time — like CodeTogether + Live Server + Figma, all inside VS Code.

---

## Features

| Feature | Description |
|---|---|
| 🔴 **Live Session** | Host creates a session, students join with a code |
| 📁 **File Sync** | All workspace files are synced from host to students instantly |
| ✏️ **Incremental Edits** | Only changed ranges are sent — no cursor jumps, no full-file replacement |
| 👁️ **File Navigation Sync** | Host switches file → students' editor follows automatically |
| 🖱️ **Collaborative Cursors** | Figma-style colored cursors with names for all participants |
| 💬 **Code Comments** | Add inline comments on any line, visible to everyone |
| 🌐 **Live Preview** | Built-in iframe preview with live reload on every save |
| 🔒 **Role System** | Host · Admin · Editor · Viewer — each with different permissions |
| 🌍 **ngrok Tunnel** | Share your session over the internet through CG-NAT with one click |
| ▶️ **Code Runner** | Run Python, JS, C++, Go, Swift and more — output streams to built-in Console |
| 📂 **Change Server Folder** | Switch the served root folder without restarting |
| 🏷️ **Status Bar** | Shows your nickname, session code and role at the bottom of VS Code |

---

## Roles

| Role | Edit Files | Add Comments | Change Roles | Kick Users |
|---|---|---|---|---|
| **Host** | ✅ | ✅ | ✅ | ✅ |
| **Admin** | ✅ | ✅ | ✅ (editors/viewers) | ✅ |
| **Editor** | ✅ | ✅ | ❌ | ❌ |
| **Viewer** | ❌ | ❌ | ❌ | ❌ |

---

## Requirements

- **VS Code** 1.85+
- **Node.js** — bundled with VS Code (no extra install)
- **ngrok CLI** *(optional, only for internet sharing)*  
  Install: `brew install ngrok` (macOS) or download from [ngrok.com/download](https://ngrok.com/download)

---

## Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Run the extension

Press **F5** in VS Code to launch the Extension Development Host.

### 3. Open the sidebar

Click the **WebSync Live** icon in the Activity Bar (left side).

---

## Usage

### Host (Teacher)

1. Enter your display name
2. Click **Create Session**
3. Server starts automatically on `http://localhost:3000`
4. Share the session code with students  
   *(or use **🌍 Share** → ngrok for internet access)*
5. Open any file — students see it in their editor instantly

### Student

1. Enter your display name and the session code
2. Enter the server URL (e.g. `ws://localhost:3000` or the ngrok WSS URL)
3. Click **Join Session**
4. Files are synced automatically — no setup needed

---

## Internet Sharing (ngrok)

1. Get a free auth token at [dashboard.ngrok.com](https://dashboard.ngrok.com/get-started/your-authtoken)
2. In the WebSync panel click **🌍 Share**
3. Paste your authtoken and click **Start Tunnel**
4. Click **📋 Copy Join Info for Students** — paste it to your students

---

## Code Runner

Supported languages out of the box:

| Extension | Runner |
|---|---|
| `.py` | `python3` |
| `.js` | `node` |
| `.ts` | `npx ts-node` |
| `.rb` | `ruby` |
| `.sh` | `bash` |
| `.go` | `go run` |
| `.swift` | `swift` |
| `.cpp` / `.cc` | `g++` |
| `.c` | `gcc` |

Click **▶ Run** in the toolbar or use the **Console** tab. Output streams in real time with stdout/stderr color coding.

---

## Project Structure

```
websync-live/
├── index.js              # Extension entry point
├── package.json          # Extension manifest
├── client/
│   └── client.js         # WebSocket client (EventEmitter)
├── server/
│   └── server.js         # Express + WebSocket server
│   └── server/
│       ├── permissions/  # Role-based permission system
│       ├── code/         # Comment store
│       └── webview/      # Live reload injector
└── ui/
    ├── index.html        # Sidebar webview UI
    └── public/
        ├── main.js       # Webview JS logic
        ├── style.css     # Styles
        └── media.css     # Media queries
```

---

## Commands

| Command | Description |
|---|---|
| `Websync Live: Open Preview` | Open preview in a panel |
| `Websync Live: Start Server` | Start the local server |
| `Websync Live: Create Session` | Create a new session |
| `Websync Live: Join Session` | Join with a code |
| `Websync Live: Add Comment` | Add comment on current line |
| `Websync Live: Change Server Folder` | Change the served root folder |
| `Websync Live: Run Code` | Run the active file |
| `Websync Live: Stop Code` | Stop the running process |
| `Websync Live: Disconnect` | Leave the session |

---

## Authors

- [**MazyLawzey**](https://github.com/MazyLawzey) — main author
- [**rionn11**](https://github.com/rionn11) — main contributor

---

## License

[GPL-3.0](LICENSE)
