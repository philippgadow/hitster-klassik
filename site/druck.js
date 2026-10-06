'use strict';

const PRO_BLATT = 12; // 3 Spalten × 4 Zeilen
const SPALTEN = 3;

const basisFeld = document.getElementById('basis');
basisFeld.value = new URL('./', location.href).href;

function epoche(jahr) {
  if (jahr < 1750) return 'barock';
  if (jahr < 1820) return 'klassik';
  if (jahr < 1900) return 'romantik';
  return 'moderne';
}

function el(tag, klasse, text) {
  const e = document.createElement(tag);
  if (klasse) e.className = klasse;
  if (text != null) e.textContent = text;
  return e;
}

function qrSvg(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
}

function vorderseite(k) {
  const d = el('div', 'karte vorne');
  d.innerHTML = qrSvg(basisFeld.value.trim() + '#k=' + k.id);
  d.appendChild(el('div', 'marke', 'Hitster Klassik'));
  return d;
}

function rueckseite(k) {
  const d = el('div', 'karte hinten ' + epoche(k.jahr));
  d.appendChild(el('div', 'komponist', k.komponist));
  const mitte = el('div', 'mitte');
  const jahr = el('div', 'jahr');
  if (k.ca) jahr.appendChild(el('small', null, 'ca.'));
  jahr.appendChild(document.createTextNode(k.jahr));
  mitte.appendChild(jahr);
  mitte.appendChild(el('div', 'werk', k.werk));
  d.appendChild(mitte);
  d.appendChild(el('div', 'interpret', k.interpret && k.interpret !== '?' ? k.interpret : ''));
  return d;
}

function blatt(karten, seite) {
  const b = el('div', 'blatt');
  const r = el('div', 'raster');
  for (let i = 0; i < PRO_BLATT; i++) {
    // Rückseiten zeilenweise spiegeln, damit sie beim Wenden an der langen Kante passen
    let idx = i;
    if (seite === 'hinten') {
      const zeile = Math.floor(i / SPALTEN), spalte = i % SPALTEN;
      idx = zeile * SPALTEN + (SPALTEN - 1 - spalte);
    }
    const k = karten[idx];
    r.appendChild(k ? (seite === 'vorne' ? vorderseite(k) : rueckseite(k)) : el('div', 'karte leer'));
  }
  b.appendChild(r);
  return b;
}

let alleKarten = [];

function zeichne() {
  const ziel = document.getElementById('blaetter');
  ziel.innerHTML = '';
  for (let i = 0; i < alleKarten.length; i += PRO_BLATT) {
    const teil = alleKarten.slice(i, i + PRO_BLATT);
    ziel.appendChild(blatt(teil, 'vorne'));
    ziel.appendChild(blatt(teil, 'hinten'));
  }
}

async function laden() {
  const info = document.getElementById('info');
  let karten;
  try {
    karten = await (await fetch('karten.json', { cache: 'no-store' })).json();
  } catch (e) {
    // Vorschau direkt aus dem Repository (ohne Build): Interpreten fehlen dann noch
    karten = await (await fetch('../data/werke.json')).json();
  }
  alleKarten = karten.slice().sort((a, b) => a.id.localeCompare(b.id));
  const blaetter = Math.ceil(alleKarten.length / PRO_BLATT);
  const ohne = alleKarten.filter((k) => k.audio === false);
  info.textContent = `${alleKarten.length} Karten auf ${blaetter} Blatt Papier (beidseitig).`;
  if (ohne.length) {
    const w = el('p', 'warnung', `Achtung: ${ohne.length} Karte(n) haben noch keinen Schnipsel: ` +
      ohne.map((k) => k.id).join(', ') + '. Details in der Übersicht.');
    info.after(w);
  }
  zeichne();
}

basisFeld.addEventListener('change', zeichne);
document.getElementById('farbig').addEventListener('change', (e) => {
  document.body.classList.toggle('farbig', e.target.checked);
});
laden();
