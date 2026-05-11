import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface PayComponentDef {
  id: string;
  name: string;
  code: string;
  category: 'earning' | 'deduction' | 'benefit';
  component_type: 'fixed' | 'variable' | 'formula' | 'overtime';
  default_amount: number | null;
  is_statutory: boolean;
  is_taxable: boolean;
  sequence: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export function usePayComponents() {
  const [components, setComponents] = useState<PayComponentDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from('pay_component_defs')
      .select('*')
      .order('category')
      .order('sequence');
    if (err) {
      setError(err.message);
      setComponents([]);
    } else {
      setComponents((data ?? []) as PayComponentDef[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { components, loading, error, refetch };
}
