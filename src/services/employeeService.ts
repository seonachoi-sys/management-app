import {
  collection,
  doc,
  onSnapshot,
  addDoc,
  updateDoc,
  query,
  orderBy,
  Timestamp,
  Unsubscribe,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { Employee } from '../types/project';

const COLLECTION = 'employees';

/** 직원 목록 실시간 구독 */
export function subscribeEmployees(
  callback: (employees: Employee[]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  const q = query(collection(db, COLLECTION), orderBy('name'));
  return onSnapshot(
    q,
    (snapshot) => {
      const employees = snapshot.docs.map((doc) => ({
        ...doc.data(),
        employeeId: doc.id,
      })) as Employee[];
      callback(employees);
    },
    onError
  );
}

/** 직원 추가 */
export async function addEmployee(data: Omit<Employee, 'employeeId' | 'updatedAt'>) {
  return addDoc(collection(db, COLLECTION), {
    ...data,
    updatedAt: Timestamp.now(),
  });
}

/** 직원 정보 수정 */
export async function updateEmployee(employeeId: string, data: Partial<Employee>) {
  const docRef = doc(db, COLLECTION, employeeId);
  return updateDoc(docRef, {
    ...data,
    updatedAt: Timestamp.now(),
  });
}
