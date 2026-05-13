import {
  collection,
  doc,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  query,
  orderBy,
  Timestamp,
  Unsubscribe,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { Project } from '../types/project';

const COLLECTION = 'projects';

/** 과제 목록 실시간 구독 */
export function subscribeProjects(
  callback: (projects: Project[]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  const q = query(collection(db, COLLECTION), orderBy('shortName'));
  return onSnapshot(
    q,
    (snapshot) => {
      const projects = snapshot.docs.map((doc) => ({
        ...doc.data(),
        projectId: doc.id,
      })) as Project[];
      callback(projects);
    },
    onError
  );
}

/** 과제 상세 조회 */
export async function getProject(projectId: string): Promise<Project | null> {
  const docRef = doc(db, COLLECTION, projectId);
  const docSnap = await getDoc(docRef);
  if (!docSnap.exists()) return null;
  return { ...docSnap.data(), projectId: docSnap.id } as Project;
}

/** 과제 추가 */
export async function addProject(data: Omit<Project, 'projectId' | 'createdAt' | 'updatedAt'>) {
  const now = Timestamp.now();
  return addDoc(collection(db, COLLECTION), {
    ...data,
    createdAt: now,
    updatedAt: now,
  });
}

/** 과제 수정 */
export async function updateProject(projectId: string, data: Partial<Project>) {
  const docRef = doc(db, COLLECTION, projectId);
  return updateDoc(docRef, {
    ...data,
    updatedAt: Timestamp.now(),
  });
}

/** 과제 삭제 */
export async function deleteProject(projectId: string) {
  const docRef = doc(db, COLLECTION, projectId);
  return deleteDoc(docRef);
}
