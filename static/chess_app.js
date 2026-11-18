// CHESS TACTICS // Minimax AI, Legal Rules & SQLite Backend
(function() {
  const chessboardEl = document.getElementById('chessboard');
  const turnIndicator = document.getElementById('turnIndicator');
  const evalDisplay = document.getElementById('evalDisplay');
  const evalBarFill = document.getElementById('evalBarFill');
  const whiteClockEl = document.getElementById('whiteClock');
  const blackClockEl = document.getElementById('blackClock');
  const whiteClockCard = document.getElementById('whiteClockCard');
  const blackClockCard = document.getElementById('blackClockCard');
  const pgnBody = document.getElementById('pgnBody');

  const modeTabs = document.querySelectorAll('.mode-tab');
  const aiSettings = document.getElementById('aiSettings');
  const puzzleSettings = document.getElementById('puzzleSettings');
  const multiSettings = document.getElementById('multiSettings');
  const aiDifficulty = document.getElementById('aiDifficulty');
  const playerColor = document.getElementById('playerColor');
  const btnNewGame = document.getElementById('btnNewGame');
  const btnNextPuzzle = document.getElementById('btnNextPuzzle');
  const puzzleTheme = document.getElementById('puzzleTheme');
  const puzzleRating = document.getElementById('puzzleRating');
  const puzzleStatus = document.getElementById('puzzleStatus');
  const roomCodeInput = document.getElementById('roomCodeInput');
  const btnJoinRoom = document.getElementById('btnJoinRoom');
  const roomStatus = document.getElementById('roomStatus');
  const btnSaveMatch = document.getElementById('btnSaveMatch');

  // Unicode Pieces
  const PIECES = {
    'K': '♔', 'Q': '♕', 'R': '♖', 'B': '♗', 'N': '♘', 'P': '♙',
    'k': '♚', 'q': '♛', 'r': '♜', 'b': '♝', 'n': '♞', 'p': '♟'
  };

  const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  let currentFen = START_FEN;
  let activeTurn = 'w';
  let selectedSquare = null;
  let lastMove = { from: null, to: null };
  let movesHistory = [];
  let isAiThinking = false;
  let currentMode = 'ai'; // 'ai' | 'puzzle' | 'multi'

  // Clock state (in seconds)
  let whiteTime = 180;
  let blackTime = 180;
  let timerInterval = null;

  // Puzzles
  let puzzlesList = [];
  let currentPuzzleIdx = 0;

  // Multiplayer
  let ws = null;
  let playerAssignedColor = 'w';

  // Board Coordinates: ranks 8..1, files a..h
  const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const RANKS = ['8', '7', '6', '5', '4', '3', '2', '1'];

  // Parse FEN to 8x8 matrix
  function parseFen(fen) {
    const parts = fen.split(' ');
    const boardStr = parts[0];
    activeTurn = parts[1] || 'w';

    const rows = boardStr.split('/');
    const grid = [];
    for (let r = 0; r < 8; r++) {
      const row = [];
      for (let ch of rows[r]) {
        if (!isNaN(ch)) {
          for (let k = 0; k < parseInt(ch); k++) row.push(null);
        } else {
          row.push(ch);
        }
      }
      grid.push(row);
    }
    return grid;
  }

  // Render Chessboard
  function renderBoard() {
    chessboardEl.innerHTML = '';
    const grid = parseFen(currentFen);

    turnIndicator.textContent = activeTurn === 'w' ? 'WHITE TO MOVE' : 'BLACK TO MOVE';
    if (activeTurn === 'w') {
      whiteClockCard.classList.add('active');
      blackClockCard.classList.remove('active');
    } else {
      blackClockCard.classList.add('active');
      whiteClockCard.classList.remove('active');
    }

    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const sqName = FILES[f] + RANKS[r];
        const isDark = (r + f) % 2 === 1;
        const square = document.createElement('div');
        square.className = `square ${isDark ? 'dark' : 'light'}`;
        square.dataset.square = sqName;

        if (selectedSquare === sqName) square.classList.add('selected');
        if (lastMove.from === sqName || lastMove.to === sqName) square.classList.add('last-move');

        const piece = grid[r][f];
        if (piece) {
          const pieceEl = document.createElement('span');
          const isWhitePiece = piece === piece.toUpperCase();
          pieceEl.className = `piece ${isWhitePiece ? 'white' : 'black'}`;
          pieceEl.textContent = PIECES[piece];
          square.appendChild(pieceEl);
        }

        square.addEventListener('click', () => handleSquareClick(sqName, piece));
        chessboardEl.appendChild(square);
      }
    }
  }

  // Handle Square Selection and Moves
  async function handleSquareClick(sqName, piece) {
    if (isAiThinking) return;

    if (!selectedSquare) {
      if (!piece) return;
      const isWhitePiece = piece === piece.toUpperCase();
      if ((activeTurn === 'w' && !isWhitePiece) || (activeTurn === 'b' && isWhitePiece)) return;

      selectedSquare = sqName;
      renderBoard();
      return;
    }

    // Attempting a move
    if (selectedSquare === sqName) {
      selectedSquare = null;
      renderBoard();
      return;
    }

    const fromSq = selectedSquare;
    const toSq = sqName;
    const uciMove = fromSq + toSq;

    selectedSquare = null;

    if (currentMode === 'puzzle') {
      await handlePuzzleMove(uciMove);
    } else {
      await executeMove(uciMove);
    }
  }

  // Send move to validation API
  async function executeMove(uciMove) {
    try {
      const res = await fetch('/api/game/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fen: currentFen, uci_move: uciMove })
      });
      const data = await res.json();

      if (!data.legal) {
        return; // Illegal move, silently rejected
      }

      // Valid Move
      lastMove = { from: uciMove.substring(0, 2), to: uciMove.substring(2, 4) };
      currentFen = data.new_fen;
      recordMove(data.san);
      updateEval(data.eval_cp);

      renderBoard();

      // Checkmate / Stalemate notification
      if (data.is_checkmate) {
        turnIndicator.textContent = `CHECKMATE! ${data.result}`;
        clearInterval(timerInterval);
        return;
      }
      if (data.is_stalemate) {
        turnIndicator.textContent = 'DRAW BY STALEMATE (1/2-1/2)';
        clearInterval(timerInterval);
        return;
      }

      // If Multiplayer, broadcast move
      if (currentMode === 'multi' && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'MOVE', uci: uciMove, fen: currentFen, san: data.san }));
      }

      // If AI mode and it's AI's turn
      if (currentMode === 'ai' && !data.is_game_over) {
        const aiTurn = playerColor.value === 'w' ? 'b' : 'w';
        if (activeTurn === aiTurn) {
          triggerAiResponse();
        }
      }

    } catch (e) {
      console.error(e);
    }
  }

  // Trigger Backend Minimax AI
  async function triggerAiResponse() {
    isAiThinking = true;
    turnIndicator.textContent = 'AI CALCULATING (MINIMAX)...';

    try {
      const diff = parseInt(aiDifficulty.value);
      const res = await fetch('/api/ai/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fen: currentFen, difficulty: diff })
      });
      const data = await res.json();

      if (data.status === 'ok') {
        await executeMove(data.uci);
      }
    } catch (e) {
      console.error("AI Move failed", e);
    } finally {
      isAiThinking = false;
    }
  }

  // Puzzles Logic
  async function handlePuzzleMove(uciMove) {
    const puzzle = puzzlesList[currentPuzzleIdx];
    if (!puzzle) return;

    if (uciMove === puzzle.solution_uci || (uciMove + 'q') === puzzle.solution_uci) {
      puzzleStatus.textContent = "✓ CORRECT! Excellent tactical vision.";
      puzzleStatus.style.color = "#10B981";

      // Execute on board
      const res = await fetch('/api/game/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fen: currentFen, uci_move: puzzle.solution_uci })
      });
      const data = await res.json();
      if (data.legal) {
        currentFen = data.new_fen;
        lastMove = { from: uciMove.substring(0, 2), to: uciMove.substring(2, 4) };
        renderBoard();
      }
    } else {
      puzzleStatus.textContent = "✗ Suboptimal move. Try another tactical line.";
      puzzleStatus.style.color = "#EF4444";
    }
  }

  async function loadPuzzles() {
    try {
      const res = await fetch('/api/puzzles');
      const data = await res.json();
      puzzlesList = data.puzzles;
      currentPuzzleIdx = 0;
      loadActivePuzzle();
    } catch (e) {
      console.error(e);
    }
  }

  function loadActivePuzzle() {
    if (!puzzlesList.length) return;
    const p = puzzlesList[currentPuzzleIdx];
    currentFen = p.fen;
    selectedSquare = null;
    lastMove = { from: null, to: null };
    puzzleTheme.textContent = `Theme: ${p.theme}`;
    puzzleRating.textContent = `Rating: ${p.rating}`;
    puzzleStatus.textContent = "Find the winning tactical move!";
    puzzleStatus.style.color = "#8E8E98";
    renderBoard();
  }

  btnNextPuzzle.addEventListener('click', () => {
    currentPuzzleIdx = (currentPuzzleIdx + 1) % puzzlesList.length;
    loadActivePuzzle();
  });

  // Notation PGN table
  function recordMove(san) {
    if (activeTurn === 'w') {
      movesHistory.push({ white: san, black: '' });
    } else {
      if (movesHistory.length > 0) {
        movesHistory[movesHistory.length - 1].black = san;
      }
    }
    renderPgnTable();
  }

  function renderPgnTable() {
    pgnBody.innerHTML = '';
    movesHistory.forEach((m, idx) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${idx + 1}</td><td>${m.white}</td><td>${m.black}</td>`;
      pgnBody.appendChild(tr);
    });
    pgnBody.parentElement.scrollTop = pgnBody.parentElement.scrollHeight;
  }

  // Evaluation bar
  function updateEval(cp) {
    const clampedCp = Math.max(-1000, Math.min(1000, cp));
    // 0 = 50%, +1000 = 100%, -1000 = 0%
    const whitePct = Math.round(50 + (clampedCp / 1000) * 50);
    evalBarFill.style.height = `${whitePct}%`;

    const sign = cp >= 0 ? '+' : '';
    evalDisplay.textContent = `${sign}${(cp / 100).toFixed(2)} CP`;
  }

  // Clocks
  function startClocks() {
    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      if (activeTurn === 'w') {
        whiteTime = Math.max(0, whiteTime - 1);
      } else {
        blackTime = Math.max(0, blackTime - 1);
      }
      updateClockDisplays();
    }, 1000);
  }

  function updateClockDisplays() {
    const fmt = (s) => `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
    whiteClockEl.textContent = fmt(whiteTime);
    blackClockEl.textContent = fmt(blackTime);
  }

  // Mode Tabs Switching
  modeTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      modeTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentMode = tab.dataset.mode;

      aiSettings.classList.add('hidden');
      puzzleSettings.classList.add('hidden');
      multiSettings.classList.add('hidden');

      if (currentMode === 'ai') {
        aiSettings.classList.remove('hidden');
        resetGame();
      } else if (currentMode === 'puzzle') {
        puzzleSettings.classList.remove('hidden');
        loadPuzzles();
      } else if (currentMode === 'multi') {
        multiSettings.classList.remove('hidden');
      }
    });
  });

  // Multiplayer Room Setup
  btnJoinRoom.addEventListener('click', () => {
    const code = roomCodeInput.value.trim() || 'ROOM-01';
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    if (ws) ws.close();

    ws = new WebSocket(`${protocol}//${window.location.host}/ws/room/${code}`);
    roomStatus.textContent = `Connecting to ${code}...`;

    ws.onopen = () => {
      roomStatus.textContent = `Connected to LAN room [${code}]`;
      roomStatus.style.color = '#10B981';
    };

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'MOVE') {
          currentFen = msg.fen;
          lastMove = { from: msg.uci.substring(0, 2), to: msg.uci.substring(2, 4) };
          recordMove(msg.san);
          renderBoard();
        }
      } catch (err) {}
    };

    ws.onclose = () => {
      roomStatus.textContent = 'Disconnected';
      roomStatus.style.color = '#8E8E98';
    };
  });

  // Save Match PGN to SQLite
  btnSaveMatch.addEventListener('click', async () => {
    const pgnString = movesHistory.map((m, idx) => `${idx + 1}. ${m.white} ${m.black}`).join(' ');
    try {
      const res = await fetch('/api/matches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          white_player: playerColor.value === 'w' ? 'Operator' : 'Minimax AI',
          black_player: playerColor.value === 'w' ? 'Minimax AI' : 'Operator',
          result: turnIndicator.textContent,
          pgn: pgnString || '1. e4',
          moves_count: movesHistory.length
        })
      });
      if (res.ok) {
        alert("Match successfully archived in SQLite database.");
      }
    } catch (e) {
      console.error(e);
    }
  });

  function resetGame() {
    currentFen = START_FEN;
    selectedSquare = null;
    lastMove = { from: null, to: null };
    movesHistory = [];
    whiteTime = 180;
    blackTime = 180;
    updateClockDisplays();
    startClocks();
    renderBoard();
    renderPgnTable();

    if (playerColor.value === 'b') {
      triggerAiResponse();
    }
  }

  btnNewGame.addEventListener('click', resetGame);

  // Initial boot
  resetGame();

})();
