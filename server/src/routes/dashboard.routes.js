const express = require('express');
const router = express.Router();
const DashboardController = require('../controllers/DashboardController'); 
const authMiddleware = require('../middlewares/authMiddleware'); 

// Endpoint: GET /api/dashboard/summary
// Protegido: Apenas usuários com JWT válido podem acessar
router.get(
    '/summary', 
    authMiddleware.protect, // Proteção JWT
    DashboardController.getDashboardSummaryController
);

module.exports = router;