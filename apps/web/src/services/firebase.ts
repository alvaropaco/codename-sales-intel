import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  type Auth,
  type ConfirmationResult,
} from 'firebase/auth';
import { getErrorCode } from '@/services/authErrors';

const env = import.meta.env;

/**
 * Firebase Web SDK config is PUBLIC (it ships in the JS bundle) and is not a
 * secret. We bake the b2base values as defaults so the app is configured in
 * every environment (dev, prod, Docker/Coolify) without extra env setup.
 * VITE_FIREBASE_* still wins when set, e.g. to point at another Firebase
 * project.
 */
const DEFAULT_FIREBASE_CONFIG = {
  apiKey: 'AIzaSyD8gSKEI3TmTo34qDDk9jIpiDuK8aAVbfM',
  authDomain: 'b2base.firebaseapp.com',
  projectId: 'b2base',
  storageBucket: 'b2base.firebasestorage.app',
  messagingSenderId: '64540157690',
  appId: '1:64540157690:web:aa95c8745ffdc385060b43',
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
 * Starts a full-page redirect sign-in for Google. The OAuth callback is handled
 * by `getFirebaseRedirectResult()` when the app reloads.
 */
export async function signInWithGoogleRedirect(): Promise<void> {
  const auth = requireAuth();
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  await signInWithRedirect(auth, provider);
}

/**
 * Preferred Google entrypoint: use the redirect flow (no popup, which is
 * more reliable across browsers and embeds). When the environment does not
 * support redirect sign-in, it falls back to a popup and returns the ID token.
 *
 * Returns null while a redirect is in progress (the browser is navigating away);
 * the session exchange happens on the next page load via
 * `getFirebaseRedirectResult()`.
 */
export async function signInWithProvider(): Promise<string | null> {
  const auth = requireAuth();
  const authProvider = new GoogleAuthProvider();
  authProvider.setCustomParameters({ prompt: 'select_account' });

  try {
    await signInWithRedirect(auth, authProvider);
    return null;
  } catch (err) {
    if (getErrorCode(err) === 'auth/operation-not-supported-in-this-environment') {
      const result = await signInWithPopup(auth, authProvider);
      return result.user.getIdToken();
    }
    throw err;
  }
}

/**
 * Resolves the OAuth redirect result after Firebase sends the user back to the
 * app. Returns the Firebase ID token, or null when the current page load was
 * not the result of a redirect sign-in.
 *
 * The result is memoized at module scope: `getRedirectResult` can only be read
 * once, and React StrictMode mounts the app twice in development (mount →
 * cleanup → mount). Without the memo, the first (discarded) mount would consume
 * the redirect result, leaving the second mount to see `null` and fall back to
 * the un-authenticated landing page — which is exactly the "first sign-in lands
 * on the landing page" bug.
 */
let redirectResultPromise: Promise<string | null> | null = null;

export async function getFirebaseRedirectResult(): Promise<string | null> {
  if (!firebaseAuth) return null;
  if (!redirectResultPromise) {
    redirectResultPromise = getRedirectResult(firebaseAuth).then((result) =>
      result && result.user ? result.user.getIdToken() : null
    );
  }
  return redirectResultPromise;
}

/**
 * Signs in with email/password and returns the Firebase ID token. Corporate
 * domain + email verification are enforced on the backend.
 */
export async function signInWithEmail(email: string, password: string): Promise<string> {
  const auth = requireAuth();
  const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
  return credential.user.getIdToken();
}

/**
 * Creates an email/password account, sends the verification email, and returns
 * the (not yet verified) Firebase ID token. The backend rejects the session
 * until the email is verified.
 */
export async function signUpWithEmail(email: string, password: string): Promise<string> {
  const auth = requireAuth();
  const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
  await sendEmailVerification(credential.user);
  return credential.user.getIdToken();
}

/**
 * Starts phone sign-in: renders Firebase's auto-provisioned invisible reCAPTCHA
 * into the given container and sends an SMS code. Returns the confirmation
 * handle used by `confirmPhoneVerificationCode`.
 */
export async function sendPhoneVerificationCode(
  phone: string,
  containerId: string
): Promise<ConfirmationResult> {
  const auth = requireAuth();
  const verifier = new RecaptchaVerifier(auth, containerId, { size: 'invisible' });
  return signInWithPhoneNumber(auth, phone, verifier);
}

/**
 * Confirms the SMS code and returns the Firebase ID token.
 */
export async function confirmPhoneVerificationCode(
  confirmation: ConfirmationResult,
  code: string
): Promise<string> {
  const credential = await confirmation.confirm(code);
  return credential.user.getIdToken();
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
