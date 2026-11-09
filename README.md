# PVI-Watch – Prototyp (Projektantrag)

Klickbarer Prototyp für das Smartwatch-Monitoring nach Pulmonalvenenisolation.
**Nur synthetische Daten, kein Medizinprodukt, kein Netzwerkverkehr.** Alles läuft lokal im Browser (localStorage).

## Starten
Doppelklick auf `Start.command`. Das Skript startet einen lokalen Webserver auf Port 8766 und öffnet den Browser.
Alternative: `python3 -m http.server 8766` in diesem Ordner, danach http://localhost:8766 aufrufen.

| Seite | Inhalt |
|---|---|
| `index.html` | Übersicht, Datenfluss, Regeln für Flags |
| `demo.html` | Patienten-App und Dashboard nebeneinander, live verbunden (für Präsentationen) |
| `dashboard.html` | Klinik-Dashboard |
| `patient.html` | Patienten-App mit Demo-Steuerung |

## Demo-Ablauf (ca. 2 Minuten)
1. `demo.html` öffnen und in der App den Einschluss durchklicken (QR-Code → Einwilligung → Uhr → Verbinden).
2. In der Demo-Steuerung „Uhr meldet: Ruhe-HF 128/min“ klicken. Die App zeigt die Push-Nachricht, das Dashboard setzt VHF-001 auf „Beobachten“.
3. Als Rhythmus „Vorhofflimmern“ wählen, in der App „Ich habe Beschwerden“ antippen und ein EKG aufzeichnen. Das Dashboard setzt VHF-001 auf „Prüfen“.
4. Im Dashboard das EKG ansehen (EKG-Papier, RR-Intervalle, Poincaré-Plot), den Befund signieren und den Kontakt dokumentieren. Alles landet im Audit-Trail.
5. „Studienexport (CSV)“ erzeugt die Tabelle für die Statistik.

## Was simuliert ist
- **EKGs:** Synthetische 30-s-Einkanal-Signale für Sinusrhythmus, VHF, Sinustachykardie, Vorhofflattern 2:1, Extrasystolen und Artefakte.
- **Hersteller-Klassifikation:** Vereinfachte Nachbildung dessen, was die Schnittstelle liefern würde.
- **Studien-Algorithmus** (`assets/ecg.js`): R-Zacken-Erkennung und RR-Irregularität. Er dient nur der Demonstration und ist **nicht validiert**.
- **Kohorte** (`assets/data.js`): 16 Patienten mit gemischten Uhren und verschiedenen Szenarien.
- **Backend:** Die Datenablage läuft im localStorage des Browsers. In der echten Version wäre das ein Server in DE/EU mit FHIR-Ablage, Anmeldung und Audit-Trail.
