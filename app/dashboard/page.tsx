'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';

// Helper to format numbers
function formatFinancialNumber(num: number | undefined): string {
  if (num === undefined || num === null) return 'N/A';
  if (num >= 1e12) return `$${(num / 1e12).toFixed(2)}T`;
  if (num >= 1e9) return `$${(num / 1e9).toFixed(2)}B`;
  if (num >= 1e6) return `$${(num / 1e6).toFixed(2)}M`;
  if (num >= 1e3) return `$${(num / 1e3).toFixed(2)}K`;
  return `$${num.toFixed(2)}`;
}

interface FinancialDocumentSchema {
  metadata: any;
  financials: any;
  tables_found: string[];
  extraction_confidence: number;
  errors: string[];
}

export default function DashboardPage() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState<'dcf' | 'chat'>('dcf');
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parsedData, setParsedData] = useState<FinancialDocumentSchema | null>(null);
  const [parseError, setParseError] = useState<string>('');
  const [chatMessages, setChatMessages] = useState<Array<{role: string, content: string}>>([]);
  const [chatInput, setChatInput] = useState('');
  const router = useRouter();

  useEffect(() => {
    checkUser();
  }, []);

  const checkUser = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        router.push('/login');
        return;
      }

      // Check if email is verified
      if (!session.user.email_confirmed_at) {
        await supabase.auth.signOut();
        router.push('/login?error=Please verify your email before accessing the dashboard');
        return;
      }

      setUser(session.user);
    } catch (error) {
      console.error('Error checking user:', error);
      router.push('/login');
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/');
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFile = e.target.files?.[0];
    if (!uploadedFile) return;

    setFile(uploadedFile);
    setParsing(true);
    setParseError('');
    setParsedData(null);

    try {
      const formData = new FormData();
      formData.append('file', uploadedFile);

      const response = await fetch('/api/parse', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.details || 'Failed to parse document');
      }

      setParsedData(result.data);
    } catch (error: any) {
      console.error('Error uploading file:', error);
      setParseError(error.message || 'Failed to parse document. Please try again.');
    } finally {
      setParsing(false);
    }
  };

  const handleChatSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;

    const userMessage = chatInput;
    const newMessages = [...chatMessages, { role: 'user', content: userMessage }];

    let response = 'Please upload a financial document first to get specific information.';
    
    if (parsedData) {
      const question = userMessage.toLowerCase();
      const { financials, metadata } = parsedData;
      
      if (question.includes('revenue') || question.includes('sales')) {
        response = `${metadata.company_name} reported total revenue of ${formatFinancialNumber(financials.revenues.total)} for the period ending ${metadata.period_end}.`;
      } else if (question.includes('net income') || question.includes('profit')) {
        response = `Net income was ${formatFinancialNumber(financials.income.net_income)} for the period.`;
      } else if (question.includes('operating income')) {
        response = `Operating income was ${formatFinancialNumber(financials.income.operating_income)}.`;
      } else if (question.includes('cash') || question.includes('liquidity')) {
        const total = (financials.assets.cash || 0) + (financials.assets.marketable_securities || 0);
        response = `${metadata.company_name} has ${formatFinancialNumber(financials.assets.cash)} in cash and ${formatFinancialNumber(financials.assets.marketable_securities)} in marketable securities, for a total of ${formatFinancialNumber(total)}.`;
      } else if (question.includes('r&d') || question.includes('research')) {
        response = `Research and development expenses were ${formatFinancialNumber(financials.expenses.research_development)}.`;
      } else if (question.includes('assets')) {
        response = `Total assets: ${formatFinancialNumber(financials.assets.total)}`;
      } else if (question.includes('debt') || question.includes('liabilities')) {
        response = `Total liabilities: ${formatFinancialNumber(financials.liabilities.total)}\nLong-term debt: ${formatFinancialNumber(financials.liabilities.long_term_debt)}`;
      } else if (question.includes('equity')) {
        response = `Total stockholders' equity: ${formatFinancialNumber(financials.equity.total)}`;
      } else if (question.includes('cash flow') || question.includes('fcf')) {
        response = `Operating cash flow: ${formatFinancialNumber(financials.cash_flow.operating)}\nFree cash flow: ${formatFinancialNumber(financials.cash_flow.free_cash_flow)}`;
      } else if (question.includes('summary') || question.includes('overview')) {
        response = `Financial Summary for ${metadata.company_name} (${metadata.document_type}):\n\n• Period: ${metadata.period_end}\n• Revenue: ${formatFinancialNumber(financials.revenues.total)}\n• Net Income: ${formatFinancialNumber(financials.income.net_income)}\n• Operating Income: ${formatFinancialNumber(financials.income.operating_income)}\n• Total Assets: ${formatFinancialNumber(financials.assets.total)}\n• Cash: ${formatFinancialNumber(financials.assets.cash)}\n• Operating Cash Flow: ${formatFinancialNumber(financials.cash_flow.operating)}`;
      } else {
        response = `I've analyzed the ${metadata.document_type} for ${metadata.company_name}. Ask me about revenue, net income, cash flow, assets, liabilities, equity, R&D, or request a summary.`;
      }
    }

    newMessages.push({ role: 'assistant', content: response });
    setChatMessages(newMessages);
    setChatInput('');
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black">
        <div className="text-white text-xl">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Top Navigation */}
      <nav className="bg-zinc-900 border-b border-zinc-800">
        <div className="max-w-full mx-auto px-6">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-8">
              <h1 className="text-xl font-bold">Financial Modeling</h1>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-gray-400 text-sm">{user?.email}</span>
              <button
                onClick={handleSignOut}
                className="px-4 py-2 bg-zinc-800 text-white rounded-lg hover:bg-zinc-700 transition-all text-sm"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      </nav>

      <div className="flex h-[calc(100vh-4rem)]">
        {/* Left Sidebar */}
        <div className="w-64 bg-zinc-900 border-r border-zinc-800 flex flex-col">
          <div className="p-4 border-b border-zinc-800">
            <h2 className="text-sm font-semibold text-gray-400 uppercase">Analysis Tools</h2>
          </div>
          
          <div className="flex-1 overflow-y-auto">
            <button
              onClick={() => setActiveSection('dcf')}
              className={`w-full text-left px-4 py-3 text-sm transition-colors ${
                activeSection === 'dcf'
                  ? 'bg-zinc-800 text-white border-l-2 border-white'
                  : 'text-gray-400 hover:bg-zinc-800/50 hover:text-white'
              }`}
            >
              Document Parser
            </button>
            
            <button
              onClick={() => setActiveSection('chat')}
              className={`w-full text-left px-4 py-3 text-sm transition-colors ${
                activeSection === 'chat'
                  ? 'bg-zinc-800 text-white border-l-2 border-white'
                  : 'text-gray-400 hover:bg-zinc-800/50 hover:text-white'
              }`}
            >
              Ask Questions
            </button>
          </div>

          <div className="p-4 border-t border-zinc-800">
            <a
              href="/demo"
              className="block w-full text-center px-4 py-2 bg-white text-black rounded-lg hover:bg-gray-200 transition-all text-sm font-medium"
            >
              Open DCF Tool
            </a>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 overflow-y-auto">
          {activeSection === 'dcf' && (
            <div className="p-8">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
              >
                <h2 className="text-3xl font-bold mb-2">Financial Document Parser</h2>
                <p className="text-gray-400 mb-8">Upload any 10-Q, 10-K, or SEC filing to extract structured financial data</p>

                {/* File Upload Area */}
                <div className="mb-8">
                  <label
                    htmlFor="file-upload"
                    className="flex flex-col items-center justify-center w-full h-64 border-2 border-dashed border-zinc-700 rounded-lg cursor-pointer hover:bg-zinc-900/50 transition-all"
                  >
                    <div className="flex flex-col items-center justify-center pt-5 pb-6">
                      <svg
                        className="w-12 h-12 mb-4 text-gray-400"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                        />
                      </svg>
                      <p className="mb-2 text-sm text-gray-400">
                        <span className="font-semibold">Click to upload</span> or drag and drop
                      </p>
                      <p className="text-xs text-gray-500">10-Q, 10-K, or any SEC filing (PDF, MAX. 50MB)</p>
                      {file && <p className="mt-2 text-sm text-white">Selected: {file.name}</p>}
                    </div>
                    <input
                      id="file-upload"
                      type="file"
                      className="hidden"
                      accept=".pdf"
                      onChange={handleFileUpload}
                    />
                  </label>
                </div>

                {/* Parsing Indicator */}
                {parsing && (
                  <div className="mb-8 p-4 bg-zinc-900 rounded-lg border border-zinc-800">
                    <div className="flex items-center gap-3">
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                      <span className="text-sm">Parsing document and extracting financial data...</span>
                    </div>
                  </div>
                )}

                {/* Error Display */}
                {parseError && (
                  <div className="mb-8 p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
                    <p className="text-red-400">{parseError}</p>
                  </div>
                )}

                {/* Parsed Data Display */}
                {parsedData && !parsing && (
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="space-y-6"
                  >
                    {/* Confidence Score */}
                    <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 flex items-center justify-between">
                      <div>
                        <p className="text-sm text-blue-400">✓ Document successfully parsed</p>
                        <p className="text-xs text-gray-500 mt-1">Extraction confidence: {parsedData.extraction_confidence}%</p>
                      </div>
                      <div className="text-2xl font-bold">{parsedData.extraction_confidence}%</div>
                    </div>

                    {/* Metadata */}
                    <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-6">
                      <h3 className="text-xl font-semibold mb-4">Document Metadata</h3>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div>
                          <p className="text-sm text-gray-400">Company</p>
                          <p className="text-lg font-medium">{parsedData.metadata.company_name}</p>
                        </div>
                        <div>
                          <p className="text-sm text-gray-400">Type</p>
                          <p className="text-lg font-medium">{parsedData.metadata.document_type}</p>
                        </div>
                        <div>
                          <p className="text-sm text-gray-400">Period End</p>
                          <p className="text-lg font-medium">{parsedData.metadata.period_end || 'N/A'}</p>
                        </div>
                        <div>
                          <p className="text-sm text-gray-400">Industry</p>
                          <p className="text-lg font-medium">{parsedData.financials.assets ? Object.keys(parsedData.financials.assets).length : 0} fields found</p>
                        </div>
                      </div>
                    </div>

                    {/* Income Statement */}
                    <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-6">
                      <h3 className="text-xl font-semibold mb-4">Income Statement</h3>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                        <div>
                          <p className="text-sm text-gray-400 mb-1">Total Revenue</p>
                          <p className="text-2xl font-bold">{formatFinancialNumber(parsedData.financials.revenues.total)}</p>
                        </div>
                        <div>
                          <p className="text-sm text-gray-400 mb-1">Gross Profit</p>
                          <p className="text-2xl font-bold">{formatFinancialNumber(parsedData.financials.revenues.gross_profit)}</p>
                        </div>
                        <div>
                          <p className="text-sm text-gray-400 mb-1">Operating Income</p>
                          <p className="text-2xl font-bold">{formatFinancialNumber(parsedData.financials.income.operating_income)}</p>
                        </div>
                        <div>
                          <p className="text-sm text-gray-400 mb-1">Net Income</p>
                          <p className="text-2xl font-bold">{formatFinancialNumber(parsedData.financials.income.net_income)}</p>
                        </div>
                      </div>
                    </div>

                    {/* Balance Sheet */}
                    <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-6">
                      <h3 className="text-xl font-semibold mb-4">Balance Sheet</h3>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
                        <div>
                          <p className="text-sm text-gray-400 mb-1">Total Assets</p>
                          <p className="text-2xl font-bold">{formatFinancialNumber(parsedData.financials.assets.total)}</p>
                        </div>
                        <div>
                          <p className="text-sm text-gray-400 mb-1">Cash & Equivalents</p>
                          <p className="text-2xl font-bold">{formatFinancialNumber(parsedData.financials.assets.cash)}</p>
                        </div>
                        <div>
                          <p className="text-sm text-gray-400 mb-1">Marketable Securities</p>
                          <p className="text-2xl font-bold">{formatFinancialNumber(parsedData.financials.assets.marketable_securities)}</p>
                        </div>
                        <div>
                          <p className="text-sm text-gray-400 mb-1">Total Liabilities</p>
                          <p className="text-2xl font-bold">{formatFinancialNumber(parsedData.financials.liabilities.total)}</p>
                        </div>
                        <div>
                          <p className="text-sm text-gray-400 mb-1">Long-term Debt</p>
                          <p className="text-2xl font-bold">{formatFinancialNumber(parsedData.financials.liabilities.long_term_debt)}</p>
                        </div>
                        <div>
                          <p className="text-sm text-gray-400 mb-1">Total Equity</p>
                          <p className="text-2xl font-bold">{formatFinancialNumber(parsedData.financials.equity.total)}</p>
                        </div>
                      </div>
                    </div>

                    {/* Cash Flow */}
                    <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-6">
                      <h3 className="text-xl font-semibold mb-4">Cash Flow Statement</h3>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
                        <div>
                          <p className="text-sm text-gray-400 mb-1">Operating Cash Flow</p>
                          <p className="text-2xl font-bold">{formatFinancialNumber(parsedData.financials.cash_flow.operating)}</p>
                        </div>
                        <div>
                          <p className="text-sm text-gray-400 mb-1">CapEx</p>
                          <p className="text-2xl font-bold">{formatFinancialNumber(parsedData.financials.cash_flow.capex)}</p>
                        </div>
                        <div>
                          <p className="text-sm text-gray-400 mb-1">Free Cash Flow</p>
                          <p className="text-2xl font-bold">{formatFinancialNumber(parsedData.financials.cash_flow.free_cash_flow)}</p>
                        </div>
                      </div>
                    </div>

                    {/* Operating Expenses */}
                    <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-6">
                      <h3 className="text-xl font-semibold mb-4">Operating Expenses</h3>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
                        <div>
                          <p className="text-sm text-gray-400 mb-1">R&D</p>
                          <p className="text-2xl font-bold">{formatFinancialNumber(parsedData.financials.expenses.research_development)}</p>
                        </div>
                        <div>
                          <p className="text-sm text-gray-400 mb-1">Sales & Marketing</p>
                          <p className="text-2xl font-bold">{formatFinancialNumber(parsedData.financials.expenses.sales_marketing)}</p>
                        </div>
                        <div>
                          <p className="text-sm text-gray-400 mb-1">G&A</p>
                          <p className="text-2xl font-bold">{formatFinancialNumber(parsedData.financials.expenses.general_administrative)}</p>
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={() => router.push('/demo')}
                      className="w-full py-3 bg-white text-black rounded-lg font-semibold hover:bg-gray-200 transition-all"
                    >
                      Run DCF Analysis with this Data
                    </button>
                  </motion.div>
                )}
              </motion.div>
            </div>
          )}

          {activeSection === 'chat' && (
            <div className="flex flex-col h-full">
              <div className="p-8 border-b border-zinc-800">
                <h2 className="text-3xl font-bold mb-2">Ask Questions</h2>
                <p className="text-gray-400">Ask questions about the uploaded financial document</p>
              </div>

              {/* Chat Messages */}
              <div className="flex-1 overflow-y-auto p-8 space-y-4">
                {chatMessages.length === 0 ? (
                  <div className="flex items-center justify-center h-full">
                    <div className="text-center text-gray-500">
                      <p>No messages yet. Upload a document and start asking questions!</p>
                      <p className="text-sm mt-2">Example: "What was the revenue?" or "Show me a summary"</p>
                    </div>
                  </div>
                ) : (
                  chatMessages.map((msg, idx) => (
                    <div
                      key={idx}
                      className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-2xl rounded-lg p-4 ${
                          msg.role === 'user'
                            ? 'bg-white text-black'
                            : 'bg-zinc-900 text-white border border-zinc-800'
                        }`}
                      >
                        <p className="text-sm whitespace-pre-line">{msg.content}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Chat Input */}
              <div className="p-6 border-t border-zinc-800">
                <form onSubmit={handleChatSubmit} className="flex gap-2">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Ask about revenue, expenses, cash flow, etc..."
                    className="flex-1 px-4 py-3 bg-zinc-900 border border-zinc-800 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-white"
                  />
                  <button
                    type="submit"
                    className="px-6 py-3 bg-white text-black rounded-lg font-semibold hover:bg-gray-200 transition-all"
                  >
                    Send
                  </button>
                </form>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
