import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  GithubAuthProvider,
  signInWithPopup,
  type Auth,
} from 'firebase/auth';

const env = import.meta.env;

function isConfigured(value?: string): boolean {
  return Boolean(
    value &&
      value.trim().length > 0 &&
      !value.startsWith('REPLACE') &&
      !value.startsWith('YOUR_')
  );
}

const projectId = env.VITE_FIREBASE_PROJECT_ID?.trim() || '';

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY?.trim() || '',
  authDomain:
    env.VITE_FIREBASE_AUTH_DOMAIN?.trim() ||
    (projectId ? `${projectId}.firebaseapp.com` : ''),
  projectId,
  storageBucket:
    env.VITE_FIREBASE_STORAGE_BUCKET?.trim() ||
    (projectId ? `${projectId}.appspot.com` : ''),
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID?.trim() || '',
  appId: env.VITE_FIREBASE_APP_ID?.trim() || '',
};

export const isFirebaseConfigured = Boolean(
  isConfigured(firebaseConfig.apiKey) &&
    isConfigured(firebaseConfig.appId) &&
    isConfigured(firebaseConfig.projectId)
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
    throw new Error(
      'Firebase não configurado. Defina VITE_FIREBASE_API_KEY e VITE_FIREBASE_APP_ID em apps/web/.env.local.'
    );
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
