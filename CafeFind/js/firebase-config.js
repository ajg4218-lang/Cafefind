
const firebaseConfig = {
  apiKey:            "AIzaSyAWqwC5c2WWaYTIdmi8FoyOGoK399fy1S4",
  authDomain:        "cafefind-a6372.firebaseapp.com",
  projectId:         "cafefind-a6372",
  storageBucket:     "cafefind-a6372.firebasestorage.app",
  messagingSenderId: "241913731674",
  appId:             "1:241913731674:web:61add585c3f8686e965663"
};

/*
  Initialise Firebase.
  Guard pattern: firebase.app() throws "app/no-app" if the default
  app has not been created yet. This is the only SDK-version-agnostic
  way to detect a missing default app across Firebase compat v9/v10
  where firebase.apps is sometimes an object (not an array) and a
  `.length` check would wrongly skip initialisation.
*/
try {
  firebase.app();
} catch (err) {
  firebase.initializeApp(firebaseConfig);
  console.log("Firebase initialized — projectId:", firebaseConfig.projectId);
}
