import { useApp } from '@/context/AppContext';
import { supabase } from '@/integrations/supabase/client';
export default function NotificationsPage() {
  const { db, currentUser, setDb, toast, showModal, closeModal } = useApp();
  const isAdmin = currentUser?.role === 'admin';
  const deleteNotif = async (id: string) => {
    const { error } = await supabase.from('notifications').delete().eq('id', id);
    if (error) { toast(error.message, 'error'); return; }
    setDb(prev => ({ ...prev, notifications: prev.notifications.filter(n => n.id !== id) }));
    toast('Notification deleted', 'info');
  };
  const showAddNotif = () => {
    let title = '', body = '', priority = 'normal';
    showModal('Post Announcement', <div>
      <div className="form-group" style={{marginBottom:12}}><label>Title</label><input className="form-input" onChange={e=>title=e.target.value}/></div>
      <div className="form-group" style={{marginBottom:12}}><label>Message</label><textarea className="form-textarea" onChange={e=>body=e.target.value}/></div>
      <div className="form-group" style={{marginBottom:14}}><label>Priority</label><select className="form-select" onChange={e=>priority=e.target.value}><option value="normal">Normal</option><option value="high">High</option><option value="low">Low</option></select></div>
      <button className="btn btn-primary" onClick={()=>{if(!title){toast('Title required','error');return;}setDb(prev=>({...prev,notifications:[{id:'n'+Date.now(),title,body,date:new Date().toISOString().split('T')[0],priority,author:currentUser?.name||'Admin'},...prev.notifications]}));closeModal();toast('Announcement posted!','success');}}>Post Announcement</button>
    </div>);
  };
  return (<>
    <div className="page-header"><div className="page-title">Notifications & Announcements</div>{isAdmin&&<button className="btn btn-primary btn-sm" onClick={showAddNotif}>＋ Post Announcement</button>}</div>
    {db.notifications.map(n=>(
      <div key={n.id} className="card" style={{marginBottom:12}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
          <div style={{display:'flex',gap:10}}>
            <span style={{fontSize:20}}>{n.priority==='high'?<i className="fa-solid fa-circle-exclamation" style={{color:'#cf222e'}}/>:n.priority==='normal'?<i className="fa-solid fa-triangle-exclamation" style={{color:'#d4920a'}}/>:<i className="fa-solid fa-circle-check" style={{color:'#1a7f37'}}/>}</span>
            <div><div style={{fontWeight:700,fontSize:14}}>{n.title}</div><div style={{fontSize:12,color:'var(--text2)',marginTop:4}}>{n.body}</div><div style={{fontSize:10,color:'var(--text3)',marginTop:6}}>{n.date} · Posted by {n.author}</div></div>
          </div>
          {isAdmin&&<button className="btn btn-danger btn-sm" onClick={()=>deleteNotif(n.id)}>Delete</button>}
        </div>
      </div>
    ))}
  </>);
}
