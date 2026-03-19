import {
  collection,
  doc,
  addDoc,
  updateDoc,
  query,
  where,
  onSnapshot,
  getDocs,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import type { Member } from '../types';

const MEMBERS = 'members';

export function subscribeMembers(
  callback: (members: Member[]) => void,
  onError: (error: Error) => void,
) {
  const q = query(collection(db, MEMBERS), where('isActive', '==', true));
  return onSnapshot(
    q,
    (snap) => {
      const members = snap.docs.map((d) => ({
        memberId: d.id,
        ...d.data(),
      })) as Member[];
      callback(members);
    },
    onError,
  );
}

export async function fetchMembers(): Promise<Member[]> {
  const q = query(collection(db, MEMBERS), where('isActive', '==', true));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ memberId: d.id, ...d.data() })) as Member[];
}

export async function createMember(data: Omit<Member, 'memberId'>): Promise<string> {
  const ref = await addDoc(collection(db, MEMBERS), data);
  return ref.id;
}

export async function updateMember(memberId: string, data: Partial<Member>): Promise<void> {
  await updateDoc(doc(db, MEMBERS, memberId), data);
}
