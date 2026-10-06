#!/usr/bin/env python3
"""Baut die Webseite inkl. 15-Sekunden-Schnipsel.

Für jedes Werk in data/werke.json wird auf Wikimedia Commons eine freie
Aufnahme gesucht (oder die fest eingetragene "datei" verwendet), mit ffmpeg
ein Schnipsel geschnitten und alles zusammen mit der Webapp nach _site/
geschrieben.

    python3 scripts/build.py                      # normaler Build
    python3 scripts/build.py --lokal-quelle x.wav # offline testen: jede Karte nutzt x.wav

Benötigt nur Python 3 (Standardbibliothek) und ffmpeg.
"""
import argparse
import hashlib
import html
import json
import os
import re
import shutil
import subprocess
import sys
import time
import unicodedata
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API = "https://commons.wikimedia.org/w/api.php"
UA = "hitster-klassik/1.0 (https://github.com/philippgadow/hitster-klassik)"
AUDIO_EXT = (".ogg", ".oga", ".opus", ".flac", ".wav", ".mp3", ".webm")
LAENGE = 15  # Sekunden
CLIP_VERSION = "1"  # erhöhen, wenn sich die ffmpeg-Parameter ändern


def norm(s):
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    return s.lower().replace("_", " ")


def strip_html(s):
    s = re.sub(r"<[^>]+>", "", s or "")
    return re.sub(r"\s+", " ", html.unescape(s)).strip()


def api(params):
    params = dict(params, format="json", formatversion="2")
    url = API + "?" + urllib.parse.urlencode(params)
    for versuch in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except Exception as e:  # noqa: BLE001
            if versuch == 3:
                raise
            print(f"  API-Fehler ({e}), neuer Versuch …", file=sys.stderr)
            time.sleep(2 ** (versuch + 1))


INFO_PROPS = "url|size|mime|extmetadata"


def info_aus_seite(page):
    ii = (page.get("imageinfo") or [None])[0]
    if not ii:
        return None
    meta = ii.get("extmetadata", {})
    m = lambda k: strip_html(meta.get(k, {}).get("value", ""))  # noqa: E731
    return {
        "datei": page["title"].removeprefix("File:"),
        "url": ii["url"],
        "seite": ii.get("descriptionurl", ""),
        "groesse": ii.get("size", 0),
        "autor": m("Artist"),
        "lizenz": m("LicenseShortName"),
        "beschreibung": m("ImageDescription"),
    }


def datei_info(titel):
    data = api({"action": "query", "titles": "File:" + titel, "prop": "imageinfo", "iiprop": INFO_PROPS})
    pages = data.get("query", {}).get("pages", [])
    return info_aus_seite(pages[0]) if pages and not pages[0].get("missing") else None


def suchen(werk):
    """Sucht auf Commons und nimmt den ersten Treffer, dessen Dateiname alle Muster enthält."""
    data = api({
        "action": "query", "generator": "search", "gsrnamespace": "6", "gsrlimit": "40",
        "gsrsearch": werk["suche"] + " filetype:audio",
        "prop": "imageinfo", "iiprop": INFO_PROPS,
    })
    pages = sorted(data.get("query", {}).get("pages", []), key=lambda p: p.get("index", 0))
    muster = [re.compile(t) for t in werk.get("treffer", [])]
    kandidaten = []
    for p in pages:
        titel = p["title"]
        if not norm(titel).endswith(AUDIO_EXT) or "midi" in norm(titel):
            continue
        info = info_aus_seite(p)
        if not info:
            continue
        kandidaten.append(info)
        if all(m.search(norm(titel)) for m in muster):
            return info, None
    if kandidaten:
        return kandidaten[0], "kein Dateiname passt zu den Suchmustern – bitte anhören und ggf. 'datei' festlegen"
    return None, "keine Aufnahme gefunden"


def herunterladen(url, ziel):
    for versuch in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=120) as r, open(ziel, "wb") as f:
                shutil.copyfileobj(r, f, 1 << 20)
            return ziel
        except Exception as e:  # noqa: BLE001
            if versuch == 3:
                raise
            print(f"  Download-Fehler ({e}), neuer Versuch …", file=sys.stderr)
            time.sleep(5 * (versuch + 1))


def dauer(quelle):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=nw=1:nk=1", quelle],
        capture_output=True, text=True, timeout=300)
    try:
        return float(out.stdout.strip())
    except ValueError:
        return None


def schneiden(quelle, start, ziel):
    """Schneidet LAENGE Sekunden ab start (negativ = vom Ende) mit Ein-/Ausblenden und Lautheitsangleichung."""
    d = dauer(quelle)
    if start < 0:
        if not d:
            raise RuntimeError("Dauer unbekannt, negativer Start nicht möglich")
        start = max(0.0, d + start)
    if d and start + LAENGE > d:
        start = max(0.0, d - LAENGE)
    fade_out = LAENGE - 1.0
    cmd = [
        "ffmpeg", "-y", "-v", "error",
        "-ss", f"{start:.2f}", "-i", quelle, "-t", str(LAENGE), "-vn",
        "-af", f"afade=t=in:d=0.4,afade=t=out:st={fade_out}:d=1,loudnorm=I=-16:TP=-1.5:LRA=11",
        "-ac", "2", "-ar", "44100", "-b:a", "128k", ziel,
    ]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    if r.returncode != 0 or os.path.getsize(ziel) < 10000:
        raise RuntimeError("ffmpeg fehlgeschlagen: " + r.stderr.strip()[-300:])
    return start, d


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(ROOT, "_site"))
    ap.add_argument("--cache", default=os.path.join(ROOT, ".cache", "clips"))
    ap.add_argument("--lokal-quelle", help="Audiodatei, die offline für alle Karten verwendet wird (Test)")
    ap.add_argument("--streng", action="store_true", help="mit Fehler beenden, wenn eine Karte kein Audio hat")
    args = ap.parse_args()

    werke = json.load(open(os.path.join(ROOT, "data", "werke.json"), encoding="utf-8"))
    ids = [w["id"] for w in werke]
    if len(ids) != len(set(ids)):
        sys.exit("Doppelte Karten-IDs in data/werke.json")

    if os.path.exists(args.out):
        shutil.rmtree(args.out)
    shutil.copytree(os.path.join(ROOT, "site"), args.out)
    os.makedirs(os.path.join(args.out, "audio"))
    os.makedirs(args.cache, exist_ok=True)

    karten, probleme = [], []
    for w in werke:
        print(f"[{w['id']}] {w['komponist']} – {w['werk']}")
        karte = {k: w[k] for k in ("id", "komponist", "werk", "jahr") if k in w}
        karte["ca"] = bool(w.get("ca"))
        warnung = None
        try:
            if args.lokal_quelle:
                info = {"datei": os.path.basename(args.lokal_quelle), "url": os.path.abspath(args.lokal_quelle),
                        "seite": "", "autor": "Testaufnahme", "lizenz": "–", "beschreibung": ""}
            elif w.get("datei"):
                info = datei_info(w["datei"])
                if not info:
                    raise RuntimeError(f"Datei '{w['datei']}' nicht auf Commons gefunden")
            else:
                info, warnung = suchen(w)
                if not info:
                    raise RuntimeError(warnung)
                time.sleep(0.5)  # höflich zur API

            schluessel = hashlib.sha1(f"{CLIP_VERSION}|{info['url']}|{w.get('start', 0)}".encode()).hexdigest()[:16]
            cache_datei = os.path.join(args.cache, f"{w['id']}-{schluessel}.mp3")
            if not os.path.exists(cache_datei) or args.lokal_quelle:
                print(f"  schneide aus {info['datei']}")
                if args.lokal_quelle:
                    quelle = info["url"]
                else:
                    quelle = herunterladen(info["url"], os.path.join(args.cache, "quelle" + os.path.splitext(info["url"])[1]))
                try:
                    start, d = schneiden(quelle, float(w.get("start", 0)), cache_datei + ".tmp.mp3")
                finally:
                    if quelle != info["url"] and os.path.exists(quelle):
                        os.remove(quelle)
                os.replace(cache_datei + ".tmp.mp3", cache_datei)
                karte["clip_start"], karte["quelle_dauer"] = round(start, 1), d and round(d, 1)
            else:
                print("  aus Cache")
            shutil.copy(cache_datei, os.path.join(args.out, "audio", f"{w['id']}.mp3"))
            karte["audio"] = True
            karte["interpret"] = w.get("interpret") or info["autor"] or "unbekannt"
            karte["quelle"] = {k: info[k] for k in ("datei", "seite", "autor", "lizenz")}
        except Exception as e:  # noqa: BLE001
            warnung = f"FEHLER: {e}"
            karte["audio"] = False
            karte["interpret"] = w.get("interpret") or "?"
        if warnung:
            karte["warnung"] = warnung
            probleme.append((w, warnung))
            print(f"  ⚠ {warnung}")
        karten.append(karte)

    karten.sort(key=lambda k: k["id"])
    with open(os.path.join(args.out, "karten.json"), "w", encoding="utf-8") as f:
        json.dump(karten, f, ensure_ascii=False, indent=1)

    # Bericht (landet in GitHub Actions in der Job-Zusammenfassung)
    zeilen = ["# Build-Bericht", "", f"{sum(k['audio'] for k in karten)} von {len(karten)} Karten haben Audio.", "",
              "| Karte | Werk | Quelle | Interpret | Hinweis |", "|---|---|---|---|---|"]
    for k in karten:
        q = k.get("quelle", {})
        zeilen.append(f"| {k['id']} | {k['komponist']}: {k['werk']} | {q.get('datei', '–')} | "
                      f"{k['interpret']} | {k.get('warnung', '')} |")
    bericht = "\n".join(zeilen) + "\n"
    with open(os.path.join(ROOT, "build-bericht.md"), "w", encoding="utf-8") as f:
        f.write(bericht)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as f:
            f.write(bericht)

    print(f"\nFertig: {len(karten)} Karten, {len(probleme)} mit Hinweis.")
    if args.streng and any(not k["audio"] for k in karten):
        sys.exit(1)


if __name__ == "__main__":
    main()
