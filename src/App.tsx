import { AppProvider, useApp } from '@/context/AppContext';
import LoginScreen from '@/components/LoginScreen';
import AppLayout from '@/components/AppLayout';

function AppContent() {
  const { currentUser } = useApp();
  return currentUser ? <AppLayout /> : <LoginScreen />;
}

const App = () => (
  <AppProvider>
    <AppContent />
  </AppProvider>
);

export default App;
