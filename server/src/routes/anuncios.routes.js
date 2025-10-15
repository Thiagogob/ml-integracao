// A rota apenas aponta para o controller
const express = require('express');
const router = express.Router();
const AnunciosController = require('../controllers/AnunciosController');

router.get('/', AnunciosController.getAnunciosSkusController);

router.put('/atualizar-estoque-de-um-anuncio', AnunciosController.putAnunciosEstoqueController);

module.exports = router;