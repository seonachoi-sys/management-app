import { useState, useEffect } from 'react';
import { Employee } from '../types/project';
import { subscribeEmployees } from '../services/employeeService';

export function useEmployees() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = subscribeEmployees(
      (data) => {
        setEmployees(data);
        setLoading(false);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      }
    );
    return unsub;
  }, []);

  return { employees, loading, error };
}
