# SIR Family Form Tool

GitHub Pages-ready version of the latest **SIR Family Forms PWA**.

This is an offline-capable helper app for maintaining People and Applicant data, JSON backup/import, Online Form PDF, Offline Form PDF, applicant photos, and Applicant Data photo download.

> Disclaimer: This is not an official mapping or government form. This app is only a helper tool for data entry.

## Files

Upload these files at the root of your GitHub repository:

```text
index.html
manifest.json
service-worker.js
styles.css
enhancements.css
core.js
storage.js
ui.js
pdf.js
importExport.js
app.js
enhancements.js
icon.png
README.md
```

## GitHub Pages deployment

Repository name:

```text
SIR Family Form Tool
```

Recommended GitHub Pages setup:

1. Create/open your GitHub repository.
2. Upload all files directly to the repository root.
3. Commit the files.
4. Open **Settings** → **Pages**.
5. Under **Build and deployment**, choose:
   - **Source:** Deploy from a branch
   - **Branch:** `main`
   - **Folder:** `/root`
6. Save.
7. Open the GitHub Pages URL after GitHub finishes deployment.

For a project site, the URL will usually look like:

```text
https://YOUR-USERNAME.github.io/SIR-Family-Form-Tool/
```

This build uses relative paths so it can run from a GitHub Pages project-site subpath.

## Install as PWA on Android

1. Open the GitHub Pages HTTPS URL in Chrome.
2. Wait for the page to load once.
3. Open Chrome menu `⋮`.
4. Tap **Install app** or **Add to Home screen**.
5. Open the app from the home screen.

The app works offline after the first successful load.

## Important notes

- All paths are relative for GitHub Pages project-site deployment.
- Service worker registration uses `./service-worker.js` with `./` scope.
- Manifest uses relative `start_url`, `scope`, and icon path.
- Data is stored locally in the browser using `localStorage`.
- Export JSON before clearing site data, changing devices, or reinstalling the app.
- Photos are saved inside applicant records as image data URLs, so JSON backups can become large.
- Online/Offline PDFs include only applicants whose **PDF** checkbox is checked in the Applicant Database table.

## Features kept and updated

- Applicant Data tab
- Database tab with Applicant Database first and People Database second
- JSON export/import
- Online Form PDF
- Offline Form PDF
- Applicant photo upload
- Applicant Data photo preview and download
- Phone WhatsApp links with `SIR acknowledgement` message
- Copy-by-click read-only values
- Date of Birth copy/display in `DD-MM-YYYY` format
- Mark Complete, Next, and New Applicant workflow
- Offline PWA support
- App zoom controls
- Version badge: `26-07-06`

## Service worker cache

Current cache version:

```text
sir-family-forms-v26-07-06
```
