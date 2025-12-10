export interface CompanyData {
  symbol: string;
  name: string;
  revenue: number;
  shares: number;
  cash: number;
  debt: number;
}

export async function getCompanyData(symbol: string): Promise<CompanyData> {
  const response = await fetch(`/api/company/${symbol}`);
  
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(errorData.error || 'Failed to fetch company data');
  }
  
  const data = await response.json();
  return data;
}

export const FAANG_SYMBOLS = ['AAPL', 'AMZN', 'META', 'NFLX', 'GOOGL'];
