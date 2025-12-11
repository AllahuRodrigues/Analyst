// Financial document parser - extracts structured data from SEC 10-K/10-Q filings
// Uses OCR position data to read tables row-by-row instead of picking first numbers

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

  public async parse(): Promise<AdvancedFinancialDocumentSchema> {
    this.log = [];
    this.logStep('Starting advanced financial document parsing');

    // Detect scale first so I can properly multiply values without explicit suffixes
    this.detectDocumentScale();

    // Build table structure from OCR positions - this lets me read rows horizontally
    if (this.words.length > 0) {
      this.detectTables();
    }

    const metadata = this.extractMetadata();

    // Read financials row-by-row: find label, get value from same row
    const financials = this.extractFinancials();

    // Reject values that violate basic accounting rules (like liabilities = assets)
    this.cleanupImpossibleValues(financials);

    const validation_warnings = this.validateFinancials(financials, metadata);
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

  private detectDocumentScale() {
    // Most SEC filings use "(in millions)" but don't put it on every number
    // Need to detect this upfront so I know whether "$123" means $123M or $123
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

  private detectTables() {
    this.logStep('Detecting tables from position data');
    
    // Group OCR words by line so I can identify table rows (multiple numbers on same line)
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

    // A table row has multiple numbers - look for lines with 2+ numeric values
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
      
      // Multiple numbers on same line = likely a financial statement row
      const numbers = words.filter(w => /^[\$\(]?[\d,]+[\.\d]*[BMK\)]?$/.test(w.text));
      
      if (numbers.length >= 2) {
        if (!currentTable) {
          currentTable = [];
          tableStart = lineNum;
        }
        currentTable.push(words);
      } else if (currentTable && currentTable.length >= 3) {
        // Found 3+ consecutive rows with numbers - that's a table
        tables.push(this.parseTableFromWords(currentTable, tableStart, pageNum));
        currentTable = null;
      } else {
        currentTable = null;
      }
    }

    return tables;
  }

  private parseTableFromWords(tableWords: OCRWord[][], startLine: number, pageNum: number): FinancialTable {
    // Cluster x-positions to find column boundaries (needed for horizontal row reading)
    const allX = tableWords.flat().map(w => w.bbox.x).sort((a, b) => a - b);
    const columns = this.detectColumnPositions(allX);

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

      // Classify table type so I can prioritize consolidated statements over notes
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
    // Words aligned vertically form columns - cluster x-positions within 20px tolerance
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
    // Company name is always near the top - search first 3000 chars to avoid false matches
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
        // Skip garbage OCR like "OF THE SECURITIES EXCHANGE ACT" being detected as company name
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
    // Earlier occurrences are more likely to be correct (company name appears before footnotes)
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

    // Calculate missing fields from accounting relationships (e.g., equity = assets - liabilities)
    this.deriveMissingFields(financials);

    return financials;
  }

  private cleanupImpossibleValues(financials: AdvancedFinancialDocumentSchema['financials']) {
    this.logStep('Cleaning up impossible values');

    // Reject if liabilities ≈ assets (impossible unless equity = 0, which never happens)
    if (financials.assets.total && financials.liabilities.total) {
      const assetVal = financials.assets.total.value;
      const liabVal = financials.liabilities.total.value;
      
      if (Math.abs(assetVal - liabVal) < assetVal * 0.01) {
        this.logStep(`WARNING: Total Assets = Total Liabilities ($${(assetVal/1e9).toFixed(1)}B) - rejecting liabilities`);
        financials.liabilities.total = undefined;
      }
    }

    // Reject components that exceed total (e.g., cash > total assets doesn't make sense)
    if (financials.assets.total) {
      const totalAssets = financials.assets.total.value;
      
      if (financials.assets.cash && financials.assets.cash.value > totalAssets) {
        this.logStep(`WARNING: Cash > Total Assets - rejecting cash value`);
        financials.assets.cash = undefined;
      }
      
      if (financials.assets.marketable_securities && financials.assets.marketable_securities.value > totalAssets) {
        this.logStep(`WARNING: Marketable Securities > Total Assets - rejecting`);
        financials.assets.marketable_securities = undefined;
      }
    }

    // Reject if operating/net income > revenue (income comes after expenses, can't exceed top line)
    if (financials.revenues.total) {
      const revenue = financials.revenues.total.value;
      
      if (financials.income.operating_income && financials.income.operating_income.value > revenue * 1.2) {
        this.logStep(`WARNING: Operating Income > Revenue - rejecting operating income`);
        financials.income.operating_income = undefined;
      }
      
      if (financials.income.net_income && financials.income.net_income.value > revenue * 1.2) {
        this.logStep(`WARNING: Net Income > Revenue - rejecting net income`);
        financials.income.net_income = undefined;
      }
    }

    // Reject expenses that exceed revenue (R&D can't be more than total revenue)
    if (financials.revenues.total) {
      const revenue = financials.revenues.total.value;
      
      if (financials.expenses.research_development && financials.expenses.research_development.value > revenue) {
        this.logStep(`WARNING: R&D > Revenue - rejecting R&D`);
        financials.expenses.research_development = undefined;
      }
    }
  }

  private deriveMissingFields(financials: AdvancedFinancialDocumentSchema['financials']) {
    this.logStep('Deriving missing fields from financial relationships');

    // Calculate equity from balance sheet equation if missing (more reliable than extracting it directly)
    if (!financials.equity.total && financials.assets.total && financials.liabilities.total) {
      const derivedEquity = financials.assets.total.value - financials.liabilities.total.value;
      if (derivedEquity > 0) {
        financials.equity.total = {
          value: derivedEquity,
          source: 'Derived (Assets - Liabilities)',
          confidence: 90,
          page: 0,
          context: 'Calculated from balance sheet',
        };
        this.logStep(`SUCCESS: Derived equity: ${this.formatMoney(derivedEquity)}`);
      }
    }

    // Calculate gross profit if not found directly (some filings don't have a gross profit line)
    if (!financials.revenues.gross_profit && financials.revenues.total && financials.revenues.cost_of_revenue) {
      const derivedGrossProfit = financials.revenues.total.value - financials.revenues.cost_of_revenue.value;
      if (derivedGrossProfit > 0 && derivedGrossProfit < financials.revenues.total.value) {
        financials.revenues.gross_profit = {
          value: derivedGrossProfit,
          source: 'Derived (Revenue - Cost of Revenue)',
          confidence: 90,
          page: 0,
          context: 'Calculated from income statement',
        };
        this.logStep(`SUCCESS: Derived gross profit: ${this.formatMoney(derivedGrossProfit)}`);
      } else {
        this.logStep(`WARNING: Gross profit calculation failed (negative or > revenue) - likely extraction error in revenue or COGS`);
      }
    }

    // Calculate FCF if missing (it's rarely labeled directly in cash flow statements)
    if (financials.cash_flow.operating && financials.cash_flow.capex) {
      const derivedFCF = financials.cash_flow.operating.value - Math.abs(financials.cash_flow.capex.value);
      financials.cash_flow.free_cash_flow = {
        value: derivedFCF,
        source: 'Derived (Operating CF - CapEx)',
        confidence: 95,
        page: 0,
        context: 'Calculated from cash flow statement',
      };
      this.logStep(`SUCCESS: Derived free cash flow: ${this.formatMoney(derivedFCF)}`);
    }
  }

  private extractField(
    fieldName: string,
    patterns: RegExp[],
    minValue: number = 100,
    maxValue: number = 1000000000000
  ): ExtractionResult | undefined {
    const candidates: ExtractionResult[] = [];

    // Try tables first (higher confidence - structured data) then fall back to raw text
    if (this.tables.length > 0) {
      const tableResults = this.extractFromTables(patterns);
      candidates.push(...tableResults);
    }

    const textResults = this.extractFromText(patterns, minValue, maxValue);
    candidates.push(...textResults);

    if (candidates.length === 0) {
      this.logStep(`ERROR: ${fieldName}: No candidates found`);
      return undefined;
    }

    // For major items (revenue, assets), bigger values are usually correct (footnotes have smaller numbers)
    const isCriticalField = /revenue|assets|liabilities|equity/.test(fieldName);
    
    if (isCriticalField && candidates.length > 1) {
      candidates.sort((a, b) => {
        const valueDiff = b.value - a.value;
        if (Math.abs(valueDiff) > a.value * 0.5) {
          return valueDiff;
        }
        return b.confidence - a.confidence;
      });
    } else {
      candidates.sort((a, b) => b.confidence - a.confidence);
    }
    
    const best = candidates[0];

    this.logStep(`SUCCESS: ${fieldName}: $${(best.value / 1000000).toFixed(2)}M (confidence: ${best.confidence.toFixed(0)}%)`);

    return best;
  }

  private extractFromTables(patterns: RegExp[]): ExtractionResult[] {
    const results: ExtractionResult[] = [];

    for (const table of this.tables) {
      // Read each row left-to-right: find label, then get value from same row
      for (const rowCells of table.rows) {
        const sortedCells = [...rowCells].sort((a, b) => a.col - b.col);
        
        // Label is usually in first column, value in columns after it
        const labelCellIndex = sortedCells.findIndex(cell => 
          patterns.some(p => p.test(cell.text.trim()))
        );

        if (labelCellIndex !== -1) {
          const labelCell = sortedCells[labelCellIndex];
          
          // Get numeric values from same row after the label (horizontal reading)
          const numericCells = sortedCells
            .slice(labelCellIndex + 1)
            .filter(cell => {
              const text = cell.text.trim();
              return /^[\$\(]?[\d,]+(?:\.[\d]+)?\s*[BMK\)]?$/.test(text) || 
                     /^\(?[\d,]+(?:\.[\d]+)?\)?\s*[BMK]?$/.test(text);
            });

          if (numericCells.length > 0) {
            numericCells.sort((a, b) => a.col - b.col);
            
            // Take first number found (leftmost) - that's usually the right column for single-year statements
            const numCell = numericCells[0];
            const value = this.parseNumber(numCell.text);
            
            if (value !== null) {
              // Single number in row = higher confidence (no ambiguity about which column)
              let confidence = numericCells.length === 1 ? 95 : 90;
              
              // Closer to label = more likely to be the right value
              if (numCell.col - labelCell.col < 3) {
                confidence += 3;
              }
              
              results.push({
                value,
                source: `Table: ${table.title || 'Unnamed'} (page ${table.page}, row ${rowCells[0]?.row || 0})`,
                confidence,
                page: table.page,
                bbox: numCell.bbox,
                context: `${labelCell.text} | ${numCell.text}`,
              });
              
              // Only take first number from row - multi-column tables have years/periods, I want the main value
              continue;
            }
          }
        }
      }
    }

    return results;
  }

  private extractFromText(patterns: RegExp[], minValue: number, maxValue: number): ExtractionResult[] {
    const results: ExtractionResult[] = [];

    // Prioritize consolidated statements - they have the real numbers, not supplementary tables
    const consolidatedSections = [
      /CONSOLIDATED\s+BALANCE\s+SHEETS?([\s\S]{0,10000}?)(?:See|Notes|The accompanying|CONSOLIDATED|$)/i,
      /CONSOLIDATED\s+STATEMENTS?\s+OF\s+(?:INCOME|OPERATIONS)([\s\S]{0,10000}?)(?:See|Notes|The accompanying|CONSOLIDATED|$)/i,
      /CONSOLIDATED\s+STATEMENTS?\s+OF\s+CASH\s+FLOWS?([\s\S]{0,10000}?)(?:See|Notes|The accompanying|CONSOLIDATED|$)/i,
    ];

    let consolidatedText = '';
    for (const sectionPattern of consolidatedSections) {
      const match = this.rawText.match(sectionPattern);
      if (match && match[1]) {
        consolidatedText += match[1] + '\n\n';
      }
    }

    // Search consolidated section first, fall back to full text if nothing found
    const searchTexts = consolidatedText.length > 500 
      ? [consolidatedText, this.rawText] 
      : [this.rawText];

    for (const searchText of searchTexts) {
      // Process line-by-line: find label, then number on same line (row reading)
      const lines = searchText.split(/\r?\n/);
      
      for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        const line = lines[lineIdx];
        const nextLine = lineIdx < lines.length - 1 ? lines[lineIdx + 1] : '';
        
        for (const pattern of patterns) {
          if (pattern.test(line)) {
            // Same-line match is best (label and value on same row)
            const sameLineNumberMatch = line.match(/[\$\(]?\s*([\d,]+(?:\.[\d]+)?)\s*([BMK])?/g);
            
            if (sameLineNumberMatch && sameLineNumberMatch.length > 0) {
              // Multiple numbers might be on same line - process each
              for (const numMatch of sameLineNumberMatch) {
                const numPattern = /[\$\(]?\s*([\d,]+(?:\.[\d]+)?)\s*([BMK])?/;
                const numGroups = numMatch.match(numPattern);
                if (numGroups) {
                  const numberText = numGroups[1];
                  const suffix = numGroups[2];
                  let parseText = numberText;
                  if (suffix) parseText += suffix;
                  
                  const value = this.parseNumber(parseText);
                  if (value !== null && value >= minValue && value <= maxValue) {
                    // Same-line matches in consolidated sections are most reliable
                    let confidence = searchText === consolidatedText ? 90 : 80;
                    
                    // Bigger numbers are usually the main values (not footnotes)
                    if (value > 10000000000) confidence += 5;
                    
                    // Tab-separated = structured table row = higher confidence
                    if (/\t| {3,}/.test(line)) confidence += 5;
                    
                    results.push({
                      value,
                      source: searchText === consolidatedText ? 'Consolidated statement (same line)' : 'Text extraction (same line)',
                      confidence,
                      page: 0,
                      context: line.substring(0, 200),
                    });
                  }
                }
              }
            } else {
              // Fallback: some filings put value on next line (less ideal but better than nothing)
              const nextLineNumberMatch = nextLine.match(/[\$\(]?\s*([\d,]+(?:\.[\d]+)?)\s*([BMK])?/);
              if (nextLineNumberMatch) {
                const numberText = nextLineNumberMatch[1];
                const suffix = nextLineNumberMatch[2];
                let parseText = numberText;
                if (suffix) parseText += suffix;
                
                const value = this.parseNumber(parseText);
                if (value !== null && value >= minValue && value <= maxValue) {
                  // Next-line matches are less reliable - could be unrelated number
                  let confidence = searchText === consolidatedText ? 75 : 65;
                  
                  if (value > 10000000000) confidence += 5;
                  
                  results.push({
                    value,
                    source: searchText === consolidatedText ? 'Consolidated statement (next line)' : 'Text extraction (next line)',
                    confidence,
                    page: 0,
                    context: (line + ' ' + nextLine).substring(0, 200),
                  });
                }
              }
            }
          }
        }
      }
      
      // If I found same-line matches in consolidated section, use those (most reliable)
      if (searchText === consolidatedText && results.length > 0) {
        const sameLineResults = results.filter(r => r.source.includes('same line') && r.source.includes('Consolidated'));
        if (sameLineResults.length > 0) {
          return sameLineResults;
        }
      }
      
      // Got good results from consolidated section, no need to search full document
      if (searchText === consolidatedText && results.length > 0) {
        break;
      }
    }

    return results;
  }

  private parseNumber(text: string): number | null {
    // Parentheses mean negative in accounting (e.g., (123) = -123)
    const hasParens = text.includes('(') && text.includes(')');
    let cleaned = text.replace(/[\$,]/g, '').replace(/[()]/g, '').trim();
    
    // If number has explicit suffix (B/M/K), use that; otherwise use document scale
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
      // No explicit suffix - apply document scale (usually millions)
      multiplier = this.documentScale.multiplier;
    }

    const num = parseFloat(cleaned);
    if (isNaN(num) || num === 0) return null;

    const result = num * multiplier;
    return hasParens ? -result : result;
  }
  
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
      // Balance sheet must balance: Assets = Liabilities + Equity (within 5% tolerance for rounding)
      const diff = Math.abs(assets - (liabilities + equity));
      const tolerance = assets * 0.05;
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
      this.logStep(`WARNING: Found ${warnings.length} validation warnings`);
    } else {
      this.logStep('SUCCESS: All validation checks passed');
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

