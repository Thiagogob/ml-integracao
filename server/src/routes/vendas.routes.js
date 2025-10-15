// A rota apenas aponta para o controller
const express = require('express');
const router = express.Router();
const VendasController = require('../controllers/VendasController');

router.get('/', VendasController.getVendasController);

module.exports = router;