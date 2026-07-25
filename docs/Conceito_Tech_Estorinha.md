1. Modelo de negócio — visão geral

O Estorinha não é um produto único (livro OU vídeo), é uma plataforma de monetização multi-formato sobre um mesmo cadastro. Isso muda a lógica de precificação: em vez de vender "um produto caro", a estratégia é vender entrada barata + expansão de consumo ao longo do tempo, porque o cadastro da criança já existe e cada novo formato tem custo marginal baixo.

Análise de referência de mercado (concorrentes de produto único, que já validam disposição de pagar):

Boki (PT): eBook €5,99 / capa dura €29
Livro Mágico Infantil (PT): eBook €6,99 / capa dura €27,99
FabulAi (BR): não divulga preço fixo publicamente, mas opera por checkout individual via Asaas

Isso indica uma âncora de mercado já educada: R$ 30–40 para digital, R$ 120–160 para versão física — e o público (avós/tios) já demonstrou disposição a pagar isso por um único item avulso, sem nenhum ecossistema por trás.

2. Estrutura de monetização (multi-stream)
A. Assinatura da família (recorrência principal)

Quem cria o perfil da criança (normalmente os pais) assina um plano que dá acesso ao "Gêmeo Digital" e um pacote de gerações por mês.

Plano	Preço sugerido	O que inclui
Grátis (isca)	R$ 0	1 história curta digital com marca d'água + amostra de personagem gerado
Estorinha Essencial	R$ 24,90/mês ou R$ 199/ano	2 histórias digitais/mês, 1 vídeo curto/mês, personagem salvo
Estorinha Família	R$ 49,90/mês ou R$ 399/ano	Gerações ilimitadas (fair-use), voz narrada, prioridade de fila, descontos em impressão
B. Compras avulsas por parentes (o motor viral)

Este é o item mais importante do modelo: avós, tios e padrinhos não precisam assinar — eles compram um produto pontual vinculado ao perfil já existente da criança, via link (mesma lógica validada pelo case Nestlé/20DASH no WhatsApp, sem fricção de cadastro).

Produto avulso	Preço sugerido	Margem estimada*
Vídeo animado personalizado (30–60s)	R$ 19,90–29,90	~85% (custo de geração de IA baixo)
Livro digital (PDF/app)	R$ 29,90–39,90	~90%
Livro impresso capa dura	R$ 129–169	~35–40% (print-on-demand + frete)
Kit de festa (rótulos + convites + adesivos, digital)	R$ 34,90	~85%
Kit de festa físico (impresso, entregue)	R$ 89–139	~30%
Camiseta/caneca personalizada	R$ 59,90–79,90	~35% (POD)

*Margens estimadas com base em custo de inferência de IA generativa + parceiros de print-on-demand nacionais; validar com fornecedor antes de fechar preço final.

C. Presente-relâmpago sazonal (gatilho de urgência)

Pacotes fechados por data (Dia das Crianças, Natal, Dia dos Avós), vendidos como "edição especial" — aproveitando a janela de decisão rápida de quem compra presente de última hora. Preço levemente premium (+15–20%) porque resolve um problema de tempo, não só de produto.

D. B2B2C (canal paralelo, para escalar aquisição)

Parceria com buffets infantis, maternidades e fotógrafos de evento: eles revendem ou oferecem como cortesia/upsell (ex: "seu convite personalizado com IA incluso no pacote de festa"), e o Estorinha paga comissão ou split. Baixo CAC, alta credibilidade.

3. Unit economics — pontos de atenção
Custo variável dominante: geração de imagem/vídeo por IA (via API) — precisa ser modelado por gerações/mês/usuário para não corroer margem no plano "ilimitado".
Custo de impressão física é o item que mais pressiona margem (frete + POD) — por isso a estratégia de preço deve empurrar o digital como produto-âncora e o físico como upsell de alta percepção de valor (mas margem mais apertada).
CAC esperado baixo se o loop de presente funcionar bem: quem recebe o link de presente já é uma aquisição "morna" (interesse emocional pré-existente), diferente de tráfego pago frio.
LTV multiplicado pelo cadastro compartilhado: diferente da concorrência (compra única), aqui o mesmo perfil de criança pode gerar receita de 4–5 pessoas diferentes da família ao longo do ano — esse é o argumento central para justificar um CAC de aquisição um pouco mais agressivo no lançamento.
4. Recomendação de posicionamento de preço

Ficar na âncora já validada pelo mercado (não abaixo, para não parecer "genérico"), mas comunicar valor pela variedade de formatos e recorrência, não pelo preço mais baixo. O plano gratuito existe só para gerar a primeira amostra emocional (o "choro de emoção" que aparece nos depoimentos da concorrência) — ele é a isca de conversão, não uma opção de uso permanente.


Preço sugerido: R$ 24,90

Por que funciona:

Fica abaixo dos R$ 29,90 dos concorrentes de produto único, mas acima de apps gratuitos — позициониamento de "produto de qualidade que cabe no orçamento de quem já gasta pouco".
Justifica o valor pela recorrência e pelo "presente" que dura mais de um dia (criança vai querer ver e rever).
É baixo o suficiente para um avô/tio comprar por impulso sem discutir com o(a) parceiro(a) ("é só 25 reais"), mas alto o suficiente para cobrir custo de geração + margem.

2. Identidade visual, naming derivado e tom de voz
Personalidade de marca

O Estorinha vive na intersecção de dois arquétipos: o Cuidador (afeto, acolhimento, proteção da criança) e o Mago/Criador (transformação — foto vira personagem, criança vira heroína). Isso define os limites de tudo que vem depois: nada de humor irônico, nada de estética "tech fria", nada de infantilização que soe artificial para o adulto que está comprando.

A marca fala com o adulto que ama a criança, não com a criança diretamente — importante, porque quem decide e paga é sempre o parente.

Arquitetura de naming (nomes derivados)

Definir desde já como os produtos e conceitos internos vão se chamar evita inconsistência mais tarde:

Conceito	Nome derivado sugerido	Racional
O cadastro central da criança	Meu Personagem	Concreto, fácil de explicar para avó: "você cria o Meu Personagem uma vez"
O assistente/IA que guia a criação	Conte-me (ou Tia Estorinha, se quiser um tom de "contadora de histórias")	Reforça a metáfora de contar história, não de "chatbot"
A biblioteca de histórias geradas	Estante do(a) [Nome da criança]	Personaliza o espaço, cria senso de posse/coleção
Presentes avulsos comprados por parentes	Mimo Estorinha	"Mimo" é uma palavra brasileira carinhosa, já comunica "presente pequeno e afetuoso"
Pacotes sazonais (Natal, Dia das Crianças)	Estorinha Especial: [data]	Mantém consistência de marca em campanhas recorrentes

Evitar nomes técnicos como "gerar conteúdo", "criar asset", "gerenciar perfil" em qualquer superfície visível ao usuário — tudo deve soar como "contar uma história", nunca como "produzir um output".

Tom de voz

Regra central: frases curtas, calorosas, nunca performáticas. O tom deve soar como uma pessoa contando uma novidade boa para um amigo — não como um app de tecnologia se vendendo.

Em vez de...	Estorinha diz...
"Gere conteúdo personalizado com IA"	"Conte uma história com a cara do seu filho"
"Assinatura premium desbloqueia recursos ilimitados"	"Quanto mais você usa, mais surpresas cabem na estante dele"
"Compartilhe com sua rede"	"Manda pra vovó ver"
"Erro ao processar sua solicitação"	"Ops, a história emperrou aqui — vamos tentar de novo?"

Isso vale também para textos de erro, onboarding e e-mails transacionais — é um erro comum de produtos desse nicho manter o tom afetivo só na landing page e esquecer dele no fluxo real do app.

Direção visual conceitual (mood, não paleta final)

Antes de travar fonte e cor no Projeto Conceitual, vale alinhar a direção:

Ilustração, não fotografia realista como elemento dominante — mesmo linha do FabulAi/Boki, que já validaram que pais preferem a criança "reinterpretada" de forma lúdica a um realismo hiper-fiel (que pode até incomodar, efeito "uncanny valley").
Traço orgânico e aquarelado, não geométrico/corporativo — reforça o calor emocional, afasta do visual "SaaS".
Espaço para o rosto da criança "brilhar" na composição — ela é sempre o centro visual, nunca um elemento decorativo entre textos e botões.
Evitar excesso de elementos "fantasiosos genéricos" (estrelinhas, arco-íris) que já saturam esse nicho — a diferenciação visual pode vir de uma paleta mais sofisticada e menos "app infantil clichê", já que quem decide a compra é adulto.


