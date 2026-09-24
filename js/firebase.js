/* ============================================================
   firebase.js — einzige Stelle, die das Firebase-SDK lädt
   ------------------------------------------------------------
   Modulares SDK direkt vom Google-CDN (kein Build nötig, läuft
   so auf GitHub Pages). Alle anderen Dateien importieren nur von
   hier — für ein SDK-Update nur die Versionsnummer in den drei
   import-Zeilen unten ändern (und in service-worker.js).

   Die Config ist öffentlich und darf im Code stehen: geschützt
   werden die Daten durch die Firestore-Regeln (firestore.rules),
   nicht durch den apiKey.
   ============================================================ */

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import * as authSdk from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import * as fs from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

export const firebaseConfig = {
  apiKey: "AIzaSyDPzEUZjs_5UqXGjJIXFvivdk-Tqydp28A",
  authDomain: "silvanos-1e7a0.firebaseapp.com",
  projectId: "silvanos-1e7a0",
  storageBucket: "silvanos-1e7a0.firebasestorage.app",
  messagingSenderId: "755310344822",
  appId: "1:755310344822:web:1c53ab90bcb3ab4e4f7d57",
};

export const app = initializeApp(firebaseConfig);

/* Login bleibt gespeichert (IndexedDB) — wie eine normale App. */
export const auth = authSdk.initializeAuth(app, {
  persistence: [authSdk.indexedDBLocalPersistence, authSdk.browserLocalPersistence],
});

/* Offline-Cache: Daten sind sofort da, Änderungen ohne Netz werden
   lokal gespeichert und automatisch nachgeschickt. */
let db;
try {
  db = fs.initializeFirestore(app, {
    localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }),
    ignoreUndefinedProperties: true,
  });
} catch (e) {
  console.warn("Offline-Cache nicht verfügbar, nutze Speicher-Cache", e);
  db = fs.initializeFirestore(app, { localCache: fs.memoryLocalCache(), ignoreUndefinedProperties: true });
}
export { db };

export const {
  onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut,
} = authSdk;

export const {
  doc, collection, getDoc, getDocs, onSnapshot, writeBatch, serverTimestamp,
} = fs;
