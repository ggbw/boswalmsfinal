import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import logoImg from '@/assets/logo.jpg';

export default function LoginScreen() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    setError('');
    setLoading(true);
    const { error } = await signIn(email.trim(), password);
    if (error) setError(error);
    setLoading(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => { if (e.key === 'Enter') handleLogin(); };

  return (
    <div className="login-bg">
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(160deg,rgba(11,31,74,0.88) 0%,rgba(5,12,30,0.72) 45%,rgba(11,31,74,0.88) 100%)', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse at center,transparent 30%,rgba(0,0,0,0.45) 100%)', pointerEvents: 'none' }} />
      <div style={{ position: 'relative', zIndex: 1 }}>
        <div className="login-card">
          <img src={logoImg} alt="Boswa CIB Logo" style={{ width: 160, marginBottom: 12, display: 'block', marginLeft: 'auto', marginRight: 'auto' }} />
          <div className="login-title">Boswa CIB</div>
          <div className="login-sub">School Management System</div>
          {error && (
            <div style={{ background: 'rgba(220,38,38,0.15)', border: '1px solid rgba(220,38,38,0.3)', borderRadius: 8, padding: '8px 12px', marginBottom: 12, color: '#f87171', fontSize: 12 }}>
              {error}
            </div>
          )}
          <input className="login-input" placeholder="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={handleKeyDown} />
          <input className="login-input" type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={handleKeyDown} />
          <button className="login-btn" onClick={handleLogin} disabled={loading}>
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
          <div style={{ fontSize: 10, color: '#484f58', marginTop: 16 }}>
            Admin: admin@boswa.ac.bw / BoswaAdmin2026!
          </div>
        </div>
      </div>
    </div>
  );
}
