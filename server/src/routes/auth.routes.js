// A rota apenas aponta para o controller
const express = require('express');
const router = express.Router();
const AuthController = require('../controllers/AuthController');
const authMiddleware = require('../middlewares/authMiddleware');

router.post('/', AuthController.login);


module.exports = router;