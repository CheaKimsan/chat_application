import { Routes, Route } from 'react-router-dom';
import LoginForm from './components/auth/LoginForm';
import ProtectedRoute from './components/auth/ProtectedRoute';
import Layout from './pages/components/Layout';
import ChatWindow from "./pages/components/ChatWindow";
import RegisterForm from './components/auth/RegisterForm';
import ForgotPasswordForm from './components/auth/ForgotPassword';
import ResetPasswordForm from './components/auth/ResetPasswordForm';

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