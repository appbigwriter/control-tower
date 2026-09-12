#!/usr/bin/env python3
"""
Control Tower CLI Helper for Virtual Agents (Hermes / Antigravity)
Facilita a execução de operações de provisionamento, listagem e extração de documentos.
"""

import os
import sys
import json
import argparse
import urllib.request
import urllib.error

BASE_URL = os.environ.get("CONTROL_TOWER_BASE_URL", "http://localhost:3000")
API_KEY = os.environ.get("CONTROL_TOWER_AGENT_API_KEY", "<secret-manager:fbr/services/agency-flux/CONTROL_TOWER_AGENT_API_KEY>")

def request_api(path: str, method: str = "GET", data: dict = None):
    url = f"{BASE_URL.rstrip('/')}{path}"
    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
        "Accept": "application/json, text/markdown, */*",
    }

    body = json.dumps(data).encode("utf-8") if data else None
    req = urllib.request.Request(url, data=body, headers=headers, method=method)

    try:
        with urllib.request.urlopen(req) as response:
            content_type = response.headers.get("Content-Type", "")
            raw = response.read().decode("utf-8")
            if "application/json" in content_type:
                return json.loads(raw)
            return raw
    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8")
        try:
            parsed = json.loads(error_body)
            print(f"[ERRO HTTP {e.code}] {parsed.get('error', error_body)}", file=sys.stderr)
        except Exception:
            print(f"[ERRO HTTP {e.code}] {error_body}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"[ERRO DE CONEXÃO] Não foi possível conectar a {url}: {e}", file=sys.stderr)
        sys.exit(1)

def list_projects():
    data = request_api("/api/control-tower/projects")
    projects = data.get("projects", [])
    print(f"\n--- Portfólio Control Tower ({len(projects)} projetos) ---")
    for p in projects:
        print(f"• [{p.get('status', '').upper()}] {p.get('name')} (slug: {p.get('slug')})")
        print(f"  Schema: {p.get('schema_name')} | Tipo: {p.get('business_type')} | Domínio: {p.get('domain') or 'N/A'}")
    print()

def provision_project(name: str, slug: str, business_type: str, domain: str = None, language: str = "pt"):
    type_to_template = {
        "blog": "blog_standard",
        "store": "store_standard",
        "saas": "saas_standard",
        "custom": "custom_base",
    }
    template_key = type_to_template.get(business_type, "blog_standard")

    payload = {
        "name": name,
        "slug": slug,
        "business_type": business_type,
        "template_key": template_key,
        "domain": domain,
        "language": language,
    }

    print(f"Provisionando novo banco: {name} (slug: {slug}, tipo: {business_type})...")
    res = request_api("/api/control-tower/projects", method="POST", data=payload)
    print("Sucesso:", res.get("message"))
    print(f"ID do Projeto: {res.get('project_id')}")

def get_doc(slug: str, doc_type: str = "dev"):
    endpoint_map = {
        "dev": f"/api/control-tower/projects/{slug}/developer-doc",
        "bigwriter": f"/api/control-tower/projects/{slug}/bigwriter-handoff",
        "adsense": f"/api/control-tower/projects/{slug}/frontend-adsense-handoff",
    }
    path = endpoint_map.get(doc_type, endpoint_map["dev"])
    doc = request_api(path)
    print(doc)

def execute_sql(slug: str, sql: str):
    payload = {"sql": sql}
    res = request_api(f"/api/control-tower/projects/{slug}/sql", method="POST", data=payload)
    print(json.dumps(res, indent=2))

def delete_project(slug: str, confirm: bool):
    if not confirm:
        print(f"[ABORTADO] Para excluir o projeto '{slug}', passe a flag --confirm.", file=sys.stderr)
        sys.exit(1)
    res = request_api(f"/api/control-tower/projects/{slug}", method="DELETE")
    print("Sucesso:", res.get("message"))

def main():
    parser = argparse.ArgumentParser(description="Control Tower CLI para Agentes Virtuais")
    subparsers = parser.add_subparsers(dest="command", required=True)

    # Subcomando: list
    subparsers.add_parser("list", help="Listar todos os projetos do portfólio")

    # Subcomando: provision
    p_provision = subparsers.add_parser("provision", help="Provisionar um novo banco de dados")
    p_provision.add_argument("--name", required=True, help="Nome do projeto")
    p_provision.add_argument("--slug", required=True, help="Slug único (minúsculas, sem traços, use _)")
    p_provision.add_argument("--type", choices=["blog", "store", "saas", "custom"], default="blog", help="Tipo de projeto")
    p_provision.add_argument("--domain", default=None, help="Domínio oficial")
    p_provision.add_argument("--lang", default="pt", choices=["pt", "en", "es"], help="Idioma")

    # Subcomando: doc
    p_doc = subparsers.add_parser("doc", help="Obter documento de handoff")
    p_doc.add_argument("--slug", required=True, help="Slug do projeto")
    p_doc.add_argument("--type", choices=["dev", "bigwriter", "adsense"], default="dev", help="Tipo de documento")

    # Subcomando: sql
    p_sql = subparsers.add_parser("sql", help="Executar SQL no schema do projeto")
    p_sql.add_argument("--slug", required=True, help="Slug do projeto")
    p_sql.add_argument("--query", required=True, help="Query SQL para executar")

    # Subcomando: delete
    p_del = subparsers.add_parser("delete", help="Excluir banco e projeto")
    p_del.add_argument("--slug", required=True, help="Slug do projeto")
    p_del.add_argument("--confirm", action="store_true", help="Confirmação explícita de exclusão")

    args = parser.parse_args()

    if args.command == "list":
        list_projects()
    elif args.command == "provision":
        provision_project(args.name, args.slug, args.type, args.domain, args.lang)
    elif args.command == "doc":
        get_doc(args.slug, args.type)
    elif args.command == "sql":
        execute_sql(args.slug, args.query)
    elif args.command == "delete":
        delete_project(args.slug, args.confirm)

if __name__ == "__main__":
    main()
