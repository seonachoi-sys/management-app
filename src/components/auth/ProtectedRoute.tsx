import React from 'react';
import { useAuth } from '../../hooks/useAuth';
import { hasAccess, AccessLevel } from '../../config/accessControl';
import AccessDenied from './AccessDenied';

interface ProtectedRouteProps {
  requiredAccess: AccessLevel;
  children: React.ReactNode;
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ requiredAccess, children }) => {
  const { user } = useAuth();

  if (!user || !hasAccess(user.email, requiredAccess)) {
    return <AccessDenied />;
  }

  return <>{children}</>;
};

export default ProtectedRoute;
