/* ============================================================
   CaféFind – Authentication & Auth Guard
   Requires: Firebase App + Auth + Firestore SDKs (compat v9)
   Loaded after firebase-config.js on every page.
   Sign-In method: Email/Password (Firebase Email/Password Auth).
   ============================================================ */

(function () {
  'use strict';

  var auth = firebase.auth();
  var db   = firebase.firestore();

  /*
    Guard flag: true while signUp() is actively running its Auth+Firestore chain.
    Prevents the onAuthStateChanged observer from redirecting away from the
    sign-up page the moment createUserWithEmailAndPassword resolves — which
    otherwise tears down the page before the .then handler (that writes the
    Firestore profile with the closure-captured username/email values) can run.
    Cleared only AFTER the Firestore write succeeds and the explicit redirect
    inside signUp() has been issued.
   */
  var isSigningUp = false;

  /* ── Page classification ───────────────────────────────────
     Public  : index, login, account (signup), contact
     Protected: everything else (search, listings, Owners, etc.)
     ────────────────────────────────────────────────────────── */
  var page = window.location.pathname.split('/').pop().toLowerCase();

  var PUBLIC_PAGES = ['index.html', 'login.html', 'account.html', 'contact.html', ''];

  var isPublic     = PUBLIC_PAGES.indexOf(page) !== -1;
  var isLoginPage  = (page === 'login.html');
  var isSignupPage = (page === 'account.html');

  /* ── Auth state observer (runs on every page) ──────────────
     • Protected page + no user  → redirect to login
     • Login page      + user    → redirect to search (already in)
     • Signup page     + user    → redirect to search ONLY if NOT mid-signup
       (isSigningUp=true defers redirect until the signUp() .then chain has
        written the Firestore profile, guaranteeing closure values reach the DB)
     • Any page + user           → update nav to show name + logout
     ────────────────────────────────────────────────────────── */
  auth.onAuthStateChanged(function (user) {
    if (!isPublic && !user) {
      window.location.replace('login.html');
      return;
    }

    if (isLoginPage && user) {
      window.location.replace('search.html');
      return;
    }

    if (isSignupPage && user && !isSigningUp) {
      window.location.replace('search.html');
      return;
    }

    if (user) {
      updateNav(user);
    }
  });

  /* ── Update nav actions for logged-in users ────────────────
     Replaces the Log In / Sign Up buttons with:
       "Hi, <username>"  +  Log Out button
     Prefers Firestore username stored in the user doc,
     otherwise falls back to email prefix.
     ────────────────────────────────────────────────────────── */
  function updateNav(user) {
    var navActions = document.querySelector('.nav-actions');
    if (!navActions) return;

    // Try to get username from Firestore; use cacheable fallback immediately.
    var fallbackName = user.email ? user.email.split('@')[0] : 'User';
    navActions.innerHTML =
      '<span style="font-size:var(--fs-sm);color:var(--clr-muted);padding:0 var(--space-sm);">' +
        'Hi, <strong>' + escHtml(fallbackName) + '</strong>' +
      '</span>' +
      '<button onclick="CafeFindAuth.signOut()" class="btn btn-secondary btn-sm">Log Out</button>';

    // If Firestore username is available, update the display name
    db.collection('users').doc(user.uid).get()
      .then(function (doc) {
        if (doc && doc.exists && doc.data() && doc.data().username) {
          var navActionsLive = document.querySelector('.nav-actions');
          if (!navActionsLive) return;
          navActionsLive.innerHTML =
            '<span style="font-size:var(--fs-sm);color:var(--clr-muted);padding:0 var(--space-sm);">' +
              'Hi, <strong>' + escHtml(doc.data().username) + '</strong>' +
            '</span>' +
            '<button onclick="CafeFindAuth.signOut()" class="btn btn-secondary btn-sm">Log Out</button>';
        }
      })
      .catch(function () { /* swallow — we already have a fallback name shown */ });
  }

  /* ── Create Firestore user profile on signup ───────────────
     Firestore path: users/{uid}
     Fields:
       username  (string)  – from signup form
       email     (string)  – from signup form / Firebase Auth
       createdAt (Timestamp) – server timestamp on first create only
     Does NOT write or store the password anywhere outside Firebase Auth.
     ────────────────────────────────────────────────────────── */
  function createUserInFirestore(uid, username, email) {
    var userRef = db.collection('users').doc(uid);
    return userRef.set({
      username:  username,
      email:     email,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  }

  /* ── Sign Up (Email + Password) ────────────────────────────
     Steps:
       0. Set isSigningUp=true so onAuthStateChanged does NOT redirect
          away before this chain has a chance to finish.
       1. Validate fields (username nonempty, email valid, pw >= 8 chars)
       2. Create user in Firebase Auth (createUserWithEmailAndPassword)
       3. Create matching Firestore doc via createUserInFirestore()
          using closure-captured username/email from the form.
       4. Redirect to search.html
     If any step fails, isSigningUp is reset in the catch.
     ────────────────────────────────────────────────────────── */
  function signUp(data, errorEl) {
    isSigningUp = true;
    clearError(errorEl);

    var username = (data.username || '').trim();
    var email    = (data.email || '').trim();
    var password = (data.password || '');

    // Client-side validation
    if (!username) {
      showError(errorEl, 'Please enter a username.');
      isSigningUp = false;
      return Promise.resolve();
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showError(errorEl, 'Please enter a valid email address.');
      isSigningUp = false;
      return Promise.resolve();
    }
    if (!password || password.length < 8) {
      showError(errorEl, 'Password must be at least 8 characters.');
      isSigningUp = false;
      return Promise.resolve();
    }

    return auth.createUserWithEmailAndPassword(email, password)
      .then(function (result) {
        var user = result.user;
        return createUserInFirestore(user.uid, username, email);
      })
      .then(function () {
        isSigningUp = false;
        window.location.replace('search.html');
      })
      .catch(function (err) {
        isSigningUp = false;
        console.error("SIGN UP ERROR:", err);
        console.error("Firebase error code:", err && err.code);
        console.error("Firebase error message:", err && err.message);
        showError(errorEl, friendlyAuthError(err && err.code, err && err.message));
      });
  }

  /* ── Sign In (Email + Password) ────────────────────────────
     Calls Firebase signInWithEmailAndPassword.
     On success → redirect to search.html.
     ────────────────────────────────────────────────────────── */
  function signIn(email, password, errorEl) {
    clearError(errorEl);

    email    = (email || '').trim();
    password = (password || '');

    if (!email) {
      showError(errorEl, 'Please enter your email address.');
      return Promise.resolve();
    }
    if (!password) {
      showError(errorEl, 'Please enter your password.');
      return Promise.resolve();
    }

    return auth.signInWithEmailAndPassword(email, password)
      .then(function () {
        window.location.replace('search.html');
      })
      .catch(function (err) {
        console.error("SIGN IN ERROR:", err);
        console.error("Firebase error code:", err && err.code);
        console.error("Firebase error message:", err && err.message);
        showError(errorEl, friendlyAuthError(err && err.code, err && err.message));
      });
  }

  /* ── Sign Out ───────────────────────────────────────────────
     Attached to the Log Out button injected by updateNav().
     After sign-out → redirect to home page.
     ────────────────────────────────────────────────────────── */
  function signOut() {
    auth.signOut().then(function () {
      window.location.replace('index.html');
    });
  }

  /* ── Helpers ─────────────────────────────────────────────── */

  function showError(el, msg) {
    if (!el) return;
    el.textContent = msg;
    el.style.display = 'block';
  }

  function clearError(el) {
    if (!el) return;
    el.textContent = '';
    el.style.display = 'none';
  }

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /*
     Convert Firebase error codes to readable messages.
     Accepts a fallback 'rawMessage' so that unmapped errors (common for
     Firestore writes during sign-up, network issues, etc.) still surface
     the real code+message to the user AND the browser console instead of
     collapsing into a generic "Something went wrong."
   */
  function friendlyAuthError(code, rawMessage) {
    var messages = {
      // --- Firebase Auth codes ---
      'auth/invalid-email':          'Please enter a valid email address.',
      'auth/user-not-found':         'No account found with that email.',
      'auth/wrong-password':         'Incorrect password. Please try again.',
      'auth/email-already-in-use':   'An account with this email already exists. Please log in instead.',
      'auth/weak-password':          'Password must be at least 8 characters.',
      'auth/too-many-requests':      'Too many attempts. Please wait a moment and try again.',
      'auth/network-request-failed': 'Network error. Please check your connection.',
      'auth/missing-password':       'Please enter your password.',
      'auth/operation-not-allowed':  'Email/Password sign-in is not enabled for this project.',
      // --- Firestore codes that may trigger during sign-up Firestore write ---
      'permission-denied':           'Permission denied: Firestore security rules rejected the write. Check that your rules allow request.auth.uid == resource.id (or userId) on users/{uid}.',
      'unavailable':                 'Firestore is temporarily unavailable. Please try again shortly.',
      'deadline-exceeded':           'Request timed out. Please try again.',
      'not-found':                   'Firestore document or collection not found.',
      'resource-exhausted':          'Firestore quota exceeded. Check your Firebase usage limits.',
      'aborted':                     'Firestore operation aborted. Please try again.',
      'cancelled':                   'Operation cancelled.'
    };

    var friendly = messages[code];
    if (friendly) {
      return friendly;
    }

    // No known mapping — surface the real Firebase code + message inline
    // so the user never sees a purely generic message.
    var suffix = '';
    if (code)       suffix += ' [' + code + ']';
    if (rawMessage) suffix += ' — ' + rawMessage;
    return 'Something went wrong.' + suffix;
  }

  /* ── Public API ─────────────────────────────────────────────
     Exposed on window.CafeFindAuth so inline onclick handlers
     (Log Out button) and page scripts can call these functions.
     ────────────────────────────────────────────────────────── */
  window.CafeFindAuth = {
    signIn:  signIn,
    signUp:  signUp,
    signOut: signOut
  };

}());
