// Gobang client: local hotseat + online rooms over WebSocket.

const SIZE = 15;
const CELL = 40;
const MARGIN = 30;
const DIM = MARGIN * 2 + CELL * (SIZE - 1);

const COLORS = [
  { name: "Black", color: "#222222" },
  { name: "White", color: "#ffffff" },
  { name: "Red",   color: "#dd3333" },
  { name: "Blue",  color: "#2266dd" },
];

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const screens = { home: $("home"), lobby: $("lobby"), game: $("game") };
const canvas = $("board");
const ctx = canvas.getContext("2d");
const statusEl = $("status");
const undoBtn = $("undoBtn");
const againBtn = $("againBtn");

const dpr = window.devicePixelRatio || 1;
canvas.width = DIM * dpr;
canvas.height = DIM * dpr;
// Display size is controlled by CSS (responsive); internal resolution stays DIM * dpr.
ctx.scale(dpr, dpr);

function show(name) {
  for (const k in screens) screens[k].classList.toggle("hidden", k !== name);
}

// ---------- shared game state ----------
let mode = "local";          // "local" | "online"
let playerCount = 3;
let names = [];              // display names per seat
let board, moves, current, winner, winLine;

// online-only state
let ws = null;
let myIndex = -1;
let roomCode = "";
let undoPendingFrom = -1;    // seat index with a pending undo request (-1 = none)
const departedSet = new Set(); // seats disconnected mid-game; game pauses while non-empty

function newBoard() {
  board = Array.from({ length: SIZE }, () => Array(SIZE).fill(-1));
  moves = [];
  current = 0;
  winner = -1;
  winLine = null;
  undoPendingFrom = -1;
  departedSet.clear();
}

// ---------- rendering ----------
function draw() {
  ctx.clearRect(0, 0, DIM, DIM);

  ctx.strokeStyle = "#5a4632";
  ctx.lineWidth = 1;
  for (let i = 0; i < SIZE; i++) {
    const p = MARGIN + i * CELL;
    ctx.beginPath(); ctx.moveTo(MARGIN, p); ctx.lineTo(DIM - MARGIN, p); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(p, MARGIN); ctx.lineTo(p, DIM - MARGIN); ctx.stroke();
  }
  ctx.fillStyle = "#5a4632";
  for (const r of [3, 7, 11]) for (const c of [3, 7, 11]) {
    ctx.beginPath();
    ctx.arc(MARGIN + c * CELL, MARGIN + r * CELL, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  for (let r = 0; r < SIZE; r++)
    for (let c = 0; c < SIZE; c++)
      if (board[r][c] >= 0) drawPiece(r, c, COLORS[board[r][c]].color);

  if (moves.length && winner < 0) {
    const { r, c } = moves[moves.length - 1];
    ctx.strokeStyle = "#0a0";
    ctx.lineWidth = 2;
    ctx.strokeRect(MARGIN + c * CELL - 8, MARGIN + r * CELL - 8, 16, 16);
  }

  if (winLine) {
    ctx.strokeStyle = "#ff0";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(MARGIN + winLine[0].c * CELL, MARGIN + winLine[0].r * CELL);
    ctx.lineTo(MARGIN + winLine[1].c * CELL, MARGIN + winLine[1].r * CELL);
    ctx.stroke();
  }
}

function drawPiece(r, c, color) {
  const x = MARGIN + c * CELL, y = MARGIN + r * CELL, rad = CELL / 2 - 3;
  const g = ctx.createRadialGradient(x - rad / 3, y - rad / 3, rad / 6, x, y, rad);
  g.addColorStop(0, lighten(color));
  g.addColorStop(1, color);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, rad, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,.5)";
  ctx.lineWidth = 1;
  ctx.stroke();
}

function lighten(hex) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.min(255, v + 70);
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

function seatLabel(i) {
  const who = names[i] ? `${COLORS[i].name} (${names[i]})` : COLORS[i].name;
  return mode === "online" && i === myIndex ? `${who} — you` : who;
}

function updateStatus() {
  if (winner >= 0) {
    statusEl.innerHTML =
      `<i class="piece-dot" style="background:${COLORS[winner].color}"></i>` +
      `${seatLabel(winner)} wins!`;
  } else if (winner === -2) {
    statusEl.textContent = "Draw! Board is full.";
  } else {
    statusEl.innerHTML =
      `<i class="piece-dot" style="background:${COLORS[current].color}"></i>` +
      `${seatLabel(current)}'s turn`;
  }
  refreshUndoButton();
}

function refreshUndoButton() {
  const last = moves[moves.length - 1];
  if (mode === "local") {
    undoBtn.disabled = !last || winner !== -1;
  } else {
    undoBtn.disabled =
      !last || winner !== -1 || last.player !== myIndex ||
      undoPendingFrom !== -1 || departedSet.size > 0;
  }
}

function renderLegend() {
  $("legend").innerHTML = COLORS.slice(0, playerCount)
    .map(
      (p, i) =>
        `<span><i class="piece-dot" style="background:${p.color}"></i>${seatLabel(i)}</span>`
    )
    .join("");
}

function checkWin(r, c, p) {
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

// ---------- local mode ----------
function startLocal() {
  mode = "local";
  playerCount = Number($("localCount").value);
  names = COLORS.slice(0, playerCount).map((p) => "");
  newBoard();
  $("roomTag").classList.add("hidden");
  againBtn.classList.add("hidden");
  renderLegend();
  updateStatus();
  show("game");
  draw();
}

function localPlace(r, c) {
  board[r][c] = current;
  moves.push({ r, c, player: current });
  winLine = checkWin(r, c, current);
  if (winLine) {
    winner = current;
    againBtn.classList.remove("hidden");
  } else if (moves.length === SIZE * SIZE) {
    winner = -2;
    againBtn.classList.remove("hidden");
  } else {
    current = (current + 1) % playerCount;
  }
  updateStatus();
  draw();
}

function localUndo() {
  const last = moves.pop();
  if (!last) return;
  board[last.r][last.c] = -1;
  current = last.player;
  winner = -1;
  winLine = null;
  againBtn.classList.add("hidden");
  updateStatus();
  draw();
}

// ---------- online mode ----------
function connect() {
  if (ws && ws.readyState <= 1) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${proto}://${location.host}`);
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error("Cannot reach the server."));
    ws.onclose = () => {};
    ws.onmessage = (e) => handleMessage(JSON.parse(e.data));
  });
}

function sendMsg(msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function homeError(text) {
  $("homeError").textContent = text || "";
}

async function createRoom() {
  homeError("");
  try {
    await connect();
  } catch (e) {
    return homeError(e.message);
  }
  sendMsg({
    type: "create",
    name: $("nickname").value,
    password: $("createPwd").value,
    playerCount: Number($("createCount").value),
  });
}

async function joinRoom() {
  homeError("");
  try {
    await connect();
  } catch (e) {
    return homeError(e.message);
  }
  sendMsg({
    type: "join",
    name: $("nickname").value,
    code: $("joinCode").value,
    password: $("joinPwd").value,
  });
}

function renderLobby(msg) {
  roomCode = msg.code;
  playerCount = msg.playerCount;
  $("lobbyCode").textContent = msg.code;
  $("playerList").innerHTML = msg.players
    .map((p, i) => {
      const flag = p.ready
        ? `<span class="ready-flag">Ready ✓</span>`
        : `<span class="not-ready">Waiting…</span>`;
      const crown = i === 0 ? " 👑" : "";
      return `<li><i class="piece-dot" style="background:${COLORS[i].color}"></i>${p.name}${crown}${flag}</li>`;
    })
    .join("");
  const joined = msg.players.length;
  $("lobbyHint").textContent =
    joined < msg.playerCount
      ? `Waiting for players… ${joined}/${msg.playerCount} joined.`
      : "All players joined. Waiting for everyone to ready up.";
  const me = msg.players[myIndex];
  $("readyBtn").disabled = !!(me && me.ready);
}

function renderPauseBanner() {
  const el = $("pauseBanner");
  if (!departedSet.size) {
    el.classList.add("hidden");
    el.innerHTML = "";
    return;
  }
  el.classList.remove("hidden");
  el.innerHTML = [...departedSet]
    .map(
      (i) =>
        `<div class="pause-row">⏳ Waiting for <b>${names[i] || COLORS[i].name}</b> to reconnect…` +
        `<button data-idx="${i}" class="continueBtn">Continue without them</button></div>`
    )
    .join("");
  el.querySelectorAll(".continueBtn").forEach((b) => {
    b.onclick = () => sendMsg({ type: "continue_without", index: Number(b.dataset.idx) });
  });
}

function markSeatLeft(i) {
  if (names[i] && !names[i].endsWith("(left)")) names[i] += " (left)";
}

function handleMessage(msg) {
  switch (msg.type) {
    case "created":
    case "joined":
      myIndex = msg.playerIndex;
      roomCode = msg.code;
      if (!msg.rejoined) show("lobby"); // rejoins go straight to the game via 'sync'
      break;

    case "lobby":
      renderLobby(msg);
      break;

    case "start":
      mode = "online";
      playerCount = msg.playerCount;
      names = msg.players;
      newBoard();
      $("roomTag").textContent = "Room " + roomCode;
      $("roomTag").classList.remove("hidden");
      againBtn.classList.add("hidden");
      renderLegend();
      renderPauseBanner();
      updateStatus();
      show("game");
      draw();
      break;

    case "move":
      board[msg.r][msg.c] = msg.player;
      moves.push({ r: msg.r, c: msg.c, player: msg.player });
      if (msg.next >= 0) current = msg.next;
      undoPendingFrom = -1;
      $("undoBanner").classList.add("hidden");
      updateStatus();
      draw();
      break;

    case "win":
      winner = msg.player;
      winLine = msg.winLine;
      againBtn.classList.remove("hidden");
      againBtn.disabled = false;
      againBtn.textContent = "Play Again";
      updateStatus();
      draw();
      break;

    case "draw":
      winner = -2;
      againBtn.classList.remove("hidden");
      againBtn.disabled = false;
      againBtn.textContent = "Play Again";
      updateStatus();
      break;

    case "undo_request":
      undoPendingFrom = msg.from;
      if (msg.from === myIndex) {
        statusEl.textContent = "Undo requested — waiting for other players…";
      } else {
        $("undoText").textContent = `${names[msg.from]} wants to take back their last move.`;
        $("undoBanner").classList.remove("hidden");
      }
      refreshUndoButton();
      break;

    case "undo_applied":
      board[msg.r][msg.c] = -1;
      moves.pop();
      current = msg.next;
      undoPendingFrom = -1;
      $("undoBanner").classList.add("hidden");
      updateStatus();
      draw();
      break;

    case "undo_rejected":
      undoPendingFrom = -1;
      $("undoBanner").classList.add("hidden");
      statusEl.textContent = `${names[msg.by]} rejected the undo request.`;
      setTimeout(updateStatus, 1800);
      break;

    case "play_again":
      againBtn.textContent = `Play Again (${msg.count}/${msg.total})`;
      if (msg.count >= msg.total) againBtn.disabled = true;
      break;

    case "sync": // mid-game rejoin: rebuild the full board state
      mode = "online";
      playerCount = msg.playerCount;
      names = msg.players.map((n, i) =>
        msg.eliminated && msg.eliminated[i] ? n + " (left)" : n
      );
      newBoard();
      for (const p of msg.pieces) {
        board[p.r][p.c] = p.player;
        moves.push({ r: p.r, c: p.c, player: p.player });
      }
      current = msg.current;
      winner = msg.winner;
      winLine = msg.winLine || null;
      (msg.departed || []).forEach((i) => departedSet.add(i));
      $("roomTag").textContent = "Room " + roomCode;
      $("roomTag").classList.remove("hidden");
      againBtn.classList.toggle("hidden", winner === -1);
      renderLegend();
      renderPauseBanner();
      updateStatus();
      show("game");
      draw();
      break;

    case "player_disconnected": // accidental drop: pause and wait for rejoin
      departedSet.add(msg.index);
      renderPauseBanner();
      updateStatus();
      break;

    case "player_rejoined":
      departedSet.delete(msg.index);
      renderPauseBanner();
      updateStatus();
      draw();
      break;

    case "continued": // the room voted to continue without a departed player
      departedSet.delete(msg.index);
      markSeatLeft(msg.index);
      if (winner === -1) current = msg.next;
      renderLegend();
      renderPauseBanner();
      updateStatus();
      draw();
      break;

    case "player_eliminated": // another player left intentionally
      markSeatLeft(msg.index);
      if (winner === -1) current = msg.next;
      renderLegend();
      updateStatus();
      draw();
      break;

    case "room_closed":
      alert(msg.reason || "The room has been closed.");
      leaveToHome();
      break;

    case "error":
      if (screens.lobby.classList.contains("hidden") && screens.game.classList.contains("hidden")) {
        homeError(msg.message);
      } else {
        alert(msg.message);
      }
      break;
  }
}

function leaveToHome() {
  if (ws) {
    ws.onclose = null;
    ws.close();
    ws = null;
  }
  myIndex = -1;
  roomCode = "";
  departedSet.clear();
  $("pauseBanner").classList.add("hidden");
  $("undoBanner").classList.add("hidden");
  homeError("");
  show("home");
}

// Leave confirmation modal: the confirm button only becomes clickable after a
// 3-second countdown, preventing accidental taps from exiting the game.
let leaveTimer = null;

function openLeaveModal() {
  const btn = $("leaveConfirmBtn");
  btn.disabled = true;
  let n = 3;
  btn.textContent = `Confirm (${n}s)`;
  $("leaveModal").classList.remove("hidden");
  clearInterval(leaveTimer);
  leaveTimer = setInterval(() => {
    n--;
    if (n <= 0) {
      clearInterval(leaveTimer);
      btn.disabled = false;
      btn.textContent = "Confirm Leave";
    } else {
      btn.textContent = `Confirm (${n}s)`;
    }
  }, 1000);
}

function closeLeaveModal() {
  clearInterval(leaveTimer);
  $("leaveModal").classList.add("hidden");
}

$("leaveCancelBtn").addEventListener("click", closeLeaveModal);
$("leaveConfirmBtn").addEventListener("click", () => {
  closeLeaveModal();
  if (ws && ws.readyState === 1) sendMsg({ type: "leave" });
  // give the leave message a moment to flush before closing the socket
  setTimeout(leaveToHome, 60);
});

// ---------- events ----------
// Tap detection: a piece is placed only on a clean single-finger tap.
// Multi-touch (pinch zoom) or finger movement (drag/scroll) cancels the tap.
const TAP_SLOP = 10; // px of movement allowed before a tap becomes a drag
const activePointers = new Map(); // pointerId -> {x, y}
let tapCandidate = null;          // {id, x, y} while a valid tap is in progress

canvas.addEventListener("pointerdown", (e) => {
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  // A second finger cancels any pending tap (pinch/zoom gesture).
  tapCandidate =
    activePointers.size === 1 ? { id: e.pointerId, x: e.clientX, y: e.clientY } : null;
});

canvas.addEventListener("pointermove", (e) => {
  if (!activePointers.has(e.pointerId)) return;
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (tapCandidate && e.pointerId === tapCandidate.id) {
    if (Math.hypot(e.clientX - tapCandidate.x, e.clientY - tapCandidate.y) > TAP_SLOP)
      tapCandidate = null; // dragged too far — this is a scroll/drag, not a tap
  }
});

function endPointer(e) {
  activePointers.delete(e.pointerId);
  if (tapCandidate && e.pointerId !== tapCandidate.id) return; // other finger lifted
  tapCandidate = null;
}
canvas.addEventListener("pointercancel", endPointer);
canvas.addEventListener("pointerup", (e) => {
  const wasTap = tapCandidate && e.pointerId === tapCandidate.id;
  endPointer(e);
  if (!wasTap || winner !== -1 || departedSet.size) return;

  // Map the displayed (possibly scaled-down) position back to board coordinates.
  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) * (DIM / rect.width);
  const y = (e.clientY - rect.top) * (DIM / rect.height);
  const c = Math.round((x - MARGIN) / CELL);
  const r = Math.round((y - MARGIN) / CELL);
  if (r < 0 || r >= SIZE || c < 0 || c >= SIZE || board[r][c] !== -1) return;

  if (mode === "local") {
    localPlace(r, c);
  } else if (current === myIndex) {
    sendMsg({ type: "move", r, c }); // server will broadcast the placement
  }
});

undoBtn.addEventListener("click", () => {
  if (mode === "local") localUndo();
  else sendMsg({ type: "undo_request" });
});

$("undoAcceptBtn").addEventListener("click", () => {
  sendMsg({ type: "undo_response", accept: true });
  $("undoBanner").classList.add("hidden");
});
$("undoRejectBtn").addEventListener("click", () => {
  sendMsg({ type: "undo_response", accept: false });
  $("undoBanner").classList.add("hidden");
});

againBtn.addEventListener("click", () => {
  if (mode === "local") {
    newBoard();
    againBtn.classList.add("hidden");
    updateStatus();
    draw();
  } else {
    sendMsg({ type: "play_again" });
    againBtn.disabled = true;
  }
});

$("localStartBtn").addEventListener("click", startLocal);
$("createBtn").addEventListener("click", createRoom);
$("joinBtn").addEventListener("click", joinRoom);
$("readyBtn").addEventListener("click", () => sendMsg({ type: "ready" }));
$("lobbyLeaveBtn").addEventListener("click", openLeaveModal);
$("leaveBtn").addEventListener("click", openLeaveModal);

show("home");
