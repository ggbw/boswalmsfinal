import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface HrDepartment {
  id: string;
  name: string;
  manager: string | null;
  parent_department: string | null;
  color: string | null;
  is_active: boolean;
  created_at: string;
}

export function useHrDepartments() {
  const [departments, setDepartments] = useState<HrDepartment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from('hr_departments')
      .select('*')
      .order('name');
    if (err) {
      setError(err.message);
      setDepartments([]);
    } else {
      setDepartments((data ?? []) as HrDepartment[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { departments, loading, error, refetch };
}
