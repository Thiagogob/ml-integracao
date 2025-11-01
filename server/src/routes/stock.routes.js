const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer({ dest: 'uploads/' }); // Define a pasta de destino para os arquivos
const authMiddleware = require('../middlewares/authMiddleware');

const StockController = require('../controllers/StockController');

// A rota recebe o middleware 'upload.single'
router.post('/upload-pdf', upload.single('stock'), StockController.uploadStockController);

router.post('/upload-pdf-sul', 
    upload.single('stock_sul'), // Use um nome de campo diferente no form se necessário, ex: 'stock_sul'
    StockController.uploadStockSulController
);

module.exports = router;