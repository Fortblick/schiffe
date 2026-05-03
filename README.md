# Schiffe versenken — Multi-Player

Online-Multiplayer-Version für **bis zu 10 Spieler** + unbegrenzte Zuschauer.

## So funktioniert's

**Eine Person erstellt einen Raum** und teilt den 4-stelligen Code (z.B. `J7K2`).
**Andere treten bei** mit dem Code — wählen entweder:
- 🎮 **Mitspielen** (nur möglich vor Spielstart)
- 👁 **Zuschauen** (jederzeit, auch während eines laufenden Spiels)

**Spielablauf:**
1. **Lobby:** Alle Spieler klicken "Bereit", dann startet das Spiel
2. **Platzierung:** Jeder verteilt 10 Steine auf seinem privaten 10×10-Feld
3. **Runden:**
   - Alle schießen *gleichzeitig* (1 Schuss pro Runde) auf das gemeinsame Angriffsfeld
   - Runde dauert max. 30 Sekunden, endet früher wenn alle geschossen haben
   - Auflösung am Rundenende: Treffer/Daneben werden für alle aufgedeckt
   - Mehrfach-Treffer (wenn mehrere Spieler dieselbe Stelle gewählt haben) werden mit `×N` markiert
4. **Sieg:** Letzter Überlebender gewinnt — am Ende werden alle Schiffspositionen aufgedeckt

**Anti-Cheat:** Schiffspositionen liegen nur auf dem Server. Kein Spieler sieht die Steine eines anderen. Zuschauer sehen sogar während des Spiels keine Steinpositionen — erst nach Spielende werden alle aufgedeckt.

**Disconnect-Schutz:** Wenn ein Spieler die Verbindung verliert, pausiert das Spiel 30 Sekunden — kommt er zurück, geht's weiter. Sonst scheidet er aus.

## Lokal testen

```bash
npm install
npm start
```

Im Browser: http://localhost:3000 — am besten mehrere Tabs/Fenster gleichzeitig öffnen, um die Spielerrollen zu testen.

## Hosting auf Railway (24/7 erreichbar)

Identisch zur 1vs1-Version:

1. **GitHub-Account** erstellen (falls nicht vorhanden)
2. Diesen Ordner als neues Repository hochladen — **ohne** den `node_modules`-Ordner!
3. Auf [railway.app](https://railway.app) registrieren (mit GitHub einloggen)
4. **New Project → Deploy from GitHub repo** → dieses Repository wählen
5. Railway erkennt Node.js automatisch und baut die App
6. Unter **Settings → Networking → Generate Domain** klicken
7. Du bekommst eine URL wie `schiffe-multi.up.railway.app` — die kannst du teilen

Kosten:
- Railway Hobby-Tier: kostenlos für ~500h/Monat (nicht ganz 24/7)
- Railway Pro: ~5$/Monat für echte 24/7-Verfügbarkeit

## Anpassen

In `server.js` und `public/app.js` ganz oben:
- `BOARD_SIZE = 10` — Feldgröße
- `SHIPS_PER_PLAYER = 10` — Steine pro Spieler
- `MAX_PLAYERS = 10` — Max. Anzahl Spieler im Raum
- `ROUND_DURATION_MS` — Rundenzeit (in `server.js`)

Wichtig: Die Werte müssen in beiden Dateien identisch sein!

## Tipps

- **Code teilen:** Klick auf den Code in der Lobby kopiert ihn automatisch
- **Zufällig setzen:** In der Platzierungs-Phase gibt's einen Button um die 10 Steine zufällig zu verteilen
- **Reconnect:** Bei Verbindungsverlust einfach die Seite neu laden — du kommst automatisch wieder in den Raum (Browser-Speicher merkt sich Code + ID)

## Technik

- **Backend:** Node.js + Express + WebSockets (`ws`)
- **Frontend:** Vanilla JavaScript, kein Framework, kein Build-Schritt
- **Persistenz:** Räume leben im RAM, werden nach 4h Inaktivität gelöscht
- **Tab-Schließen:** Spieler bleiben im Raum (Pause), kommen mit gleicher Browser-Session zurück
