const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer({ dest: 'uploads/' }); // Define a pasta de destino para os arquivos

const StockController = require('../controllers/StockController');

// A rota recebe o middleware 'upload.single'
router.post('/upload-pdf', upload.single('stock'), StockController.uploadStockController);

module.exports = router;