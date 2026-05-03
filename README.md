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

## Technik

- **Backend:** Node.js + Express + WebSockets (`ws`)
- **Frontend:** Vanilla JavaScript, kein Framework, kein Build-Schritt
- **Persistenz:** Räume leben im RAM, werden nach 4h Inaktivität gelöscht
- **Tab-Schließen:** Spieler bleiben im Raum (Pause), kommen mit gleicher Browser-Session zurück
