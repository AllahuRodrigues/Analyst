// PDF Parser - Extracts financial data from SEC filings

export const config = {
  api: {
    bodyParser: false,
    responseLimit: false,
    externalResolver: true,
  },
};

// Suppress scribe.js CDN timeouts - they happen when it tries to download fonts, not a real error
if (typeof process !== 'undefined') {
  const originalListeners = process.listeners('uncaughtException');
  process.removeAllListeners('uncaughtException');
  process.on('uncaughtException', (error) => {
    if (error.code === 'ETIMEDOUT' && error.syscall === 'write') {
      return;
    }
    originalListeners.forEach(listener => listener(error));
  });
}
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
      keepExtensions: true,
      allowEmptyFiles: false,
      multiples: false,
    });

    // Wrap form.parse so handler doesn't return before parsing completes
    await new Promise((resolve) => {
      form.parse(req, async (err, fields, files) => {
        if (err) {
          console.error('Formidable parsing error:', err);
          if (!res.headersSent) {
            // Handle specific formidable errors
            let errorMessage = 'Failed to upload file';
            if (err.message) {
              if (err.message.includes('maxFileSize')) {
                errorMessage = 'File too large. Maximum size is 50MB.';
              } else if (err.message.includes('pattern') || err.message.includes('string')) {
                errorMessage = 'Invalid file format. Please upload a PDF file.';
              } else {
                errorMessage = err.message;
              }
            }
            
            res.status(400).json({ 
              success: false,
              error: errorMessage,
              details: process.env.NODE_ENV === 'development' ? err.stack : undefined
            });
          }
          return resolve();
        }

        try {
        // Handle both array and single file formats from formidable
        const file = Array.isArray(files.file) ? files.file[0] : files.file;
        
        if (!file || !file.filepath) {
          if (!res.headersSent) {
            res.status(400).json({ 
              success: false,
              error: 'No file provided or file upload failed' 
            });
          }
          return resolve();
        }

        tempFilePath = file.filepath;
        
        // Verify file exists and is readable
        if (!fs.existsSync(tempFilePath)) {
          throw new Error('Uploaded file not found on server');
        }
        
        const fileBuffer = fs.readFileSync(tempFilePath);
        if (!fileBuffer || fileBuffer.length === 0) {
          throw new Error('Uploaded file is empty');
        }
        
        const fileName = file.originalFilename || file.newFilename || 'document.pdf';
        
        // Verify it's a PDF
        if (!fileName.toLowerCase().endsWith('.pdf')) {
          throw new Error('Only PDF files are supported');
        }
        
        const fileBlob = new Blob([fileBuffer], { type: 'application/pdf' });
        Object.defineProperty(fileBlob, 'name', { value: fileName });

        // OCR init with timeout - scribe.js can hang if CDN is slow
        try {
          await withTimeout(
            scribe.init({ ocr: true, font: false }),
            15000,
            'OCR initialization timed out'
          );
        } catch (initError) {
          // Try once more with shorter timeout
          try {
            await withTimeout(
              scribe.init({ ocr: true, font: false }),
              10000,
              'OCR initialization failed'
            );
          } catch (retryError) {
            // Try text extraction even if OCR init fails (works for text-based PDFs)
            console.error('OCR init failed, will try text extraction only');
          }
        }

        // Import PDF with timeout - large files can take a while
        await withTimeout(
          scribe.importFiles([fileBlob]),
          20000,
          'PDF import timed out'
        );

        if (!scribe.inputData || (!scribe.inputData.pdfMode && !scribe.inputData.imageMode)) {
          throw new Error('Failed to import PDF file');
        }

        // Skip OCR for text-based PDFs - huge time saver (30-60 seconds)
        const skipRec = scribe.inputData.pdfMode && scribe.inputData.pdfType === 'text';
        
        if (skipRec) {
          // Text PDF - extract directly
        } else {
          // Scanned PDF - need OCR but it's slow, so use timeout
          try {
            await withTimeout(
              scribe.recognize({ langs: ['eng'] }),
              45000, // Reduced from 60s to 45s
              'OCR recognition timed out'
            );
          } catch (ocrError) {
            // OCR failed but try to continue - parser might work with partial data
            console.warn('OCR recognition failed or timed out, continuing with available data');
          }
        }

        // Extract text from OCR results
        let extractedText = '';
        try {
          extractedText = await withTimeout(
            scribe.exportData('txt'),
            15000,
            'Text extraction timed out'
          );
        } catch (extractError) {
          // Fallback: try alternate data sources if export fails
          if (scribe.inputData?.text) {
            extractedText = scribe.inputData.text;
          } else if (scribe.data?.text) {
            extractedText = scribe.data.text;
          } else {
            throw new Error('Failed to extract text from PDF');
          }
        }
        
        if (!extractedText || extractedText.trim().length === 0) {
          throw new Error('No text could be extracted from the PDF. The file may be image-only or corrupted.');
        }

        // Extract OCR word positions - optional but helps with row-by-row parsing
        const ocrWords = [];
        try {
          // Position data only exists if OCR ran (text PDFs don't have it)
          if (!skipRec) {
            const ocrData = scribe.data?.ocr || scribe.inputData?.ocr || scribe.data?.pageMetrics;
            
            if (ocrData && Array.isArray(ocrData)) {
              // Limit pages/lines - financials are always in first ~30 pages, full OCR is too slow
              const maxPages = Math.min(ocrData.length, 50);
              for (let pageIndex = 0; pageIndex < maxPages; pageIndex++) {
                const page = ocrData[pageIndex];
                const lines = page?.lines || page?.textLines || [];
                
                const maxLines = Math.min(lines.length, 500);
                for (let lineIndex = 0; lineIndex < maxLines; lineIndex++) {
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
          }
        } catch (e) {
          // No position data - parser falls back to pure text extraction
        }

        // Run financial parser (regex + row-by-row table reading)
        const { AnalystParser, convertToLegacyFormat } = await import('../../lib/parser.ts');
        const parser = new AnalystParser(extractedText, ocrWords.length > 0 ? ocrWords : undefined);
        
        // Parser timeout - shouldn't take long but protect against edge cases
        const data = await withTimeout(
          parser.parse(),
          30000,
          'Financial data parsing timed out'
        );
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
    console.error('Parse API top-level error:', error);
    // Always return a response
    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        error: error.message || 'Server error',
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  }
}

