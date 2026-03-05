import { AuthProvider, useAuth } from '@/hooks/useAuth';
import { AppProvider } from '@/context/AppContext';
import LoginScreen from '@/components/LoginScreen';
import AppLayout from '@/components/AppLayout';

function AuthGate() {
  const { user, loading } = useAuth();
  
  if (loading) {
    return (
      <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', background: '#0d1117', color: '#e6edf3' }}>
        <div style={{ fontSize: 14 }}>Loading...</div>
      </div>
    );
  }

  if (!user) return <LoginScreen />;

  return (
    <AppProvider>
      <AppLayout />
    </AppProvider>
  );
}

const App = () => (
  <AuthProvider>
    <AuthGate />
  </AuthProvider>
);

export default App;
