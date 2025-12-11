import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Use Node.js runtime - Supabase client requires Node.js APIs
export const runtime = 'nodejs';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://nkcfbnbqvljpzuckoyhc.supabase.co';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5rY2ZibmJxdmxqcHp1Y2tveWhjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM0MjQ4NTUsImV4cCI6MjA3OTAwMDg1NX0.QN_uwOmyiPjmYtfxP8ZDBJn9reh_G-uijfGM1QwPhPQ';

async function getSupabaseClient(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) {
    throw new Error('Unauthorized');
  }

  const token = authHeader.replace('Bearer ', '');
  const supabase = createClient(supabaseUrl, supabaseKey, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });

  const { data: { user }, error: authError } = await supabase.auth.getUser(token);

  if (authError || !user) {
    throw new Error('Unauthorized');
  }

  return { supabase, user };
}

export async function GET(request: NextRequest) {
  try {
    const { supabase, user } = await getSupabaseClient(request);

    const { data, error } = await supabase
      .from('sessions')
      .select('*, documents(filename)')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false });

    if (error) throw error;

    return NextResponse.json({ sessions: data || [] });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { supabase, user } = await getSupabaseClient(request);

    const body = await request.json();
    const { name, document_id } = body;

    if (!name) {
      return NextResponse.json({ error: 'Session name is required' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('sessions')
      .insert({
        user_id: user.id,
        name,
        document_id: document_id || null,
        messages: [],
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ session: data });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { supabase, user } = await getSupabaseClient(request);

    const body = await request.json();
    const { id, name, messages, dcf_data, document_id } = body;

    if (!id) {
      return NextResponse.json({ error: 'Session ID is required' }, { status: 400 });
    }

    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (messages !== undefined) updateData.messages = messages;
    if (dcf_data !== undefined) updateData.dcf_data = dcf_data;
    if (document_id !== undefined) updateData.document_id = document_id;

    const { data, error } = await supabase
      .from('sessions')
      .update(updateData)
      .eq('id', id)
      .eq('user_id', user.id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ session: data });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { supabase, user } = await getSupabaseClient(request);

    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('id');

    if (!sessionId) {
      return NextResponse.json({ error: 'Missing session ID' }, { status: 400 });
    }

    const { error } = await supabase
      .from('sessions')
      .delete()
      .eq('id', sessionId)
      .eq('user_id', user.id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

