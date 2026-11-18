import os
import sqlite3
import json
import time
from typing import Dict, List, Optional
import chess
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

DB_PATH = os.path.join(os.path.dirname(__file__), "chess_archive.db")

app = FastAPI(title="Chess Tactics Engine API", version="1.0.0")

# Piece-Square Values (Centipawns)
PIECE_VALUES = {
    chess.PAWN: 100,
    chess.KNIGHT: 320,
    chess.BISHOP: 330,
    chess.ROOK: 500,
    chess.QUEEN: 900,
    chess.KING: 20000
}

PAWN_TABLE = [
     0,  0,  0,  0,  0,  0,  0,  0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
     5,  5, 10, 25, 25, 10,  5,  5,
     0,  0,  0, 20, 20,  0,  0,  0,
     5, -5,-10,  0,  0,-10, -5,  5,
     5, 10, 10,-20,-20, 10, 10,  5,
     0,  0,  0,  0,  0,  0,  0,  0
]

KNIGHT_TABLE = [
    -50,-40,-30,-30,-30,-30,-40,-50,
    -40,-20,  0,  0,  0,  0,-20,-40,
    -30,  0, 10, 15, 15, 10,  0,-30,
    -30,  5, 15, 20, 20, 15,  5,-30,
    -30,  0, 15, 20, 20, 15,  0,-30,
    -30,  5, 10, 15, 15, 10,  5,-30,
    -40,-20,  0,  5,  5,  0,-20,-40,
    -50,-40,-30,-30,-30,-30,-40,-50
]

def evaluate_board(board: chess.Board) -> int:
    if board.is_checkmate():
        return -99999 if board.turn == chess.WHITE else 99999
    if board.is_stalemate() or board.is_insufficient_material() or board.can_claim_draw():
        return 0

    score = 0
    for square in chess.SQUARES:
        piece = board.piece_at(square)
        if piece is None:
            continue
        val = PIECE_VALUES.get(piece.piece_type, 0)

        # Positional bonuses
        if piece.piece_type == chess.PAWN:
            sq_idx = square if piece.color == chess.WHITE else chess.square_mirror(square)
            val += PAWN_TABLE[sq_idx]
        elif piece.piece_type == chess.KNIGHT:
            sq_idx = square if piece.color == chess.WHITE else chess.square_mirror(square)
            val += KNIGHT_TABLE[sq_idx]

        if piece.color == chess.WHITE:
            score += val
        else:
            score -= val

    return score

def minimax_alpha_beta(board: chess.Board, depth: int, alpha: int, beta: int, maximizing: bool) -> tuple[int, Optional[chess.Move]]:
    if depth == 0 or board.is_game_over():
        return evaluate_board(board), None

    legal_moves = list(board.legal_moves)
    # Move ordering heuristic: search captures first
    legal_moves.sort(key=lambda m: board.is_capture(m), reverse=True)

    best_move = None
    if maximizing:
        max_eval = -999999
        for move in legal_moves:
            board.push(move)
            eval_score, _ = minimax_alpha_beta(board, depth - 1, alpha, beta, False)
            board.pop()
            if eval_score > max_eval:
                max_eval = eval_score
                best_move = move
            alpha = max(alpha, eval_score)
            if beta <= alpha:
                break
        return max_eval, best_move
    else:
        min_eval = 999999
        for move in legal_moves:
            board.push(move)
            eval_score, _ = minimax_alpha_beta(board, depth - 1, alpha, beta, True)
            board.pop()
            if eval_score < min_eval:
                min_eval = eval_score
                best_move = move
            beta = min(beta, eval_score)
            if beta <= alpha:
                break
        return min_eval, best_move

def init_db():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS matches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            white_player TEXT NOT NULL,
            black_player TEXT NOT NULL,
            result TEXT NOT NULL,
            pgn TEXT NOT NULL,
            moves_count INTEGER NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS puzzles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            fen TEXT NOT NULL,
            solution_uci TEXT NOT NULL,
            theme TEXT NOT NULL,
            rating INTEGER NOT NULL
        )
    """)

    # Populate real chess tactical puzzles if empty
    cursor.execute("SELECT COUNT(*) FROM puzzles")
    if cursor.fetchone()[0] == 0:
        real_puzzles = [
            ("Scholar's Finish", "r1bqkb1r/pppp1ppp/2n5/4p3/2B1n3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 0 5", "f3f7", "Mate in 1", 800),
            ("Anastasia's Mate", "5rk1/1p3ppp/8/8/8/1B6/4nPPP/R6K b - - 0 1", "e2g3", "Tactical Fork", 1200),
            ("Opera House Deflection", "4kb1r/p2n1ppp/4q3/4p1B1/4P3/1Q6/PPP2PPP/2KR4 w k - 1 18", "b3b8", "Queen Sacrifice", 1450),
            ("Smothered Mate Sequence", "6k1/5ppp/8/8/8/8/5QPP/6K1 w - - 0 1", "f2f7", "Backrank Deflection", 1100),
            ("Greek Gift Sacrifice", "r1bq1rk1/ppp2ppp/2n1pn2/3p4/3P4/2PBPN2/PP1N1PPP/R2QK2R w KQ - 0 8", "d3h7", "Bishop Sacrifice", 1350),
            ("Knight Fork Royale", "r1bqk2r/pppp1ppp/2n5/4p3/4n3/2P2N2/PPP1BPPP/R1BQK2R w KQkq - 0 7", "d1d5", "Double Attack", 1050),
            ("Rook Battery Punch", "3r2k1/5ppp/8/8/8/8/3R2PP/3R2K1 w - - 0 1", "d2d8", "Mate on Back Rank", 950),
            ("Endgame Pawn Breakthrough", "8/5p2/8/5P2/8/8/4k3/4K3 w - - 0 1", "f5f6", "Zugzwang", 1600)
        ]
        cursor.executemany("INSERT INTO puzzles (title, fen, solution_uci, theme, rating) VALUES (?, ?, ?, ?, ?)", real_puzzles)
    conn.commit()
    conn.close()

init_db()

class AIMoveRequest(BaseModel):
    fen: str
    difficulty: int = Field(default=2, ge=1, le=3) # 1=Easy(depth 1), 2=Medium(depth 2), 3=Master(depth 3)

class MoveValidationRequest(BaseModel):
    fen: str
    uci_move: str

class SaveMatchRequest(BaseModel):
    white_player: str
    black_player: str
    result: str
    pgn: str
    moves_count: int

@app.post("/api/ai/move")
def calculate_ai_move(req: AIMoveRequest):
    try:
        board = chess.Board(req.fen)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid FEN: {str(e)}")

    if board.is_game_over():
        return {"status": "game_over", "result": board.result()}

    # Select depth based on difficulty
    depth = 1 if req.difficulty == 1 else 2 if req.difficulty == 2 else 3
    is_white = (board.turn == chess.WHITE)

    eval_score, best_move = minimax_alpha_beta(board, depth, -999999, 999999, is_white)

    if best_move is None:
        legal = list(board.legal_moves)
        if legal:
            best_move = legal[0]
        else:
            return {"status": "game_over"}

    san = board.san(best_move)
    uci = best_move.uci()

    return {
        "status": "ok",
        "uci": uci,
        "san": san,
        "eval_cp": eval_score,
        "depth": depth
    }

@app.post("/api/game/validate")
def validate_move(req: MoveValidationRequest):
    try:
        board = chess.Board(req.fen)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid FEN: {str(e)}")

    try:
        move = chess.Move.from_uci(req.uci_move)
    except Exception:
        raise HTTPException(status_code=400, detail="Malformed UCI move string")

    if move not in board.legal_moves:
        # Check if promotion was omitted (default to queen)
        if len(req.uci_move) == 4:
            promo_move = chess.Move.from_uci(req.uci_move + "q")
            if promo_move in board.legal_moves:
                move = promo_move
            else:
                return {"legal": False, "reason": "Illegal move"}
        else:
            return {"legal": False, "reason": "Illegal move"}

    san = board.san(move)
    is_capture = board.is_capture(move)
    board.push(move)

    return {
        "legal": True,
        "new_fen": board.fen(),
        "san": san,
        "is_capture": is_capture,
        "is_check": board.is_check(),
        "is_checkmate": board.is_checkmate(),
        "is_stalemate": board.is_stalemate(),
        "is_game_over": board.is_game_over(),
        "result": board.result() if board.is_game_over() else None,
        "eval_cp": evaluate_board(board)
    }

@app.get("/api/puzzles")
def get_puzzles():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM puzzles ORDER BY rating ASC")
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return {"puzzles": rows}

@app.get("/api/matches")
def get_matches():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM matches ORDER BY created_at DESC LIMIT 20")
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return {"matches": rows}

@app.post("/api/matches")
def save_match(req: SaveMatchRequest):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO matches (white_player, black_player, result, pgn, moves_count)
        VALUES (?, ?, ?, ?, ?)
    """, (req.white_player, req.black_player, req.result, req.pgn, req.moves_count))
    mid = cursor.lastrowid
    conn.commit()
    conn.close()
    return {"status": "saved", "id": mid}

# Multiplayer WebSockets
class MultiplayerRoomManager:
    def __init__(self):
        self.rooms: Dict[str, List[WebSocket]] = {}

    async def connect(self, room_id: str, websocket: WebSocket):
        await websocket.accept()
        if room_id not in self.rooms:
            self.rooms[room_id] = []
        self.rooms[room_id].append(websocket)

    def disconnect(self, room_id: str, websocket: WebSocket):
        if room_id in self.rooms and websocket in self.rooms[room_id]:
            self.rooms[room_id].remove(websocket)
            if not self.rooms[room_id]:
                del self.rooms[room_id]

    async def broadcast(self, room_id: str, message: dict, sender: WebSocket):
        if room_id in self.rooms:
            for conn in list(self.rooms[room_id]):
                if conn != sender:
                    try:
                        await conn.send_json(message)
                    except Exception:
                        pass

multi_manager = MultiplayerRoomManager()

@app.websocket("/ws/room/{room_id}")
async def websocket_room(websocket: WebSocket, room_id: str):
    await multi_manager.connect(room_id, websocket)
    try:
        while True:
            data = await websocket.receive_text()
            payload = json.loads(data)
            await multi_manager.broadcast(room_id, payload, websocket)
    except WebSocketDisconnect:
        multi_manager.disconnect(room_id, websocket)

static_dir = os.path.join(os.path.dirname(__file__), "static")
app.mount("/static", StaticFiles(directory=static_dir), name="static")

@app.get("/")
def read_root():
    return FileResponse(os.path.join(static_dir, "index.html"))
