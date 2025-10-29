import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import DashboardPage from '../pages/DashboardPage'; // Importa o Dashboard
import { isLoggedIn, logout } from '../services/authService'; // Sua lógica de autenticação
import LoginPage from '../pages/LoginPage';
import VendasPage from '../pages/VendasPage';



// --- Componente Auxiliar para Proteção de Rota ---

const ProtectedRoute: React.FC = () => {
    // Se o usuário não estiver logado, redireciona para o login
    if (!isLoggedIn()) {
        return <Navigate to="/login" replace />;
    }
    
    // CRÍTICO: Se estiver logado, o <Outlet /> renderiza o componente filho (o Dashboard)
    return <Outlet />; 
};

// --- Roteador Principal ---
const AppRouter: React.FC = () => {
    return (
        <Router>
            <Routes>
                {/* Rota de Login */}
                <Route path="/login" element={<LoginPage />} />
                
                {/* ROTA PROTEGIDA (PAI) */}
                <Route element={<ProtectedRoute />}>
                    {/* A Rota do Dashboard agora é filha da ProtectedRoute */}
                    <Route path="/dashboard" element={<DashboardPage />} />

                    {/*Rota Protegida da Lista de Vendas */}
                    <Route path="/vendas" element={<VendasPage />} />
                    
                    {/* Rota padrão para / se estiver logado, redireciona para dashboard */}
                    <Route path="/" element={<Navigate to="/dashboard" replace />} />
                    
                    {/* Aqui você adicionaria outras rotas protegidas */}
                </Route>
                
                {/* Rota para páginas não encontradas */}
                <Route path="*" element={<h1 className="text-center mt-5 text-gray-500">404 - Página Não Encontrada</h1>} />
            </Routes>
        </Router>
    );
};

export default AppRouter;
