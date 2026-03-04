import { useApp } from '@/context/AppContext';
export default function ClassesPage() {
  const { db } = useApp();
  return (<>
    <div className="page-header"><div className="page-title">Classes</div></div>
    <div className="card"><div className="table-wrap"><table><thead><tr><th>Class Name</th><th>Type</th><th>Year/Sem</th><th>Cal Year</th><th>Lecturer</th><th>Students</th><th>Status</th></tr></thead>
      <tbody>{db.classes.map(cls => {
        const prog = db.config.programmes.find(p => p.id === cls.programme);
        const studCount = db.students.filter(s => s.classId === cls.id).length;
        return <tr key={cls.id}><td className="td-name">{cls.name}</td><td>{prog?.type}</td><td>Year {cls.year} · Sem {cls.semester}</td><td>{cls.calYear}</td><td>{cls.lecturer}</td><td style={{fontFamily:"'JetBrains Mono',monospace"}}>{studCount}</td><td><span className="badge badge-active">Active</span></td></tr>;
      })}</tbody></table></div></div>
  </>);
}
