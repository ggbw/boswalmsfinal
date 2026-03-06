import { useState, useEffect, useMemo } from 'react';
import { useApp } from '@/context/AppContext';
import { supabase } from '@/integrations/supabase/client';

export default function PhotoGalleryPage() {
  const { db } = useApp();
  const [search, setSearch] = useState('');
  const [classFilter, setClassFilter] = useState('');
  const [photoMap, setPhotoMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  // Load all thumbnails from bucket
  useEffect(() => {
    (async () => {
      const { data: files } = await supabase.storage.from('student-photos').list('', { limit: 2000 });
      if (!files) { setLoading(false); return; }

      // List folders (student ids)
      const folders = files.filter(f => f.id && !f.name.includes('.'));
      const map: Record<string, string> = {};

      // For each student folder, get thumbnail
      for (const folder of folders) {
        const { data: inner } = await supabase.storage.from('student-photos').list(folder.name, { limit: 10 });
        const thumb = inner?.find(f => f.name === 'thumb.webp');
        if (thumb) {
          const { data: urlData } = supabase.storage.from('student-photos').getPublicUrl(`${folder.name}/thumb.webp`);
          map[folder.name] = urlData.publicUrl;
        } else {
          // fallback to full photo
          const photo = inner?.find(f => f.name === 'photo.webp');
          if (photo) {
            const { data: urlData } = supabase.storage.from('student-photos').getPublicUrl(`${folder.name}/photo.webp`);
            map[folder.name] = urlData.publicUrl;
          }
        }
      }
      setPhotoMap(map);
      setLoading(false);
    })();
  }, []);

  const filtered = useMemo(() => {
    return db.students.filter(s => {
      if (classFilter && s.classId !== classFilter) return false;
      if (search && !s.name.toLowerCase().includes(search.toLowerCase()) && !s.studentId.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [db.students, classFilter, search]);

  return (
    <>
      <div className="page-header">
        <div className="page-title">Student Photo Gallery</div>
      </div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="form-row cols2">
          <div className="form-group">
            <label>Search</label>
            <input className="form-input" placeholder="Search by name or ID..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Filter by Class</label>
            <select className="form-input" value={classFilter} onChange={e => setClassFilter(e.target.value)}>
              <option value="">All Classes</option>
              {db.classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text2)' }}>Loading photos...</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 16 }}>
          {filtered.map(s => {
            const hasPhoto = !!photoMap[s.id];
            const cls = db.classes.find(c => c.id === s.classId);
            return (
              <div key={s.id} className="card" style={{ padding: 12, textAlign: 'center' }}>
                <div style={{
                  width: 100, height: 100, borderRadius: 12, margin: '0 auto 8px',
                  overflow: 'hidden', background: 'var(--bg3)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {hasPhoto ? (
                    <img src={photoMap[s.id]} alt={s.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <span style={{ fontSize: 32, fontWeight: 700, color: 'var(--text2)' }}>{s.name[0]}</span>
                  )}
                </div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text1)' }}>{s.name}</div>
                <div style={{ fontSize: 10, color: 'var(--text2)' }}>{s.studentId}</div>
                {cls && <div style={{ fontSize: 10, color: 'var(--text2)' }}>{cls.name}</div>}
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: 40, color: 'var(--text2)' }}>No students found.</div>
          )}
        </div>
      )}
    </>
  );
}
