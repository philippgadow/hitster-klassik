'use strict';

const LAENGE = 15;
const RING = 2 * Math.PI * 54;

const $ = (id) => document.getElementById(id);
const video = $('video');
const audio = new Audio();
audio.preload = 'auto';

let stream = null;
let scanLaeuft = false;
let detector = null;
let aktuelleKarte = null;
const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });

// --- Ansichten ------------------------------------------------------------

function zeige(name) {
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('aktiv', v.id === name));
  document.body.dataset.ansicht = name;
}

function fehler(text) {
  stoppeKamera();
  audio.pause();
  $('fehlertext').textContent = text;
  zeige('fehler');
}

// --- Audio ----------------------------------------------------------------

// Kurze stille WAV-Datei: Ein play() innerhalb eines Tipps schaltet die
// Wiedergabe auf iOS/Android frei, damit der Schnipsel später nach dem
// Scannen ohne weiteren Tipp starten darf.
const STILLE = (() => {
  const n = 800, buf = new ArrayBuffer(44 + n), d = new DataView(buf);
  const s = (o, t) => [...t].forEach((c, i) => d.setUint8(o + i, c.charCodeAt(0)));
  s(0, 'RIFF'); d.setUint32(4, 36 + n, true); s(8, 'WAVEfmt ');
  d.setUint32(16, 16, true); d.setUint16(20, 1, true); d.setUint16(22, 1, true);
  d.setUint32(24, 8000, true); d.setUint32(28, 8000, true); d.setUint16(32, 1, true);
  d.setUint16(34, 8, true); s(36, 'data'); d.setUint32(40, n, true);
  for (let i = 0; i < n; i++) d.setUint8(44 + i, 128);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
})();

function audioFreischalten() {
  if (aktuelleKarte) return;
  audio.src = STILLE;
  audio.play().catch(() => {});
}

function ladeKarte(id) {
  aktuelleKarte = id;
  $('kartennr').textContent = 'Karte ' + id;
  audio.src = 'audio/' + id + '.mp3';
  audio.currentTime = 0;
  zeige('spieler');
  abspielen();
}

function abspielen() {
  audio.play().catch((e) => {
    if (e.name === 'NotAllowedError') {
      $('status').textContent = 'Tippen zum Abspielen';
    } else if (e.name !== 'AbortError') {
      fehler('Der Schnipsel für diese Karte konnte nicht geladen werden.');
    }
  });
}

function aktualisiere() {
  const t = Math.min(audio.currentTime || 0, LAENGE);
  const dauer = Math.min(audio.duration || LAENGE, LAENGE);
  $('ring').style.strokeDashoffset = RING * (1 - t / dauer);
  const spielt = !audio.paused && !audio.ended;
  $('play').classList.toggle('spielt', spielt);
  $('play').setAttribute('aria-label', spielt ? 'Pause' : 'Abspielen');
  if (spielt) $('status').textContent = 'Hör genau hin …';
  else if (audio.ended) $('status').textContent = 'Wann wurde das komponiert?';
  else if (t > 0) $('status').textContent = 'Pausiert';
}

audio.addEventListener('timeupdate', aktualisiere);
audio.addEventListener('play', aktualisiere);
audio.addEventListener('pause', aktualisiere);
audio.addEventListener('ended', aktualisiere);
audio.addEventListener('error', () => {
  if (aktuelleKarte && document.body.dataset.ansicht === 'spieler') {
    fehler('Zu Karte ' + aktuelleKarte + ' gibt es keinen Schnipsel.');
  }
});
$('ring').style.strokeDasharray = RING;

$('play').addEventListener('click', () => {
  if (!audio.paused && !audio.ended) audio.pause();
  else {
    if (audio.ended) audio.currentTime = 0;
    abspielen();
  }
});

// --- QR-Codes ---------------------------------------------------------------

// Karten enthalten eine URL wie https://…/hitster-klassik/#k=042
function kartenId(text) {
  const m = /[#?&]k=(\d{1,4})\b/.exec(text) || /^\s*(\d{1,4})\s*$/.exec(text);
  return m ? m[1].padStart(3, '0') : null;
}

async function starteScanner() {
  audio.pause();
  aktuelleKarte = null;
  audioFreischalten();
  zeige('scanner');
  $('scan-hinweis').textContent = 'QR-Code der Karte in den Rahmen halten';
  if (!navigator.mediaDevices?.getUserMedia) {
    fehler('Dieser Browser erlaubt keinen Kamerazugriff. Bitte die Seite über https öffnen.');
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
  } catch (e) {
    fehler('Kein Zugriff auf die Kamera. Bitte in den Browser-Einstellungen erlauben.');
    return;
  }
  if (document.body.dataset.ansicht !== 'scanner') { stoppeKamera(); return; }
  video.srcObject = stream;
  await video.play().catch(() => {});
  if (!detector && 'BarcodeDetector' in window) {
    try {
      const formate = await BarcodeDetector.getSupportedFormats();
      if (formate.includes('qr_code')) detector = new BarcodeDetector({ formats: ['qr_code'] });
    } catch (e) { /* jsQR übernimmt */ }
  }
  scanLaeuft = true;
  scanSchleife();
}

function stoppeKamera() {
  scanLaeuft = false;
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
  video.srcObject = null;
}

async function erkenne() {
  if (video.readyState < 2) return null;
  if (detector) {
    const codes = await detector.detect(video);
    return codes.length ? codes[0].rawValue : null;
  }
  const max = 640;
  const f = Math.min(1, max / Math.max(video.videoWidth, video.videoHeight));
  canvas.width = Math.round(video.videoWidth * f);
  canvas.height = Math.round(video.videoHeight * f);
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const bild = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const code = jsQR(bild.data, bild.width, bild.height, { inversionAttempts: 'dontInvert' });
  return code ? code.data : null;
}

async function scanSchleife() {
  if (!scanLaeuft) return;
  try {
    const text = await erkenne();
    if (text) {
      const id = kartenId(text);
      if (id) {
        stoppeKamera();
        if (navigator.vibrate) navigator.vibrate(60);
        ladeKarte(id);
        return;
      }
      $('scan-hinweis').textContent = 'Das ist keine Hitster-Klassik-Karte';
    }
  } catch (e) { /* nächster Versuch */ }
  setTimeout(() => requestAnimationFrame(scanSchleife), detector ? 120 : 60);
}

// --- Knöpfe -----------------------------------------------------------------

document.addEventListener('click', (e) => {
  const knopf = e.target.closest('[data-aktion]');
  if (!knopf) return;
  const aktion = knopf.dataset.aktion;
  if (aktion === 'scannen') starteScanner();
  if (aktion === 'abbrechen') { stoppeKamera(); zeige(aktuelleKarte ? 'spieler' : 'start'); }
  if (aktion === 'nochmal' && aktuelleKarte) { audio.currentTime = 0; abspielen(); }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) { audio.pause(); if (scanLaeuft) { stoppeKamera(); zeige('start'); } }
});

// Mit der normalen Handykamera gescannt? Dann direkt die Karte anbieten.
function ausHash() {
  const id = kartenId(location.hash);
  if (!id) return;
  history.replaceState(null, '', location.pathname);
  aktuelleKarte = id;
  $('kartennr').textContent = 'Karte ' + id;
  audio.src = 'audio/' + id + '.mp3';
  zeige('spieler');
  abspielen(); // klappt meist nicht ohne Tipp – dann zeigt der Status „Tippen zum Abspielen“
}

zeige('start');
ausHash();
window.addEventListener('hashchange', ausHash);
