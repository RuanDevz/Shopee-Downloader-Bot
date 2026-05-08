Pronto. Aqui está o resumo do que mudou e o que você precisa fazer:

  No bot (este projeto)                                                                                                                                
                                                                                                                                               
  Novos arquivos / mudanças:
  - src/services/siteApi.js — cliente HTTP que conversa com o site (link, status, downloads).                                                          
  - src/bot.js — agora tem /start <token> para vincular conta, /status para ver plano, e bloqueia downloads quando allowed: false.                   
  - .env.example — três novas variáveis: SITE_API_URL, SITE_API_KEY, SITE_PUBLIC_URL.

  Adicionar na Vercel (Settings → Environment Variables):
  - SITE_API_URL=https://shopeedownloader.com
  - SITE_API_KEY=<gere com openssl rand -hex 32> ← mesmo valor do site
  - SITE_PUBLIC_URL=https://shopeedownloader.com

  Depois vercel --prod para redeployar.

  No site (shopeedownloader.com)

  Tudo na pasta site-examples/ — leia o site-examples/README.md que explica onde cada arquivo entra.

  Passos:
  1. Rodar schema.sql no seu Postgres.
  2. Copiar os 4 arquivos .ts para app/api/bot/... no Next.js.
  3. Substituir o bloco de auth no issue-link-token pela sua função de sessão real (NextAuth, Clerk, etc.).
  4. Adicionar BOT_API_SECRET=<mesmo valor do bot> no env do site.
  5. Colocar o componente OpenInTelegramButton no painel do usuário e trocar BOT_USERNAME pelo username real do seu bot.

  Segurança (pontos importantes)

  - O bot nunca decide a cota — quem decide é o site, com UPDATE atômico no Postgres. Isso bloqueia race conditions de spam.
  - Toda chamada bot→site exige header X-Bot-Secret. Sem ele, retorna 401.
  - Tokens de vínculo são de uso único + expiram em 10min — não dá pra reaproveitar deep link.

  Quando quiser testar: gere um token manualmente no banco (INSERT INTO bot_link_tokens ...) e mande /start <esse-token> pro bot — ou já implemente o
  botão no site direto.