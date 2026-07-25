# Gobang — Multiplayer Gomoku for 2–4 Players

A Gobang (Gomoku / Five-in-a-Row) game supporting **2, 3, or 4 players**, playable either
**locally** (hotseat on one device) or **online** (private rooms over WebSocket).

## Features

- **Initial screen** to choose *Local Play* or *Online Play* and the number of players (2–4).
- **Local play**: players take turns on the same device with pieces of different colors
  (Black, White, Red, Blue).
- **Online play**:
  - Create a room with an optional password, or join a room with its 5-character code + password.
  - The room creator sets the number of players when creating the room.
  - The match starts automatically when **all seats are filled and everyone is ready**.
  - Late joining during an ongoing match is not allowed.
  - If the room owner goes offline, the room is terminated and everyone is sent back to the home screen.
- **Standard Gobang rules**: first to make an unbroken line of 5 pieces
  (horizontal, vertical, or diagonal) wins; a full board is a draw.
- **Move retraction (undo)**:
  - Local: one click takes back the last move, repeatable.
  - Online: a player may request to retract **their own last move**; all other connected
    players must accept. Any rejection cancels the request.
- **Play again**: after a match ends, everyone can vote to play again; the board resets
  when all connected players agree.
- Last-move highlight and winning-line highlight.

## Project Structure

```
TFBoysTest/
├── server.js            # HTTP static server + WebSocket room management
├── package.json         # single dependency: ws
├── public/
│   ├── index.html       # home / lobby / game screens
│   ├── style.css
│   └── client.js        # board rendering, local logic, online protocol client
├── README.md
└── DEPLOYMENT.md        # how to put this game online
```

## Run Locally

Requires **Node.js 18+**.

```bash
npm install
npm start
```

Then open <http://localhost:3000> in your browser. To play online with friends on the
same machine or LAN, share your machine's IP, e.g. `http://192.168.x.x:3000`.

To use a different port:

```bash
PORT=8080 npm start
```

## How to Play

### Local Play
1. Choose the number of players (2–4) and click **Start Local Game**.
2. Players take turns clicking an empty intersection to place their piece.
   Turn order: Black → White → Red → Blue.
3. **Undo** retracts the most recent move. **Play Again** appears after a win/draw.

### Online Play
1. Enter a nickname.
2. **Create Room**: pick the player count and an optional password. You'll receive a
   5-character room code — share the code and password with your friends.
3. **Join Room**: enter the code and password.
4. In the lobby, everyone clicks **Ready**. The match starts when all seats are filled
   and everyone is ready.
5. On your turn, click an empty intersection. You can request an **Undo** of your own
   last move — the match pauses until all other players accept or someone rejects.
6. After the match, click **Play Again**; the board resets when everyone agrees.

## Client–Server Protocol (WebSocket, JSON)

Client → Server:

| Message | Payload | Purpose |
|---|---|---|
| `create` | `name, password, playerCount` | Create a room |
| `join` | `name, code, password` | Join a room |
| `ready` | — | Mark ready in the lobby |
| `move` | `r, c` | Place a piece |
| `undo_request` | — | Ask to retract your last move |
| `undo_response` | `accept` | Vote on an undo request |
| `play_again` | — | Vote for a rematch |

Server → Client: `created`, `joined`, `lobby`, `start`, `move`, `win`, `draw`,
`undo_request`, `undo_applied`, `undo_rejected`, `play_again`, `player_left`,
`room_closed`, `error`.

The server is authoritative: it validates turns, occupied cells, win detection,
and room lifecycle.

## Deployment

- [DEPLOYMENT.md](DEPLOYMENT.md) — overseas platforms (Render, Railway, VPS + Nginx, Docker).
- [DEPLOYMENT_CN.md](DEPLOYMENT_CN.md) — mainland China platforms (WeChat Cloud Hosting 微信云托管,
  Tencent Lighthouse, Alibaba Cloud SAE/ECS).
