export function installLocalRuntime(){
 const unavailable=async()=>{throw Error('ログイン・同期は接続設定後に利用できます。');};
 const callbacks=new Set(),auth={currentUser:null,onAuthStateChanged(fn){callbacks.add(fn);queueMicrotask(()=>fn(null));return()=>callbacks.delete(fn);},async signOut(){for(const fn of callbacks)fn(null);},setPersistence:async()=>{},getRedirectResult:async()=>({user:null}),signInWithPopup:unavailable,signInWithRedirect:unavailable,signInWithEmailAndPassword:unavailable,signInWithCustomToken:unavailable,signInAnonymously:unavailable,createUserWithEmailAndPassword:unavailable,sendPasswordResetEmail:unavailable};
 const snapshot={exists:false,data:()=>undefined,docs:[],empty:true};
 const ref=()=>({get:async()=>snapshot,onSnapshot(fn){queueMicrotask(()=>fn(snapshot));return()=>{};},doc:ref,where:ref,orderBy:ref,limit:ref,set:unavailable,update:unavailable,delete:unavailable});
 const db={collection:ref,doc:ref,runTransaction:unavailable};
 const authFactory=()=>auth;authFactory.Auth={Persistence:{LOCAL:'local',SESSION:'session'}};authFactory.GoogleAuthProvider=function(){this.setCustomParameters=()=>{}};
 const firestore=()=>db;firestore.FieldValue={serverTimestamp:()=>Date.now(),delete:()=>null};
 window.firebase={initializeApp:()=>{},auth:authFactory,firestore};
}
