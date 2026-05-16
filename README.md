# Jocum React

Mobile-first React app built with Next.js and Supabase, ready for Vercel.

## Configuração

1. Instale dependências:

```bash
npm install
```

2. Configure as variáveis de ambiente em `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://xptkrsbjyyslbgurfvbg.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_pYxXJES07IMdRM9ULLc7fQ_HD07JiGo
NEXT_PUBLIC_APP_URL=http://localhost:3000
ASAAS_API_KEY=\$sua_chave_api_do_asaas
ASAAS_API_URL=https://api.asaas.com/v3
ASAAS_DUE_DATE_LIMIT_DAYS=3
ASAAS_MAX_INSTALLMENTS=1
```

Se a chave do Asaas começar com `$`, mantenha a barra invertida antes dele (`\$`) para o Next.js não interpretar como variável. Para testar no sandbox do Asaas, use `ASAAS_API_URL=https://api-sandbox.asaas.com/v3` e uma chave gerada na conta sandbox.

3. Inicie em desenvolvimento:

```bash
npm run dev
```

## Login padrão

- Email: `cm@cm.com`
- Senha: `holyholy`

## Publicar no Vercel

1. Faça login no Vercel.
2. Crie um novo projeto apontando para este repositório.
3. Adicione as mesmas variáveis de ambiente no dashboard do Vercel.
4. Deploy.
# wifi_manager_jocum_at
