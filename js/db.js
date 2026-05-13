/**
 * GlobeTrotter SQL - IndexedDB Abstraktionsschicht
 * Verwaltet alle lokalen Daten: Reisen, Dokumente, Checklisten, Koordinaten, Blobs.
 */

const DB_NAME = 'GlobeTrotterDB';
const DB_VERSION = 1;

/**
 * Datenbankschema:
 *
 * trips          - Reisedaten (Name, Ziel, Zeitraum, Status)
 * documents      - Dokumente pro Reise (PDF-Blobs, Metadaten)
 * checklist      - Checklisten-Eintraege pro Reise
 * locations      - Besuchte Orte mit Koordinaten fuer Weltkarte
 * mapTilesMeta   - Metadaten gecachter Kartenkacheln
 * pendingSync    - Noch nicht synchronisierte Aktionen (Offline-Queue)
 */

let dbInstance = null;

export async function openDB() {
  if (dbInstance) return dbInstance;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // --- trips ---
      if (!db.objectStoreNames.contains('trips')) {
        const trips = db.createObjectStore('trips', { keyPath: 'id', autoIncrement: true });
        trips.createIndex('status', 'status', { unique: false });
        trips.createIndex('startDate', 'startDate', { unique: false });
      }

      // --- documents ---
      if (!db.objectStoreNames.contains('documents')) {
        const docs = db.createObjectStore('documents', { keyPath: 'id', autoIncrement: true });
        docs.createIndex('tripId', 'tripId', { unique: false });
        docs.createIndex('type', 'type', { unique: false });
      }

      // --- checklist ---
      if (!db.objectStoreNames.contains('checklist')) {
        const checklist = db.createObjectStore('checklist', { keyPath: 'id', autoIncrement: true });
        checklist.createIndex('tripId', 'tripId', { unique: false });
        checklist.createIndex('category', 'category', { unique: false });
        checklist.createIndex('done', 'done', { unique: false });
      }

      // --- locations ---
      if (!db.objectStoreNames.contains('locations')) {
        const locations = db.createObjectStore('locations', { keyPath: 'id', autoIncrement: true });
        locations.createIndex('tripId', 'tripId', { unique: false });
        locations.createIndex('visited', 'visited', { unique: false });
      }

      // --- pendingSync ---
      if (!db.objectStoreNames.contains('pendingSync')) {
        const sync = db.createObjectStore('pendingSync', { keyPath: 'id', autoIncrement: true });
        sync.createIndex('type', 'type', { unique: false });
        sync.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };

    request.onsuccess = (event) => {
      dbInstance = event.target.result;
      console.log('[DB] GlobeTrotterDB geoeffnet, Version:', DB_VERSION);
      resolve(dbInstance);
    };

    request.onerror = (event) => {
      console.error('[DB] Fehler beim Oeffnen:', event.target.error);
      reject(event.target.error);
    };
  });
}

// ----------------------------------------------------------------
// Generische Hilfsfunktionen
// ----------------------------------------------------------------

function tx(db, storeName, mode = 'readonly') {
  return db.transaction(storeName, mode).objectStore(storeName);
}

function promisifyRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// ----------------------------------------------------------------
// TRIPS
// ----------------------------------------------------------------

export async function getAllTrips() {
  const db = await openDB();
  return promisifyRequest(tx(db, 'trips').getAll());
}

export async function getTripsByStatus(status) {
  const db = await openDB();
  return promisifyRequest(tx(db, 'trips').index('status').getAll(status));
}

export async function getActiveTrip() {
  const trips = await getTripsByStatus('active');
  return trips[0] || null;
}

export async function saveTrip(trip) {
  const db = await openDB();
  const store = tx(db, 'trips', 'readwrite');
  const now = new Date().toISOString();
  const data = { ...trip, updatedAt: now };
  if (!data.createdAt) data.createdAt = now;
  return promisifyRequest(store.put(data));
}

export async function deleteTrip(id) {
  const db = await openDB();
  return promisifyRequest(tx(db, 'trips', 'readwrite').delete(id));
}

// ----------------------------------------------------------------
// DOCUMENTS (PDF-Tresor)
// ----------------------------------------------------------------

export async function saveDocument(doc) {
  const db = await openDB();
  // doc.blob: der eigentliche Datei-Blob
  // doc.tripId, doc.name, doc.type ('ticket'|'hotel'|'insurance'|'other')
  const data = { ...doc, savedAt: new Date().toISOString() };
  return promisifyRequest(tx(db, 'documents', 'readwrite').put(data));
}

export async function getDocumentsByTrip(tripId) {
  const db = await openDB();
  return promisifyRequest(tx(db, 'documents').index('tripId').getAll(tripId));
}

export async function getDocument(id) {
  const db = await openDB();
  return promisifyRequest(tx(db, 'documents').get(id));
}

export async function deleteDocument(id) {
  const db = await openDB();
  return promisifyRequest(tx(db, 'documents', 'readwrite').delete(id));
}

// ----------------------------------------------------------------
// CHECKLISTE
// ----------------------------------------------------------------

export async function getChecklistByTrip(tripId) {
  const db = await openDB();
  return promisifyRequest(tx(db, 'checklist').index('tripId').getAll(tripId));
}

export async function saveChecklistItem(item) {
  const db = await openDB();
  const data = { ...item, updatedAt: new Date().toISOString() };
  if (!data.createdAt) data.createdAt = data.updatedAt;
  return promisifyRequest(tx(db, 'checklist', 'readwrite').put(data));
}

export async function toggleChecklistItem(id) {
  const db = await openDB();
  const store = tx(db, 'checklist', 'readwrite');
  const item = await promisifyRequest(store.get(id));
  if (!item) throw new Error(`Checklist-Item ${id} nicht gefunden`);
  item.done = !item.done;
  item.updatedAt = new Date().toISOString();
  await promisifyRequest(store.put(item));
  return item;
}

export async function deleteChecklistItem(id) {
  const db = await openDB();
  return promisifyRequest(tx(db, 'checklist', 'readwrite').delete(id));
}

export async function getChecklistStats(tripId) {
  const items = await getChecklistByTrip(tripId);
  const total = items.length;
  const done = items.filter((i) => i.done).length;
  return { total, done, percent: total > 0 ? Math.round((done / total) * 100) : 0 };
}

// ----------------------------------------------------------------
// LOCATIONS (Weltkarte)
// ----------------------------------------------------------------

export async function getAllLocations() {
  const db = await openDB();
  return promisifyRequest(tx(db, 'locations').getAll());
}

export async function saveLocation(location) {
  // location: { tripId, name, lat, lng, country, visitedAt, notes }
  const db = await openDB();
  const data = { ...location, savedAt: new Date().toISOString() };
  return promisifyRequest(tx(db, 'locations', 'readwrite').put(data));
}

export async function getLocationsByTrip(tripId) {
  const db = await openDB();
  return promisifyRequest(tx(db, 'locations').index('tripId').getAll(tripId));
}

// ----------------------------------------------------------------
// PENDING SYNC (Offline-Queue)
// ----------------------------------------------------------------

export async function addPendingSync(action) {
  const db = await openDB();
  const data = { ...action, createdAt: new Date().toISOString(), retries: 0 };
  return promisifyRequest(tx(db, 'pendingSync', 'readwrite').add(data));
}

export async function getPendingSync(type) {
  const db = await openDB();
  if (type) {
    return promisifyRequest(tx(db, 'pendingSync').index('type').getAll(type));
  }
  return promisifyRequest(tx(db, 'pendingSync').getAll());
}

export async function deletePendingSync(id) {
  const db = await openDB();
  return promisifyRequest(tx(db, 'pendingSync', 'readwrite').delete(id));
}

// ----------------------------------------------------------------
// DATENBANK-STATISTIKEN (fuer Debug-/Einstellungsansicht)
// ----------------------------------------------------------------

export async function getDBStats() {
  const db = await openDB();
  const stores = ['trips', 'documents', 'checklist', 'locations', 'pendingSync'];
  const counts = {};

  for (const storeName of stores) {
    counts[storeName] = await promisifyRequest(tx(db, storeName).count());
  }

  return counts;
}

export async function clearAllData() {
  const db = await openDB();
  const stores = ['trips', 'documents', 'checklist', 'locations', 'pendingSync'];
  for (const storeName of stores) {
    await promisifyRequest(tx(db, storeName, 'readwrite').clear());
  }
  console.log('[DB] Alle lokalen Daten geloescht.');
}

console.log('[DB] db.js Modul geladen');
