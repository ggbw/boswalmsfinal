import { useApp } from '@/context/AppContext';
export default function AdmissionsPage() {
  const { db, setDb, toast } = useApp();
  const approve = (id: string) => { setDb(prev => ({ ...prev, admissionEnquiries: prev.admissionEnquiries.map(a => a.id === id ? { ...a, status: 'approved' } : a) })); toast('Admission approved!', 'success'); };
  return (<>
    <div className="page-header"><div className="page-title">Admission Enquiries</div></div>
    <div className="card"><div className="table-wrap"><table><thead><tr><th>Name</th><th>Programme</th><th>Applied</th><th>Status</th><th>Action</th></tr></thead>
      <tbody>{db.admissionEnquiries.map(a=><tr key={a.id}><td className="td-name">{a.name}</td><td>{a.programme}</td><td>{a.date}</td><td><span className="badge badge-pending">{a.status}</span></td><td><button className="btn btn-green btn-sm" onClick={()=>approve(a.id)}>✓ Approve</button></td></tr>)}</tbody>
    </table></div></div>
  </>);
}
