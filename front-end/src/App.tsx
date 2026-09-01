import { Routes, Route } from 'react-router-dom';
import ProtectedRoute from './routes/ProtectedRoute';
import Layout from './pages/components/Layout';
import ChatWindow from "./pages/components/ChatWindow";
import LoginForm from "./components/auth/login/LoginForm";
import RegisterForm from "./components/auth/register/RegisterForm";
import ForgotPasswordForm from "./components/auth/forgot-password/ForgotPassword";
import ResetPasswordForm from "./components/auth/forgot-password/ResetPasswordForm";

function App() {

    return (
        <Routes>
            <Route path="/" element={<LoginForm />} />
            <Route path="/register" element={<RegisterForm />} />
            <Route path="/forgot-password" element={<ForgotPasswordForm />} />
            <Route path="/reset-password" element={<ResetPasswordForm />} />
            <Route
                path="/dashboard"
                element={
                    <ProtectedRoute>
                        <Layout />
                    </ProtectedRoute>
                }
            >
                <Route index element={<ChatWindow />} />
            </Route>
        </Routes>
    );
}

export default App;