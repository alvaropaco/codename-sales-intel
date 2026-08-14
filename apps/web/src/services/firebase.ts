import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  GithubAuthProvider,
  signInWithPopup,
  type Auth,
} from 'firebase/auth';

const env = import.meta.env;

/**
 * Firebase Web SDK config is PUBLIC (it ships in the JS bundle) and is not a
 * secret. We bake the shadowtrace-7199f values as defaults so the app is
 * configured in every environment (dev, prod, Docker/Coolify) without extra
 * env setup. VITE_FIREBASE_* still wins when set, e.g. to point at another
 * Firebase project.
 */
const DEFAULT_FIREBASE_CONFIG = {
  apiKey: 'AIzaSyB1hzBHuiSVolIX5q7_gbpJbdGJd60L7lQ',
  authDomain: 'shadowtrace-7199f.firebaseapp.com',
  projectId: 'shadowtrace-7199f',
  storageBucket: 'shadowtrace-7199f.firebasestorage.app',
  messagingSenderId: '421752671625',
  appId: '1:421752671625:web:c3ed13421447db68fe2558',
};

function pick(name: string, fallback: string): string {
  const value = env[name]?.trim();
  if (!value || value.startsWith('REPLACE') || value.startsWith('YOUR_')) {
    return fallback;
  }
  return value;
}

export const firebaseConfig = {
  apiKey: pick('VITE_FIREBASE_API_KEY', DEFAULT_FIREBASE_CONFIG.apiKey),
  authDomain: pick('VITE_FIREBASE_AUTH_DOMAIN', DEFAULT_FIREBASE_CONFIG.authDomain),
  projectId: pick('VITE_FIREBASE_PROJECT_ID', DEFAULT_FIREBASE_CONFIG.projectId),
  storageBucket: pick('VITE_FIREBASE_STORAGE_BUCKET', DEFAULT_FIREBASE_CONFIG.storageBucket),
  messagingSenderId: pick('VITE_FIREBASE_MESSAGING_SENDER_ID', DEFAULT_FIREBASE_CONFIG.messagingSenderId),
  appId: pick('VITE_FIREBASE_APP_ID', DEFAULT_FIREBASE_CONFIG.appId),
};

export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey && firebaseConfig.appId && firebaseConfig.projectId
);

let app: FirebaseApp | null = null;
let firebaseAuth: Auth | null = null;

if (isFirebaseConfigured) {
  app = initializeApp(firebaseConfig);
  firebaseAuth = getAuth(app);
  // Popups are the most reliable flow for a dashboard; the SDK persists the
  // Firebase user locally so we only need the session cookie on the backend.
  firebaseAuth.useDeviceLanguage();
}

function requireAuth(): Auth {
  if (!firebaseAuth) {
    throw new Error('Firebase não configurado. Verifique o arquivo de configuração do Web SDK.');
  }
  return firebaseAuth;
}

/**
 * Signs the user in via a Google popup and returns the Firebase ID token.
 */
export async function signInWithGoogle(): Promise<string> {
  const auth = requireAuth();
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const result = await signInWithPopup(auth, provider);
  return result.user.getIdToken();
}

/**
 * Signs the user in via a GitHub popup and returns the Firebase ID token.
 */
export async function signInWithGithub(): Promise<string> {
  const auth = requireAuth();
  const provider = new GithubAuthProvider();
  const result = await signInWithPopup(auth, provider);
  return result.user.getIdToken();
}

/**
 * Signs the Firebase user out on the client (the session cookie is cleared
 * separately by the backend /api/auth/logout endpoint).
 */
export async function signOutFirebase(): Promise<void> {
  if (firebaseAuth) {
    await firebaseAuth.signOut();
  }
}
