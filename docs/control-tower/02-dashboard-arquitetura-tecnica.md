# Arquitetura Técnica

Camadas:

- apresentação em Next.js
- API em route handlers
- catálogo central em `public`
- schemas dedicados por projeto

Princípios:

- permitir apenas schemas allowlisted
- provisionar de forma idempotente
- registrar auditoria sempre que possível
