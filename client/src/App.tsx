import { Routes, Route } from "react-router-dom";
import { useTheme } from "./hooks/useTheme";
import Landing from "./pages/Landing";
import PatientLogin from "./pages/patient/PatientLogin";
import PatientDashboard from "./pages/patient/PatientDashboard";
import DoctorLogin from "./pages/doctor/DoctorLogin";
import DoctorDashboard from "./pages/doctor/DoctorDashboard";
import DatabaseViewer from "./pages/DatabaseViewer";

import { LiveUpdatesProvider } from "./context/LiveUpdatesContext";

function App() {
  const { theme } = useTheme();

  return (
    <div data-theme={theme}>
      <LiveUpdatesProvider>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/user/login" element={<PatientLogin />} />
          <Route path="/user" element={<PatientDashboard />} />
          <Route path="/doctor/login" element={<DoctorLogin />} />
          <Route path="/doctor" element={<DoctorDashboard />} />
          <Route path="/database" element={<DatabaseViewer />} />
        </Routes>
      </LiveUpdatesProvider>
    </div>
  );
}

export default App;