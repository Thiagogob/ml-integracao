// /server/src/services/pdf.service.js
const pdfParse = require('pdf-parse');

const parsePdf = async (fileBuffer) => {
  try {
    const data = await pdfParse(fileBuffer);
    const rawText = data.text;
    
    // Lógica para limpar o texto
    const cleanText = rawText
      .replace(/MODELOFOTOS ARO PCD ACABAMENTO[\s\S]*?@mkrrodas \| mkrrodas/g, '')
      .replace(/^\s*.*?\.jasper\)?\s*Pag\s*\/\s*$/gmi, '')
      .replace(/[^\S\r\n]+/g, ' ')
      .replace(/E F G M L B BRW KLinha:[\s\S]*$/, '');

    return cleanText;
  } catch (err) {
    console.error("Erro ao processar PDF:", err);
    throw new Error('Falha ao fazer o parsing do PDF');
  }
};

module.exports = { parsePdf };