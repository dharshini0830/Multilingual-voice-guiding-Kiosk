import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { auth, googleProvider } from '@/src/firebase';
import { subscribeToSubmissions } from '@/src/services/firebaseService';
import type { SubmissionRecord } from '@/src/types/kiosk';

interface FirebaseContextValue {
  user: User | null;
  authReady: boolean;
  signingIn: boolean;
  authError: string | null;
  savedSubmissions: SubmissionRecord[];
  firestoreError: Error | null;
  signInWithGoogle: () => Promise<User | null>;
  signOutUser: () => Promise<void>;
  clearAuthError: () => void;
}

const FirebaseContext = createContext<FirebaseContextValue | null>(null);

export function FirebaseProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [savedSubmissions, setSavedSubmissions] = useState<SubmissionRecord[]>([]);
  const [firestoreError, setFirestoreError] = useState<Error | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);
      if (!nextUser) {
        setSavedSubmissions([]);
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!authReady || !user || !user.emailVerified) {
      setSavedSubmissions([]);
      return;
    }

    const unsubscribe = subscribeToSubmissions(
      user.uid,
      (records) => {
        setSavedSubmissions(records);
      },
      (err) => {
        setFirestoreError(err instanceof Error ? err : new Error(String(err)));
      }
    );

    return () => unsubscribe();
  }, [authReady, user]);

  // Surface Firestore permission errors to the nearest React ErrorBoundary
  if (firestoreError) {
    throw firestoreError;
  }

  const signInWithGoogle = useCallback(async (): Promise<User | null> => {
    setSigningIn(true);
    setAuthError(null);
    try {
      const cred = await signInWithPopup(auth, googleProvider);
      return cred.user;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sign-in failed';
      setAuthError(message);
      return null;
    } finally {
      setSigningIn(false);
    }
  }, []);

  const signOutUser = useCallback(async (): Promise<void> => {
    setAuthError(null);
    await signOut(auth);
  }, []);

  const clearAuthError = useCallback(() => {
    setAuthError(null);
  }, []);

  return (
    <FirebaseContext.Provider
      value={{
        user,
        authReady,
        signingIn,
        authError,
        savedSubmissions,
        firestoreError,
        signInWithGoogle,
        signOutUser,
        clearAuthError,
      }}
    >
      {children}
    </FirebaseContext.Provider>
  );
}

export function useFirebase(): FirebaseContextValue {
  const ctx = useContext(FirebaseContext);
  if (!ctx) throw new Error('useFirebase must be used inside FirebaseProvider');
  return ctx;
}
