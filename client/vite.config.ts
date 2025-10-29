import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'



// https://vite.dev/config/
export default defineConfig({
  plugins: [tailwindcss(), react()],
  
  // --- CONFIGURAÇÃO DO PROXY AQUI ---
  server: {
    // A porta 5173 é a porta padrão do frontend Vite
    port: 5173,
    
    proxy: {
      // Quando o frontend chamar '/api/qualquer-coisa'
      '/api': {
        // Redireciona para o seu servidor Node.js
        target: 'http://localhost:3001', 
        
        changeOrigin: true,
        
        // Opcional: Para segurança
        secure: false,
      },
    },
  },

});
