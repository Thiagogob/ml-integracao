import React from 'react';
import './index.css';
import ReactDOM from 'react-dom/client';
import AppRouter from './router/AppRouter'; // Importe o Roteador
import 'react-toastify/dist/ReactToastify.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {/* Renderiza o Roteador Principal */}
    <AppRouter />
  </React.StrictMode>,
);