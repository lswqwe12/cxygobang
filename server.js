// Gobang multiplayer server: static file hosting + WebSocket room management.
const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 3000;
const SIZE = 15;
const PUBLIC_DIR = path.join(__dirname, "public");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

// ---------- static file server ----------
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/index.html";
  const file = path.join(PUBLIC_DIR, path.normalize(p));
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end("Not found");
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  });
});

// ---------- rooms ----------
const wss = new WebSocketServer({ server });
const rooms = new Map(); // code -> room

// room = {
//   code, password, playerCount,
//   players: [{ ws, name, ready, connected }],   // index = seat = color
//   started, board, moves, current, winner, winLine,
//   undoRequest: { from, votes: Set } | null,
//   playAgain: Set
// }

function genCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do {
    code = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  } while (rooms.has(code));
  return code;
}

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function broadcast(room, msg) {
  for (const p of room.players) if (p.connected) send(p.ws, msg);
}

function lobbyState(room) {
  return {
    type: "lobby",
    code: room.code,
    playerCount: room.playerCount,
    players: room.players.map((p) => ({ name: p.name, ready: p.ready })),
  };
}

function connectedCount(room) {
  return room.players.filter((p) => p.connected).length;
}

function nextTurn(room) {
  let n = room.current;
  do {
    n = (n + 1) % room.playerCount;
  } while (!room.players[n].connected);
  room.current = n;
  return n;
}

function checkWin(board, r, c, p) {
  const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
  for (const [dr, dc] of dirs) {
    const cells = [{ r, c }];
    for (const s of [1, -1]) {
      let nr = r + dr * s, nc = c + dc * s;
      while (nr >= 0 && nr < SIZE && nc >= 0 && nc < SIZE && board[nr][nc] === p) {
        cells.push({ r: nr, c: nc });
        nr += dr * s; nc += dc * s;
      }
    }
    if (cells.length >= 5) {
      cells.sort((a, b) => a.r - b.r || a.c - b.c);
      return [cells[0], cells[cells.length - 1]];
    }
  }
  return null;
}

function startGame(room) {
  room.started = true;
  room.board = Array.from({ length: SIZE }, () => Array(SIZE).fill(-1));
  room.moves = [];
  room.current = 0;
  room.winner = -1;
  room.winLine = null;
  room.undoRequest = null;
  room.playAgain = new Set();
  broadcast(room, {
    type: "start",
    players: room.players.map((p) => p.name),
    playerCount: room.playerCount,
  });
}

function closeRoom(room, reason) {
  broadcast(room, { type: "room_closed", reason });
  for (const p of room.players) if (p.connected) p.ws.close();
  rooms.delete(room.code);
}

function applyUndo(room) {
  const last = room.moves.pop();
  room.board[last.r][last.c] = -1;
  room.current = last.player;
  room.undoRequest = null;
  broadcast(room, { type: "undo_applied", r: last.r, c: last.c, next: room.current });
}

function findRoom(ws) {
  if (!ws.roomCode) return null;
  const room = rooms.get(ws.roomCode);
  return room && room.players[ws.playerIndex] ? room : null;
}

const handlers = {
  create(ws, msg) {
    const name = String(msg.name || "").trim().slice(0, 20);
    const playerCount = Number(msg.playerCount);
    if (!name) return send(ws, { type: "error", message: "Please enter a nickname." });
    if (![2, 3, 4].includes(playerCount))
      return send(ws, { type: "error", message: "Player count must be 2, 3 or 4." });
    const code = genCode();
    const room = {
      code,
      password: String(msg.password || ""),
      playerCount,
      players: [{ ws, name, ready: false, connected: true }],
      started: false,
      board: null, moves: [], current: 0, winner: -1, winLine: null,
      undoRequest: null, playAgain: new Set(),
    };
    rooms.set(code, room);
    ws.roomCode = code;
    ws.playerIndex = 0;
    send(ws, { type: "created", code, playerIndex: 0 });
    broadcast(room, lobbyState(room));
  },

  join(ws, msg) {
    const name = String(msg.name || "").trim().slice(0, 20);
    const code = String(msg.code || "").trim().toUpperCase();
    if (!name) return send(ws, { type: "error", message: "Please enter a nickname." });
    const room = rooms.get(code);
    if (!room) return send(ws, { type: "error", message: "Room not found. Check the room code." });
    if (room.password !== String(msg.password || ""))
      return send(ws, { type: "error", message: "Wrong password." });
    if (room.started)
      return send(ws, { type: "error", message: "This match has already started. Late joining is not allowed." });
    if (room.players.length >= room.playerCount)
      return send(ws, { type: "error", message: "Room is full." });
    const idx = room.players.length;
    room.players.push({ ws, name, ready: false, connected: true });
    ws.roomCode = code;
    ws.playerIndex = idx;
    send(ws, { type: "joined", code, playerIndex: idx });
    broadcast(room, lobbyState(room));
  },

  ready(ws) {
    const room = findRoom(ws);
    if (!room || room.started) return;
    room.players[ws.playerIndex].ready = true;
    broadcast(room, lobbyState(room));
    if (
      room.players.length === room.playerCount &&
      room.players.every((p) => p.ready)
    ) {
      startGame(room);
    }
  },

  move(ws, msg) {
    const room = findRoom(ws);
    if (!room || !room.started || room.winner >= 0) return;
    if (ws.playerIndex !== room.current) return;
    const r = Number(msg.r), c = Number(msg.c);
    if (!(r >= 0 && r < SIZE && c >= 0 && c < SIZE) || room.board[r][c] !== -1) return;
    room.undoRequest = null; // a new move cancels any pending undo discussion
    room.board[r][c] = ws.playerIndex;
    room.moves.push({ r, c, player: ws.playerIndex });
    const winLine = checkWin(room.board, r, c, ws.playerIndex);
    if (winLine) {
      room.winner = ws.playerIndex;
      room.winLine = winLine;
      broadcast(room, { type: "move", r, c, player: ws.playerIndex, next: -1 });
      broadcast(room, { type: "win", player: ws.playerIndex, winLine });
    } else if (room.moves.length === SIZE * SIZE) {
      broadcast(room, { type: "move", r, c, player: ws.playerIndex, next: -1 });
      broadcast(room, { type: "draw" });
    } else {
      broadcast(room, { type: "move", r, c, player: ws.playerIndex, next: nextTurn(room) });
    }
  },

  undo_request(ws) {
    const room = findRoom(ws);
    if (!room || !room.started || room.winner >= 0 || room.undoRequest) return;
    const last = room.moves[room.moves.length - 1];
    if (!last || last.player !== ws.playerIndex)
      return send(ws, { type: "error", message: "You can only take back your own last move." });
    const others = room.players
      .map((p, i) => (p.connected && i !== ws.playerIndex ? i : -1))
      .filter((i) => i >= 0);
    if (others.length === 0) {
      applyUndo(room); // alone in the room, approve instantly
      return;
    }
    room.undoRequest = { from: ws.playerIndex, votes: new Set(others) };
    broadcast(room, { type: "undo_request", from: ws.playerIndex });
  },

  undo_response(ws, msg) {
    const room = findRoom(ws);
    if (!room || !room.undoRequest) return;
    const req = room.undoRequest;
    if (!req.votes.has(ws.playerIndex)) return; // not a voter or already voted
    if (!msg.accept) {
      room.undoRequest = null;
      return broadcast(room, { type: "undo_rejected", by: ws.playerIndex });
    }
    req.votes.delete(ws.playerIndex);
    if (req.votes.size === 0) applyUndo(room);
  },

  play_again(ws) {
    const room = findRoom(ws);
    if (!room || !room.started || room.winner < 0) return;
    room.playAgain.add(ws.playerIndex);
    const total = connectedCount(room);
    broadcast(room, { type: "play_again", count: room.playAgain.size, total });
    if (room.playAgain.size >= total) {
      room.players.forEach((p) => (p.ready = false));
      startGame(room);
    }
  },
};

wss.on("connection", (ws) => {
  ws.isAlive = true;
  ws.on("pong", () => (ws.isAlive = true));

  ws.on("message", (data) => {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    const h = handlers[msg.type];
    if (h) h(ws, msg);
  });

  ws.on("close", () => {
    const room = findRoom(ws);
    if (!room) return;
    const idx = ws.playerIndex;

    if (idx === 0) {
      // Room owner went offline: terminate the room for everyone.
      return closeRoom(room, "The room owner went offline. The room has been closed.");
    }

    if (!room.started) {
      room.players.splice(idx, 1);
      room.players.forEach((p, i) => (p.ws.playerIndex = i));
      broadcast(room, lobbyState(room));
    } else {
      room.players[idx].connected = false;
      if (connectedCount(room) < 2) {
        return closeRoom(room, "Too many players left. The room has been closed.");
      }
      if (room.undoRequest) {
        if (room.undoRequest.from === idx) room.undoRequest = null;
        else {
          room.undoRequest.votes.delete(idx);
          if (room.undoRequest.votes.size === 0) applyUndo(room);
        }
      }
      if (room.winner < 0 && room.current === idx) {
        const next = nextTurn(room);
        broadcast(room, { type: "player_left", index: idx, next });
      } else {
        broadcast(room, { type: "player_left", index: idx, next: room.current });
      }
    }
  });
});

// Heartbeat: cloud gateways (WeChat Cloud Hosting, Nginx, etc.) drop idle
// connections. Ping every 30 s and terminate sockets that stop responding,
// which also makes "owner went offline" detection reliable.
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);
wss.on("close", () => clearInterval(heartbeat));

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Gobang server listening on http://localhost:${PORT}`);
});
