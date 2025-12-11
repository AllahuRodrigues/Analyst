# The Analyst

Started working on this November 10th, 05:43pm, for Zev's online assessment,to be used to value FAANG companies using a DCF model. Basically you can see if apple (amazon, google, meta, etc...) is overpriced or underpriced based on their cash flows.

## what it does

pick a company, tweak some assumptions like growth rate or wacc, and you get an intrinsic stock price, then compare that to the actual market price to see if it's a buy or no.

## Why i built it this way

### REST API instead of GraphQL

I went with REST because:
- financial modeling prep only offers REST endpoints, no graphql support
- for this app i'm literally just fetching company financials once, not doing complex nested queries
- REST is simpler - just hit `/stable/income-statement` and get back json
- graphql would be overkill when i only need 4 endpoints max per company

Basically graphql would be better if I need to fetch tons of related data in one go (like social media feeds with users + posts + comments), but for financial statements? REST does the job fine and keeps it simple.

### which API i'm using

**Financial Modeling Prep (FMP)** - specifically their `/stable/` endpoints

why FMP:
- free tier gives 250 calls/day which is enough for a demo
- has all the data i need: income statements, balance sheets, profiles, key metrics
- returns clean json, no weird parsing needed
- their "stable" endpoints are more reliable than the v3 ones

what i'm calling:
- `/stable/income-statement` - revenue data
- `/stable/balance-sheet-statement` - cash and debt
- `/stable/profile` - company name and shares outstanding
- `/api/v3/key-metrics` - backup for shares if profile doesn't have it

### caching strategy

i cache everything in two layers:
1. **server-side cache (5 min)** - saves responses in memory so multiple users don't spam the API
2. **localStorage (10 min)** - saves responses in your browser so switching companies is instant

why? because FMP only gives 250 calls/day. without caching you'd burn through that in like 30 minutes of testing.

### share count fallback chain

this was annoying. FMP doesn't always return `sharesOutstanding` in the same field. sometimes it's in profile, sometimes key-metrics, sometimes you gotta calculate it from market cap.

so i built a fallback:
1. try `profile[0].sharesOutstanding`
2. try `metrics[0].sharesOutstanding`  
3. try `income[0].weightedAverageShsOut`
4. try `income[0].weightedAverageShsOutDil`
5. calculate from `mktCap / price`
6. if all fail, return error

this is why the implied price per share is actually accurate now instead of showing like $1 trillion per share lol.

### why framer-motion

wanted smooth scroll animations like apple.com does. framer-motion makes it stupid easy:
- sections fade in as you scroll
- hero section scales/fades as you go down  
- buttons have nice hover/tap feedback
- all with like 3 lines of code per animation

## tech stack

- **Next.js 14** (app router)
- **TypeScript** (type safety for financial calcs)
- **Tailwind CSS** (styling)
- **Framer Motion** (animations)
- **Recharts** (fcf growth chart)
- **FMP API** (financial data)

## how the DCF works

1. project revenue for 5 years based on growth assumption
2. calculate EBIT, then after-tax EBIT
3. add back D&A, subtract CapEx and NWC change = **Free Cash Flow**
4. discount each year's FCF back to present value using WACC
5. calculate terminal value (assumes company grows forever at terminal rate)
6. add up all discounted FCFs + terminal value = **Enterprise Value**
7. subtract debt, add cash = **Equity Value**
8. divide by shares outstanding = **Price Per Share**

## why certain implementation choices

### sensitivity analysis

i built a heatmap showing how price changes with different WACC and growth assumptions because:
- tiny changes in WACC (like 8% vs 10%) can swing valuation by billions
- helps you see how sensitive your valuation is to your assumptions
- if changing growth by 0.5% makes the price double, your model is probably too aggressive

### number formatting

everything shows as $1.82 T or $123.4 B instead of $1,234,567,890 because:
- billion-scale numbers with full digits are impossible to read
- keeps the UI clean
- matches how analysts actually talk ("apple is a 3 trillion dollar company" not "3,000,000,000,000")

### localStorage for selected company

saves your last selected company so when you refresh the page it doesn't reset to Apple every time. small ux thing but makes testing way faster.

### clickable sections with modals

you can click on company names, valuation results, forecast tables etc to see:
- where the data came from (which API endpoint)
- how the calculation works
- what each metric means

did this because DCF has a lot of moving parts and i wanted transparency on where every number comes from.

## how to run

1. get an API key from [financialmodelingprep.com](https://financialmodelingprep.com)
2. create `.env` in the root:
```
FMP_KEY=your_key_here
```
3. install and run:
```bash
npm install
npm run dev
```
4. go to `localhost:3000`

## the dashboard

users will be able to upload their own SEC filings and get structured data out, the main flow is:

1. **upload a PDF** - any 10-K or 10-Q filing
2. **parser extracts financials** - reads tables row-by-row, finds labels, gets values from same row (horizontal reading instead of picking first number)
3. **view all parsed data** - see everything it found: metadata, income statement, balance sheet, cash flow, with confidence scores and page numbers
4. **run DCF analysis** - use the extracted data to build a DCF model right there
5. **save to sessions** - link documents to analysis sessions so you can ask questions later

### why the parser works row-by-row

SEC filings have financial tables where labels are in column 1 and values in columns 2+. if you just search for "Total Revenue" and grab the first number, you might get a footnote or the wrong period. instead, i:

- detect table structure from OCR positions
- find the label on a row
- read horizontally to get the value from the same row
- prioritize consolidated statements over notes/footnotes

this gives way better accuracy because i'm matching labels to their actual values instead of hoping the first number found is the right one.

### document management

every uploaded PDF gets saved to your account (stored in supabase). you can:
- see all your documents
- delete ones you don't need
- link documents to sessions for analysis

### sessions

sessions are basically workspaces where you can:
- attach a document
- run DCF calculations
- save results
- (eventually) ask questions about the document

i built this because financial analysis is iterative - you upload a 10-K, extract data, build a model, tweak assumptions, ask questions, etc. sessions let you keep all that work organized.

## limitations

- FMP free tier = 250 calls/day (caching helps but you'll still hit it eventually)
- only works for companies FMP has data for (so FAANG + most US large caps)
- shares outstanding can still be wrong for some tickers if FMP data is stale
- DCF assumes steady growth which is never true in real life
- parser works best on text-based PDFs (scanned PDFs need OCR which is slow)

---

