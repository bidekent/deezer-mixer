# Deezer Mixer

Ein Web-Player, der Musik über die **Deezer API** sucht und abspielt und dabei im Browser
versucht, die **Instrumente im Stück zu erkennen**. Per Schaltfläche (oder Tastatur) lassen
sich einzelne Instrumente **stummschalten**.

![Konzept](https://img.shields.io/badge/Stack-HTML%2FCSS%2FJS%20vanilla-a238ff)

## Features

- 🔍 **Deezer-Suche** nach Song, Künstler oder Album (öffentliche Deezer-API, JSONP-Fallback)
- ▶️ **Wiedergabe** der 30-Sekunden-Preview über die Web Audio API
- 🧠 **Instrumentenerkennung**: Die Trennung läuft vollständig lokal im Browser –
  STFT (FFT 2048, Hann, Hop 512) + **Harmonic/Percussive Source Separation** (Median-Filter-HPSS).
  daraus werden vier Kanäle abgeleitet:
  | Kanal | Ableitung |
  |---|---|
  | 🎤 Gesang | harmonischer Anteil, Band ≈ 180–6800 Hz, Mid-Kanal |
  | 🥁 Schlagzeug | perkussiver Anteil (HPSS) |
  | 🎸 Bass | harmonischer Anteil < ~430 Hz, Mid-Kanal |
  | 🎹 Andere Instrumente | Rest-Signal (Summe aller vier = Original) |
- 🔇 **Mute-Schalter** pro Instrument + Live-Pegelanzeige pro Kanal
- ⌨️ **Tastatur**: `Leertaste` = Play/Pause, `1`–`4` = Instrumente stummschalten
- 📊 Der erkannte **Energieanteil** jedes Instruments wird als Konfidenz angezeigt

## Starten

Es ist ein reines Frontend ohne Build-Schritt:

```bash
# einfach index.html im Browser öffnen, oder:
python3 -m http.server 8080   # dann http://localhost:8080
```

## Einschränkungen

- Die öffentliche Deezer-API liefert nur **30-Sekunden-Previews**. Ganze Titel wären nur
  über das Deezer-SDK mit Deezer-Konto/Premium möglich.
- Die Stummschaltung ist eine **Näherung**: Aus einem fertigen Stereo-Mix lassen sich echte
  Stems nicht verlustfrei zurückgewinnen. Künstliche Trennung (z. B. Demucs/Spleeter als
  Server-Backend) wäre bei Bedarf aufrüstbar — die Trennung ist bewusst als dependency-freie
  In-Browser-Lösung umgesetzt.
- Schlägt das Laden der Preview an CORS/Netzwerk scheitern, fällt der Player auf normale
  Wiedergabe ohne Stem-Steuerung zurück.

## Struktur

```
index.html          UI
style.css           Styling (Dark Theme)
separate.js         Stem-Trennung: FFT, Median-HPSS, Masken, ISTFT (DOM-frei, node-testbar)
app.js              Suche, Transport, Stems, Meter, Tastatur
test/
  separate.test.js  Unit-Tests (node test/separate.test.js)
```

## Tests

```bash
node test/separate.test.js
```

Prüft FFT/IFFT-Roundtrip, genaue Rekonstruktion der Summe aller Stems, NaN-Freiheit und
die erwartete Energieverteilung auf synthetischen Signalen (Bass-Sinus, Noise-Bursts,
Mitten-Ton, Hochton).
