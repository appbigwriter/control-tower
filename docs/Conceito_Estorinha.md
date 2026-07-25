# PRD — Estorinha v1.0
**Domínio provisório:** estorinha.net
**Status:** Rascunho para validação
**Data:** Julho 2026

---

## 1. Visão Geral

Estorinha é uma plataforma que transforma o afeto que pais, avós, tios, irmãos e padrinhos sentem por uma criança em conteúdo personalizado gerado por IA — histórias ilustradas, vídeos animados, narrações em áudio e brindes físicos — a partir de um único cadastro central da criança ("Meu Personagem").

O produto resolve duas dores simultâneas:
1. **Da família estendida:** desejo constante de expressar carinho pela criança, hoje limitado a curtidas e comentários passivos em fotos/vídeos.
2. **Dos pais:** fragmentação de esforço — cada parente querendo "fazer algo" pela criança de forma isolada, repetitiva ou de última hora.

---

## 2. Objetivos de Negócio

- **OBJ-01:** Validar disposição de pagamento de parentes não-pais (avós, tios, padrinhos) por produtos avulsos vinculados a um cadastro existente.
- **OBJ-02:** Estabelecer o cadastro da criança ("Meu Personagem") como ativo reutilizável, elevando o LTV por criança acima da média de concorrentes de produto único.
- **OBJ-03:** Criar um loop viral de aquisição via presentes compartilhados (link de compra sem necessidade de cadastro prévio pelo comprador).
- **OBJ-04:** Garantir conformidade irrestrita com LGPD e boas práticas de proteção de dados de menores desde o v1.0 (não tratado como débito técnico).

---

## 3. Personas

| Persona | Papel | Motivação central |
|---|---|---|
| **Mãe/Pai administrador(a)** | Cria e gerencia o perfil da criança | Organizar memórias, reduzir fricção de coordenação familiar |
| **Avó/Avô presenteador(a)** | Compra produtos avulsos via link | Expressar carinho, baixo domínio técnico esperado |
| **Tio/Padrinho ocasional** | Compra pontual em datas específicas | Resolver "o que dar de presente" com rapidez |
| **Criança (usuária final passiva)** | Recebe e consome o conteúdo | Reconhecimento e protagonismo na história |

---

## 4. Escopo de Módulos — v1.0

### M-CORE — Cadastro Central ("Meu Personagem")
- **RF-CORE-1:** Sistema permite criar um perfil de criança com nome, apelido, idade, foto(s) de referência (mínimo 1, recomendado 3 para consistência de personagem).
- **RF-CORE-2:** Sistema gera um "personagem visual" consistente a partir das fotos, reutilizável em múltiplos formatos de saída.
- **RF-CORE-3:** Perfil registra interesses, cor favorita, animal de estimação e um "traço de personalidade" livre, usados como variáveis de personalização narrativa.
- **RF-CORE-4:** Um perfil pode ser acessado por múltiplos responsáveis/parentes autorizados sem duplicar cadastro.
- **RF-CORE-5:** Histórico de conteúdo gerado fica arquivado na "Estante do(a) [Nome]", com ordenação cronológica.

### M-GEN — Geração de Conteúdo
- **RF-GEN-1:** Geração de história ilustrada curta (livro digital, 8–12 páginas) a partir do perfil + tema escolhido.
- **RF-GEN-2:** Geração de vídeo animado curto (30–60s) com o personagem, para uso em datas/ocasiões (aniversário, convite, mensagem).
- **RF-GEN-3:** Narração em áudio da história, com opção de voz padrão do sistema ou voz clonada de um familiar (consentimento explícito obrigatório para clonagem de voz).
- **RF-GEN-4:** Templates sazonais pré-configurados (Dia das Crianças, Natal, Dia dos Avós, aniversário, chegada de irmão(ã)).
- **RF-GEN-5:** Tempo de geração-alvo: entrega em minutos, não horas (benchmark de mercado already validado por concorrentes).

### M-MIMO — Compras Avulsas (Presentes de Parentes)
- **RF-MIMO-1:** Qualquer parente pode comprar um produto avulso vinculado a um perfil existente via link compartilhável, sem necessidade de criar conta própria.
- **RF-MIMO-2:** Fluxo de compra funciona via web e via WhatsApp (checkout conversacional), reduzindo fricção para público de menor domínio técnico.
- **RF-MIMO-3:** Comprador recebe confirmação de entrega e pode compartilhar o resultado diretamente com o grupo familiar.
- **RF-MIMO-4:** Sistema sugere produtos "Mimo" com base em datas relevantes (aniversário cadastrado, datas sazonais).

### M-PRINT — Produtos Físicos (Print-on-Demand)
- **RF-PRINT-1:** Integração com fornecedor de POD para livro impresso capa dura, camisetas, canecas e kits de festa (rótulos, adesivos, convites).
- **RF-PRINT-2:** Rastreamento de pedido e prazo de entrega visível ao comprador.
- **RF-PRINT-3:** Reaproveitamento automático da arte já gerada digitalmente para os produtos físicos, sem custo adicional de design.

### M-SUB — Assinatura e Monetização
- **RF-SUB-1:** Plano gratuito com 1 geração de amostra (com marca d'água), como isca de conversão emocional.
- **RF-SUB-2:** Planos pagos "Essencial" e "Família" com cotas de geração mensal (ver bloco de precificação já validado).
- **RF-SUB-3:** Compras avulsas (M-MIMO) não exigem assinatura ativa do comprador.
- **RF-SUB-4:** Pacotes sazonais "Estorinha Especial" com preço e disponibilidade por tempo limitado.

### M-SAFETY — Segurança, Privacidade e Conformidade
- **RF-SAFETY-1:** Consentimento parental centralizado antes de qualquer geração de conteúdo envolvendo a criança.
- **RF-SAFETY-2:** Controle granular de quem (além do responsável) pode solicitar novas gerações sobre o perfil.
- **RF-SAFETY-3:** Moderação automática + revisão humana amostral do conteúdo gerado antes da entrega.
- **RF-SAFETY-4:** Conformidade com LGPD, incluindo direito de exclusão total de dados, fotos e conteúdo gerado a qualquer momento.
- **RF-SAFETY-5:** Dados e imagens da criança nunca são utilizados para treinar modelos de terceiros nem para outros fins além da geração solicitada.
- **RF-SAFETY-6:** Clonagem de voz (RF-GEN-3) exige consentimento explícito e separado do consentimento geral de cadastro.

### M-SOCIAL — Compartilhamento e Loop Viral
- **RF-SOCIAL-1:** Todo conteúdo entregue via M-MIMO carrega um selo discreto de marca com CTA de criação própria.
- **RF-SOCIAL-2:** Compartilhamento direto para WhatsApp/redes a partir da tela de entrega, sem etapas intermediárias.
- **RF-SOCIAL-3:** Programa de indicação: presentear gera benefício mensurável para o presenteador (desconto na próxima compra).

---

## 5. Não-Objetivos (Fora do Escopo v1.0)

- Rede social pública entre famílias (sem feed público ou descoberta entre usuários não conectados).
- Internacionalização/multi-idioma (v1.0 é Brasil/português; expansão fica para versão futura).
- Geração de conteúdo interativo em tempo real (jogos, chat ao vivo com o personagem).
- Marketplace aberto a terceiros para venda de templates/temas.

---

## 6. Métricas de Sucesso (v1.0)

- Taxa de conversão do plano gratuito → primeira compra paga (assinatura ou avulsa).
- Número médio de compradores distintos por perfil de criança (validação do OBJ-02).
- % de compras avulsas originadas de link compartilhado sem cadastro prévio (validação do loop viral, OBJ-03).
- Tempo médio de geração ponta a ponta (meta: minutos).
- Zero incidentes de conformidade LGPD reportados.

---

## 7. Riscos e Mitigações

| Risco | Mitigação |
|---|---|
| Inconsistência do personagem visual entre gerações | Investir cedo em pipeline de "character lock"; validar com fornecedor de IA antes de comprometer prazo |
| Percepção de insegurança com dados de menores | M-SAFETY como módulo de lançamento, não pós-lançamento; comunicação transparente na marca |
| Margem apertada em produtos físicos (POD) | Precificar físico como upsell de alta percepção, não como produto de entrada |
| Baixa disposição de avós/tios para usar app novo | Priorizar fluxo via WhatsApp (RF-MIMO-2) como porta de entrada de menor fricção |

---

