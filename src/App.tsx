import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { AppProvider } from "@/context/AppContext";
import LoginScreen from "@/components/LoginScreen";
import AppLayout from "@/components/AppLayout";
import PublicApplyPage from "@/pages/PublicApplyPage";
import ApplicantPortal from "@/pages/ApplicantPortal";
import type { User } from "@/data/db";

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

  const staffRoles = ["admin", "hod", "hoy", "lecturer", "student"];

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

  return (
    <AppProvider authUser={authUser} onSignOut={signOut}>
      <AppLayout />
    </AppProvider>
  );
}

const App: React.FC = () => {
  if (window.location.pathname === "/apply") {
    return <PublicApplyPage />;
  }
  return (
    <AuthProvider>
      <AuthGate />
    </AuthProvider>
  );
};

export default App;
