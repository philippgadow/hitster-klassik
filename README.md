# Hitster Klassik 🎻

Funktioniert wie „Hitster“, nur mit klassischer Musik. Man druckt Karten mit QR-Codes, scannt sie mit dem Handy in der Webapp und hört einen 15 Sekunden langen Schnipsel. Dann legt man die Karte an die richtige Stelle der Zeitleiste. Auf der Rückseite stehen Komponist, Kompositionsjahr, Werk und Interpret.

**Spielen:** https://philippgadow.github.io/hitster-klassik/
**Druckvorlage:** https://philippgadow.github.io/hitster-klassik/druck.html
**Übersicht & Quellen** (zum Prüfen, enthält die Lösungen): https://philippgadow.github.io/hitster-klassik/uebersicht.html

## So funktioniert's

- Die Webapp (`site/`) besteht nur aus statischen Dateien. Gescannt wird mit der Handykamera, über `BarcodeDetector` oder, auf dem iPhone, über [jsQR](https://github.com/cozmo/jsQR).
- Im QR-Code steht nur eine neutrale Adresse wie `…/hitster-klassik/#k=042`. Mit der normalen Kamera-App gescannt, öffnet sich die Webapp direkt mit dieser Karte.
- Die Werke stehen in [`data/werke.json`](data/werke.json). Die Karten-IDs sind absichtlich gemischt.
- Bei jedem Push auf `main` läuft ein GitHub-Actions-Workflow ([`.github/workflows/pages.yml`](.github/workflows/pages.yml)). Er führt [`scripts/build.py`](scripts/build.py) aus, das zu jedem Werk eine freie Aufnahme auf **Wikimedia Commons** sucht, mit ffmpeg einen 15-Sekunden-Schnipsel schneidet (mit Ein- und Ausblenden und angeglichener Lautstärke) und alles auf GitHub Pages veröffentlicht. Die Audiodateien liegen also nicht im Repository.
- Welche Aufnahme für welche Karte gewählt wurde, steht im **Build-Bericht** in der Zusammenfassung des Actions-Laufs und auf der Übersichtsseite.

## Einmalig einrichten

1. Den Code auf den Branch `main` bringen.
2. Im Repository unter **Settings → Pages → Build and deployment → Source** „**GitHub Actions**“ auswählen.
3. Unter **Actions** den Workflow „Bauen und auf GitHub Pages veröffentlichen“ starten oder einfach auf `main` pushen.

## Werke anpassen

Jeder Eintrag in `data/werke.json`:

| Feld | Bedeutung |
|---|---|
| `id` | Kartennummer, steht im QR-Code. Bei gedruckten Karten nicht mehr ändern! |
| `komponist`, `werk`, `jahr` | Das steht auf der Rückseite. Mit `"ca": true` steht „ca.“ vor dem Jahr. |
| `suche` | Suchbegriffe für Wikimedia Commons |
| `treffer` | Liste von regulären Ausdrücken, die alle im (kleingeschriebenen, akzentfreien) Dateinamen vorkommen müssen |
| `ohne` *(optional)* | Reguläre Ausdrücke für Dateinamen, die nicht gewählt werden dürfen, z.B. `"guitar"`. Ausschnitte, Backing-Tracks, Remixe usw. sind immer ausgeschlossen. |
| `start` | Startpunkt des Schnipsels in Sekunden. Negative Werte zählen vom Ende, z.B. `-150` |
| `datei` *(optional)* | Eine Commons-Datei fest vorgeben, z.B. `"Beethoven - Für Elise.ogg"`. Die Suche entfällt dann. |
| `interpret` *(optional)* | Interpret für die Karte überschreiben, falls die Angabe auf Commons unpassend ist |

Empfohlener Ablauf: Den ersten Build laufen lassen, auf der Übersichtsseite alle Schnipsel anhören, dann für falsche Treffer `datei` und für langweilige Stellen `start` anpassen. Erst danach die Karten drucken.

## Lokal bauen

```bash
python3 scripts/build.py          # braucht Internet (Wikimedia Commons) und ffmpeg
cd _site && python3 -m http.server
```

Für einen Test ohne Internet nutzt `python3 scripts/build.py --lokal-quelle irgendeine.wav` dieselbe Datei für alle Karten.
Die Kamera funktioniert nur über `https://` oder `localhost`.

## Drucken

Die Druckseite öffnen, A4 mit 100 % Skalierung **beidseitig an der langen Kante** drucken und entlang der gestrichelten Linien schneiden. Ein Blatt fasst 12 Karten à 6 × 6 cm. Die Rückseiten sind nach Epoche eingefärbt: Barock, Klassik, Romantik, Moderne.

## Lizenzen

Alle Aufnahmen stammen von Wikimedia Commons und stehen unter freien Lizenzen (Quelle, Urheber und Lizenz siehe Übersichtsseite).
Mitgelieferte Bibliotheken: jsQR (Apache 2.0) und qrcode-generator von Kazuhiko Arase (MIT), siehe `site/vendor/`.
