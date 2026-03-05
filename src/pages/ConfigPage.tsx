import { useApp } from '@/context/AppContext';
export default function ConfigPage() {
  const { db, setDb, toast, showModal, closeModal } = useApp();
  const progRows = db.config.programmes.map(p => <div key={p.id} className="info-row"><span className="info-label">{p.name}</span><span className="info-val">{p.type} · {p.years}yr · {p.semesters}sem/yr</span></div>);
  return (<>
    <div className="page-header"><div className="page-title">System Configuration</div></div>
    <div className="two-col" style={{marginBottom:16}}>
      <div className="card"><div className="card-title"><span><i className="fa-solid fa-graduation-cap"/> Programmes</span></div>{progRows}</div>
      <div className="card"><div className="card-title">🏢 Departments</div>{db.departments.map(d=><div key={d.id} className="info-row"><span className="info-label">{d.name}</span><span className="info-val">{d.hod}</span></div>)}</div>
    </div>
    <div className="card" style={{marginBottom:16}}>
      <div className="card-title"><span><i className="fa-solid fa-gear"/> Academic Year Settings</span></div>
      <div className="info-row"><span className="info-label">Current Year</span><span className="info-val">{db.config.currentYear}</span></div>
      <div className="info-row"><span className="info-label">Active Semester</span><span className="info-val">Semester {db.config.currentSemester}</span></div>
    </div>
  </>);
}
