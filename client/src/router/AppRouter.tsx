import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import DashboardPage from '../pages/DashboardPage'; // Importa o Dashboard
import GerarPedidoPage from '../pages/GerarPedidoPage';
import { isLoggedIn, logout } from '../services/authService'; 
import LoginPage from '../pages/LoginPage';
import VendasPage from '../pages/VendasPage';
import { ToastContainer } from 'react-toastify';



const ProtectedRoute: React.FC = () => {
    // Se o usuário não estiver logado, redireciona para o login
    if (!isLoggedIn()) {
        return <Navigate to="/login" replace />;
    }
    
    return <Outlet />; 
};

// --- Roteador Principal ---
const AppRouter: React.FC = () => {
    return (
        <Router>
            <ToastContainer position="top-right" autoClose={5000} />
            <Routes>
                {/* Rota de Login */}
                <Route path="/login" element={<LoginPage />} />
                
                {/* ROTA PROTEGIDA (PAI) */}
                <Route element={<ProtectedRoute />}>
                    <Route path="/dashboard" element={<DashboardPage />} />

                    <Route path="/vendas" element={<VendasPage />} />
                    
                    <Route path="/gerar-pedido" element={<GerarPedidoPage />} />

                    <Route path="/" element={<Navigate to="/dashboard" replace />} />
                    
                    
                </Route>
                
                <Route path="*" element={<h1 className="text-center mt-5 text-gray-500">404 - Página Não Encontrada</h1>} />
            </Routes>
        </Router>
    );
};

export default AppRouter;
