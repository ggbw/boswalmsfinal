import { useState } from 'react';
import { useApp } from '@/context/AppContext';
import { roleCredentials } from '@/data/db';
import logoImg from '@/assets/logo.jpg';

const roles = ['admin', 'hod', 'hoy', 'lecturer', 'student'] as const;

export default function LoginScreen() {
  const { db, setCurrentUser, navigate, toast } = useApp();
  const [selectedRole, setSelectedRole] = useState('admin');
  const [username, setUsername] = useState(roleCredentials.admin.username);
  const [password, setPassword] = useState(roleCredentials.admin.password);

  const handleRoleClick = (role: string) => {
    setSelectedRole(role);
    const creds = roleCredentials[role] || { username: role, password: 'password' };
    setUsername(creds.username);
    setPassword(creds.password);
  };

  const handleLogin = () => {
    let user = db.users.find(u => u.username === username.trim() && u.password === password);
    if (!user) {
      const stu = db.students.find(s => s.name.split(' ')[0].toLowerCase() === username.trim().toLowerCase());
      if (stu && password === 'password') {
        user = { id: 'stu_' + stu.id, username, password: 'password', role: 'student', name: stu.name, changed: false, dept: '', studentRef: stu.id, studentId: stu.studentId };
      }
    }
    if (!user) { toast('Invalid username or password', 'error'); return; }
    setCurrentUser(user);
    navigate('dashboard');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => { if (e.key === 'Enter') handleLogin(); };

  return (
    <div className="login-bg">
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(160deg,rgba(11,31,74,0.88) 0%,rgba(5,12,30,0.72) 45%,rgba(11,31,74,0.88) 100%)', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse at center,transparent 30%,rgba(0,0,0,0.45) 100%)', pointerEvents: 'none' }} />
      <div style={{ position: 'relative', zIndex: 1 }}>
        <div className="login-card">
          <img src={logoImg} alt="Boswa CIB Logo" style={{ width: 90, height: 90, borderRadius: 16, objectFit: 'cover', marginBottom: 8 }} />
          <div className="login-title">Boswa CIB</div>
          <div className="login-sub">School Management System</div>
          <div className="login-role">
            {roles.map(r => (
              <button key={r} className={`login-role-btn ${selectedRole === r ? 'active' : ''}`} onClick={() => handleRoleClick(r)}>
                {r.charAt(0).toUpperCase() + r.slice(1)}
              </button>
            ))}
          </div>
          <input className="login-input" placeholder="Username" value={username} onChange={e => setUsername(e.target.value)} onKeyDown={handleKeyDown} />
          <input className="login-input" type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={handleKeyDown} />
          <button className="login-btn" onClick={handleLogin}>Sign In</button>
          <div style={{ fontSize: 10, color: '#484f58', marginTop: 16 }}>Demo: select a role above, credentials auto-fill</div>
        </div>
      </div>
    </div>
  );
}
