/**
 * firebase.ts
 * Configuración de Firebase Realtime Database.
 *
 * SEGURIDAD: La configuración se lee de las variables de entorno.
 * Para configurar, agrega en .env.local:
 *   VITE_FIREBASE_API_KEY=...
 *   VITE_FIREBASE_AUTH_DOMAIN=...
 *   VITE_FIREBASE_DATABASE_URL=...
 *   VITE_FIREBASE_PROJECT_ID=...
 *   VITE_FIREBASE_STORAGE_BUCKET=...
 *   VITE_FIREBASE_MESSAGING_SENDER_ID=...
 *   VITE_FIREBASE_APP_ID=...
 *
 * IDeIn Computación - Extractor de Comprobantes
 *
 * NOTA: Esta es una implementación en memoria como fallback cuando Firebase
 * no está configurado. Reemplaza con la configuración real de Firebase.
 */

// ─── Tipos básicos de Firebase (mock) ────────────────────────────────────────

export type DatabaseReference = {
  _path: string;
  _db: InMemoryDatabase;
};

export type DataSnapshot = {
  exists: () => boolean;
  val: () => unknown;
};

type InMemoryDatabase = Map<string, unknown>;

// ─── Base de datos en memoria (fallback cuando Firebase no está configurado) ──

const inMemoryDb: InMemoryDatabase = new Map();

// ─── API Compatible con Firebase Realtime Database ───────────────────────────

/**
 * Obtiene una referencia a la base de datos.
 * Si Firebase está configurado, usa Firebase real; si no, usa almacenamiento en memoria.
 */
export function getFirebaseDb(): InMemoryDatabase {
  // TODO: Reemplazar con la configuración real de Firebase cuando esté disponible
  // Ejemplo:
  // import { initializeApp } from 'firebase/app';
  // import { getDatabase } from 'firebase/database';
  // const app = initializeApp({ apiKey: import.meta.env.VITE_FIREBASE_API_KEY, ... });
  // return getDatabase(app);

  console.warn('[firebase] Usando base de datos en memoria. Configura Firebase en .env.local para persistencia real.');
  return inMemoryDb;
}

/**
 * Crea una referencia a una ruta de la base de datos.
 */
export function ref(db: InMemoryDatabase, path: string): DatabaseReference {
  return { _path: path, _db: db };
}

/**
 * Lee el valor en una referencia de la base de datos.
 */
export async function get(reference: DatabaseReference): Promise<DataSnapshot> {
  const value = reference._db.get(reference._path);
  return {
    exists: () => value !== undefined,
    val: () => value ?? null,
  };
}

/**
 * Escribe un valor en una referencia de la base de datos.
 */
export async function set(reference: DatabaseReference, value: unknown): Promise<void> {
  reference._db.set(reference._path, value);
}
