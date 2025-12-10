// PDF Parser - Extracts financial data from SEC filings

export const config = {
  api: {
    bodyParser: false,
    responseLimit: false,
  },
};

// Suppress scribe.js CDN timeout errors
if (typeof process !== 'undefined') {
  const originalListeners = process.listeners('uncaughtException');
  process.removeAllListeners('uncaughtException');
  process.on('uncaughtException', (error) => {
    // Suppress ETIMEDOUT from scribe.js CDN downloads
    if (error.code === 'ETIMEDOUT' && error.syscall === 'write') {
      return; // Silently ignore
    }
    // Re-throw other errors
    originalListeners.forEach(listener => listener(error));
  });
}

// Helper to add timeout to promises
function withTimeout(promise, timeoutMs, errorMsg) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(errorMsg)), timeoutMs)
    ),
  ]);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let scribeInstance = null;
  let tempFilePath = null;

  try {
    const formidable = (await import('formidable')).default;
    const fs = await import('fs');
    const scribe = (await import('scribe.js-ocr')).default;
    scribeInstance = scribe;
    
    const form = formidable({
      maxFileSize: 50 * 1024 * 1024,
    });

    // Wrap form.parse in a Promise to ensure handler waits
    await new Promise((resolve, reject) => {
      form.parse(req, async (err, fields, files) => {
        if (err) {
          res.status(400).json({ error: 'Failed to parse form' });
          return resolve();
        }

        try {
        const file = files.file?.[0] || files.file;
        
        if (!file) {
          return res.status(400).json({ error: 'No file provided' });
        }

        tempFilePath = file.filepath;
        const fileBuffer = fs.readFileSync(file.filepath);
        const fileName = file.originalFilename || file.newFilename || 'document.pdf';
        const fileBlob = new Blob([fileBuffer], { type: 'application/pdf' });
        Object.defineProperty(fileBlob, 'name', { value: fileName });

        // Initialize OCR with timeout (30s) and suppress external resource errors
        try {
          await withTimeout(
            scribe.init({ ocr: true, font: false }),
            30000,
            'OCR initialization timed out'
          );
        } catch (initError) {
          // Retry without font downloads to avoid CDN timeouts
          await withTimeout(
            scribe.init({ ocr: true, font: false }),
            10000,
            'OCR initialization failed'
          );
        }

        // Import files with timeout (30s)
        await withTimeout(
          scribe.importFiles([fileBlob]),
          30000,
          'PDF import timed out'
        );

        if (!scribe.inputData || (!scribe.inputData.pdfMode && !scribe.inputData.imageMode)) {
          throw new Error('Failed to import PDF file');
        }

        // Run OCR if needed with timeout (60s for recognition)
        const skipRec = scribe.inputData.pdfMode && scribe.inputData.pdfType === 'text';
        if (!skipRec) {
          await withTimeout(
            scribe.recognize({ langs: ['eng'] }),
            60000,
            'OCR recognition timed out'
          );
        }

        // Extract text with timeout (10s)
        const extractedText = await withTimeout(
          scribe.exportData('txt'),
          10000,
          'Text extraction timed out'
        );

        // Extract position data
        const ocrWords = [];
        try {
          const ocrData = scribe.data?.ocr || scribe.inputData?.ocr || scribe.data?.pageMetrics;
          
          if (ocrData && Array.isArray(ocrData)) {
            for (let pageIndex = 0; pageIndex < ocrData.length; pageIndex++) {
              const page = ocrData[pageIndex];
              const lines = page?.lines || page?.textLines || [];
              
              for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
                const line = lines[lineIndex];
                const words = line?.words || [];
                
                for (const word of words) {
                  if (word && word.text) {
                    ocrWords.push({
                      text: word.text,
                      bbox: {
                        x: word.bbox?.left || word.left || 0,
                        y: word.bbox?.top || word.top || 0,
                        width: ((word.bbox?.right || word.right || 0) - (word.bbox?.left || word.left || 0)),
                        height: ((word.bbox?.bottom || word.bottom || 0) - (word.bbox?.top || word.top || 0)),
                      },
                      confidence: word.confidence || 80,
                      line: lineIndex,
                      page: pageIndex,
                    });
                  }
                }
              }
            }
          }
        } catch (e) {
          // Position data unavailable
        }

        // Parse financial data
        const { AnalystParser, convertToLegacyFormat } = await import('../../lib/parser.ts');
        const parser = new AnalystParser(extractedText, ocrWords);
        const data = await parser.parse();
        const parsedData = convertToLegacyFormat(data);

        // Cleanup
          try {
            if (tempFilePath) {
              fs.unlinkSync(tempFilePath);
            }
          } catch (e) {
            // Ignore cleanup errors
          }

          try {
            await withTimeout(scribe.clear(), 5000, 'Cleanup timed out');
          } catch (e) {
            // Ignore cleanup errors
          }

          res.status(200).json({
            success: true,
            data: parsedData,
            advanced: data,
            meta: {
              text_length: extractedText.length,
              ocr_words: ocrWords.length,
              tables_detected: data.tables_detected.length,
              validation_warnings: data.validation_warnings.length,
            }
          });
          resolve();

        } catch (error) {
          // Cleanup on error
          try {
            if (tempFilePath) {
              fs.unlinkSync(tempFilePath);
            }
          } catch (e) {
            // Ignore
          }

          try {
            if (scribeInstance) {
              await withTimeout(scribeInstance.clear(), 5000, 'Cleanup timed out');
            }
          } catch (e) {
            // Ignore
          }

          // Always return a response
          if (!res.headersSent) {
            res.status(500).json({
              success: false,
              error: error.message || 'PDF parsing failed',
              details: process.env.NODE_ENV === 'development' ? error.stack : undefined
            });
          }
          resolve();
        }
      });
    });

  } catch (error) {
    // Always return a response
    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        error: error.message || 'Server error'
      });
    }
  }
}

