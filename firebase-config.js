// Importiere die benötigten Funktionen aus den Firebase SDKs
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-app.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-database.js";

// =================================================================================
// TODO: Ersetze dies durch die Firebase-Konfiguration deines Web-Projekts
// Du erhältst diesen Code, wenn du eine Web-App in deinem Firebase-Projekt erstellst.
// =================================================================================
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyDLOV59kiFzp7QfgaZNMmJB8iD5DNHrh2o",
  authDomain: "bustrinker-3a47f.firebaseapp.com",
  projectId: "bustrinker-3a47f",
  storageBucket: "bustrinker-3a47f.firebasestorage.app",
  messagingSenderId: "1059965319189",
  appId: "1:1059965319189:web:2c475328a404fb6463f61c",
  measurementId: "G-V9B6MZ880T"
};
// Firebase initialisieren
const app = initializeApp(firebaseConfig);

// Die Datenbank-Instanz exportieren, damit sie in main.js verwendet werden kann
export const db = getDatabase(app);

