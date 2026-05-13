# GlobeTrotter SQL - PWA Grundgerüst

## Projektstruktur

```
globetrotter/
├── index.html           - Haupt-App mit Design-System, Navigation, Views
├── manifest.json        - PWA-Manifest (2026-konform)
├── sw.js                - Service Worker (Stale-While-Revalidate)
├── js/
│   └── db.js            - IndexedDB Abstraktionsschicht
├── css/
│   └── app.css          - (optional: externes CSS, derzeit in index.html)
├── icons/
│   ├── icon-48.png
│   ├── icon-72.png
│   ├── icon-96.png
│   ├── icon-128.png
│   ├── icon-192.png     - Maskable Icon (A2HS)
│   ├── icon-256.png
│   └── icon-512.png     - Maskable Icon (Splash Screen)
└── screenshots/
    ├── mobile-home.png
    └── desktop-map.png
```

## Was fehlt noch (naechste Schritte)

1. **Icons generieren**
   - SVG-Logo erstellen, in alle PNG-Groessen exportieren
   - Maskable-Icons mit 20% Padding auf allen Seiten

2. **Dokument-Upload**
   - PDF/Bild-Upload ins IndexedDB (Blob-Speicher)
   - Ticket-Viewer (PDF-Rendering via pdf.js)

3. **OneDrive-Anbindung**
   - Microsoft Graph API OAuth2 Flow
   - Bildband-Ansicht mit Lazy Loading

4. **Checklisten-View**
   - View `#checkliste` mit haptischem Feedback (Vibration API)
   - Kategorien (Kleidung, Dokumente, Technik, ...)

5. **Offline-Karte fuer aktuelle Reise**
   - Leaflet + TileLayer fuer spezifischen Ort vorabladen
   - POI-Marker aus IDB

## Deployment-Hinweise

- HTTPS ist zwingend erforderlich (Service Worker, A2HS)
- Content-Security-Policy Header empfohlen
- Sicherstellen: alle APP_SHELL_URLS im sw.js existieren
- `manifest.json` muss mit `Content-Type: application/manifest+json` ausgeliefert werden

## Design-System

| Token          | Wert         | Verwendung              |
|----------------|--------------|-------------------------|
| `--c-gold`     | #c9a84c      | Primaer-Akzent          |
| `--c-bg`       | #08080e      | Seitenhintergrund       |
| `--c-surface`  | #0f0f1a      | Karten, Inputs          |
| `--font-display` | Cormorant Garamond | Headlines      |
| `--font-body`  | DM Sans      | Fliestext, Labels       |

## Standards

- Sprache: Deutsch
- Zahlen: 1.234,56 (Punkt als Tausender, Komma als Dezimal)
- Waehrung: Euro (EUR)
- Masse: Metrisch (km, m, cm)
- Datumsformat: DD.MM.YYYY
