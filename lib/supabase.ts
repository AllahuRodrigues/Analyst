import { createBrowserClient } from '@supabase/ssr';

const supabaseUrl = 'https://nkcfbnbqvljpzuckoyhc.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5rY2ZibmJxdmxqcHp1Y2tveWhjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM0MjQ4NTUsImV4cCI6MjA3OTAwMDg1NX0.QN_uwOmyiPjmYtfxP8ZDBJn9reh_G-uijfGM1QwPhPQ';

export const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey);

