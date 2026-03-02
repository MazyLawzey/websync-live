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

### 1. Download ngrok CLI!!!
[ngrok.com/download](https://ngrok.com/download)
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
5. Sometimes you need twice join session.

---

## Internet Sharing (ngrok)

1. Get a free auth token at [dashboard.ngrok.com](https://dashboard.ngrok.com/get-started/your-authtoken)
2. In the WebSync panel click **🌍 Share**
3. Paste your authtoken and click **Start Tunnel**
4. Click **📋 Copy Join Info for Students** — paste it to your students

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

---

# ⚠️ Important Notice About VS Code Marketplace Version

If you installed our extension from the VS Code Marketplace, please read this before opening an issue.

The Marketplace version has significant limitations and restrictions, which may cause unexpected errors or missing functionality. These issues are often related to the Marketplace build itself and not the core project.

## 🚨 Before creating an issue, please make sure you are using the stable version from our official GitHub Releases.

The version published in GitHub Releases is the original and fully stable build without the limitations present in the Marketplace version.

### 👉 Please download and install the extension directly from GitHub Releases for the best and most stable experience.

If the issue still persists after installing the GitHub release version, feel free to open an issue — we’ll be happy to help.

**Thank you for your understanding and support!**
