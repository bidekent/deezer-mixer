# Deezer Mixer

Ein Web-Player, der Musik über **Deezer** oder **Audius** sucht und abspielt und dabei im
Browser versucht, die **Instrumente im Stück zu erkennen**. Einzelne Instrumente lassen
sich per Schaltfläche **stummschalten**, und sechs **synthetische Zusatzinstrumente**
(Saxophon, Kalimba, Geige, Ziehharmonika, Kokosnuss-Geklapper, Hundegebell) können
**harmonisch zum Stück dazugemischt** werden.

## Features

- 🔍 **Quellwahl**: Deezer (30s-Previews, Mainstream-Katalog) oder
  Audius (freie Musik, volle Tracks) — beides ohne Anmeldung
- 🔊 **Lautstärkeregler** und Transportsteuerung (Play/Pause, Seek)
- 🧠 **Instrumentenerkennung** komplett im Browser:
  STFT (FFT 2048, Hann, Hop 512) + **Harmonic/Percussive Source Separation** (Median-HPSS).
  Vier Kanäle, deren Summe exakt das Original rekonstruiert:

  | Kanal | Ableitung |
  |---|---|
  | 🎤 Gesang | harmonischer Anteil, Band ≈ 180–6800 Hz, Mid-Kanal |
  | 🥁 Schlagzeug | perkussiver Anteil (HPSS) |
  | 🎸 Bass | harmonischer Anteil < ~430 Hz, Mid-Kanal |
  | 🎹 Andere Instrumente | Rest-Signal |

- 🔇 **Mute-Schalter** pro Instrument + Live-Pegelanzeige pro Kanal
- 🎷 **Zusätzliche Instrumente** (harmonisch eingefügt): Saxophon, Kalimba, Geige,
  Ziehharmonika, Kokosnuss-Geklapper, Hundegebell. Durchgehend per Web-Audio-Synthese
  erzeugt und auf **Tonart** (Chroma-Profilschätzung) und **Tempo** (Onset-Autokorrelation)
  des Stücks abgestimmt; Akkordwechsel alle zwei Takte (I–IV–V–vi), Muster laufen als
  taktsynchroner 8-Takt-Loop.
- 📱 **Touch-optimiert**: große Bedienelemente (≥ 44 px), Slider mit großen Daumen,
  tappbare Karten und Schalter, keine Doppeltipp-Zooms
- ⌨️ **Tastatur**: `Leertaste` = Play/Pause, `1`–`4` = Original-Instrumente stummschalten

## Starten

Reines Frontend, kein Build-Schritt:

```bash
# einfach index.html im Browser öffnen, oder:
python3 -m http.server 8080   # dann http://localhost:8080
```

## Quellen & Einschränkungen

- **Deezer**: Die öffentliche API liefert nur 30-Sekunden-Previews; volle Titel wären nur
  über das Deezer-SDK mit Deezer-Konto/Premium möglich.
- **Audius**: Volle Tracks ohne Anmeldung (API `app_name=DeezerMixer`). Analyse &
  Wiedergabe sind auf die ersten 3 Minuten begrenzt, damit die Browser-Analyse schnell bleibt.
- Das Muting bestehender Instrumente ist eine **Näherung**: Aus einem fertigen Stereo-Mix
  lassen sich echte Stems nicht verlustfrei zurückgewinnen. Eine KI-Trennung
  (Demucs/Spleeter als Server-Backend) wäre aufrüstbar.
- Die Zusatzinstrumente sind bewusst synthetisch — sie erklingen in der geschätzten
  Tonart und im Tempo des Stücks, ersetzen aber keine real eingespielten Parts.
- Schlägt das Laden einer Audiodatei an CORS/Netzwerk scheitern, fällt der Player auf
  normale Wiedergabe ohne Stem-Steuerung zurück.

## Struktur

```
index.html          UI (Quellschalter, Player, Stems, Layer)
style.css           Styling (Dark Theme, Desktop + Touch)
separate.js         Stem-Trennung: FFT, Median-HPSS, ISTFT + Chroma/Onset (node-testbar)
harmony.js          Tonart/BPM-Erkennung, Akkorde, Muster (node-testbar)
synth.js            Stimmen (Saxophon, Kalimba, Geige, Ziehharmonika, Kokosnuss, Hund)
app.js              Quellen, Suche, Transport, Layer-Scheduler, Meter
test/
  separate.test.js  Separierung: FFT/IFFT, Rekonstruktion, Shares
  harmony.test.js   Tonart/BPM/Akkorde/Muster
```

## Tests

```bash
node test/separate.test.js
node test/harmony.test.js
```
