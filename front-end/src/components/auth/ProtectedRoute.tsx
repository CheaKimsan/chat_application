import { Navigate, useLocation } from 'react-router-dom';
import { JSX } from 'react/jsx-runtime';

const isAuthenticated = () => Boolean(localStorage.getItem('token'));

interface ProtectedRouteProps {
    children: JSX.Element;
}

export default function ProtectedRoute({ children }: ProtectedRouteProps) {
    const location = useLocation();

    if (!isAuthenticated()) {
        return <Navigate to="/" replace state={{ from: location }} />;

    }

    return children;
}
