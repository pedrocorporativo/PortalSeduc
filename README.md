# Dashboard SEDUC modularizado

Arquivos principais:

- `index.html`: marcação e carregamento dos recursos locais.
- `assets/css/styles.css`: estilos.
- `assets/js/app.js`: comportamento e integração com dados.
- `assets/js/config.js`: configuração vazia, segura para publicar.
- `assets/js/config.example.js`: referência da configuração.
- `supabase-policies.sql`: modelo de Row Level Security (RLS).

## Como abrir/publicar sem perder o CSS

Não copie apenas `index.html`. Mantenha a pasta `assets` ao lado dele, pois ela contém o CSS,
o JavaScript e o leitor de Excel. Para hospedagem, envie o conteúdo inteiro da pasta
`seduc-dashboard`, preservando essa estrutura de arquivos.

## Importação de Excel

O botão **Importar Excel** aceita arquivos `.xlsx` e `.csv` de até 10 MB. A primeira linha
precisa conter os cabeçalhos **Cliente** e **Número do reparo** (também aceita `BD`, `Chamado`
ou `Ticket` como nome da coluna de reparo). As colunas opcionais **Produto** e **Cidade**
também são importadas quando presentes.

## Antes de publicar

1. A chave anon que existia no arquivo original deve ser revogada/rotacionada no Supabase. Embora uma chave anon não seja segredo, ela não pode permanecer associada a tabelas abertas por RLS.
2. Execute e adapte `supabase-policies.sql`. Teste com uma conta comum: ela só deve enxergar os próprios dados. O painel exige um JWT de usuário autenticado; não volta a usar a chave anon como autorização.
3. Mantenha `assets/js/config.js` sem segredos no repositório. Não exponha `service_role`, senha, token administrativo ou URL de webhook no front-end.
4. Configure no servidor os cabeçalhos abaixo (a meta CSP é uma camada adicional, não substitui o servidor):

```text
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https://*.supabase.co https://tessdata.projectnaptha.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

## Autenticação do painel

O navegador usa somente a chave pública do Supabase em `assets/js/config.js`. A autorização
das operações deve vir de um JWT de usuário autenticado retornado por
`APP_CONFIG.getAccessToken()`. Nunca coloque `service_role` ou qualquer chave administrativa
no HTML, no JavaScript ou no armazenamento do navegador.

As políticas em `supabase-policies.sql` restringem reparos ao `auth.uid()` e tornam o histórico
somente leitura para o cliente. Execute a migração em ambiente de teste, atribua os registros
legados a usuários de forma controlada e valide leitura, cadastro, edição e exclusão com uma
conta autenticada antes de publicar.

## Limites de importação

O leitor aceita apenas `.xlsx` e `.csv` de até 10 MB, com no máximo 5.000 linhas e 2.000
caracteres por célula. Os BDs são validados como 5 a 20 dígitos antes do envio; valores
inválidos são rejeitados e o conteúdo da planilha nunca é executado como HTML ou JavaScript.

`X-Content-Type-Options`, `Permissions-Policy`, `Strict-Transport-Security` e a CSP efetiva
devem ser enviados como cabeçalhos HTTP pelo servidor. A CSP no `<meta>` protege apenas parte
do documento e não substitui `frame-ancestors` nem os demais controles de transporte.

A importação de planilhas é feita no navegador com uma biblioteca local em `assets/vendor`.
