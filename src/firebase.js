
import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDGUIt-uMxjtTNRlmAS1SPacb0UaEfmgQU",
  authDomain: "blinkit-ims-59401.firebaseapp.com",
  projectId: "blinkit-ims-59401",
  storageBucket: "blinkit-ims-59401.firebasestorage.app",
  messagingSenderId: "389656985133",
  appId: "1:389656985133:web:4f6738a896eb43e4c1c2a4"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Services and EXPORT them
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider(); // This was the missing part!
