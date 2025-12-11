'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Trash2, Edit2, Plus, X, Save, FileText, MessageSquare, Calculator, Settings, ChevronDown, ChevronUp } from 'lucide-react';
import { runDCF, Assumptions, DCFResult } from '@/lib/finance';
import { formatBillions, formatShares, formatPercent, formatWithCommas } from '@/lib/format';
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from 'recharts';

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

interface Document {
  id: string;
  filename: string;
  parsed_data: FinancialDocumentSchema;
  created_at: string;
}

interface Session {
  id: string;
  name: string;
  document_id: string | null;
  messages: Array<{role: string, content: string}>;
  dcf_data: any;
  created_at: string;
  updated_at: string;
  documents?: { filename: string };
}

export default function DashboardPage() {
  const [user, setUser] = useState<any>(null);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState<'analyser' | 'documents' | 'sessions' | 'dcf' | 'settings'>('analyser');
  const [showFullParsedData, setShowFullParsedData] = useState(false);
  const [rawParsedData, setRawParsedData] = useState<any>(null);
  
  // File upload state
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parseProgress, setParseProgress] = useState<string>('Initializing...');
  const [parsedData, setParsedData] = useState<FinancialDocumentSchema | null>(null);
  const [parseError, setParseError] = useState<string>('');
  
  // Documents state
  const [documents, setDocuments] = useState<Document[]>([]);
  const [selectedDocument, setSelectedDocument] = useState<Document | null>(null);
  
  // Sessions state
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  const [chatMessages, setChatMessages] = useState<Array<{role: string, content: string}>>([]);
  const [chatInput, setChatInput] = useState('');
  const [newSessionName, setNewSessionName] = useState('');
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingSessionName, setEditingSessionName] = useState('');
  
  // DCF state
  const [dcfAssumptions, setDcfAssumptions] = useState<Assumptions>({
    revenueGrowth: 0.10,
    ebitMargin: 0.30,
    taxRate: 0.21,
    daPercent: 0.03,
    capexPercent: 0.05,
    nwcPercent: 0.02,
    wacc: 0.09,
    terminalGrowth: 0.03,
  });
  const [dcfResult, setDcfResult] = useState<DCFResult | null>(null);
  const [dcfDocument, setDcfDocument] = useState<Document | null>(null);
  const [dcfShares, setDcfShares] = useState<number>(0);
  
  // Settings state
  const [settingsEmail, setSettingsEmail] = useState('');
  const [settingsFirstName, setSettingsFirstName] = useState('');
  const [settingsLastName, setSettingsLastName] = useState('');
  const [settingsDateOfBirth, setSettingsDateOfBirth] = useState('');
  const [settingsCompany, setSettingsCompany] = useState('');
  const [settingsPosition, setSettingsPosition] = useState('');
  const [deleteAccountConfirm, setDeleteAccountConfirm] = useState('');
  
  const router = useRouter();

  useEffect(() => {
    checkUser();
  }, []);

  useEffect(() => {
    if (user) {
      loadDocuments();
      loadSessions();
    }
  }, [user]);

  useEffect(() => {
    if (selectedSession) {
      setChatMessages(selectedSession.messages || []);
      if (selectedSession.document_id) {
        const doc = documents.find(d => d.id === selectedSession.document_id);
        if (doc) {
          setSelectedDocument(doc);
          setParsedData(doc.parsed_data);
        }
      }
    }
  }, [selectedSession, documents]);

  useEffect(() => {
    if (dcfDocument && dcfDocument.parsed_data) {
      calculateDCF(dcfDocument.parsed_data);
    }
  }, [dcfDocument, dcfAssumptions, dcfShares]);

  const checkUser = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        router.push('/login');
        return;
      }

      if (!session.user.email_confirmed_at) {
        await supabase.auth.signOut();
        router.push('/login?error=Please verify your email before accessing the dashboard');
        return;
      }

      setUser(session.user);

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .single();

      if (profileError) {
        if (profileError.code !== 'PGRST116') {
          console.error('Profile fetch error:', profileError);
        }
      }

      // Use profile if it exists, otherwise create empty profile object
      const profileData = profile || {};
      
      // Ensure we have the user ID
      if (!profileData.id && session.user.id) {
        profileData.id = session.user.id;
      }
      
      // If profile exists but first_name/last_name are null, try to create/update profile
      if (profile && (!profile.first_name || !profile.last_name)) {
        // Profile exists but missing name - user needs to update in settings
      }
      
      setUserProfile(profileData);
      
      // Populate settings form
      setSettingsEmail(session.user.email || '');
      setSettingsFirstName(profileData.first_name || '');
      setSettingsLastName(profileData.last_name || '');
      setSettingsDateOfBirth(profileData.date_of_birth || '');
      setSettingsCompany(profileData.company || '');
      setSettingsPosition(profileData.position || '');
    } catch (error) {
      console.error('Error checking user:', error);
      router.push('/login');
    } finally {
      setLoading(false);
    }
  };

  const getAuthToken = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token || null;
  };

  const loadDocuments = async () => {
    try {
      const token = await getAuthToken();
      if (!token) return;

      const response = await fetch('/api/documents', {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const result = await response.json();
        setDocuments(result.documents || []);
      }
    } catch (error) {
      console.error('Error loading documents:', error);
    }
  };

  const loadSessions = async () => {
    try {
      const token = await getAuthToken();
      if (!token) return;

      const response = await fetch('/api/sessions', {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const result = await response.json();
        setSessions(result.sessions || []);
      }
    } catch (error) {
      console.error('Error loading sessions:', error);
    }
  };

  const saveDocument = async (filename: string, parsedData: FinancialDocumentSchema) => {
    try {
      const token = await getAuthToken();
      if (!token) return;

      const response = await fetch('/api/documents', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filename,
          parsed_data: parsedData,
        }),
      });

      if (response.ok) {
        await loadDocuments();
      }
    } catch (error) {
      console.error('Error saving document:', error);
    }
  };

  const deleteDocument = async (documentId: string) => {
    try {
      const token = await getAuthToken();
      if (!token) return;

      const response = await fetch(`/api/documents?id=${documentId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.ok) {
        await loadDocuments();
        if (selectedDocument?.id === documentId) {
          setSelectedDocument(null);
          setParsedData(null);
        }
      }
    } catch (error) {
      console.error('Error deleting document:', error);
    }
  };

  const createSession = async (name: string, documentId?: string) => {
    try {
      const token = await getAuthToken();
      if (!token) return;

      const response = await fetch('/api/sessions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name,
          document_id: documentId || null,
        }),
      });

      if (response.ok) {
        await loadSessions();
        const result = await response.json();
        setSelectedSession(result.session);
        setNewSessionName('');
      }
    } catch (error) {
      console.error('Error creating session:', error);
    }
  };

  const updateSession = async (sessionId: string, updates: any) => {
    try {
      const token = await getAuthToken();
      if (!token) return;

      const response = await fetch('/api/sessions', {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id: sessionId,
          ...updates,
        }),
      });

      if (response.ok) {
        await loadSessions();
        if (selectedSession?.id === sessionId) {
          const result = await response.json();
          setSelectedSession(result.session);
        }
      }
    } catch (error) {
      console.error('Error updating session:', error);
    }
  };

  const deleteSession = async (sessionId: string) => {
    try {
      const token = await getAuthToken();
      if (!token) return;

      const response = await fetch(`/api/sessions?id=${sessionId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.ok) {
        await loadSessions();
        if (selectedSession?.id === sessionId) {
          setSelectedSession(null);
          setChatMessages([]);
        }
      }
    } catch (error) {
      console.error('Error deleting session:', error);
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
    setParseProgress('Uploading file...');
    setParseError('');
    setParsedData(null);

    const progressMessages = [
      'Uploading file...',
      'Initializing OCR engine...',
      'Extracting text from PDF...',
      'Running OCR recognition (this may take 30-60 seconds for scanned documents)...',
      'Parsing financial data...',
      'Finalizing results...',
    ];

    let progressIndex = 0;
    const progressInterval = setInterval(() => {
      if (progressIndex < progressMessages.length - 1) {
        progressIndex++;
        setParseProgress(progressMessages[progressIndex]);
      }
    }, 5000); // Update progress every 5 seconds

    try {
      const formData = new FormData();
      formData.append('file', uploadedFile);

      setParseProgress('Uploading file and initializing...');

      // Add timeout to fetch (120 seconds total)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 120000); // 2 minutes timeout

      const response = await fetch('/api/parse', {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      clearInterval(progressInterval);

      setParseProgress('Processing response...');

      // Check if response is actually JSON
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const text = await response.text();
        throw new Error(`Server returned non-JSON response: ${text.substring(0, 200)}`);
      }

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || result.details || 'Failed to parse document');
      }

      setParseProgress('Saving document...');
      setParsedData(result.data);
      setRawParsedData(result.advanced || result.data); // Store full parsed data
      
      // Auto-save document
      await saveDocument(uploadedFile.name, result.data);
      await loadDocuments();
      setParseProgress('Complete!');
    } catch (error: any) {
      clearInterval(progressInterval);
      console.error('Error uploading file:', error);
      
      if (error.name === 'AbortError') {
        setParseError('Request timed out after 2 minutes. The document may be too large or complex. Please try a smaller file or contact support.');
      } else {
      setParseError(error.message || 'Failed to parse document. Please try again.');
      }
    } finally {
      setParsing(false);
      setParseProgress('Initializing...');
    }
  };

  const handleChatSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || !selectedSession) return;

    const userMessage = chatInput;
    const newMessages = [...chatMessages, { role: 'user', content: userMessage }];
    setChatMessages(newMessages);
    setChatInput('');

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

    const updatedMessages = [...newMessages, { role: 'assistant', content: response }];
    setChatMessages(updatedMessages);
    
    // Save messages to session
    await updateSession(selectedSession.id, { messages: updatedMessages });
  };

  const calculateDCF = (docData: FinancialDocumentSchema) => {
    if (!docData?.financials) {
      setDcfResult(null);
      return;
    }

    const revenue = docData.financials.revenues?.total || 0;
    
    // Use manual shares input if provided, otherwise try to extract
    let shares = dcfShares > 0 ? dcfShares : 0;
    
    if (!shares || shares <= 0) {
      // Try to extract shares from equity section - common in balance sheets
      shares = 0; // Don't use default, require user input
      
      // Try to get from metadata if available
      if (docData.metadata?.shares_outstanding) {
        shares = parseFloat(String(docData.metadata.shares_outstanding)) || 0;
      }
      
      // Estimate from equity if market cap info might be in document
      const totalEquity = docData.financials.equity?.total;
      if (!shares && totalEquity && totalEquity > 0) {
        // Very rough estimate: assume stock price around $100-200, calculate shares
        const estimatedPricePerShare = 150;
        shares = Math.round(totalEquity / estimatedPricePerShare);
      }
      
      // If still no shares, set to 0 to require user input
      if (!shares || shares <= 0) {
        setDcfResult(null);
        return; // Don't calculate without valid shares
      }
    }
    
    const cash = docData.financials.assets?.cash || 0;
    const debt = docData.financials.liabilities?.long_term_debt || docData.financials.liabilities?.total || 0;

    // Validate assumptions
    if (dcfAssumptions.wacc <= dcfAssumptions.terminalGrowth) {
      alert('WACC must be greater than Terminal Growth Rate for valid DCF calculation');
      return;
    }

    const result = runDCF(revenue, shares, cash, debt, dcfAssumptions);
    setDcfResult(result);
    
    // Save DCF data to session if one is selected
    if (selectedSession) {
      updateSession(selectedSession.id, { dcf_data: { assumptions: dcfAssumptions, result, shares_used: shares } });
    }
  };

  const updateAssumption = (key: keyof Assumptions, value: number) => {
    setDcfAssumptions(prev => ({ ...prev, [key]: value }));
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
      <nav className="bg-black border-b border-white/20">
        <div className="max-w-full mx-auto px-6">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-4">
              <h1 className="text-xl font-bold text-white">Analyst</h1>
              {userProfile && (
                <span className="text-white/70 text-sm">
                  Welcome {
                    (() => {
                      const firstName = (userProfile.first_name || '').trim();
                      const lastName = (userProfile.last_name || '').trim();
                      if (firstName || lastName) {
                        return [firstName, lastName].filter(Boolean).join(' ');
                      }
                      return user?.email?.split('@')[0] || 'User';
                    })()
                  }
                  {userProfile.company && `, ${userProfile.company}`}
                </span>
              )}
            </div>
            <div className="flex items-center gap-4">
              <button
                onClick={() => setActiveSection('settings')}
                className="px-4 py-2 bg-white/10 text-white rounded-lg hover:bg-white/20 transition-all text-sm font-medium"
              >
                Settings
              </button>
              <button
                onClick={handleSignOut}
                className="px-4 py-2 bg-white text-black rounded-lg hover:bg-white/90 transition-all text-sm font-medium"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      </nav>

      <div className="flex h-[calc(100vh-4rem)]">
        {/* Left Sidebar */}
        <div className="w-64 bg-black border-r border-white/20 flex flex-col">
          <div className="p-4 border-b border-white/20">
            <h2 className="text-sm font-semibold text-white/50 uppercase">Analysis Tools</h2>
          </div>
          
          <div className="flex-1 overflow-y-auto">
            <button
              onClick={() => setActiveSection('analyser')}
              className={`w-full text-left px-4 py-3 text-sm transition-colors flex items-center gap-2 ${
                activeSection === 'analyser'
                  ? 'bg-white/10 text-white border-l-2 border-white'
                  : 'text-white/50 hover:bg-white/5 hover:text-white'
              }`}
            >
              <FileText size={16} />
              Analyser
            </button>
            
            <button
              onClick={() => setActiveSection('documents')}
              className={`w-full text-left px-4 py-3 text-sm transition-colors flex items-center gap-2 ${
                activeSection === 'documents'
                  ? 'bg-white/10 text-white border-l-2 border-white'
                  : 'text-white/50 hover:bg-white/5 hover:text-white'
              }`}
            >
              <FileText size={16} />
              Documents ({documents.length})
            </button>
            
            <button
              onClick={() => setActiveSection('sessions')}
              className={`w-full text-left px-4 py-3 text-sm transition-colors flex items-center gap-2 ${
                activeSection === 'sessions'
                  ? 'bg-white/10 text-white border-l-2 border-white'
                  : 'text-white/50 hover:bg-white/5 hover:text-white'
              }`}
            >
              <MessageSquare size={16} />
              Sessions ({sessions.length})
            </button>

            <button
              onClick={() => setActiveSection('dcf')}
              className={`w-full text-left px-4 py-3 text-sm transition-colors flex items-center gap-2 ${
                activeSection === 'dcf'
                  ? 'bg-white/10 text-white border-l-2 border-white'
                  : 'text-white/50 hover:bg-white/5 hover:text-white'
              }`}
            >
              <Calculator size={16} />
              DCF Analysis
            </button>
            
            <button
              onClick={() => setActiveSection('settings')}
              className={`w-full text-left px-4 py-3 text-sm transition-colors flex items-center gap-2 ${
                activeSection === 'settings'
                  ? 'bg-white/10 text-white border-l-2 border-white'
                  : 'text-white/50 hover:bg-white/5 hover:text-white'
              }`}
            >
              <Save size={16} />
              Settings
            </button>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 overflow-y-auto bg-black">
          {activeSection === 'analyser' && (
            <div className="p-8">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
              >
                <h3 className="text-2xl font-bold mb-2 text-white">Analyser</h3>
                <p className="text-white/50 mb-8">Upload any 10-Q, 10-K, or SEC filing to extract structured financial data</p>

                {/* File Upload Area */}
                <div className="mb-8">
                  <label
                    htmlFor="file-upload"
                    className="flex flex-col items-center justify-center w-full h-64 border-2 border-dashed border-white/30 rounded-lg cursor-pointer hover:bg-white/5 transition-all"
                  >
                    <div className="flex flex-col items-center justify-center pt-5 pb-6">
                      <svg
                        className="w-12 h-12 mb-4 text-white/50"
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
                      <p className="mb-2 text-sm text-white/70">
                        <span className="font-semibold">Click to upload</span> or drag and drop
                      </p>
                      <p className="text-xs text-white/50">10-Q, 10-K, or any SEC filing (PDF, MAX. 50MB)</p>
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
                  <div className="mb-8 p-6 bg-white/5 rounded-lg border border-white/20">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                      <span className="text-sm text-white font-medium">Processing Document</span>
                    </div>
                    <p className="text-xs text-white/70 ml-8 mb-4">{parseProgress}</p>
                    <div className="w-full bg-white/10 rounded-full h-2 overflow-hidden">
                      <div 
                        className="h-full bg-white rounded-full animate-pulse"
                        style={{ 
                          width: '100%',
                          animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite'
                        }}
                      />
                    </div>
                    <p className="text-xs text-white/50 mt-3 ml-8">
                      Large documents may take 30-90 seconds. Please wait...
                    </p>
                  </div>
                )}

                {/* Error Display */}
                {parseError && (
                  <div className="mb-8 p-4 bg-red-500/20 border border-red-500/50 rounded-lg">
                    <p className="text-white">{parseError}</p>
                  </div>
                )}

                {/* Parsed Data Display - Same as before */}
                {parsedData && !parsing && (
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="space-y-6"
                  >
                    <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 flex items-center justify-between">
                      <div>
                        <p className="text-sm text-blue-400">Document successfully parsed</p>
                        <p className="text-xs text-gray-500 mt-1">Extraction confidence: {parsedData.extraction_confidence}%</p>
                      </div>
                      <div className="text-2xl font-bold">{parsedData.extraction_confidence}%</div>
                    </div>

                    {/* Metadata and Financial Data sections - keeping the same format as original */}
                    <div className="bg-white/5 rounded-lg border border-white/20 p-6">
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
                          <p className="text-sm text-gray-400">Confidence</p>
                          <p className="text-lg font-medium">{parsedData.extraction_confidence}%</p>
                        </div>
                      </div>
                    </div>

                    {/* Expandable Full Parsed Data View */}
                    <div className="bg-white/5 rounded-lg border border-white/20 p-6">
                      <button
                        onClick={() => setShowFullParsedData(!showFullParsedData)}
                        className="w-full flex items-center justify-between text-left mb-4 hover:opacity-80 transition-opacity"
                      >
                        <h3 className="text-xl font-semibold">View All Parsed Data</h3>
                        {showFullParsedData ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                      </button>
                      {showFullParsedData && rawParsedData && (() => {
                        // Helper to extract value from either ExtractionResult or plain number
                        const getValue = (data: any) => {
                          if (!data) return null;
                          if (typeof data === 'number') return data;
                          if (data.value !== undefined) return data.value;
                          return null;
                        };

                        const getConfidence = (data: any) => {
                          if (!data || typeof data === 'number') return null;
                          return data.confidence;
                        };

                        const getPage = (data: any) => {
                          if (!data || typeof data === 'number') return null;
                          return data.page;
                        };

                        const getContext = (data: any) => {
                          if (!data || typeof data === 'number') return null;
                          return data.context;
                        };

                        return (
                        <div className="mt-4 space-y-6 max-h-[800px] overflow-y-auto">
                          {/* Complete Metadata */}
                          <div className="bg-black/30 rounded-lg border border-white/10 p-6">
                            <h4 className="text-lg font-semibold mb-4 text-white border-b border-white/20 pb-2">Complete Metadata</h4>
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                              {rawParsedData.metadata && Object.entries(rawParsedData.metadata).map(([key, value]) => (
                                <div key={key} className="bg-white/5 rounded p-3">
                                  <p className="text-xs text-white/60 uppercase mb-1">{key.replace(/_/g, ' ')}</p>
                                  <p className="text-sm font-medium text-white">{String(value || 'N/A')}</p>
                                </div>
                              ))}
                            </div>
                          </div>

                          {/* Detailed Financials */}
                          <div className="bg-black/30 rounded-lg border border-white/10 p-6">
                            <h4 className="text-lg font-semibold mb-4 text-white border-b border-white/20 pb-2">Detailed Financial Data</h4>
                            
                            {/* Assets */}
                            {rawParsedData.financials?.assets && (
                              <div className="mb-6">
                                <h5 className="text-md font-semibold mb-3 text-white/90">Assets</h5>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                  {Object.entries(rawParsedData.financials.assets).map(([key, data]: [string, any]) => {
                                    const value = getValue(data);
                                    const confidence = getConfidence(data);
                                    const page = getPage(data);
                                    const context = getContext(data);
                                    
                                    return value !== null && (
                                      <div key={key} className="bg-white/5 rounded p-3 border border-white/10">
                                        <p className="text-xs text-white/60 uppercase mb-1">{key.replace(/_/g, ' ')}</p>
                                        <p className="text-lg font-bold text-white mb-1">{formatFinancialNumber(value)}</p>
                                        {(confidence !== null || page !== null) && (
                                          <div className="flex gap-4 text-xs text-white/50">
                                            {confidence !== null && <span>Confidence: {confidence.toFixed(0)}%</span>}
                                            {page !== null && <span>Page: {page}</span>}
                                          </div>
                                        )}
                                        {context && (
                                          <p className="text-xs text-white/40 mt-2 italic">"{context}"</p>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                            {/* Liabilities */}
                            {rawParsedData.financials?.liabilities && (
                              <div className="mb-6">
                                <h5 className="text-md font-semibold mb-3 text-white/90">Liabilities</h5>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                  {Object.entries(rawParsedData.financials.liabilities).map(([key, data]: [string, any]) => {
                                    const value = getValue(data);
                                    const confidence = getConfidence(data);
                                    const page = getPage(data);
                                    const context = getContext(data);
                                    
                                    return value !== null && (
                                      <div key={key} className="bg-white/5 rounded p-3 border border-white/10">
                                        <p className="text-xs text-white/60 uppercase mb-1">{key.replace(/_/g, ' ')}</p>
                                        <p className="text-lg font-bold text-white mb-1">{formatFinancialNumber(value)}</p>
                                        {(confidence !== null || page !== null) && (
                                          <div className="flex gap-4 text-xs text-white/50">
                                            {confidence !== null && <span>Confidence: {confidence.toFixed(0)}%</span>}
                                            {page !== null && <span>Page: {page}</span>}
                                          </div>
                                        )}
                                        {context && (
                                          <p className="text-xs text-white/40 mt-2 italic">"{context}"</p>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                            {/* Equity */}
                            {rawParsedData.financials?.equity && (
                              <div className="mb-6">
                                <h5 className="text-md font-semibold mb-3 text-white/90">Equity</h5>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                  {Object.entries(rawParsedData.financials.equity).map(([key, data]: [string, any]) => {
                                    const value = getValue(data);
                                    const confidence = getConfidence(data);
                                    const page = getPage(data);
                                    const context = getContext(data);
                                    
                                    return value !== null && (
                                      <div key={key} className="bg-white/5 rounded p-3 border border-white/10">
                                        <p className="text-xs text-white/60 uppercase mb-1">{key.replace(/_/g, ' ')}</p>
                                        <p className="text-lg font-bold text-white mb-1">{formatFinancialNumber(value)}</p>
                                        {(confidence !== null || page !== null) && (
                                          <div className="flex gap-4 text-xs text-white/50">
                                            {confidence !== null && <span>Confidence: {confidence.toFixed(0)}%</span>}
                                            {page !== null && <span>Page: {page}</span>}
                                          </div>
                                        )}
                                        {context && (
                                          <p className="text-xs text-white/40 mt-2 italic">"{context}"</p>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                            {/* Revenues */}
                            {rawParsedData.financials?.revenues && (
                              <div className="mb-6">
                                <h5 className="text-md font-semibold mb-3 text-white/90">Revenues</h5>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                  {Object.entries(rawParsedData.financials.revenues).map(([key, data]: [string, any]) => {
                                    const value = getValue(data);
                                    const confidence = getConfidence(data);
                                    const page = getPage(data);
                                    const context = getContext(data);
                                    
                                    return value !== null && (
                                      <div key={key} className="bg-white/5 rounded p-3 border border-white/10">
                                        <p className="text-xs text-white/60 uppercase mb-1">{key.replace(/_/g, ' ')}</p>
                                        <p className="text-lg font-bold text-white mb-1">{formatFinancialNumber(value)}</p>
                                        {(confidence !== null || page !== null) && (
                                          <div className="flex gap-4 text-xs text-white/50">
                                            {confidence !== null && <span>Confidence: {confidence.toFixed(0)}%</span>}
                                            {page !== null && <span>Page: {page}</span>}
                                          </div>
                                        )}
                                        {context && (
                                          <p className="text-xs text-white/40 mt-2 italic">"{context}"</p>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                            {/* Expenses */}
                            {rawParsedData.financials?.expenses && (
                              <div className="mb-6">
                                <h5 className="text-md font-semibold mb-3 text-white/90">Expenses</h5>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                  {Object.entries(rawParsedData.financials.expenses).map(([key, data]: [string, any]) => {
                                    const value = getValue(data);
                                    const confidence = getConfidence(data);
                                    const page = getPage(data);
                                    const context = getContext(data);
                                    
                                    return value !== null && (
                                      <div key={key} className="bg-white/5 rounded p-3 border border-white/10">
                                        <p className="text-xs text-white/60 uppercase mb-1">{key.replace(/_/g, ' ')}</p>
                                        <p className="text-lg font-bold text-white mb-1">{formatFinancialNumber(value)}</p>
                                        {(confidence !== null || page !== null) && (
                                          <div className="flex gap-4 text-xs text-white/50">
                                            {confidence !== null && <span>Confidence: {confidence.toFixed(0)}%</span>}
                                            {page !== null && <span>Page: {page}</span>}
                                          </div>
                                        )}
                                        {context && (
                                          <p className="text-xs text-white/40 mt-2 italic">"{context}"</p>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                            {/* Income */}
                            {rawParsedData.financials?.income && (
                              <div className="mb-6">
                                <h5 className="text-md font-semibold mb-3 text-white/90">Income</h5>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                  {Object.entries(rawParsedData.financials.income).map(([key, data]: [string, any]) => {
                                    const value = getValue(data);
                                    const confidence = getConfidence(data);
                                    const page = getPage(data);
                                    const context = getContext(data);
                                    
                                    return value !== null && (
                                      <div key={key} className="bg-white/5 rounded p-3 border border-white/10">
                                        <p className="text-xs text-white/60 uppercase mb-1">{key.replace(/_/g, ' ')}</p>
                                        <p className="text-lg font-bold text-white mb-1">{formatFinancialNumber(value)}</p>
                                        {(confidence !== null || page !== null) && (
                                          <div className="flex gap-4 text-xs text-white/50">
                                            {confidence !== null && <span>Confidence: {confidence.toFixed(0)}%</span>}
                                            {page !== null && <span>Page: {page}</span>}
                                          </div>
                                        )}
                                        {context && (
                                          <p className="text-xs text-white/40 mt-2 italic">"{context}"</p>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                            {/* Cash Flow */}
                            {rawParsedData.financials?.cash_flow && (
                              <div>
                                <h5 className="text-md font-semibold mb-3 text-white/90">Cash Flow</h5>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                  {Object.entries(rawParsedData.financials.cash_flow).map(([key, data]: [string, any]) => {
                                    const value = getValue(data);
                                    const confidence = getConfidence(data);
                                    const page = getPage(data);
                                    const context = getContext(data);
                                    
                                    return value !== null && (
                                      <div key={key} className="bg-white/5 rounded p-3 border border-white/10">
                                        <p className="text-xs text-white/60 uppercase mb-1">{key.replace(/_/g, ' ')}</p>
                                        <p className="text-lg font-bold text-white mb-1">{formatFinancialNumber(value)}</p>
                                        {(confidence !== null || page !== null) && (
                                          <div className="flex gap-4 text-xs text-white/50">
                                            {confidence !== null && <span>Confidence: {confidence.toFixed(0)}%</span>}
                                            {page !== null && <span>Page: {page}</span>}
                                          </div>
                                        )}
                                        {context && (
                                          <p className="text-xs text-white/40 mt-2 italic">"{context}"</p>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                          </div>

                          {/* Tables Detected */}
                          {rawParsedData.tables_detected && rawParsedData.tables_detected.length > 0 && (
                            <div className="bg-black/30 rounded-lg border border-white/10 p-6">
                              <h4 className="text-lg font-semibold mb-4 text-white border-b border-white/20 pb-2">
                                Tables Detected ({rawParsedData.tables_detected.length})
                              </h4>
                              <div className="space-y-4">
                                {rawParsedData.tables_detected.map((table: any, idx: number) => (
                                  <div key={idx} className="bg-white/5 rounded p-4 border border-white/10">
                                    <div className="flex justify-between items-start mb-2">
                                      <div>
                                        <p className="font-semibold text-white">{table.title || `Table ${idx + 1}`}</p>
                                        <p className="text-xs text-white/60 capitalize">{table.type?.replace(/_/g, ' ') || 'Unknown'}</p>
                                      </div>
                                      <span className="text-xs text-white/50">Page {table.page || 'N/A'}</span>
                                    </div>
                                    {table.headers && table.headers.length > 0 && (
                                      <div className="mt-3">
                                        <p className="text-xs text-white/60 mb-2">Headers:</p>
                                        <div className="flex flex-wrap gap-2">
                                          {table.headers.map((header: string, hIdx: number) => (
                                            <span key={hIdx} className="px-2 py-1 bg-white/10 rounded text-xs text-white/80">
                                              {header}
                                            </span>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                    {table.rows && table.rows.length > 0 && (
                                      <p className="text-xs text-white/50 mt-2">{table.rows.length} rows detected</p>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Validation Warnings */}
                          {rawParsedData.validation_warnings && rawParsedData.validation_warnings.length > 0 && (
                            <div className="bg-yellow-500/10 rounded-lg border border-yellow-500/30 p-6">
                              <h4 className="text-lg font-semibold mb-4 text-yellow-400 border-b border-yellow-500/30 pb-2">
                                Validation Warnings ({rawParsedData.validation_warnings.length})
                              </h4>
                              <ul className="space-y-2">
                                {rawParsedData.validation_warnings.map((warning: string, idx: number) => (
                                  <li key={idx} className="text-sm text-yellow-200 flex items-start gap-2">
                                    <span className="text-yellow-400 mt-0.5">!</span>
                                    <span>{warning}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}

                        </div>
                        );
                      })()}
                    </div>

                    <div className="flex gap-4">
                      <button
                        onClick={() => {
                          setDcfDocument({ id: 'current', filename: file?.name || 'current', parsed_data: parsedData, created_at: new Date().toISOString() });
                          setActiveSection('dcf');
                        }}
                        className="flex-1 py-3 bg-white text-black rounded-lg font-semibold hover:bg-gray-200 transition-all"
                      >
                        Run DCF Analysis
                      </button>
                      <button
                        onClick={() => {
                          setNewSessionName(`Session - ${parsedData.metadata.company_name || 'New'}`);
                          setActiveSection('sessions');
                        }}
                        className="flex-1 py-3 bg-white/10 text-white border border-white/20 rounded-lg font-semibold hover:bg-white/20 transition-all"
                      >
                        Create Session
                      </button>
                    </div>
                  </motion.div>
                )}
              </motion.div>
            </div>
          )}

          {activeSection === 'documents' && (
            <div className="p-8">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-2xl font-bold text-white">Documents</h3>
              </div>

              {documents.length === 0 ? (
                <div className="text-center py-12 text-white/50">
                  <FileText size={48} className="mx-auto mb-4 opacity-50" />
                  <p>No documents uploaded yet</p>
                  <p className="text-sm mt-2">Upload a document in the Analyser section</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {documents.map((doc) => (
                    <motion.div
                      key={doc.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="bg-white/5 border border-white/20 rounded-lg p-4 hover:bg-white/10 transition-all"
                    >
                      <div className="flex justify-between items-start mb-3">
                        <div className="flex-1">
                          <h4 className="font-semibold text-white mb-1 truncate">{doc.filename}</h4>
                          <p className="text-xs text-white/50">
                            {new Date(doc.created_at).toLocaleDateString()}
                          </p>
                          {doc.parsed_data?.metadata && (
                            <p className="text-xs text-white/70 mt-1">
                              {doc.parsed_data.metadata.company_name} • {doc.parsed_data.metadata.document_type}
                            </p>
                          )}
                        </div>
                        <button
                          onClick={() => deleteDocument(doc.id)}
                          className="ml-2 p-2 hover:bg-red-500/20 rounded transition-colors"
                        >
                          <Trash2 size={16} className="text-red-400" />
                        </button>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            setSelectedDocument(doc);
                            setParsedData(doc.parsed_data);
                            setActiveSection('analyser');
                          }}
                          className="flex-1 px-3 py-2 bg-white/10 hover:bg-white/20 rounded text-sm transition-colors"
                        >
                          View
                        </button>
                        <button
                          onClick={() => {
                            setDcfDocument(doc);
                            setActiveSection('dcf');
                          }}
                          className="flex-1 px-3 py-2 bg-white/10 hover:bg-white/20 rounded text-sm transition-colors"
                        >
                          DCF
                        </button>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeSection === 'sessions' && (
            <div className="flex flex-col h-full">
              <div className="p-8 border-b border-white/20">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-3xl font-bold">Sessions</h2>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newSessionName}
                      onChange={(e) => setNewSessionName(e.target.value)}
                      placeholder="New session name..."
                      className="px-4 py-2 bg-white/5 border border-white/20 rounded-lg text-white placeholder-white/50"
                    />
                    <button
                      onClick={() => {
                        if (newSessionName.trim()) {
                          createSession(newSessionName.trim(), selectedDocument?.id);
                        }
                      }}
                      className="px-4 py-2 bg-white text-black rounded-lg font-semibold hover:bg-gray-200 transition-all flex items-center gap-2"
                    >
                      <Plus size={16} />
                      New Session
                    </button>
                  </div>
                </div>

                {/* Sessions List */}
                <div className="flex gap-2 flex-wrap">
                  {sessions.map((session) => (
                    <div
                      key={session.id}
                      className={`px-4 py-2 rounded-lg border cursor-pointer transition-all flex items-center gap-2 ${
                        selectedSession?.id === session.id
                          ? 'bg-white text-black border-white'
                          : 'bg-white/5 text-white border-white/20 hover:bg-white/10'
                      }`}
                      onClick={() => setSelectedSession(session)}
                    >
                      {editingSessionId === session.id ? (
                        <>
                          <input
                            type="text"
                            value={editingSessionName}
                            onChange={(e) => setEditingSessionName(e.target.value)}
                            className="bg-transparent border-b border-white/50 px-1 flex-1 min-w-[100px]"
                            autoFocus
                            onBlur={() => {
                              if (editingSessionName.trim()) {
                                updateSession(session.id, { name: editingSessionName.trim() });
                              }
                              setEditingSessionId(null);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                if (editingSessionName.trim()) {
                                  updateSession(session.id, { name: editingSessionName.trim() });
                                }
                                setEditingSessionId(null);
                              } else if (e.key === 'Escape') {
                                setEditingSessionId(null);
                              }
                            }}
                          />
                        </>
                      ) : (
                        <>
                          <span>{session.name}</span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingSessionId(session.id);
                              setEditingSessionName(session.name);
                            }}
                            className="p-1 hover:bg-white/20 rounded"
                          >
                            <Edit2 size={12} />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteSession(session.id);
                            }}
                            className="p-1 hover:bg-red-500/20 rounded"
                          >
                            <X size={12} />
                          </button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Chat Area */}
              {selectedSession ? (
                <>
              <div className="flex-1 overflow-y-auto p-8 space-y-4">
                {chatMessages.length === 0 ? (
                  <div className="flex items-center justify-center h-full">
                        <div className="text-center text-white/50">
                          <p>No messages yet. Start a conversation!</p>
                          {selectedDocument && (
                            <p className="text-sm mt-2">Document loaded: {selectedDocument.filename}</p>
                          )}
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
                                : 'bg-white/5 text-white border border-white/20'
                        }`}
                      >
                        <p className="text-sm whitespace-pre-line">{msg.content}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>

                  <div className="p-6 border-t border-white/20">
                <form onSubmit={handleChatSubmit} className="flex gap-2">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Ask about revenue, expenses, cash flow, etc..."
                        className="flex-1 px-4 py-3 bg-white/5 border border-white/20 rounded-lg text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-white"
                  />
                  <button
                    type="submit"
                    className="px-6 py-3 bg-white text-black rounded-lg font-semibold hover:bg-gray-200 transition-all"
                  >
                    Send
                  </button>
                </form>
              </div>
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center text-white/50">
                  <div className="text-center">
                    <MessageSquare size={48} className="mx-auto mb-4 opacity-50" />
                    <p>Select or create a session to start</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeSection === 'dcf' && (
            <div className="p-8">
              <h3 className="text-2xl font-bold mb-6 text-white">DCF Analysis</h3>

              {/* Document Selection */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-white/70 mb-2">Select Document</label>
                <select
                  value={dcfDocument?.id || ''}
                  onChange={(e) => {
                    const doc = documents.find(d => d.id === e.target.value);
                    if (doc) setDcfDocument(doc);
                  }}
                  className="w-full px-4 py-2 bg-white/5 border border-white/20 rounded-lg text-white"
                >
                  <option value="">Select a document...</option>
                  {documents.map((doc) => (
                    <option key={doc.id} value={doc.id}>
                      {doc.filename} - {doc.parsed_data?.metadata?.company_name || 'Unknown'}
                    </option>
                  ))}
                </select>
              </div>

              {dcfDocument && dcfDocument.parsed_data && (
                <div className="space-y-6">
                  {/* Shares Outstanding Input */}
                  <div className="bg-white/5 border border-white/20 rounded-lg p-6">
                    <h4 className="text-lg font-semibold mb-4">Shares Outstanding</h4>
                    <div className="mb-4">
                      <label className="block text-sm text-white/70 mb-2">
                        Enter shares outstanding (required for accurate DCF)
                      </label>
                      <input
                        type="number"
                        step="1000000"
                        value={dcfShares || ''}
                        onChange={(e) => setDcfShares(parseFloat(e.target.value) || 0)}
                        placeholder="e.g., 15728700000 for Apple"
                        className="w-full px-4 py-2 bg-white/5 border border-white/20 rounded-lg text-white placeholder-white/50"
                      />
                      <p className="text-xs text-white/50 mt-2">
                        {dcfShares > 0 ? (
                          <>Shares entered: {formatShares(dcfShares)}</>
                        ) : (
                          <>Enter shares outstanding to calculate DCF. You can find this in the company's 10-K or balance sheet.</>
                        )}
                      </p>
                    </div>
                  </div>

                  {/* Assumptions */}
                  <div className="bg-white/5 border border-white/20 rounded-lg p-6">
                    <h4 className="text-lg font-semibold mb-4">Assumptions</h4>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      {Object.entries(dcfAssumptions).map(([key, value]) => (
                        <div key={key}>
                          <label className="block text-sm text-white/70 mb-1">
                            {key.replace(/([A-Z])/g, ' $1').trim()}
                          </label>
                          <input
                            type="number"
                            step="0.01"
                            value={value}
                            onChange={(e) => updateAssumption(key as keyof Assumptions, parseFloat(e.target.value) || 0)}
                            className="w-full px-3 py-2 bg-white/5 border border-white/20 rounded text-white"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                  
                  {dcfResult && (
                  <>

                  {/* Results */}
                  <div className="bg-white/5 border border-white/20 rounded-lg p-6">
                    <h4 className="text-lg font-semibold mb-4">Results</h4>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                      <div>
                        <p className="text-sm text-white/70">Equity Value</p>
                        <p className="text-2xl font-bold">{formatBillions(dcfResult.equityValue)}</p>
                      </div>
                      <div>
                        <p className="text-sm text-white/70">Price Per Share</p>
                        <p className="text-2xl font-bold">${dcfResult.pricePerShare.toFixed(2)}</p>
                      </div>
                      <div>
                        <p className="text-sm text-white/70">Enterprise Value</p>
                        <p className="text-2xl font-bold">{formatBillions(dcfResult.enterpriseValue)}</p>
                      </div>
                    </div>
                  </div>

                  {/* Forecast Chart */}
                  {dcfResult.forecast && (
                    <div className="bg-white/5 border border-white/20 rounded-lg p-6">
                      <h4 className="text-lg font-semibold mb-4">5-Year Forecast</h4>
                      <ResponsiveContainer width="100%" height={300}>
                        <ComposedChart data={dcfResult.forecast}>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                          <XAxis dataKey="year" stroke="rgba(255,255,255,0.7)" />
                          <YAxis stroke="rgba(255,255,255,0.7)" />
                          <Tooltip contentStyle={{ backgroundColor: 'rgba(0,0,0,0.9)', border: '1px solid rgba(255,255,255,0.2)' }} />
                          <Legend />
                          <Bar dataKey="revenue" fill="#8884d8" name="Revenue" />
                          <Line type="monotone" dataKey="fcf" stroke="#82ca9d" name="Free Cash Flow" />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                  </>
                  )}
                </div>
              )}
            </div>
          )}

          {activeSection === 'settings' && (
            <div className="p-8">
              <h3 className="text-2xl font-bold mb-6 text-white">Settings</h3>

              <div className="space-y-6">
                {/* Personal Information */}
                <div className="bg-white/5 border border-white/20 rounded-lg p-6">
                  <h4 className="text-lg font-semibold mb-4">Personal Information</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm text-white/70 mb-2">First Name</label>
                      <input
                        type="text"
                        value={settingsFirstName}
                        onChange={(e) => setSettingsFirstName(e.target.value)}
                        className="w-full px-4 py-2 bg-white/5 border border-white/20 rounded-lg text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-white/70 mb-2">Last Name</label>
                      <input
                        type="text"
                        value={settingsLastName}
                        onChange={(e) => setSettingsLastName(e.target.value)}
                        className="w-full px-4 py-2 bg-white/5 border border-white/20 rounded-lg text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-white/70 mb-2">Date of Birth</label>
                      <input
                        type="date"
                        value={settingsDateOfBirth}
                        onChange={(e) => setSettingsDateOfBirth(e.target.value)}
                        className="w-full px-4 py-2 bg-white/5 border border-white/20 rounded-lg text-white"
                      />
                    </div>
                  </div>
                </div>

                {/* Professional Information */}
                <div className="bg-white/5 border border-white/20 rounded-lg p-6">
                  <h4 className="text-lg font-semibold mb-4">Professional Information</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm text-white/70 mb-2">Company</label>
                      <input
                        type="text"
                        value={settingsCompany}
                        onChange={(e) => setSettingsCompany(e.target.value)}
                        placeholder="e.g., McKinsey & Company"
                        className="w-full px-4 py-2 bg-white/5 border border-white/20 rounded-lg text-white placeholder-white/50"
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-white/70 mb-2">Position</label>
                      <input
                        type="text"
                        value={settingsPosition}
                        onChange={(e) => setSettingsPosition(e.target.value)}
                        placeholder="e.g., Associate, Analyst"
                        className="w-full px-4 py-2 bg-white/5 border border-white/20 rounded-lg text-white placeholder-white/50"
                      />
                    </div>
                  </div>
                </div>

                {/* Email */}
                <div className="bg-white/5 border border-white/20 rounded-lg p-6">
                  <h4 className="text-lg font-semibold mb-4">Email</h4>
                  <div>
                    <label className="block text-sm text-white/70 mb-2">Email Address</label>
                    <input
                      type="email"
                      value={settingsEmail}
                      onChange={(e) => setSettingsEmail(e.target.value)}
                      className="w-full px-4 py-2 bg-white/5 border border-white/20 rounded-lg text-white"
                    />
                    <p className="text-xs text-white/50 mt-2">Changing email requires verification</p>
                  </div>
                </div>

                {/* Save Button */}
                <button
                  onClick={async () => {
                    try {
                      const token = await getAuthToken();
                      if (!token) return;

                      // Update profile
                      const { error: profileError } = await supabase
                        .from('profiles')
                        .update({
                          first_name: settingsFirstName,
                          last_name: settingsLastName,
                          date_of_birth: settingsDateOfBirth || null,
                          company: settingsCompany || null,
                          position: settingsPosition || null,
                        })
                        .eq('id', user?.id);

                      if (profileError) throw profileError;

                      // Update email if changed
                      if (settingsEmail !== user?.email) {
                        const { error: emailError } = await supabase.auth.updateUser({
                          email: settingsEmail,
                        });
                        if (emailError) throw emailError;
                      }

                      // Reload profile
                      await checkUser();
                      alert('Settings saved successfully!');
                    } catch (error: any) {
                      alert(`Error saving settings: ${error.message}`);
                    }
                  }}
                  className="px-6 py-3 bg-white text-black rounded-lg font-semibold hover:bg-gray-200 transition-all"
                >
                  Save Changes
                </button>

                {/* Delete Account */}
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-6">
                  <h4 className="text-lg font-semibold mb-4 text-red-400">Danger Zone</h4>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm text-white/70 mb-2">
                        Type "DELETE" to confirm account deletion
                      </label>
                      <input
                        type="text"
                        value={deleteAccountConfirm}
                        onChange={(e) => setDeleteAccountConfirm(e.target.value)}
                        placeholder="DELETE"
                        className="w-full px-4 py-2 bg-white/5 border border-red-500/50 rounded-lg text-white placeholder-white/50"
                      />
                    </div>
                    <button
                      onClick={async () => {
                        if (deleteAccountConfirm !== 'DELETE') {
                          alert('Please type "DELETE" to confirm');
                          return;
                        }

                        if (!confirm('Are you sure you want to delete your account? This cannot be undone.')) {
                          return;
                        }

                        try {
                          // Delete user data first
                          const token = await getAuthToken();
                          if (token) {
                            // Delete from profiles, sessions, documents will cascade via RLS
                            const { error: deleteError } = await supabase
                              .from('profiles')
                              .delete()
                              .eq('id', user?.id);
                            
                            if (deleteError) throw deleteError;
                          }
                          
                          // Sign out and redirect
                          await supabase.auth.signOut();
                          alert('Account data deleted. Please contact support to fully remove your account.');
                          router.push('/');
                        } catch (error: any) {
                          alert(`Error deleting account: ${error.message}`);
                        }
                      }}
                      disabled={deleteAccountConfirm !== 'DELETE'}
                      className="px-6 py-3 bg-red-600 text-white rounded-lg font-semibold hover:bg-red-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Delete Account
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

