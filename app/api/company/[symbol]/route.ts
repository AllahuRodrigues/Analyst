import { NextRequest, NextResponse } from 'next/server';

const FMP_KEY = process.env.FMP_KEY;
const FMP_BASE = 'https://financialmodelingprep.com/stable';

export async function GET(
  request: NextRequest,
  { params }: { params: { symbol: string } }
) {
  const symbol = params.symbol;

  if (!FMP_KEY) {
    return NextResponse.json(
      { error: 'FMP API key not configured' },
      { status: 500 }
    );
  }

  try {
    const profileRes = await fetch(
      `${FMP_BASE}/profile?symbol=${symbol}&apikey=${FMP_KEY}`
    );
    
    if (!profileRes.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch company profile' },
        { status: 500 }
      );
    }

    const profileData = await profileRes.json();

    if (!profileData || profileData.length === 0 || profileData.error) {
      return NextResponse.json(
        { error: 'Company not found' },
        { status: 404 }
      );
    }

    const profile = profileData[0];
    
    if (!profile) {
      return NextResponse.json(
        { error: 'Invalid API response' },
        { status: 500 }
      );
    }

    // Fetch financial statements
    const incomeRes = await fetch(
      `${FMP_BASE}/income-statement?symbol=${symbol}&limit=1&apikey=${FMP_KEY}`
    );
    const incomeData = await incomeRes.json();

    const balanceRes = await fetch(
      `${FMP_BASE}/balance-sheet-statement?symbol=${symbol}&limit=1&apikey=${FMP_KEY}`
    );
    const balanceData = await balanceRes.json();

    const income = incomeData[0] || {};
    const balance = balanceData[0] || {};

    // Calculate shares with multiple fallbacks
    let shares = profile.sharesOutstanding || 0;
    if (!shares && income.weightedAverageShsOut) {
      shares = income.weightedAverageShsOut;
    }
    if (!shares && profile.mktCap && profile.price) {
      shares = profile.mktCap / profile.price;
    }

    const data = {
      symbol: symbol,
      name: profile.companyName || symbol,
      revenue: income.revenue || 0,
      shares: shares,
      cash: balance.cashAndCashEquivalents || 0,
      debt: balance.totalDebt || balance.longTermDebt || 0,
    };

    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch company data' },
      { status: 500 }
    );
  }
}

