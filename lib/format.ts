// auto scaling to keep numbers readable instead of showing 1234567890
export function formatNumber(num: number | undefined | null, decimals: number = 2): string {
  if (num === undefined || num === null || isNaN(num)) return 'N/A';
  
  const absNum = Math.abs(num);
  const sign = num < 0 ? '-' : '';
  
  if (absNum >= 1e12) {
    return `${sign}$${(Math.abs(num) / 1e12).toFixed(decimals)} T`;
  }
  if (absNum >= 1e9) {
    return `${sign}$${(Math.abs(num) / 1e9).toFixed(decimals)} B`;
  }
  if (absNum >= 1e6) {
    return `${sign}$${(Math.abs(num) / 1e6).toFixed(decimals)} M`;
  }
  if (absNum >= 1e3) {
    return `${sign}$${(Math.abs(num) / 1e3).toFixed(decimals)} K`;
  }
  return `${sign}$${Math.abs(num).toFixed(decimals)}`;
}

// forcing billions format for consistency in valuation tables
export function formatBillions(num: number | undefined | null, decimals: number = 2): string {
  if (num === undefined || num === null || isNaN(num)) return 'N/A';
  
  const absNum = Math.abs(num);
  const sign = num < 0 ? '-' : '';
  
  if (absNum >= 1e12) {
    return `${sign}$${(Math.abs(num) / 1e12).toFixed(decimals)} T`;
  }
  return `${sign}$${(Math.abs(num) / 1e9).toFixed(decimals)} B`;
}

export function formatWithCommas(num: number | undefined | null, decimals: number = 2): string {
  if (num === undefined || num === null || isNaN(num)) return 'N/A';
  
  return num.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

// no dollar sign for share counts
export function formatShares(num: number | undefined | null, decimals: number = 2): string {
  if (num === undefined || num === null || isNaN(num)) return 'N/A';
  
  const absNum = Math.abs(num);
  const sign = num < 0 ? '-' : '';
  
  if (absNum >= 1e12) {
    return `${sign}${(Math.abs(num) / 1e12).toFixed(decimals)}T`;
  }
  if (absNum >= 1e9) {
    return `${sign}${(Math.abs(num) / 1e9).toFixed(decimals)}B`;
  }
  if (absNum >= 1e6) {
    return `${sign}${(Math.abs(num) / 1e6).toFixed(decimals)}M`;
  }
  if (absNum >= 1e3) {
    return `${sign}${(Math.abs(num) / 1e3).toFixed(decimals)}K`;
  }
  return Math.abs(num).toFixed(decimals);
}

export function formatPercent(num: number | undefined | null, decimals: number = 1): string {
  if (num === undefined || num === null || isNaN(num)) return 'N/A';
  
  return `${(num * 100).toFixed(decimals)}%`;
}
