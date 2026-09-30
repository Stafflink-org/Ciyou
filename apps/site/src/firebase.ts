import { initializeApp } from 'firebase/app';
import { addDoc, collection, getFirestore, serverTimestamp } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyAYQ_TzyCEK0_Iw5TnSiH8jbFbOFKZYNoM',
  authDomain: 'golink-9f16d.firebaseapp.com',
  projectId: 'golink-9f16d',
  storageBucket: 'golink-9f16d.firebasestorage.app',
  messagingSenderId: '683198090102',
  appId: '1:683198090102:web:5da52a0cdfcebcfd910857',
  measurementId: 'G-SHYR3NV3Y6',
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

export interface LeadPayload {
  fullName: string;
  businessName: string;
  email: string;
  phone: string;
  city: string;
  message: string;
}

export async function createPublicLead(payload: LeadPayload) {
  return addDoc(collection(db, 'publicLeads'), {
    ...payload,
    source: 'ciyou-public-site',
    status: 'new',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}
