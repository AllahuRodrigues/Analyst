'use client';

import { useState, useEffect, useRef } from 'react';
import { getCompanyData, FAANG_SYMBOLS, CompanyData } from '@/lib/api';
import { runDCF, Assumptions, DCFResult, FORMULAS } from '@/lib/finance';
import { formatBillions, formatShares, formatPercent, formatWithCommas } from '@/lib/format';
import { AreaChart, Area, BarChart, Bar, LineChart, Line, ComposedChart, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from 'recharts';
import { motion, useScroll, useTransform } from 'framer-motion';

const DEFAULT_ASSUMPTIONS: Assumptions = {
  revenueGrowth: 0.10,
  ebitMargin: 0.30,
  taxRate: 0.21,
  daPercent: 0.03,
  capexPercent: 0.05,
  nwcPercent: 0.02,
  wacc: 0.09,
  terminalGrowth: 0.03,
};

interface ModalData {
  title: string;
  content: React.ReactNode;
}

export default function DemoPage() {
  // persisting selection across page reloads for better ux
  const [selectedSymbol, setSelectedSymbol] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('selectedSymbol') || 'AAPL';
    }
    return 'AAPL';
  });
  const [companyData, setCompanyData] = useState<CompanyData | null>(null);
  const [assumptions, setAssumptions] = useState(DEFAULT_ASSUMPTIONS);
  const [result, setResult] = useState<DCFResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showFormulas, setShowFormulas] = useState(false);
  const [modal, setModal] = useState<ModalData | null>(null);
  const [monteCarloMatrix, setMonteCarloMatrix] = useState<number[][] | null>(null);
  
  const containerRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start start", "end end"]
  });

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('selectedSymbol', selectedSymbol);
    }
  }, [selectedSymbol]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    getCompanyData(selectedSymbol)
      .then(data => {
        setCompanyData(data);
        setError(null);
        const dcfResult = runDCF(data.revenue, data.shares, data.cash, data.debt, assumptions);
        setResult(dcfResult);
      })
      .catch((err) => {
        setError(err.message || 'Failed to load company data');
        setCompanyData(null);
        setResult(null);
      })
      .finally(() => setLoading(false));
  }, [selectedSymbol]);

  useEffect(() => {
    if (companyData) {
      const dcfResult = runDCF(companyData.revenue, companyData.shares, companyData.cash, companyData.debt, assumptions);
      setResult(dcfResult);
    }
  }, [assumptions, companyData]);

  const updateAssumption = (key: keyof Assumptions, value: number) => {
    setAssumptions(prev => ({ ...prev, [key]: value }));
  };

  const showCompanyModal = () => {
    if (!companyData) return;
    setModal({
      title: `${companyData.name} - Data Source`,
      content: (
        <div style={{ fontSize: '0.875rem', color: '#ccc', lineHeight: '1.6' }}>
          <p style={{ marginBottom: '1rem' }}>Data fetched from Financial Modeling Prep API:</p>
          <div style={{ background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: '8px', marginBottom: '1rem' }}>
            <p><strong>Revenue:</strong> {formatBillions(companyData.revenue)} ({formatWithCommas(companyData.revenue / 1e9, 2)} billion USD)</p>
            <p><strong>Source:</strong> Income Statement (latest annual)</p>
            <p style={{ fontSize: '0.75rem', color: '#999', fontFamily: 'monospace', marginTop: '0.5rem' }}>GET /stable/income-statement?symbol={companyData.symbol}</p>
          </div>
          <div style={{ background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: '8px', marginBottom: '1rem' }}>
            <p><strong>Shares Outstanding:</strong> {formatShares(companyData.shares)} ({formatWithCommas(companyData.shares, 0)} shares)</p>
            <p><strong>Source:</strong> Company Profile & Key Metrics (with fallback chain)</p>
            <p style={{ fontSize: '0.75rem', color: '#999', fontFamily: 'monospace', marginTop: '0.5rem' }}>GET /stable/profile?symbol={companyData.symbol}</p>
            <p style={{ fontSize: '0.75rem', color: '#999', fontFamily: 'monospace' }}>GET /api/v3/key-metrics?symbol={companyData.symbol}</p>
          </div>
          <div style={{ background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: '8px', marginBottom: '1rem' }}>
            <p><strong>Cash:</strong> {formatBillions(companyData.cash)} ({formatWithCommas(companyData.cash / 1e9, 2)} billion USD)</p>
            <p><strong>Debt:</strong> {formatBillions(companyData.debt)} ({formatWithCommas(companyData.debt / 1e9, 2)} billion USD)</p>
            <p><strong>Source:</strong> Balance Sheet (latest annual)</p>
            <p style={{ fontSize: '0.75rem', color: '#999', fontFamily: 'monospace', marginTop: '0.5rem' }}>GET /stable/balance-sheet-statement?symbol={companyData.symbol}</p>
          </div>
          <div style={{ background: 'rgba(100,100,100,0.2)', padding: '1rem', borderRadius: '8px', border: '1px solid rgba(100,100,100,0.3)' }}>
            <p style={{ color: '#999', fontSize: '0.875rem' }}>
              Data refreshed from Financial Modeling Prep API
            </p>
          </div>
        </div>
      ),
    });
  };

  const showForecastModal = () => {
    if (!companyData || !result) return;
    setModal({
      title: '5-Year Forecast - Calculation Breakdown',
      content: (
        <div style={{ fontSize: '0.875rem', color: '#ccc', lineHeight: '1.6' }}>
          <p style={{ marginBottom: '1rem' }}>How we calculated each year (all values in billions USD):</p>
          {result.forecast.map((year) => {
            const revenue = companyData.revenue * Math.pow(1 + assumptions.revenueGrowth, year.year);
            const ebit = revenue * assumptions.ebitMargin;
            const da = revenue * assumptions.daPercent;
            const capex = revenue * assumptions.capexPercent;
            const nwcChange = revenue * assumptions.nwcPercent;
            const fcf = ebit * (1 - assumptions.taxRate) + da - capex - nwcChange;
            const pv = fcf / Math.pow(1 + assumptions.wacc, year.year);
            
            return (
              <div key={year.year} style={{ background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: '8px', marginBottom: '1rem' }}>
                <p style={{ fontWeight: '600', marginBottom: '0.5rem' }}>Year {year.year}</p>
                <p>Revenue = {formatBillions(companyData.revenue)} × (1 + {formatPercent(assumptions.revenueGrowth)})^{year.year} = {formatBillions(revenue)}</p>
                <p>EBIT = {formatBillions(revenue)} × {formatPercent(assumptions.ebitMargin)} = {formatBillions(ebit)}</p>
                <p>D&A = {formatBillions(revenue)} × {formatPercent(assumptions.daPercent)} = {formatBillions(da)}</p>
                <p>CapEx = {formatBillions(revenue)} × {formatPercent(assumptions.capexPercent)} = {formatBillions(capex)}</p>
                <p>ΔNWC = {formatBillions(revenue)} × {formatPercent(assumptions.nwcPercent)} = {formatBillions(nwcChange)}</p>
                <p style={{ fontWeight: '600', marginTop: '0.5rem' }}>FCF = {formatBillions(ebit)} × (1 - {formatPercent(assumptions.taxRate)}) + {formatBillions(da)} - {formatBillions(capex)} - {formatBillions(nwcChange)} = {formatBillions(fcf)}</p>
                <p style={{ fontWeight: '600' }}>PV(FCF) = {formatBillions(fcf)} / (1 + {formatPercent(assumptions.wacc)})^{year.year} = {formatBillions(pv)}</p>
              </div>
            );
          })}
          <div style={{ background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: '8px' }}>
            <p style={{ fontWeight: '600', marginBottom: '0.5rem' }}>Terminal Value</p>
            <p>TV = FCF₅ × (1 + {formatPercent(assumptions.terminalGrowth)}) / ({formatPercent(assumptions.wacc)} - {formatPercent(assumptions.terminalGrowth)})</p>
            <p>TV = {formatBillions(result.forecast[4].fcf)} × 1.03 / 0.06 = {formatBillions(result.terminalValue)}</p>
            <p style={{ fontWeight: '600', marginTop: '0.5rem' }}>PV(TV) = {formatBillions(result.terminalValue)} / (1 + {formatPercent(assumptions.wacc)})^5 = {formatBillions(result.pvTerminal)}</p>
          </div>
        </div>
      ),
    });
  };

  const showValuationModal = () => {
    if (!companyData || !result) return;
    const sumPVFCF = result.forecast.reduce((sum, y) => sum + y.pv, 0);
    setModal({
      title: 'Valuation Results - Step by Step',
      content: (
        <div style={{ fontSize: '0.875rem', color: '#ccc', lineHeight: '1.6' }}>
          <p style={{ marginBottom: '1rem' }}>All values in billions USD:</p>
          <div style={{ background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: '8px', marginBottom: '1rem' }}>
            <p style={{ fontWeight: '600', marginBottom: '0.5rem' }}>Enterprise Value</p>
            <p>EV = Sum of all PV(FCF) + PV(Terminal Value)</p>
            <p>EV = {formatBillions(sumPVFCF)} + {formatBillions(result.pvTerminal)}</p>
            <p style={{ fontWeight: '600' }}>EV = {formatBillions(result.enterpriseValue)}</p>
          </div>
          <div style={{ background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: '8px', marginBottom: '1rem' }}>
            <p style={{ fontWeight: '600', marginBottom: '0.5rem' }}>Equity Value</p>
            <p>Equity = EV - Debt + Cash</p>
            <p>Equity = {formatBillions(result.enterpriseValue)} - {formatBillions(companyData.debt)} + {formatBillions(companyData.cash)}</p>
            <p style={{ fontWeight: '600' }}>Equity = {formatBillions(result.equityValue)}</p>
          </div>
          <div style={{ background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: '8px' }}>
            <p style={{ fontWeight: '600', marginBottom: '0.5rem' }}>Price Per Share</p>
            <p>Price = Equity Value / Shares Outstanding</p>
            <p>Price = {formatBillions(result.equityValue)} / {formatShares(companyData.shares)}</p>
            <p>Price = ${formatWithCommas(result.equityValue, 0)} / {formatWithCommas(companyData.shares, 0)}</p>
            <p style={{ fontWeight: '600', fontSize: '1.125rem', marginTop: '0.75rem', color: '#fff' }}>Price = ${formatWithCommas(result.pricePerShare, 2)} per share</p>
          </div>
        </div>
      ),
    });
  };

  const showSensitivityModal = () => {
    setModal({
      title: 'Sensitivity Analysis - How It Works',
      content: (
        <div style={{ fontSize: '0.875rem', color: '#ccc', lineHeight: '1.6' }}>
          <p style={{ marginBottom: '1rem' }}>The sensitivity analysis shows how the implied share price changes with different assumptions.</p>
          <div style={{ background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: '8px', marginBottom: '1rem' }}>
            <p style={{ fontWeight: '600', marginBottom: '0.5rem' }}>WACC (Weighted Average Cost of Capital)</p>
            <p>Represents the required return rate for investors. Higher WACC = lower valuation because future cash flows are worth less today.</p>
            <p style={{ marginTop: '0.5rem' }}>Range tested: 7% to 11%</p>
          </div>
          <div style={{ background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: '8px', marginBottom: '1rem' }}>
            <p style={{ fontWeight: '600', marginBottom: '0.5rem' }}>Terminal Growth Rate</p>
            <p>Assumes perpetual growth rate after year 5. Higher growth = higher valuation because cash flows keep growing forever.</p>
            <p style={{ marginTop: '0.5rem' }}>Range tested: 2.0% to 4.0%</p>
          </div>
          <p style={{ color: '#999' }}>Each cell runs a complete DCF calculation with those specific WACC and growth assumptions while keeping all other inputs constant.</p>
        </div>
      ),
    });
  };

  const opacity = useTransform(scrollYProgress, [0, 0.2], [1, 0]);
  const scale = useTransform(scrollYProgress, [0, 0.5], [1, 0.8]);

  return (
    <main ref={containerRef} style={{ position: 'relative' }}>
      {/* modal overlay */}
      {modal && (
        <div 
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 2000,
            padding: '2rem',
          }}
          onClick={() => setModal(null)}
        >
          <div 
            className="glass"
            style={{
              maxWidth: '800px',
              maxHeight: '80vh',
              overflow: 'auto',
              padding: '2rem',
              borderRadius: '16px',
              position: 'relative',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setModal(null)}
              style={{
                position: 'absolute',
                top: '1rem',
                right: '1rem',
                background: 'rgba(255, 255, 255, 0.1)',
                border: 'none',
                color: '#fff',
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                cursor: 'pointer',
                fontSize: '1.25rem',
              }}
            >
              ×
            </button>
            <h3 style={{ fontSize: '1.5rem', fontWeight: '600', marginBottom: '1.5rem' }}>{modal.title}</h3>
            {modal.content}
          </div>
        </div>
      )}

      <motion.section 
        style={{ 
          minHeight: '100vh', 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center', 
          flexDirection: 'column', 
          padding: '2rem',
          opacity,
          scale
        }}
      >
        <motion.h1 
          initial={{ y: -50, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.8 }}
          style={{ fontSize: '4rem', fontWeight: '700', marginBottom: '1rem' }} 
          className="gradient-text"
        >
          Analyst
        </motion.h1>
        <motion.p 
          initial={{ y: 50, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.8, delay: 0.2 }}
          style={{ fontSize: '1.25rem', color: '#999', marginBottom: '3rem', textAlign: 'center' }}
        >
          Interact with our software, for more information, get in touch with us.
        </motion.p>
        
        {/* formulas toggle */}
        <motion.button
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          onClick={() => setShowFormulas(!showFormulas)}
          style={{
            padding: '0.875rem 2rem',
            background: showFormulas ? 'rgba(255, 255, 255, 0.15)' : 'rgba(255, 255, 255, 0.05)',
            color: '#fff',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            borderRadius: '12px',
            cursor: 'pointer',
            fontSize: '0.9375rem',
            fontWeight: '500',
            marginBottom: '2rem',
            transition: 'all 0.3s',
            backdropFilter: 'blur(10px)',
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.15)'}
          onMouseLeave={(e) => e.currentTarget.style.background = showFormulas ? 'rgba(255, 255, 255, 0.15)' : 'rgba(255, 255, 255, 0.05)'}
        >
          {showFormulas ? '✕ Hide' : '+ View'} DCF Formulas
        </motion.button>

        {showFormulas && (
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="glass" 
            style={{ 
              padding: '2.5rem', 
              borderRadius: '16px', 
              marginBottom: '3rem', 
              maxWidth: '900px',
              background: 'rgba(0,0,0,0.6)',
              backdropFilter: 'blur(20px)',
              border: '1px solid rgba(255,255,255,0.1)'
            }}
          >
            <h3 style={{ fontSize: '1.5rem', fontWeight: '600', marginBottom: '2rem', textAlign: 'center', color: '#fff' }}>
              DCF Calculation Formulas
            </h3>
            <div style={{ display: 'grid', gap: '1.25rem' }}>
              {Object.entries(FORMULAS).map(([key, formula], index) => (
                <motion.div 
                  key={key}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.1 }}
                  style={{ 
                    background: 'rgba(255,255,255,0.03)',
                    padding: '1.25rem',
                    borderRadius: '12px',
                    border: '1px solid rgba(255,255,255,0.05)',
                    fontFamily: 'monospace',
                    fontSize: '0.9375rem',
                    color: '#e0e0e0',
                    letterSpacing: '0.01em'
                  }}
                >
                  {formula}
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}

        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
          style={{ display: 'flex', gap: '1rem', marginBottom: '3rem', flexWrap: 'wrap', justifyContent: 'center' }}
        >
          {FAANG_SYMBOLS.map((symbol, index) => (
            <motion.button
              key={symbol}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.7 + index * 0.1 }}
              onClick={() => setSelectedSymbol(symbol)}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              style={{
                padding: '0.875rem 1.75rem',
                background: selectedSymbol === symbol ? 'rgba(255, 255, 255, 0.15)' : 'rgba(255, 255, 255, 0.03)',
                color: '#fff',
                border: selectedSymbol === symbol ? '2px solid rgba(255, 255, 255, 0.3)' : '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '12px',
                cursor: 'pointer',
                fontSize: '1rem',
                fontWeight: selectedSymbol === symbol ? '600' : '400',
                transition: 'all 0.3s',
                backdropFilter: 'blur(10px)',
              }}
            >
              {symbol}
            </motion.button>
          ))}
        </motion.div>
      </motion.section>

      {loading && (
        <section style={{ padding: '4rem 2rem', textAlign: 'center' }}>
          <p style={{ fontSize: '1.25rem', color: '#999' }}>Loading data...</p>
        </section>
      )}

      {!loading && error && (
        <section style={{ padding: '4rem 2rem', textAlign: 'center' }}>
          <div style={{ 
            maxWidth: '600px', 
            margin: '0 auto', 
            padding: '2rem', 
            borderRadius: '12px', 
            background: 'rgba(220, 38, 38, 0.1)', 
            border: '1px solid rgba(220, 38, 38, 0.3)' 
          }}>
            <p style={{ fontSize: '1.25rem', color: '#ef4444', marginBottom: '1rem' }}>Error loading data</p>
            <p style={{ fontSize: '1rem', color: '#999' }}>{error}</p>
            <button
              onClick={() => {
                setError(null);
                setLoading(true);
                getCompanyData(selectedSymbol)
                  .then(data => {
                    setCompanyData(data);
                    setError(null);
                    const dcfResult = runDCF(data.revenue, data.shares, data.cash, data.debt, assumptions);
                    setResult(dcfResult);
                  })
                  .catch((err) => {
                    setError(err.message || 'Failed to load company data');
                  })
                  .finally(() => setLoading(false));
              }}
              style={{
                marginTop: '1rem',
                padding: '0.75rem 1.5rem',
                borderRadius: '8px',
                border: '1px solid rgba(220, 38, 38, 0.5)',
                background: 'rgba(220, 38, 38, 0.1)',
                color: '#ef4444',
                cursor: 'pointer',
                fontSize: '1rem',
              }}
            >
              Try Again
            </button>
          </div>
        </section>
      )}

      {!loading && !error && companyData && result && (
        <>
          <motion.section 
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
            style={{ padding: '4rem 2rem', maxWidth: '1200px', margin: '0 auto' }}
          >
            <motion.div 
              initial={{ y: 30, opacity: 0 }}
              whileInView={{ y: 0, opacity: 1 }}
              viewport={{ once: true }}
              style={{ marginBottom: '3rem', textAlign: 'center' }}
            >
              <h2 
                style={{ fontSize: '2rem', fontWeight: '500', cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted', color: '#ccc', marginBottom: '0.5rem' }}
                onClick={showCompanyModal}
              >
                {companyData.name}
              </h2>
              <span style={{ fontSize: '0.75rem', color: '#666' }}>click for data source</span>
            </motion.div>

            <p style={{ fontSize: '0.875rem', color: '#999', marginBottom: '1.5rem', textAlign: 'center' }}>All values in <b>billions USD</b></p>

            <motion.div 
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1.5rem', marginBottom: '3rem' }}
            >
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.1 }}
                className="glass" 
                style={{ padding: '1.5rem', borderRadius: '12px', cursor: 'help' }} 
                title="Annual revenue from income statement"
              >
                <p style={{ color: '#999', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  Revenue <span style={{ fontSize: '0.75rem', color: '#666' }}>ⓘ</span>
                </p>
                <p style={{ fontSize: '1.5rem', fontWeight: '600' }}>{formatBillions(companyData.revenue)}</p>
                <p style={{ fontSize: '0.75rem', color: '#666', marginTop: '0.25rem' }}>${formatWithCommas(companyData.revenue / 1e9, 2)} billion</p>
              </motion.div>
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.2 }}
                className="glass" 
                style={{ padding: '1.5rem', borderRadius: '12px', cursor: 'help' }} 
                title="Total shares outstanding from company profile"
              >
                <p style={{ color: '#999', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  Shares Outstanding <span style={{ fontSize: '0.75rem', color: '#666' }}>ⓘ</span>
                </p>
                <p style={{ fontSize: '1.5rem', fontWeight: '600' }}>{formatShares(companyData.shares)}</p>
                <p style={{ fontSize: '0.75rem', color: '#666', marginTop: '0.25rem' }}>{formatWithCommas(companyData.shares, 0)} shares</p>
              </motion.div>
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.3 }}
                className="glass" 
                style={{ padding: '1.5rem', borderRadius: '12px', cursor: 'help' }} 
                title="Cash and cash equivalents from balance sheet"
              >
                <p style={{ color: '#999', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  Cash <span style={{ fontSize: '0.75rem', color: '#666' }}>ⓘ</span>
                </p>
                <p style={{ fontSize: '1.5rem', fontWeight: '600' }}>{formatBillions(companyData.cash)}</p>
                <p style={{ fontSize: '0.75rem', color: '#666', marginTop: '0.25rem' }}>${formatWithCommas(companyData.cash / 1e9, 2)} billion</p>
              </motion.div>
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.4 }}
                className="glass" 
                style={{ padding: '1.5rem', borderRadius: '12px', cursor: 'help' }} 
                title="Total debt from balance sheet"
              >
                <p style={{ color: '#999', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  Debt <span style={{ fontSize: '0.75rem', color: '#666' }}>ⓘ</span>
                </p>
                <p style={{ fontSize: '1.5rem', fontWeight: '600' }}>{formatBillions(companyData.debt)}</p>
                <p style={{ fontSize: '0.75rem', color: '#666', marginTop: '0.25rem' }}>${formatWithCommas(companyData.debt / 1e9, 2)} billion</p>
              </motion.div>
            </motion.div>
          </motion.section>

          <motion.section 
            initial={{ opacity: 0, y: 50 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            style={{ padding: '4rem 2rem', maxWidth: '1200px', margin: '0 auto' }}
          >
            <h2 style={{ fontSize: '2rem', fontWeight: '600', marginBottom: '3rem', textAlign: 'center' }}>
              Model Assumptions
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '2rem' }}>
              {Object.entries(assumptions).map(([key, value], index) => (
                <motion.div 
                  key={key}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: index * 0.05 }}
                  className="glass"
                  style={{
                    padding: '1.5rem',
                    borderRadius: '12px',
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    transition: 'all 0.3s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)';
                    e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.2)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
                    e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                  }}
                >
                  <label 
                    htmlFor={key}
                    style={{ 
                      display: 'block', 
                      marginBottom: '0.75rem', 
                      color: '#ccc', 
                      textTransform: 'capitalize',
                      fontSize: '0.875rem',
                      fontWeight: '500',
                      letterSpacing: '0.025em'
                    }}
                  >
                    {key.replace(/([A-Z])/g, ' $1').toLowerCase()}
                  </label>
                  <div style={{ position: 'relative' }}>
                    <input
                      id={key}
                      type="number"
                      value={value}
                      onChange={(e) => updateAssumption(key as keyof Assumptions, parseFloat(e.target.value))}
                      step="0.01"
                      style={{
                        width: '100%',
                        padding: '0.875rem 1rem',
                        background: 'rgba(0, 0, 0, 0.4)',
                        border: '1px solid rgba(255, 255, 255, 0.15)',
                        borderRadius: '8px',
                        color: '#fff',
                        fontSize: '1.125rem',
                        fontWeight: '500',
                        outline: 'none',
                        transition: 'all 0.2s',
                      }}
                      onFocus={(e) => {
                        e.target.style.borderColor = 'rgba(136, 132, 216, 0.6)';
                        e.target.style.boxShadow = '0 0 0 3px rgba(136, 132, 216, 0.1)';
                      }}
                      onBlur={(e) => {
                        e.target.style.borderColor = 'rgba(255, 255, 255, 0.15)';
                        e.target.style.boxShadow = 'none';
                      }}
                    />
                    <div style={{
                      position: 'absolute',
                      right: '1rem',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      color: '#666',
                      fontSize: '0.875rem',
                      pointerEvents: 'none'
                    }}>
                      {key.includes('Percent') || key.includes('Growth') || key.includes('Rate') || key === 'wacc' ? '%' : ''}
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.section>

          <motion.section 
            initial={{ opacity: 0, y: 50 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            style={{ padding: '4rem 2rem', maxWidth: '1200px', margin: '0 auto' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
              <h2 
                style={{ fontSize: '2rem', fontWeight: '600', cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted' }}
                onClick={showValuationModal}
              >
                Valuation Results
              </h2>
              <span style={{ fontSize: '0.875rem', color: '#666' }}>click for calculation details</span>
            </div>
            
            <p style={{ fontSize: '0.875rem', color: '#999', marginBottom: '1rem' }}>All values in billions USD</p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1.5rem', marginBottom: '3rem' }}>
              <div className="glass" style={{ padding: '1.5rem', borderRadius: '12px', cursor: 'help' }} title="Sum of present values of all future cash flows">
                <p style={{ color: '#999', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  Enterprise Value <span style={{ fontSize: '0.75rem', color: '#666' }}>ⓘ</span>
                </p>
                <p style={{ fontSize: '1.5rem', fontWeight: '600' }}>{formatBillions(result.enterpriseValue)}</p>
                <p style={{ fontSize: '0.75rem', color: '#666', marginTop: '0.25rem' }}>${formatWithCommas(result.enterpriseValue / 1e9, 2)} billion</p>
              </div>
              <div className="glass" style={{ padding: '1.5rem', borderRadius: '12px', cursor: 'help' }} title="EV minus debt plus cash">
                <p style={{ color: '#999', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  Equity Value <span style={{ fontSize: '0.75rem', color: '#666' }}>ⓘ</span>
                </p>
                <p style={{ fontSize: '1.5rem', fontWeight: '600' }}>{formatBillions(result.equityValue)}</p>
                <p style={{ fontSize: '0.75rem', color: '#666', marginTop: '0.25rem' }}>${formatWithCommas(result.equityValue / 1e9, 2)} billion</p>
              </div>
              <div className="glass" style={{ padding: '1.5rem', borderRadius: '12px', border: '2px solid #fff', cursor: 'help', boxShadow: '0 0 20px rgba(255,255,255,0.2)' }} title="Equity value divided by shares outstanding">
                <p style={{ color: '#fff', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: '600' }}>
                  Implied Price Per Share <span style={{ fontSize: '0.75rem' }}>ⓘ</span>
                </p>
                <p style={{ fontSize: '2rem', fontWeight: '700', color: '#fff' }}>${formatWithCommas(result.pricePerShare, 2)}</p>
                <p style={{ fontSize: '0.75rem', color: '#ccc', marginTop: '0.25rem' }}>per share</p>
              </div>
            </div>
          </motion.section>

          <motion.section 
            initial={{ opacity: 0, y: 50 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            style={{ padding: '4rem 2rem', maxWidth: '1200px', margin: '0 auto' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h3 
                style={{ fontSize: '1.5rem', fontWeight: '600', cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted' }}
                onClick={showForecastModal}
              >
                5-Year Forecast
              </h3>
              <span style={{ fontSize: '0.875rem', color: '#666' }}>click for breakdown</span>
            </div>

            <p style={{ fontSize: '0.875rem', color: '#999', marginBottom: '1rem' }}>All values in billions USD</p>

            <div style={{ overflowX: 'auto', marginBottom: '3rem' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.1)' }}>
                    <th style={{ padding: '1rem', textAlign: 'left', color: '#999' }}>Metric</th>
                    {result.forecast.map(year => (
                      <th key={year.year} style={{ padding: '1rem', textAlign: 'right', color: '#999' }}>Year {year.year}</th>
                    ))}
                    <th style={{ padding: '1rem', textAlign: 'right', color: '#999' }}>Terminal</th>
                  </tr>
                </thead>
                <tbody>
                  <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                    <td style={{ padding: '1rem', fontWeight: '500' }}>Revenue</td>
                    {result.forecast.map(year => (
                      <td key={year.year} style={{ padding: '1rem', textAlign: 'right' }}>{formatBillions(year.revenue)}</td>
                    ))}
                    <td style={{ padding: '1rem', textAlign: 'right' }}>-</td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                    <td style={{ padding: '1rem', fontWeight: '500' }}>EBIT</td>
                    {result.forecast.map(year => (
                      <td key={year.year} style={{ padding: '1rem', textAlign: 'right' }}>{formatBillions(year.ebit)}</td>
                    ))}
                    <td style={{ padding: '1rem', textAlign: 'right' }}>-</td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                    <td style={{ padding: '1rem', fontWeight: '500' }}>FCF</td>
                    {result.forecast.map(year => (
                      <td key={year.year} style={{ padding: '1rem', textAlign: 'right' }}>{formatBillions(year.fcf)}</td>
                    ))}
                    <td style={{ padding: '1rem', textAlign: 'right', fontWeight: '600' }}>{formatBillions(result.terminalValue)}</td>
                  </tr>
                  <tr style={{ borderTop: '2px solid rgba(255, 255, 255, 0.2)', background: 'rgba(255,255,255,0.03)' }}>
                    <td style={{ padding: '1rem', fontWeight: '600' }}>PV(FCF)</td>
                    {result.forecast.map(year => (
                      <td key={year.year} style={{ padding: '1rem', textAlign: 'right', fontWeight: '600' }}>{formatBillions(year.pv)}</td>
                    ))}
                    <td style={{ padding: '1rem', textAlign: 'right', fontWeight: '600' }}>{formatBillions(result.pvTerminal)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <h3 style={{ fontSize: '1.5rem', fontWeight: '600', marginBottom: '1.5rem' }}>
              FCF Growth Chart
            </h3>
            <div className="glass" style={{ padding: '2rem', borderRadius: '12px' }}>
              <ResponsiveContainer width="100%" height={350}>
                <ComposedChart data={result.forecast.map(y => {
                  const equityValue = result.equityValue || result.enterpriseValue || 1;
                  const fcfYield = (y.fcf / equityValue) * 100;
                  return { 
                    year: `Year ${y.year}`, 
                    fcf: y.fcf / 1e9, 
                    fcfYield: fcfYield,
                    equityValue: equityValue / 1e9
                  };
                })}>
                  <defs>
                    <linearGradient id="colorEquity" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#60a5fa" stopOpacity={0.8}/>
                      <stop offset="95%" stopColor="#60a5fa" stopOpacity={0.1}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.15)" />
                  <XAxis dataKey="year" stroke="#999" style={{ fontSize: '0.875rem' }} />
                  <YAxis 
                    yAxisId="left"
                    stroke="#10b981"
                    label={{ value: 'Free Cash Flow Yield (%)', angle: -90, position: 'insideLeft', fill: '#10b981' }} 
                    style={{ fontSize: '0.875rem' }}
                  />
                  <YAxis 
                    yAxisId="right"
                    orientation="right"
                    stroke="#60a5fa"
                    label={{ value: 'Free Cash Flow (Billions USD)', angle: 90, position: 'insideRight', fill: '#60a5fa' }} 
                    style={{ fontSize: '0.875rem' }}
                  />
                  <Tooltip 
                    contentStyle={{ background: 'rgba(0,0,0,0.9)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '8px', padding: '0.75rem' }}
                    labelStyle={{ color: '#fff', marginBottom: '0.5rem' }}
                    formatter={(value: number, name: string) => {
                      if (name === 'fcfYield') return `${value.toFixed(2)}%`;
                      if (name === 'equityValue') return `$${value.toFixed(2)} B`;
                      return `$${value.toFixed(2)} B`;
                    }}
                  />
                  <Legend wrapperStyle={{ paddingTop: '1rem' }} />
                  <Bar yAxisId="right" dataKey="fcf" fill="#f97316" name="Free Cash Flow" radius={[4, 4, 0, 0]} />
                  <Line 
                    yAxisId="left" 
                    type="monotone" 
                    dataKey="fcfYield" 
                    stroke="#10b981" 
                    strokeWidth={3}
                    dot={{ fill: '#10b981', r: 5 }}
                    activeDot={{ r: 7 }}
                    name="Free Cash Flow Yield (%)"
                  />
                  <Area 
                    yAxisId="right" 
                    type="monotone" 
                    dataKey="equityValue" 
                    stroke="#60a5fa" 
                    strokeWidth={2}
                    fillOpacity={0.2}
                    fill="url(#colorEquity)" 
                    name="Equity Value"
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </motion.section>

          <motion.section 
            initial={{ opacity: 0, y: 50 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            style={{ padding: '4rem 2rem', maxWidth: '1200px', margin: '0 auto', marginTop: '3rem' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
              <h2 
                style={{ fontSize: '2rem', fontWeight: '600', cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted' }}
                onClick={showSensitivityModal}
              >
                Sensitivity Analysis
              </h2>
              <span style={{ fontSize: '0.875rem', color: '#666' }}>click for explanation</span>
            </div>
            <p style={{ color: '#999', marginBottom: '2rem', fontSize: '0.875rem' }}>
              Price sensitivity to WACC and Terminal Growth Rate<br />
              <span style={{ color: '#666', fontSize: '0.8125rem' }}>Hover over cells for details</span>
            </p>
            <div className="glass" style={{ padding: '1.5rem', borderRadius: '12px' }}>
              <SensitivityHeatmap companyData={companyData} baseAssumptions={assumptions} monteCarloMatrix={monteCarloMatrix} />
            </div>

            {/* Monte Carlo Simulation */}
            <div style={{ marginTop: '3rem' }}>
              <h3 
                style={{ 
                  fontSize: '1.5rem', 
                  fontWeight: '600', 
                  marginBottom: '1rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  cursor: 'help'
                }}
                title="Monte Carlo Simulation: A statistical method that uses random sampling to model the probability of different outcomes. In finance, it helps assess risk by simulating thousands of possible scenarios with varying WACC and Terminal Growth Rate inputs to estimate the range and distribution of potential stock prices in the sensitivity table above."
              >
                Monte Carlo Simulation
                <span style={{ fontSize: '0.75rem', color: '#666' }}>ⓘ</span>
              </h3>
              <p style={{ color: '#999', marginBottom: '1.5rem', fontSize: '0.875rem' }}>
                Run thousands of simulations with randomized WACC and Terminal Growth Rate to see the sensitivity table update in real-time
              </p>
              
              <MonteCarloSimulation 
                companyData={companyData} 
                baseAssumptions={assumptions}
                onMatrixUpdate={setMonteCarloMatrix}
              />
            </div>
          </motion.section>
        </>
      )}

      <style jsx>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </main>
  );
}

function SensitivityHeatmap({ companyData, baseAssumptions, monteCarloMatrix }: { companyData: CompanyData; baseAssumptions: Assumptions; monteCarloMatrix: number[][] | null }) {
  const waccRange = [0.07, 0.08, 0.09, 0.10, 0.11];
  const terminalRange = [0.02, 0.025, 0.03, 0.035, 0.04];

  // Use Monte Carlo matrix if provided, otherwise calculate standard matrix
  const matrix = monteCarloMatrix || terminalRange.map(terminal =>
    waccRange.map(wacc => {
      const assumptions = { ...baseAssumptions, wacc, terminalGrowth: terminal };
      const result = runDCF(companyData.revenue, companyData.shares, companyData.cash, companyData.debt, assumptions);
      return result.pricePerShare;
    })
  );

  const maxPrice = Math.max(...matrix.flat());
  const minPrice = Math.min(...matrix.flat());

  const formatPrice = (price: number) => {
    if (price >= 1e12) return `$${(price / 1e12).toFixed(2)} T`;
    if (price >= 1e9) return `$${(price / 1e9).toFixed(2)} B`;
    if (price >= 1e6) return `$${(price / 1e6).toFixed(2)} M`;
    return `$${formatWithCommas(price, 2)}`;
  };

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.1)' }}>
            <th style={{ padding: '1rem', textAlign: 'left', color: '#999', fontSize: '0.875rem' }}>Terminal / WACC</th>
            {waccRange.map(wacc => (
              <th key={wacc} style={{ padding: '1rem', textAlign: 'center', color: '#999', fontSize: '0.875rem' }}>
                {(wacc * 100).toFixed(0)}%
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.map((row, i) => (
            <tr key={i} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
              <td style={{ padding: '1rem', color: '#999', fontSize: '0.875rem' }}>{(terminalRange[i] * 100).toFixed(1)}%</td>
              {row.map((price, j) => {
                const intensity = (price - minPrice) / (maxPrice - minPrice);
                // Smooth orange gradient: from soft dark orange (low) to soft light orange (high)
                // Using a warm, muted orange palette
                const orangeR = Math.round(120 + intensity * 100); // 120 to 220 (soft orange to light orange)
                const orangeG = Math.round(70 + intensity * 80); // 70 to 150 (muted)
                const orangeB = Math.round(40 + intensity * 50); // 40 to 90 (warm tone)
                return (
                  <td
                    key={j}
                    title={`WACC: ${(waccRange[j] * 100).toFixed(0)}%, Growth: ${(terminalRange[i] * 100).toFixed(1)}% → ${formatPrice(price)}`}
                    style={{
                      padding: '1rem',
                      textAlign: 'center',
                      background: `rgb(${orangeR}, ${orangeG}, ${orangeB})`,
                      color: '#fff',
                      borderRadius: '4px',
                      fontSize: '0.875rem',
                      cursor: 'help',
                      transition: 'all 0.2s',
                      fontWeight: '500',
                    }}
                    onMouseEnter={(e) => {
                      const hoverR = Math.min(255, orangeR + 30);
                      const hoverG = Math.min(255, orangeG + 30);
                      const hoverB = Math.min(255, orangeB + 20);
                      e.currentTarget.style.background = `rgb(${hoverR}, ${hoverG}, ${hoverB})`;
                      e.currentTarget.style.transform = 'scale(1.05)';
                      e.currentTarget.style.boxShadow = '0 0 15px rgba(255, 165, 0, 0.4)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = `rgb(${orangeR}, ${orangeG}, ${orangeB})`;
                      e.currentTarget.style.transform = 'scale(1)';
                      e.currentTarget.style.boxShadow = 'none';
                    }}
                  >
                    {formatPrice(price)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MonteCarloSimulation({ companyData, baseAssumptions, onMatrixUpdate }: { companyData: CompanyData; baseAssumptions: Assumptions; onMatrixUpdate: (matrix: number[][] | null) => void }) {
  const [numSimulations, setNumSimulations] = useState(1000);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);

  const waccRange = [0.07, 0.08, 0.09, 0.10, 0.11];
  const terminalRange = [0.02, 0.025, 0.03, 0.035, 0.04];
  const simulationOptions = [100, 1000, 10000, 100000];

  const runSimulation = async () => {
    setIsRunning(true);
    setProgress(0);
    
    // Initialize matrix with zeros
    const matrix: number[][] = terminalRange.map(() => waccRange.map(() => 0));
    const counts: number[][] = terminalRange.map(() => waccRange.map(() => 0));
    
    // Update every N simulations based on total count for smooth animation
    const updateInterval = numSimulations <= 1000 ? 10 : numSimulations <= 10000 ? 100 : 1000;
    
    for (let i = 0; i < numSimulations; i++) {
      // Randomize WACC and Terminal Growth Rate within the ranges
      const randomWacc = 0.07 + Math.random() * 0.04; // 0.07 to 0.11
      const randomTerminal = 0.02 + Math.random() * 0.02; // 0.02 to 0.04
      
      // Find closest grid cell
      let waccIndex = waccRange.reduce((closest, wacc, idx) => 
        Math.abs(wacc - randomWacc) < Math.abs(waccRange[closest] - randomWacc) ? idx : closest, 0
      );
      let terminalIndex = terminalRange.reduce((closest, terminal, idx) => 
        Math.abs(terminal - randomTerminal) < Math.abs(terminalRange[closest] - randomTerminal) ? idx : closest, 0
      );
      
      // Run DCF with randomized WACC and Terminal Growth Rate
      const randomizedAssumptions: Assumptions = {
        ...baseAssumptions,
        wacc: randomWacc,
        terminalGrowth: randomTerminal,
      };

      const result = runDCF(
        companyData.revenue,
        companyData.shares,
        companyData.cash,
        companyData.debt,
        randomizedAssumptions
      );

      // Accumulate price in the matrix cell (running average)
      counts[terminalIndex][waccIndex]++;
      const currentAvg = matrix[terminalIndex][waccIndex];
      const newPrice = result.pricePerShare;
      matrix[terminalIndex][waccIndex] = currentAvg + (newPrice - currentAvg) / counts[terminalIndex][waccIndex];

      // Update progress and matrix in real-time
      if (i % updateInterval === 0 || i === numSimulations - 1) {
        const progressPercent = ((i + 1) / numSimulations) * 100;
        setProgress(progressPercent);
        
        // Update the matrix (create new array for reactivity)
        onMatrixUpdate(matrix.map(row => [...row]));

        // Small delay for animation effect (50ms per update)
        if (i < numSimulations - 1) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }
    }

    setProgress(100);
    
    // Wait a bit before enabling run again
    setTimeout(() => {
      setIsRunning(false);
    }, 500);
  };


  return (
    <div className="glass" style={{ padding: '2rem', borderRadius: '12px' }}>
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <div>
          <label style={{ display: 'block', marginBottom: '0.5rem', color: '#999', fontSize: '0.875rem' }}>
            Number of Simulations:
          </label>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {simulationOptions.map(option => (
              <button
                key={option}
                onClick={() => !isRunning && setNumSimulations(option)}
                disabled={isRunning}
                style={{
                  padding: '0.5rem 1rem',
                  borderRadius: '8px',
                  border: `2px solid ${numSimulations === option ? '#fff' : 'rgba(255,255,255,0.3)'}`,
                  background: numSimulations === option ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.3)',
                  color: '#fff',
                  cursor: isRunning ? 'not-allowed' : 'pointer',
                  opacity: isRunning ? 0.5 : 1,
                  transition: 'all 0.2s',
                  fontSize: '0.875rem',
                }}
              >
                {option.toLocaleString()}
              </button>
            ))}
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem' }}>
          <button
            onClick={() => onMatrixUpdate(null)}
            disabled={isRunning}
            style={{
              padding: '0.75rem 1.5rem',
              borderRadius: '8px',
              border: '2px solid rgba(255,255,255,0.3)',
              background: 'rgba(0,0,0,0.3)',
              color: '#fff',
              cursor: isRunning ? 'not-allowed' : 'pointer',
              fontWeight: '600',
              fontSize: '1rem',
              transition: 'all 0.2s',
              opacity: isRunning ? 0.5 : 1,
            }}
          >
            Reset
          </button>
          <button
            onClick={runSimulation}
            disabled={isRunning}
            style={{
              padding: '0.75rem 2rem',
              borderRadius: '8px',
              border: '2px solid #fff',
              background: isRunning ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.2)',
              color: '#fff',
              cursor: isRunning ? 'not-allowed' : 'pointer',
              fontWeight: '600',
              fontSize: '1rem',
              transition: 'all 0.2s',
            }}
          >
            {isRunning ? 'Running...' : 'Run Simulation'}
          </button>
        </div>
      </div>

      {isRunning && (
        <div style={{ marginBottom: '2rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', alignItems: 'center' }}>
            <span style={{ color: '#999', fontSize: '0.875rem' }}>Progress</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ color: '#fff', fontSize: '0.875rem', fontWeight: '600' }}>
                {Math.round((progress / 100) * numSimulations).toLocaleString()} / {numSimulations.toLocaleString()}
              </span>
              <span style={{ color: '#999', fontSize: '0.875rem' }}>{progress.toFixed(1)}%</span>
              <div style={{
                width: '12px',
                height: '12px',
                borderRadius: '50%',
                background: '#fff',
                animation: 'pulse 1s ease-in-out infinite',
              }} />
            </div>
          </div>
          <div style={{
            width: '100%',
            height: '10px',
            background: 'rgba(255,255,255,0.2)',
            borderRadius: '5px',
            overflow: 'hidden',
          }}>
            <div style={{
              width: `${progress}%`,
              height: '100%',
              background: 'linear-gradient(90deg, #000, #666, #fff)',
              transition: 'width 0.1s linear',
              borderRadius: '5px',
              boxShadow: '0 0 10px rgba(255,255,255,0.3)',
            }} />
          </div>
          <p style={{ color: '#999', fontSize: '0.75rem', marginTop: '0.5rem', fontStyle: 'italic' }}>
            Watch the sensitivity table above update in real-time as simulations run...
          </p>
        </div>
      )}
    </div>
  );
}

