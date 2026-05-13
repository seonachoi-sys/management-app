import { collection, addDoc, Timestamp } from 'firebase/firestore';
import { db } from '../firebase/config';

const COLLECTION = 'auditLog';

/** 데이터 변경 감사 로그 기록 */
export async function logAction(
  action: string,
  targetCollection: string,
  documentId: string,
  field: string,
  oldValue: unknown,
  newValue: unknown,
  userEmail: string
) {
  return addDoc(collection(db, COLLECTION), {
    action,
    collection: targetCollection,
    documentId,
    field,
    oldValue,
    newValue,
    userEmail,
    createdAt: Timestamp.now(),
  });
}
