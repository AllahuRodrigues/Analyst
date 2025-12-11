// PDF Parser - Extracts financial data from SEC filings

export const config = {
  api: {
    bodyParser: false,
    responseLimit: false,
    externalResolver: true,
  },
  // Vercel serverless function timeout - max 60s on Hobby, 300s on Pro
  maxDuration: 300, // Use maximum available (300s for Pro, will be capped at 60s for Hobby)
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
  // Set timeout for the entire request (50s to leave room for response)
  const requestTimeout = setTimeout(() => {
    if (!res.headersSent) {
      res.status(504).json({
        success: false,
        error: 'Request timeout - PDF processing took too long. Try a smaller file or text-based PDF.',
      });
    }
  }, 50000); // 50 seconds total timeout

  if (req.method !== 'POST') {
    clearTimeout(requestTimeout);
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
        
        const fileStats = fs.statSync(tempFilePath);
        const fileSizeMB = fileStats.size / (1024 * 1024);
        
        // Warn about large files (but still process)
        if (fileSizeMB > 20) {
          console.warn(`Large file detected: ${fileSizeMB.toFixed(2)}MB - may timeout on serverless`);
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

        // OCR init with timeout - reduce timeout for faster failure on serverless
        try {
          await withTimeout(
            scribe.init({ ocr: true, font: false }),
            8000, // Reduced from 15s to 8s
            'OCR initialization timed out'
          );
        } catch (initError) {
          // Skip OCR entirely if init fails - faster for text-based PDFs
          console.warn('OCR init failed, will try text extraction only');
        }

        // Import PDF with timeout - reduce for serverless limits
        await withTimeout(
          scribe.importFiles([fileBlob]),
          15000, // Reduced from 20s to 15s
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
          // Scanned PDF - limit OCR to first 30 pages for speed on serverless
          const maxOcrPages = Math.min(scribe.inputData?.numPages || 200, 30);
          try {
            await withTimeout(
              scribe.recognize({ 
                langs: ['eng'],
                pageRange: [0, maxOcrPages - 1] // Only OCR first 30 pages
              }),
              30000, // Reduced from 45s to 30s for serverless
              'OCR recognition timed out'
            );
          } catch (ocrError) {
            // OCR failed but try to continue - parser might work with partial data
            console.warn('OCR recognition failed or timed out, continuing with available data');
          }
        }

        // Extract text from OCR results - faster timeout for serverless
        let extractedText = '';
        try {
          extractedText = await withTimeout(
            scribe.exportData('txt'),
            10000, // Reduced from 15s to 10s
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
              // Limit pages/lines even more aggressively for serverless - financials in first 20 pages
              const maxPages = Math.min(ocrData.length, 20); // Reduced from 50 to 20
              for (let pageIndex = 0; pageIndex < maxPages; pageIndex++) {
                const page = ocrData[pageIndex];
                const lines = page?.lines || page?.textLines || [];
                
                const maxLines = Math.min(lines.length, 300); // Reduced from 500 to 300
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
        
        // Parser timeout - reduce for serverless function limits
        const data = await withTimeout(
          parser.parse(),
          15000, // Reduced from 30s to 15s - parser should be fast
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

          clearTimeout(requestTimeout);
          if (!res.headersSent) {
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
          }
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

          clearTimeout(requestTimeout);
          // Always return a response
          if (!res.headersSent) {
            // Check if it's a timeout error
            if (error.message && error.message.includes('timeout')) {
              res.status(504).json({
                success: false,
                error: 'PDF processing timed out. The file may be too large or complex. Try uploading a smaller file or a text-based PDF.',
              });
            } else {
              res.status(500).json({
                success: false,
                error: error.message || 'PDF parsing failed',
                details: process.env.NODE_ENV === 'development' ? error.stack : undefined
              });
            }
          }
          resolve();
        }
      });
    });

  } catch (error) {
    clearTimeout(requestTimeout);
    console.error('Parse API top-level error:', error);
    // Always return a response
    if (!res.headersSent) {
      // Check if it's a timeout or forbidden error (Vercel timeout)
      if (error.message && (error.message.includes('timeout') || error.message.includes('Forbidden'))) {
        return res.status(504).json({
          success: false,
          error: 'Request timed out - PDF processing exceeded server limits. Try a smaller file or contact support.',
        });
      }
      return res.status(500).json({
        success: false,
        error: error.message || 'Server error',
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  }
}

