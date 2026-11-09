#!/bin/bash
# Startet den PVI-Watch-Prototyp lokal (nur auf diesem Rechner erreichbar)
cd "$(dirname "$0")"
PORT=8766
echo "PVI-Watch Prototyp läuft auf http://localhost:$PORT  (Beenden: dieses Fenster schließen oder Ctrl+C)"
( sleep 1; open "http://localhost:$PORT/index.html" ) &
python3 -m http.server $PORT --bind 127.0.0.1
