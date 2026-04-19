import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const DEFAULT_INVITE = "manager";

type Body = {
  email?: string;
  password?: string;
  inviteToken?: string;
};

/**
 * POST /api/auth/register
 * Valida o token de convite no servidor e faz signUp com a chave anon.
 * O projeto Supabase deve ter a migration `0006_auto_confirm_email_on_signup`
 * (trigger em auth.users) para marcar o e-mail como confirmado na hora —
 * sem SUPABASE_SERVICE_ROLE_KEY e sem abrir o painel.
 */
export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const email = body.email?.trim();
  const password = body.password;
  const inviteToken = body.inviteToken?.trim();

  const expected =
    process.env.SIGNUP_INVITE_TOKEN?.trim() || DEFAULT_INVITE;

  if (!email || !password) {
    return NextResponse.json(
      { error: "Informe usuário (e-mail) e senha." },
      { status: 400 }
    );
  }

  if (inviteToken !== expected) {
    return NextResponse.json(
      { error: "Token de cadastro inválido." },
      { status: 403 }
    );
  }

  if (password.length < 6) {
    return NextResponse.json(
      { error: "A senha deve ter pelo menos 6 caracteres." },
      { status: 400 }
    );
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    return NextResponse.json(
      {
        error:
          "Configuração incompleta: defina NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY.",
      },
      { status: 500 }
    );
  }

  const supabase = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error } = await supabase.auth.signUp({
    email,
    password,
  });

  if (error) {
    const msg = error.message.toLowerCase();
    if (
      msg.includes("already") ||
      msg.includes("registered") ||
      msg.includes("exists")
    ) {
      return NextResponse.json(
        { error: "Este e-mail já está cadastrado. Use Entrar." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
