import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyAiIycci-D3csYOsIL1ajQoSL8j9rk0qtQ",
  authDomain: "select2notion-4f716.firebaseapp.com",
  projectId: "select2notion-4f716",
  storageBucket: "select2notion-4f716.firebasestorage.app",
  messagingSenderId: "607422635920",
  appId: "1:607422635920:web:89f89b06fbd2388de8dd15",
  measurementId: "G-TP0M1R35BQ",
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

export default app;
