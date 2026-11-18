@echo off
chcp 65001 > nul
title Chess Tactics Engine [Port 8013]
echo ========================================================
echo   CHESS TACTICS // MINIMAX AI & FIDE RULES ENGINE
echo ========================================================
echo [INFO] Проверка и установка зависимостей...
python -m pip install -r requirements.txt --quiet
echo [INFO] Запуск FastAPI веб-сервера на http://localhost:8013 ...
start http://localhost:8013
python -m uvicorn main:app --host 0.0.0.0 --port 8013
pause
