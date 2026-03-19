import { useState, useEffect } from 'react';
import type { Member } from '../types';
import { subscribeMembers } from '../services/memberService';

export function useMembers() {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = subscribeMembers(
      (data) => {
        setMembers(data);
        setLoading(false);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      },
    );
    return unsub;
  }, []);

  return { members, loading, error };
}
