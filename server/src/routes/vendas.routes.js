// A rota apenas aponta para o controller
const express = require('express');
const router = express.Router();
const VendasController = require('../controllers/VendasController');
const authMiddleware = require('../middlewares/authMiddleware');

router.get('/', VendasController.getVendasController);

router.get('/listarVendas', 
    authMiddleware.protect, 
    VendasController.listarVendas
);

router.put('/coletado/:idVenda',
    authMiddleware.protect,
    VendasController.marcarComoColetada
);



module.exports = router;