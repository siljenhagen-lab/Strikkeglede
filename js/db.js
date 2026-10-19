// IndexedDB-lagring. All data ligger lokalt på enheten.
const DB_NAME = 'strikkeglede';
const DB_VERSION = 1;
export const STORES = ['recipes', 'files', 'patterns', 'projects', 'kv'];

let dbPromise;
function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const name of ['recipes', 'files', 'patterns', 'projects']) {
          if (!db.objectStoreNames.contains(name)) {
            const os = db.createObjectStore(name, { keyPath: 'id' });
            if (name !== 'recipes') os.createIndex('recipeId', 'recipeId');
          }
        }
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

const done = (r) => new Promise((resolve, reject) => {
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});
const txDone = (tx) => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error);
});

export async function get(store, key) {
  const db = await open();
  return done(db.transaction(store).objectStore(store).get(key));
}
export async function all(store) {
  const db = await open();
  return done(db.transaction(store).objectStore(store).getAll());
}
export async function byRecipe(store, recipeId) {
  const db = await open();
  return done(db.transaction(store).objectStore(store).index('recipeId').getAll(recipeId));
}
export async function put(store, value, key) {
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  if (key === undefined) tx.objectStore(store).put(value);
  else tx.objectStore(store).put(value, key);
  await txDone(tx);
  return value;
}
export async function del(store, key) {
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).delete(key);
  await txDone(tx);
}
export async function kvEntries() {
  const db = await open();
  const os = db.transaction('kv').objectStore('kv');
  const [keys, values] = await Promise.all([done(os.getAllKeys()), done(os.getAll())]);
  return keys.map((k, i) => [k, values[i]]);
}
export async function clearAll() {
  const db = await open();
  const tx = db.transaction(STORES, 'readwrite');
  for (const s of STORES) tx.objectStore(s).clear();
  await txDone(tx);
}

export function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}
