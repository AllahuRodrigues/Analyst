// Advanced Financial Document Parser with Computer Vision & Position-Aware OCR
// Built entirely with local CV/OCR - no external AI APIs

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OCRWord {
  text: string;
  bbox: BoundingBox;
  confidence: number;
  line: number;
  page: number;
}

export interface TableCell {
  text: string;
  bbox: BoundingBox;
  row: number;
  col: number;
  isHeader: boolean;
}

export interface FinancialTable {
  title: string;
  headers: string[];
  rows: TableCell[][];
  bbox: BoundingBox;
  page: number;
  type: 'balance_sheet' | 'income_statement' | 'cash_flow' | 'unknown';
}

export interface ExtractionResult {
  value: number;
  source: string;
  confidence: number;
  page: number;
  bbox?: BoundingBox;
  context?: string;
}

export interface AdvancedFinancialDocumentSchema {
  metadata: {
    company_name: string;
    ticker: string;
    cik: string;
    period_end: string;
    filing_date: string;
    document_type: string;
    fiscal_year: string;
    fiscal_quarter: string;
  };
  financials: {
    assets: {
      total?: ExtractionResult;
      current?: ExtractionResult;
      cash?: ExtractionResult;
      marketable_securities?: ExtractionResult;
      accounts_receivable?: ExtractionResult;
      property_equipment?: ExtractionResult;
      goodwill?: ExtractionResult;
    };
    liabilities: {
      total?: ExtractionResult;
      current?: ExtractionResult;
      long_term_debt?: ExtractionResult;
      accounts_payable?: ExtractionResult;
    };
    equity: {
      total?: ExtractionResult;
      retained_earnings?: ExtractionResult;
    };
    revenues: {
      total?: ExtractionResult;
      cost_of_revenue?: ExtractionResult;
      gross_profit?: ExtractionResult;
    };
    expenses: {
      research_development?: ExtractionResult;
      sales_marketing?: ExtractionResult;
      general_administrative?: ExtractionResult;
      total_operating?: ExtractionResult;
    };
    income: {
      operating_income?: ExtractionResult;
      net_income?: ExtractionResult;
      earnings_per_share?: ExtractionResult;
    };
    cash_flow: {
      operating?: ExtractionResult;
      investing?: ExtractionResult;
      financing?: ExtractionResult;
      capex?: ExtractionResult;
      free_cash_flow?: ExtractionResult;
    };
  };
  tables_detected: FinancialTable[];
  extraction_confidence: number;
  validation_warnings: string[];
  extraction_log: string[];
}

export class AnalystParser {
  private words: OCRWord[] = [];
  private tables: FinancialTable[] = [];
  private rawText: string;
  private documentScale: { unit: string; multiplier: number } = { unit: 'millions', multiplier: 1000000 };
  private log: string[] = [];

  constructor(rawText: string, ocrWords?: OCRWord[]) {
    this.rawText = rawText;
    this.words = ocrWords || [];
  }

  // Main parsing pipeline
  public async parse(): Promise<AdvancedFinancialDocumentSchema> {
    this.log = [];
    this.logStep('Starting advanced financial document parsing');

    // Step 1: Detect document scale
    this.detectDocumentScale();

    // Step 2: Detect and extract tables
    if (this.words.length > 0) {
      this.detectTables();
    }

    // Step 3: Extract metadata
    const metadata = this.extractMetadata();

    // Step 4: Extract financial data with position awareness
    const financials = this.extractFinancials();

    // Step 4.5: Post-extraction cleanup (reject impossible values)
    this.cleanupImpossibleValues(financials);

    // Step 5: Validate extracted data
    const validation_warnings = this.validateFinancials(financials, metadata);

    // Step 6: Calculate confidence
    const extraction_confidence = this.calculateConfidence(financials, validation_warnings);

    return {
      metadata,
      financials,
      tables_detected: this.tables,
      extraction_confidence,
      validation_warnings,
      extraction_log: this.log,
    };
  }

  private logStep(message: string) {
    this.log.push(`[${new Date().toISOString()}] ${message}`);
  }

  // ==================== SCALE DETECTION ====================
  
  private detectDocumentScale() {
    const scalePatterns = [
      { pattern: /\((?:in|except per share amounts in)\s+millions\)/i, multiplier: 1000000, unit: 'millions' },
      { pattern: /\(in\s+thousands\)/i, multiplier: 1000, unit: 'thousands' },
      { pattern: /\(in\s+billions\)/i, multiplier: 1000000000, unit: 'billions' },
      { pattern: /amounts in millions/i, multiplier: 1000000, unit: 'millions' },
    ];

    for (const { pattern, multiplier, unit } of scalePatterns) {
      if (pattern.test(this.rawText)) {
        this.documentScale = { unit, multiplier };
        this.logStep(`Detected document scale: ${unit} (${multiplier}x)`);
        return;
      }
    }

    this.logStep('No explicit scale found, assuming base units');
  }

  // ==================== TABLE DETECTION ====================
  
  private detectTables() {
    this.logStep('Detecting tables from position data');
    
    // Group words by page and line
    const pages = new Map<number, Map<number, OCRWord[]>>();
    
    for (const word of this.words) {
      if (!pages.has(word.page)) {
        pages.set(word.page, new Map());
      }
      const pageLines = pages.get(word.page)!;
      if (!pageLines.has(word.line)) {
        pageLines.set(word.line, []);
      }
      pageLines.get(word.line)!.push(word);
    }

    // Detect table regions (lines with multiple numeric columns)
    for (const [pageNum, lines] of pages) {
      const tableRegions = this.findTableRegions(lines, pageNum);
      this.tables.push(...tableRegions);
    }

    this.logStep(`Detected ${this.tables.length} tables`);
  }

  private findTableRegions(lines: Map<number, OCRWord[]>, pageNum: number): FinancialTable[] {
    const tables: FinancialTable[] = [];
    const lineNumbers = Array.from(lines.keys()).sort((a, b) => a - b);
    
    let currentTable: OCRWord[][] | null = null;
    let tableStart = 0;

    for (let i = 0; i < lineNumbers.length; i++) {
      const lineNum = lineNumbers[i];
      const words = lines.get(lineNum) || [];
      
      // Check if line has multiple numbers (likely a table row)
      const numbers = words.filter(w => /^[\$\(]?[\d,]+[\.\d]*[BMK\)]?$/.test(w.text));
      
      if (numbers.length >= 2) {
        if (!currentTable) {
          currentTable = [];
          tableStart = lineNum;
        }
        currentTable.push(words);
      } else if (currentTable && currentTable.length >= 3) {
        // End of table region
        tables.push(this.parseTableFromWords(currentTable, tableStart, pageNum));
        currentTable = null;
      } else {
        currentTable = null;
      }
    }

    return tables;
  }

  private parseTableFromWords(tableWords: OCRWord[][], startLine: number, pageNum: number): FinancialTable {
    // Detect column positions
    const allX = tableWords.flat().map(w => w.bbox.x).sort((a, b) => a - b);
    const columns = this.detectColumnPositions(allX);

    // Build table structure
    const rows: TableCell[][] = [];
    let title = '';
    let type: FinancialTable['type'] = 'unknown';

    for (let i = 0; i < tableWords.length; i++) {
      const lineWords = tableWords[i];
      const row: TableCell[] = [];
      
      for (const word of lineWords) {
        const col = this.assignColumn(word.bbox.x, columns);
        row.push({
          text: word.text,
          bbox: word.bbox,
          row: i,
          col,
          isHeader: i === 0,
        });
      }
      
      rows.push(row);

      // Detect table type from content
      if (i === 0) {
        title = lineWords.map(w => w.text).join(' ');
        if (/balance.*sheet/i.test(title)) type = 'balance_sheet';
        else if (/income|operations/i.test(title)) type = 'income_statement';
        else if (/cash.*flow/i.test(title)) type = 'cash_flow';
      }
    }

    const bbox = this.calculateBoundingBox(tableWords.flat().map(w => w.bbox));

    return {
      title,
      headers: rows[0]?.map(c => c.text) || [],
      rows,
      bbox,
      page: pageNum,
      type,
    };
  }

  private detectColumnPositions(xPositions: number[]): number[] {
    // Simple clustering: group x positions within 20px tolerance
    const columns: number[] = [];
    const tolerance = 20;

    for (const x of xPositions) {
      if (columns.length === 0 || x - columns[columns.length - 1] > tolerance) {
        columns.push(x);
      }
    }

    return columns;
  }

  private assignColumn(x: number, columns: number[]): number {
    for (let i = 0; i < columns.length; i++) {
      if (Math.abs(x - columns[i]) < 30) {
        return i;
      }
    }
    return columns.length;
  }

  private calculateBoundingBox(boxes: BoundingBox[]): BoundingBox {
    if (boxes.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
    
    const minX = Math.min(...boxes.map(b => b.x));
    const minY = Math.min(...boxes.map(b => b.y));
    const maxX = Math.max(...boxes.map(b => b.x + b.width));
    const maxY = Math.max(...boxes.map(b => b.y + b.height));

    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    };
  }

  // ==================== METADATA EXTRACTION ====================
  
  private extractMetadata(): AdvancedFinancialDocumentSchema['metadata'] {
    return {
      company_name: this.extractCompanyName(),
      ticker: this.extractTicker(),
      cik: this.extractCIK(),
      period_end: this.extractPeriodEnd(),
      filing_date: this.extractFilingDate(),
      document_type: this.extractDocumentType(),
      fiscal_year: this.extractFiscalYear(),
      fiscal_quarter: this.extractFiscalQuarter(),
    };
  }

  private extractCompanyName(): string {
    // Look for company name in first 3000 characters
    const header = this.rawText.substring(0, 3000);
    
    const patterns = [
      // Alphabet/Google specific
      /Alphabet Inc\./i,
      // Standard pattern: Company name before "Commission file number"
      /^([A-Z][A-Za-z0-9\s&\.,'-]+(?:Inc\.|Corp\.|Corporation|Company|LLC|Ltd\.|Limited|Co\.?))\s+Commission file number/im,
      // Pattern: Name between address and CIK
      /\d{5}[\s\S]{0,300}?([A-Z][A-Za-z0-9\s&\.,'-]{3,50}(?:Inc\.|Corp\.|Corporation|Company|LLC))/i,
      // Pattern: Large caps name near the beginning
      /^([A-Z][A-Z\s&]{3,40}(?:INC|CORP|LLC)\.?)/m,
    ];

    for (const pattern of patterns) {
      const match = header.match(pattern);
      if (match && match[1]) {
        const name = match[1].trim().replace(/\s+/g, ' ');
        // Validate it's not junk
        if (name.length > 3 && name.length < 100 && 
            !/SECURITIES|EXCHANGE|ACT OF|UNITED STATES|WASHINGTON|COMMISSION/i.test(name)) {
          this.logStep(`Extracted company name: ${name}`);
          return name;
        }
      }
      // Check for direct Alphabet match
      if (/Alphabet Inc\./i.test(header)) {
        this.logStep('Extracted company name: Alphabet Inc.');
        return 'Alphabet Inc.';
      }
    }

    this.logStep('Could not extract company name');
    return 'Unknown Company';
  }

  private extractDocumentType(): string {
    // Prioritize first occurrence in first 1000 chars
    const header = this.rawText.substring(0, 1000);
    
    if (/FORM\s+10-K\b/i.test(header)) {
      this.logStep('Document type: 10-K');
      return '10-K';
    }
    if (/FORM\s+10-Q\b/i.test(header)) {
      this.logStep('Document type: 10-Q');
      return '10-Q';
    }
    if (/FORM\s+8-K\b/i.test(header)) {
      return '8-K';
    }

    this.logStep('Document type unknown');
    return 'Unknown';
  }

  private extractTicker(): string {
    const match = this.rawText.match(/Trading Symbol[:\s]+([A-Z]{1,5})\b/i);
    return match ? match[1] : '';
  }

  private extractCIK(): string {
    const match = this.rawText.match(/CIK[:\s]+(\d{10})/i);
    return match ? match[1] : '';
  }

  private extractPeriodEnd(): string {
    const patterns = [
      /(?:fiscal\s+year|period|quarter)\s+ended?\s+([A-Z][a-z]+\s+\d{1,2},?\s+\d{4})/i,
      /(?:three|six|nine)\s+months\s+ended\s+([A-Z][a-z]+\s+\d{1,2},?\s+\d{4})/i,
      /As\s+of\s+([A-Z][a-z]+\s+\d{1,2},?\s+\d{4})/i,
    ];

    for (const pattern of patterns) {
      const match = this.rawText.match(pattern);
      if (match) {
        this.logStep(`Period end: ${match[1]}`);
        return match[1];
      }
    }

    return '';
  }

  private extractFilingDate(): string {
    const match = this.rawText.match(/(?:Filed|Date)[:\s]+([A-Z][a-z]+\s+\d{1,2},?\s+\d{4})/i);
    return match ? match[1] : '';
  }

  private extractFiscalYear(): string {
    const match = this.rawText.match(/fiscal\s+year\s+(?:ended?\s+)?(\d{4})/i);
    if (match) return match[1];

    // Try period end
    const period = this.extractPeriodEnd();
    const yearMatch = period.match(/(\d{4})/);
    return yearMatch ? yearMatch[1] : '';
  }

  private extractFiscalQuarter(): string {
    if (/first\s+quarter|Q1/i.test(this.rawText)) return 'Q1';
    if (/second\s+quarter|Q2/i.test(this.rawText)) return 'Q2';
    if (/third\s+quarter|Q3/i.test(this.rawText)) return 'Q3';
    if (/fourth\s+quarter|Q4/i.test(this.rawText)) return 'Q4';
    return '';
  }

  // ==================== FINANCIAL EXTRACTION ====================
  
  private extractFinancials(): AdvancedFinancialDocumentSchema['financials'] {
    this.logStep('Extracting financial fields with multi-strategy approach');

    const financials = {
      assets: {
        total: this.extractField('total_assets', [
          /^Total\s+assets\s*$/im,
          /Total\s+assets\s*\n/im,
          /^Total\s+assets\s+\$/im,
        ], 5000000000), // Min 5B
        cash: this.extractField('cash', [
          /Cash\s+and\s+cash\s+equivalents/i,
          /^Cash\b/i,
        ]),
        marketable_securities: this.extractField('marketable_securities', [
          /Marketable\s+securities/i,
          /Short-term\s+investments/i,
        ]),
        accounts_receivable: this.extractField('accounts_receivable', [
          /Accounts\s+receivable/i,
          /Trade\s+receivables/i,
        ]),
        property_equipment: this.extractField('property_equipment', [
          /Property\s+and\s+equipment,?\s+net/i,
          /Property,?\s+plant\s+and\s+equipment/i,
        ]),
        goodwill: this.extractField('goodwill', [/Goodwill/i]),
      },
      liabilities: {
        total: this.extractField('total_liabilities', [
          /^Total\s+liabilities\s*$/im,
          /^Total\s+liabilities\s*\n/im,
          /Total\s+liabilities(?!\s+and\s+(?:stockholders|shareholders))/i,
        ], 1000000000), // Min 1B
        long_term_debt: this.extractField('long_term_debt', [
          /Long-term\s+debt/i,
          /Long\s+term\s+debt/i,
        ]),
        accounts_payable: this.extractField('accounts_payable', [
          /Accounts\s+payable/i,
        ]),
      },
      equity: {
        total: this.extractField('total_equity', [
          /^Total\s+(?:stockholders'|shareholders')\s+equity\s*$/im,
          /Total\s+(?:stockholders'|shareholders')\s+equity\s*\n/im,
          /^Total\s+equity\s*$/im,
        ], 1000000000), // Min 1B
        retained_earnings: this.extractField('retained_earnings', [
          /Retained\s+earnings/i,
          /Accumulated\s+(?:deficit|earnings)/i,
        ]),
      },
      revenues: {
        total: this.extractField('total_revenue', [
          /^Total\s+revenues?\s*$/im,
          /^Revenues?\s*$/im,
          /Total\s+revenues?\s*\n/i,
          /^Total\s+revenues?\s+\$/im,
          /Revenues?\s*\n\s*\$/i,
        ], 1000000000), // Min 1B
        cost_of_revenue: this.extractField('cost_of_revenue', [
          /Cost\s+of\s+revenues?/i,
          /Cost\s+of\s+sales/i,
        ]),
        gross_profit: this.extractField('gross_profit', [
          /Gross\s+profit/i,
          /Gross\s+income/i,
        ]),
      },
      expenses: {
        research_development: this.extractField('rd', [
          /Research\s+and\s+development/i,
          /R&D/i,
        ]),
        sales_marketing: this.extractField('sales_marketing', [
          /Sales\s+and\s+marketing/i,
          /Selling\s+and\s+marketing/i,
          /Selling,?\s+general\s+and\s+administrative/i,
        ]),
        general_administrative: this.extractField('ga', [
          /General\s+and\s+administrative/i,
        ]),
      },
      income: {
        operating_income: this.extractField('operating_income', [
          /Income\s+from\s+operations/i,
          /Operating\s+income/i,
        ]),
        net_income: this.extractField('net_income', [
          /Net\s+income\s+\(loss\)/i,
          /Net\s+income/i,
        ]),
        earnings_per_share: this.extractField('eps', [
          /Basic\s+(?:net\s+)?(?:earnings|income)\s+per\s+share/i,
        ], 0, 10000),
      },
      cash_flow: {
        operating: this.extractField('ocf', [
          /Net\s+cash\s+provided\s+by\s+operating\s+activities/i,
          /Cash\s+from\s+operating\s+activities/i,
          /Operating\s+activities/i,
        ]),
        capex: this.extractField('capex', [
          /Capital\s+expenditures/i,
          /Purchases\s+of\s+property\s+and\s+equipment/i,
          /Property\s+and\s+equipment\s+additions/i,
        ]),
      },
    };

    // Derive missing fields using financial relationships
    this.deriveMissingFields(financials);

    return financials;
  }

  private cleanupImpossibleValues(financials: AdvancedFinancialDocumentSchema['financials']) {
    this.logStep('Cleaning up impossible values');

    // Check 1: Total Liabilities should not equal Total Assets (impossible unless equity = 0)
    if (financials.assets.total && financials.liabilities.total) {
      const assetVal = financials.assets.total.value;
      const liabVal = financials.liabilities.total.value;
      
      if (Math.abs(assetVal - liabVal) < assetVal * 0.01) {
        // They're within 1% of each other - likely wrong
        this.logStep(`⚠️  Total Assets = Total Liabilities ($${(assetVal/1e9).toFixed(1)}B) - rejecting liabilities`);
        financials.liabilities.total = undefined;
      }
    }

    // Check 2: Total Assets should be larger than any individual asset component
    if (financials.assets.total) {
      const totalAssets = financials.assets.total.value;
      
      if (financials.assets.cash && financials.assets.cash.value > totalAssets) {
        this.logStep(`⚠️  Cash > Total Assets - rejecting cash value`);
        financials.assets.cash = undefined;
      }
      
      if (financials.assets.marketable_securities && financials.assets.marketable_securities.value > totalAssets) {
        this.logStep(`⚠️  Marketable Securities > Total Assets - rejecting`);
        financials.assets.marketable_securities = undefined;
      }
    }

    // Check 3: Revenue should be larger than operating income and net income
    if (financials.revenues.total) {
      const revenue = financials.revenues.total.value;
      
      if (financials.income.operating_income && financials.income.operating_income.value > revenue * 1.2) {
        this.logStep(`⚠️  Operating Income > Revenue - rejecting operating income`);
        financials.income.operating_income = undefined;
      }
      
      if (financials.income.net_income && financials.income.net_income.value > revenue * 1.2) {
        this.logStep(`⚠️  Net Income > Revenue - rejecting net income`);
        financials.income.net_income = undefined;
      }
    }

    // Check 4: Operating expenses should be reasonable vs revenue
    if (financials.revenues.total) {
      const revenue = financials.revenues.total.value;
      
      if (financials.expenses.research_development && financials.expenses.research_development.value > revenue) {
        this.logStep(`⚠️  R&D > Revenue - rejecting R&D`);
        financials.expenses.research_development = undefined;
      }
    }
  }

  private deriveMissingFields(financials: AdvancedFinancialDocumentSchema['financials']) {
    this.logStep('Deriving missing fields from financial relationships');

    // Derive equity from assets - liabilities
    if (!financials.equity.total && financials.assets.total && financials.liabilities.total) {
      const derivedEquity = financials.assets.total.value - financials.liabilities.total.value;
      if (derivedEquity > 0) { // Only derive if positive
        financials.equity.total = {
          value: derivedEquity,
          source: 'Derived (Assets - Liabilities)',
          confidence: 90,
          page: 0,
          context: 'Calculated from balance sheet',
        };
        this.logStep(`✓ Derived equity: ${this.formatMoney(derivedEquity)}`);
      }
    }

    // Derive gross profit from revenue - cost of revenue
    if (!financials.revenues.gross_profit && financials.revenues.total && financials.revenues.cost_of_revenue) {
      const derivedGrossProfit = financials.revenues.total.value - financials.revenues.cost_of_revenue.value;
      
      // Only derive if result is positive and reasonable
      if (derivedGrossProfit > 0 && derivedGrossProfit < financials.revenues.total.value) {
        financials.revenues.gross_profit = {
          value: derivedGrossProfit,
          source: 'Derived (Revenue - Cost of Revenue)',
          confidence: 90,
          page: 0,
          context: 'Calculated from income statement',
        };
        this.logStep(`✓ Derived gross profit: ${this.formatMoney(derivedGrossProfit)}`);
      } else {
        this.logStep(`⚠️  Gross profit calculation failed (negative or > revenue) - likely extraction error in revenue or COGS`);
      }
    }

    // Derive free cash flow from operating CF - capex
    if (financials.cash_flow.operating && financials.cash_flow.capex) {
      const derivedFCF = financials.cash_flow.operating.value - Math.abs(financials.cash_flow.capex.value);
      financials.cash_flow.free_cash_flow = {
        value: derivedFCF,
        source: 'Derived (Operating CF - CapEx)',
        confidence: 95,
        page: 0,
        context: 'Calculated from cash flow statement',
      };
      this.logStep(`✓ Derived free cash flow: ${this.formatMoney(derivedFCF)}`);
    }
  }

  private extractField(
    fieldName: string,
    patterns: RegExp[],
    minValue: number = 100,
    maxValue: number = 1000000000000
  ): ExtractionResult | undefined {
    const candidates: ExtractionResult[] = [];

    // Strategy 1: Extract from tables (if available)
    if (this.tables.length > 0) {
      const tableResults = this.extractFromTables(patterns);
      candidates.push(...tableResults);
    }

    // Strategy 2: Extract from raw text with context
    const textResults = this.extractFromText(patterns, minValue, maxValue);
    candidates.push(...textResults);

    if (candidates.length === 0) {
      this.logStep(`❌ ${fieldName}: No candidates found`);
      return undefined;
    }

    // For critical fields (revenue, assets, liabilities), prefer larger values
    const isCriticalField = /revenue|assets|liabilities|equity/.test(fieldName);
    
    if (isCriticalField && candidates.length > 1) {
      // Sort by value (largest first) for critical fields, then by confidence
      candidates.sort((a, b) => {
        const valueDiff = b.value - a.value;
        if (Math.abs(valueDiff) > a.value * 0.5) { // If values differ significantly
          return valueDiff; // Prefer larger value
        }
        return b.confidence - a.confidence; // Otherwise prefer higher confidence
      });
    } else {
      // For other fields, sort by confidence only
      candidates.sort((a, b) => b.confidence - a.confidence);
    }
    
    const best = candidates[0];

    this.logStep(`✓ ${fieldName}: $${(best.value / 1000000).toFixed(2)}M (confidence: ${best.confidence.toFixed(0)}%)`);

    return best;
  }

  private extractFromTables(patterns: RegExp[]): ExtractionResult[] {
    const results: ExtractionResult[] = [];

    for (const table of this.tables) {
      for (const rowCells of table.rows) {
        // Check if any cell matches the label pattern
        const labelCell = rowCells.find(cell => 
          patterns.some(p => p.test(cell.text))
        );

        if (labelCell) {
          // Look for numeric cells in the same row
          const numericCells = rowCells.filter(cell => 
            cell.col > labelCell.col && /^[\$\(]?[\d,]+[\.\d]*[BMK\)]?$/.test(cell.text)
          );

          for (const numCell of numericCells) {
            const value = this.parseNumber(numCell.text);
            if (value !== null) {
              results.push({
                value,
                source: `Table: ${table.title || 'Unnamed'} (page ${table.page})`,
                confidence: 85,
                page: table.page,
                bbox: numCell.bbox,
                context: labelCell.text,
              });
            }
          }
        }
      }
    }

    return results;
  }

  private extractFromText(patterns: RegExp[], minValue: number, maxValue: number): ExtractionResult[] {
    const results: ExtractionResult[] = [];

    // First, try to find the consolidated financial statements section
    const consolidatedSections = [
      /CONSOLIDATED\s+BALANCE\s+SHEETS?([\s\S]{0,5000}?)(?:See|Notes|The accompanying)/i,
      /CONSOLIDATED\s+STATEMENTS?\s+OF\s+(?:INCOME|OPERATIONS)([\s\S]{0,5000}?)(?:See|Notes|The accompanying)/i,
      /CONSOLIDATED\s+STATEMENTS?\s+OF\s+CASH\s+FLOWS?([\s\S]{0,5000}?)(?:See|Notes|The accompanying)/i,
    ];

    let consolidatedText = '';
    for (const sectionPattern of consolidatedSections) {
      const match = this.rawText.match(sectionPattern);
      if (match && match[1]) {
        consolidatedText += match[1] + '\n\n';
      }
    }

    // If we found consolidated sections, search there first
    const searchTexts = consolidatedText.length > 500 
      ? [consolidatedText, this.rawText] 
      : [this.rawText];

    for (const searchText of searchTexts) {
      for (const pattern of patterns) {
        // Look for pattern followed by number within same or next line
        const searchPattern = new RegExp(
          pattern.source + '\\s*[\n\\r]*\\s*\\$?\\s*([\\d,]+(?:\\.\\d+)?)\\s*([BMK])?',
          'gi'
        );
        const matches = [...searchText.matchAll(searchPattern)];
        
        for (const match of matches) {
          const numberText = match[1];
          const suffix = match[2];
          
          // Build number string for parsing
          let parseText = numberText;
          if (suffix) parseText += suffix;
          
          const value = this.parseNumber(parseText);
          if (value !== null && value >= minValue && value <= maxValue) {
            const context = match[0];
            let confidence = searchText === consolidatedText ? 85 : 70;
            
            // Boost confidence for larger values (major companies have B-scale numbers)
            if (value > 10000000000) confidence += 5;
            
            // Boost if in a table-like structure
            if (/\s{2,}/.test(context)) confidence += 3;
            
            results.push({
              value,
              source: searchText === consolidatedText ? 'Consolidated statement' : 'Text extraction',
              confidence,
              page: 0,
              context: context.substring(0, 150),
            });
          }
        }
      }
      
      // If we found good results in consolidated section, don't search full text
      if (searchText === consolidatedText && results.length > 0) {
        break;
      }
    }

    return results;
  }

  private parseNumber(text: string): number | null {
    // Remove formatting but keep parentheses for negative detection
    const hasParens = text.includes('(') && text.includes(')');
    let cleaned = text.replace(/[\$,]/g, '').replace(/[()]/g, '').trim();
    
    // Handle suffix multipliers (explicit in the number)
    let multiplier = 1;
    let hasExplicitSuffix = false;
    
    if (/B$/i.test(cleaned)) {
      multiplier = 1000000000;
      cleaned = cleaned.replace(/B$/i, '');
      hasExplicitSuffix = true;
    } else if (/M$/i.test(cleaned)) {
      multiplier = 1000000;
      cleaned = cleaned.replace(/M$/i, '');
      hasExplicitSuffix = true;
    } else if (/K$/i.test(cleaned)) {
      multiplier = 1000;
      cleaned = cleaned.replace(/K$/i, '');
      hasExplicitSuffix = true;
    } else {
      // Apply document scale only if no explicit suffix
      multiplier = this.documentScale.multiplier;
    }

    const num = parseFloat(cleaned);
    if (isNaN(num) || num === 0) return null;

    const result = num * multiplier;

    // Handle parentheses as negative
    if (hasParens) {
      return -result;
    }

    return result;
  }

  // ==================== VALIDATION ====================
  
  private validateFinancials(
    financials: AdvancedFinancialDocumentSchema['financials'],
    metadata: AdvancedFinancialDocumentSchema['metadata']
  ): string[] {
    const warnings: string[] = [];

    // Validation 1: Assets = Liabilities + Equity
    const assets = financials.assets.total?.value;
    const liabilities = financials.liabilities.total?.value;
    const equity = financials.equity.total?.value;

    if (assets && liabilities && equity) {
      const diff = Math.abs(assets - (liabilities + equity));
      const tolerance = assets * 0.05; // 5% tolerance
      if (diff > tolerance) {
        warnings.push(`Balance sheet doesn't balance: Assets (${this.formatMoney(assets)}) ≠ Liabilities (${this.formatMoney(liabilities)}) + Equity (${this.formatMoney(equity)})`);
      }
    }

    // Validation 2: Gross profit should be positive and < revenue
    const revenue = financials.revenues.total?.value;
    const grossProfit = financials.revenues.gross_profit?.value;

    if (revenue && grossProfit) {
      if (grossProfit < 0) {
        warnings.push(`Gross profit is negative: ${this.formatMoney(grossProfit)} - likely extraction error`);
      }
      if (grossProfit > revenue) {
        warnings.push(`Gross profit (${this.formatMoney(grossProfit)}) exceeds revenue (${this.formatMoney(revenue)})`);
      }
    }

    // Validation 3: Operating income should be < gross profit
    const opIncome = financials.income.operating_income?.value;
    if (grossProfit && opIncome && opIncome > grossProfit) {
      warnings.push(`Operating income (${this.formatMoney(opIncome)}) exceeds gross profit (${this.formatMoney(grossProfit)})`);
    }

    // Validation 4: Net income should be < operating income
    const netIncome = financials.income.net_income?.value;
    if (opIncome && netIncome && netIncome > opIncome * 1.5) {
      warnings.push(`Net income (${this.formatMoney(netIncome)}) significantly exceeds operating income (${this.formatMoney(opIncome)})`);
    }

    // Validation 5: Cash + marketable securities should be reasonable vs assets
    const cash = financials.assets.cash?.value;
    const securities = financials.assets.marketable_securities?.value;
    if (assets && cash && securities) {
      const liquid = cash + securities;
      if (liquid > assets) {
        warnings.push(`Liquid assets (${this.formatMoney(liquid)}) exceed total assets (${this.formatMoney(assets)})`);
      }
    }

    if (warnings.length > 0) {
      this.logStep(`⚠️  Found ${warnings.length} validation warnings`);
    } else {
      this.logStep('✓ All validation checks passed');
    }

    return warnings;
  }

  private formatMoney(value: number): string {
    if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
    if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
    if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
    if (value >= 1e3) return `$${(value / 1e3).toFixed(2)}K`;
    return `$${value.toFixed(2)}`;
  }

  // ==================== CONFIDENCE CALCULATION ====================
  
  private calculateConfidence(
    financials: AdvancedFinancialDocumentSchema['financials'],
    warnings: string[]
  ): number {
    let score = 0;
    let total = 0;

    // Critical fields (higher weight)
    const criticalFields = [
      financials.revenues.total,
      financials.income.net_income,
      financials.assets.total,
      financials.liabilities.total,
      financials.equity.total,
    ];

    for (const field of criticalFields) {
      total += 3;
      if (field) score += 3;
    }

    // Important fields
    const importantFields = [
      financials.income.operating_income,
      financials.revenues.gross_profit,
      financials.assets.cash,
      financials.cash_flow.operating,
    ];

    for (const field of importantFields) {
      total += 2;
      if (field) score += 2;
    }

    // Nice-to-have fields
    const optionalFields = [
      financials.expenses.research_development,
      financials.expenses.sales_marketing,
      financials.cash_flow.capex,
      financials.assets.marketable_securities,
    ];

    for (const field of optionalFields) {
      total += 1;
      if (field) score += 1;
    }

    // Penalty for validation warnings
    const warningPenalty = Math.min(warnings.length * 5, 20);

    const confidence = Math.max(0, Math.min(100, Math.round((score / total) * 100) - warningPenalty));

    this.logStep(`Final confidence score: ${confidence}% (extracted ${score}/${total} fields, ${warnings.length} warnings)`);

    return confidence;
  }
}

// Helper to convert old format to new format
export function convertToLegacyFormat(advanced: AdvancedFinancialDocumentSchema): any {
  const extractValue = (result: ExtractionResult | undefined) => result?.value;

  return {
    metadata: advanced.metadata,
    sections: {},
    financials: {
      assets: {
        total: extractValue(advanced.financials.assets.total),
        cash: extractValue(advanced.financials.assets.cash),
        marketable_securities: extractValue(advanced.financials.assets.marketable_securities),
        accounts_receivable: extractValue(advanced.financials.assets.accounts_receivable),
        property_equipment: extractValue(advanced.financials.assets.property_equipment),
        goodwill: extractValue(advanced.financials.assets.goodwill),
      },
      liabilities: {
        total: extractValue(advanced.financials.liabilities.total),
        long_term_debt: extractValue(advanced.financials.liabilities.long_term_debt),
        accounts_payable: extractValue(advanced.financials.liabilities.accounts_payable),
      },
      equity: {
        total: extractValue(advanced.financials.equity.total),
        retained_earnings: extractValue(advanced.financials.equity.retained_earnings),
      },
      revenues: {
        total: extractValue(advanced.financials.revenues.total),
        cost_of_revenue: extractValue(advanced.financials.revenues.cost_of_revenue),
        gross_profit: extractValue(advanced.financials.revenues.gross_profit),
      },
      expenses: {
        research_development: extractValue(advanced.financials.expenses.research_development),
        sales_marketing: extractValue(advanced.financials.expenses.sales_marketing),
        general_administrative: extractValue(advanced.financials.expenses.general_administrative),
      },
      income: {
        operating_income: extractValue(advanced.financials.income.operating_income),
        net_income: extractValue(advanced.financials.income.net_income),
        earnings_per_share: extractValue(advanced.financials.income.earnings_per_share),
      },
      cash_flow: {
        operating: extractValue(advanced.financials.cash_flow.operating),
        capex: extractValue(advanced.financials.cash_flow.capex),
        free_cash_flow: 
          advanced.financials.cash_flow.operating?.value && advanced.financials.cash_flow.capex?.value
            ? advanced.financials.cash_flow.operating.value - Math.abs(advanced.financials.cash_flow.capex.value)
            : undefined,
      },
    },
    tables_found: advanced.tables_detected.map(t => t.type),
    extraction_confidence: advanced.extraction_confidence,
    errors: advanced.validation_warnings,
  };
}

