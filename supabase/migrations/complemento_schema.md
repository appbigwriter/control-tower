Anúncios — GAM + AdSense + parceiros diretos

3.1 Extensão do schema

sql-- =========================================================
-- AD SLOTS — atualização: agora referencia o Ad Manager
-- =========================================================
ALTER TABLE blog_facebrasil.ad_slots
  ADD COLUMN gam_ad_unit_path text,        -- ex: "/1234567/fbr-blog/sidebar_top"
  ADD COLUMN size_mapping jsonb NOT NULL DEFAULT '[]'::jsonb;
  -- ex: [{ "viewport": [0,0], "sizes": [[300,250]] },
  --      { "viewport": [768,0], "sizes": [[300,250],[336,280]] }]

ALTER TABLE blog_facebrasil.ad_slots
  DROP CONSTRAINT ad_slots_provider_check;

ALTER TABLE blog_facebrasil.ad_slots
  ADD CONSTRAINT ad_slots_provider_check CHECK (provider = ANY (ARRAY[
    'gam'::text,             -- inclui AdSense + qualquer rede plugada via GAM/header bidding
    'direct_creative'::text  -- parceria direta sem passar pelo GAM
  ]));

-- =========================================================
-- DIRECT CAMPAIGNS — parcerias diretas (não passam pelo leilão do GAM)
-- Permite rotação entre múltiplos anunciantes no mesmo slot
-- =========================================================
CREATE TABLE blog_facebrasil.direct_campaigns (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  ad_slot_id uuid NOT NULL,
  partner_name text NOT NULL,
  creative_url text NOT NULL,          -- imagem ou HTML do banner
  click_url text NOT NULL,
  weight integer NOT NULL DEFAULT 1,   -- peso na rotação (maior = aparece mais)
  starts_at timestamp with time zone NOT NULL DEFAULT now(),
  ends_at timestamp with time zone,
  impression_count bigint NOT NULL DEFAULT 0,
  click_count bigint NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT direct_campaigns_pkey PRIMARY KEY (id),
  CONSTRAINT direct_campaigns_slot_fkey FOREIGN KEY (ad_slot_id)
    REFERENCES blog_facebrasil.ad_slots(id)
);

impression_count/click_count incrementam via endpoint próprio (POST /api/ads/track) chamado no client
quando o slot renderiza e quando o usuário clica — simples, sem precisar de ad server pra isso.

3.2 Componente AdSlot (Next.js App Router)

Carrega o GPT uma vez no layout raiz, e cada <AdSlot /> define/exibe seu próprio slot.
Cuida do problema de navegação client-side (destrói e redefine o slot ao trocar de rota).

tsx// components/ads/GamProvider.tsx — coloque no layout raiz, uma vez só
'use client';
import Script from 'next/script';
import { createContext, useContext, useEffect, useRef } from 'react';

declare global {
  interface Window {
    googletag: any;
  }
}

const GamContext = createContext(false);
export const useGamReady = () => useContext(GamContext);

export function GamProvider({ children }: { children: React.ReactNode }) {
  const ready = useRef(false);

  useEffect(() => {
    window.googletag = window.googletag || { cmd: [] };
    window.googletag.cmd.push(() => {
      window.googletag.pubads().enableSingleRequest();
      window.googletag.pubads().collapseEmptyDivs();
      window.googletag.enableServices();
      ready.current = true;
    });
  }, []);

  return (
    <>
      <Script
        src="https://securepubads.g.doubleclick.net/tag/js/gpt.js"
        strategy="afterInteractive"
      />
      {children}
    </>
  );
}

tsx// components/ads/AdSlot.tsx
'use client';
import { useEffect, useId } from 'react';
import { usePathname } from 'next/navigation';

type AdSlotProps = {
  adUnitPath: string;      // vem de ad_slots.gam_ad_unit_path
  sizes: [number, number][];
  minHeight: number;       // evita layout shift — deve bater com o maior size
};

export function AdSlot({ adUnitPath, sizes, minHeight }: AdSlotProps) {
  const divId = useId().replace(/:/g, '');
  const pathname = usePathname();

  useEffect(() => {
    if (!window.googletag) return;

    window.googletag.cmd.push(() => {
      const slot = window.googletag.defineSlot(adUnitPath, sizes, divId);
      if (slot) {
        slot.addService(window.googletag.pubads());
        window.googletag.display(divId);
      }
    });

    // trafega registro de impressão simples (pro seu tracking direto, se aplicável)
    fetch('/api/ads/track', {
      method: 'POST',
      body: JSON.stringify({ adUnitPath, event: 'impression' }),
    }).catch(() => {});

    return () => {
      // destrói o slot ao sair da rota — evita anúncio "grudado" em navegação SPA
      window.googletag?.cmd?.push(() => {
        const slot = window.googletag
          .pubads()
          .getSlots()
          .find((s: any) => s.getSlotElementId() === divId);
        if (slot) window.googletag.destroySlots([slot]);
      });
    };
  }, [pathname, adUnitPath, divId, sizes]);

  return (
    <div
      id={divId}
      data-ad-slot={adUnitPath}
      style={{ minHeight, width: '100%' }}
    />
  );
}

Uso dentro de um bloco layout_blocks do tipo ad_slot: você lê gam_ad_unit_path e size_mapping
direto do banco e passa como props — nenhum código muda entre blogs, só o dado.

3.3 ads.txt multi-domínio

Cada blog/domínio precisa do próprio ads.txt na raiz. Como você tem N domínios no Cloudflare,
o jeito certo é gerar isso a partir de config central (não manter arquivo estático manual por blog):

ts// app/ads.txt/route.ts
export async function GET() {
  const entries = [
    'google.com, pub-XXXXXXXXXXXXXXXX, DIRECT, f08c47fec0942fa0',
    // + uma linha por rede adicional plugada no GAM (cada parceiro te dá a linha exata)
  ];
  return new Response(entries.join('\n'), {
    headers: { 'Content-Type': 'text/plain' },
  });
}

Puxe as linhas de rede/parceiro de uma tabela ad_network_partners (nome, seller_id, tax_id) se
o número de redes crescer — assim adicionar uma rede nova é UPDATE no banco, não deploy.