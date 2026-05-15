import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { AppProvider } from "@/context/AppProvider";
import { FormPersistenceProvider } from "@/context/hr/FormPersistenceContext";
import LoginScreen from "@/components/LoginScreen";
import AppLayout from "@/components/AppLayout";
import PublicApplyPage from "@/pages/PublicApplyPage";
import ApplicantPortal from "@/pages/ApplicantPortal";
import type { User } from "@/data/db";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      retry: 1,
    },
  },
});

function AuthGate() {
  const { user, profile, role, loading, signOut } = useAuth();

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          height: "100vh",
          alignItems: "center",
          justifyContent: "center",
          background: "#0d1117",
          color: "#e6edf3",
        }}
      >
        <div style={{ fontSize: 14 }}>Loading...</div>
      </div>
    );
  }

  if (!user || !profile) return <LoginScreen />;

  const staffRoles = ["admin", "super_admin", "hr", "manager", "employee", "hod", "hoy", "lecturer", "student"];

  // Applicants get their own portal — not the full SMS
  if (role === "applicant" || !role || !staffRoles.includes(role)) {
    return <ApplicantPortal userId={user.id} onSignOut={signOut} />;
  }

  const authUser: User = {
    id: profile.user_id,
    username: profile.email || "",
    password: "",
    role: role,
    name: profile.name,
    changed: false,
    email: profile.email || "",
    dept: profile.dept || "",
    code: profile.code || "",
    studentRef: profile.student_ref || "",
    studentId: profile.student_id || "",
  };

  const initialPage =
    role === "hr"
      ? "hr-dashboard"
      : role === "manager" || role === "employee"
        ? "my-employee-file"
        : "dashboard";

  return (
    <AppProvider authUser={authUser} onSignOut={signOut} initialPage={initialPage}>
      <FormPersistenceProvider>
        <AppLayout />
      </FormPersistenceProvider>
    </AppProvider>
  );
}

const App: React.FC = () => {
  if (window.location.pathname === "/apply") {
    return (
      <QueryClientProvider client={queryClient}>
        <PublicApplyPage />
      </QueryClientProvider>
    );
  }
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AuthGate />
      </AuthProvider>
    </QueryClientProvider>
  );
};

export default App;
