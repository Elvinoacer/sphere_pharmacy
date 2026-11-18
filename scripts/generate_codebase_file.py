#!/usr/bin/env python3
"""
Sphere Pharmacy - Single-File Codebase Consolidator
Generates SPHERE_PHARMACY_FULL_CODEBASE.md containing:
1. Architectural Overview & Summary Statistics
2. Complete ASCII / Unicode Directory Tree
3. Categorized Table of Contents with Anchor Links
4. Verbatim Source Code for Every Source File (indexed against relative paths)
5. Appendix of Binary Assets, Media, and Dependency Lockfiles
"""

import os
import re
import subprocess
from datetime import datetime

ROOT_DIR = os.path.abspath(os.path.dirname(os.path.dirname(__file__)))
OUTPUT_FILE = os.path.join(ROOT_DIR, "SPHERE_PHARMACY_FULL_CODEBASE.md")
SYMLINK_FILE = os.path.join(ROOT_DIR, "FULL_CODEBASE.md")

BINARY_EXTENSIONS = {".webp", ".png", ".jpg", ".jpeg", ".pdf", ".ico", ".woff", ".woff2", ".ttf", ".eot"}
SKIP_TRACKED_FILES = {"package-lock.json", "bun.lock", "--full-page", ".zscripts/dev.pid", "mini-services/.gitkeep"}

LANG_MAP = {
    ".ts": ("TypeScript", "typescript"),
    ".tsx": ("TypeScript React", "tsx"),
    ".js": ("JavaScript", "javascript"),
    ".mjs": ("JavaScript (ESM)", "javascript"),
    ".css": ("CSS", "css"),
    ".json": ("JSON", "json"),
    ".sql": ("SQL Migration", "sql"),
    ".sh": ("Shell Script", "bash"),
    ".prisma": ("Prisma Schema", "prisma"),
    ".toml": ("TOML Config", "toml"),
    ".yml": ("YAML", "yaml"),
    ".yaml": ("YAML", "yaml"),
    ".md": ("Markdown Documentation", "markdown"),
    ".svg": ("SVG XML", "xml"),
    ".example": ("Environment Config Template", "bash"),
    ".txt": ("Plain Text", "text"),
    ".gitignore": ("Git Ignore Rules", "gitignore"),
    "Caddyfile": ("Caddy Web Server Config", "caddy"),
    "next-env.d.ts": ("Next.js Type Declarations", "typescript"),
}

def get_tracked_files():
    output = subprocess.check_output(["git", "ls-files"], cwd=ROOT_DIR).decode("utf-8")
    files = output.splitlines()
    return sorted(files)

def sanitize_anchor(path):
    # Anchor id for markdown link
    clean = re.sub(r'[^a-zA-Z0-9_\-]', '-', path).lower()
    return f"file-{clean}"

def format_size(bytes_num):
    if bytes_num < 1024:
        return f"{bytes_num} B"
    elif bytes_num < 1024 * 1024:
        return f"{bytes_num / 1024:.1f} KB"
    else:
        return f"{bytes_num / (1024 * 1024):.2f} MB"

def build_tree(paths):
    tree = {}
    for p in paths:
        parts = p.split("/")
        curr = tree
        for part in parts:
            curr = curr.setdefault(part, {})
    return tree

def render_tree(node, prefix=""):
    lines = []
    items = sorted(node.keys())
    for i, item in enumerate(items):
        is_last = (i == len(items) - 1)
        connector = "└── " if is_last else "├── "
        lines.append(f"{prefix}{connector}{item}")
        child_prefix = prefix + ("    " if is_last else "│   ")
        if node[item]:
            lines.extend(render_tree(node[item], child_prefix))
    return lines

def categorize_file(rel_path):
    if rel_path.startswith("src/app/api/"):
        return "Backend API Routes (Next.js App Router)"
    elif rel_path.startswith("src/app/"):
        return "Frontend Pages & Global Styles (Next.js App Router)"
    elif rel_path.startswith("src/components/views/admin/"):
        return "Admin Workspace & Staff Control Room"
    elif rel_path.startswith("src/components/views/"):
        return "Storefront Views & Customer Flows"
    elif rel_path.startswith("src/components/ui/"):
        return "UI Primitives (shadcn/ui & Radix UI)"
    elif rel_path.startswith("src/components/"):
        return "Shared Layout & Domain Components"
    elif rel_path.startswith("src/lib/mpesa") or rel_path.startswith("src/lib/intasend"):
        return "Payment Gateways (M-Pesa Daraja & IntaSend)"
    elif rel_path.startswith("src/lib/security"):
        return "Security, Rate Limiting & Validation Guards"
    elif rel_path.startswith("src/lib/crm") or rel_path.startswith("src/lib/bandago"):
        return "Bandago POS & CRM Integration"
    elif rel_path.startswith("src/lib/notifications") or rel_path.startswith("src/lib/email") or rel_path.startswith("src/lib/firebase") or rel_path.startswith("src/lib/sms"):
        return "Notifications, Push Messaging & Communications"
    elif rel_path.startswith("src/lib/assistant"):
        return "AI Medication Assistant"
    elif rel_path.startswith("src/lib/"):
        return "Core Business Logic & Database Clients"
    elif rel_path.startswith("src/store/"):
        return "Client State Stores (Zustand)"
    elif rel_path.startswith("src/hooks/"):
        return "Custom React Hooks"
    elif rel_path.startswith("prisma/"):
        return "Database Schema, Migrations & Seeds (Prisma ORM)"
    elif rel_path.startswith("tests/"):
        return "Automated Test Suites & Verification"
    elif rel_path.startswith(".zscripts/") or rel_path.startswith("scripts/"):
        return "Dev, Build & Service Scripts"
    elif rel_path.startswith("docs/") or rel_path.endswith(".md"):
        return "Documentation & Blueprints"
    elif rel_path.startswith(".github/"):
        return "CI/CD Workflows"
    elif rel_path.startswith("public/"):
        return "Public Web Assets & Service Workers"
    else:
        return "Project Configuration & Root Tooling"

def main():
    tracked_files = get_tracked_files()
    
    # Extra untracked code files of interest
    extra_files = [
        "scripts/generate_codebase_file.py",
        "next-env.d.ts",
        "gitignoresfiles/SPHERE_PHARMACY_OWNER_OPERATIONS_MANUAL.md"
    ]
    all_files_for_tree = sorted(set(tracked_files + [f for f in extra_files if os.path.exists(os.path.join(ROOT_DIR, f))]))
    
    code_files_to_dump = []
    binary_files = []
    lock_files = []
    
    for f in all_files_for_tree:
        full_path = os.path.join(ROOT_DIR, f)
        if not os.path.isfile(full_path):
            continue
        ext = os.path.splitext(f)[1]
        base = os.path.basename(f)
        
        if f in {"package-lock.json", "bun.lock"}:
            lock_files.append((f, os.path.getsize(full_path)))
            continue
            
        if ext in BINARY_EXTENSIONS or f in {"--full-page", ".zscripts/dev.pid", "mini-services/.gitkeep"}:
            binary_files.append((f, os.path.getsize(full_path)))
            continue
            
        # Determine language
        lang_name, fence_lang = LANG_MAP.get(base, LANG_MAP.get(ext, ("Plain Text", "text")))
        
        with open(full_path, "r", encoding="utf-8", errors="replace") as fh:
            lines = fh.readlines()
            line_count = len(lines)
            content = "".join(lines)
            
        size = os.path.getsize(full_path)
        category = categorize_file(f)
        code_files_to_dump.append({
            "path": f,
            "category": category,
            "lang_name": lang_name,
            "fence_lang": fence_lang,
            "line_count": line_count,
            "size": size,
            "content": content
        })

    # Sort code files by path
    code_files_to_dump.sort(key=lambda x: x["path"])
    
    total_code_files = len(code_files_to_dump)
    total_code_lines = sum(cf["line_count"] for cf in code_files_to_dump)
    total_code_size = sum(cf["size"] for cf in code_files_to_dump)
    
    print(f"Aggregating {total_code_files} files, {total_code_lines:,} lines, {format_size(total_code_size)}...")

    # Group by category for ToC
    categories = {}
    for cf in code_files_to_dump:
        categories.setdefault(cf["category"], []).append(cf)
        
    category_order = [
        "Project Configuration & Root Tooling",
        "CI/CD Workflows",
        "Database Schema, Migrations & Seeds (Prisma ORM)",
        "Frontend Pages & Global Styles (Next.js App Router)",
        "Backend API Routes (Next.js App Router)",
        "Storefront Views & Customer Flows",
        "Admin Workspace & Staff Control Room",
        "Shared Layout & Domain Components",
        "UI Primitives (shadcn/ui & Radix UI)",
        "Core Business Logic & Database Clients",
        "Payment Gateways (M-Pesa Daraja & IntaSend)",
        "Security, Rate Limiting & Validation Guards",
        "Bandago POS & CRM Integration",
        "Notifications, Push Messaging & Communications",
        "AI Medication Assistant",
        "Client State Stores (Zustand)",
        "Custom React Hooks",
        "Automated Test Suites & Verification",
        "Dev, Build & Service Scripts",
        "Public Web Assets & Service Workers",
        "Documentation & Blueprints"
    ]

    with open(OUTPUT_FILE, "w", encoding="utf-8") as out:
        out.write("# Sphere Pharmacy — Complete Platform Codebase & Architecture\n\n")
        out.write("> **Comprehensive Single-File Source Code Repository**  \n")
        out.write("> **Platform:** Sphere Pharmacy (Lumumba Drive, Roysambu, Nairobi, Kenya)  \n")
        out.write(f"> **Generated:** {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}  \n")
        out.write(f"> **Total Source Code Files:** {total_code_files} files  \n")
        out.write(f"> **Total Lines of Source Code:** {total_code_lines:,} lines  \n")
        out.write(f"> **Total Uncompressed Size:** {format_size(total_code_size)}  \n\n")
        out.write("---\n\n")
        
        # Section 1: Executive Summary & Stack
        out.write("## 1. Executive Summary & Technology Stack\n\n")
        out.write("This single file encapsulates the complete source code, architectural structure, and integration logic for **Sphere Pharmacy**, a high-compliance retail pharmacy web platform.\n\n")
        out.write("### Tech Stack Highlights\n")
        out.write("- **Framework:** Next.js 16 (App Router) + React 19\n")
        out.write("- **Language:** TypeScript 5 (Strict Mode)\n")
        out.write("- **Styling & UI:** Tailwind CSS 4 + shadcn/ui (New York style), Lucide React, Radix UI\n")
        out.write("- **Database & ORM:** PostgreSQL + Prisma ORM (with 10 incremental database migrations and full seed dataset)\n")
        out.write("- **State Management:** Zustand (reactive view router + localStorage persistent cart)\n")
        out.write("- **Payment Integrations:** Safaricom M-Pesa Daraja (STK Push with PIN simulator), IntaSend Card Processing\n")
        out.write("- **External Integrations:** Bandago POS/CRM synchronization, Resend Email API, Firebase Cloud Messaging (Web Push), Cloudflare R2 Presigned Storage\n")
        out.write("- **Verification:** Automated unit, integration, and security tests covering checkout, RBAC, dispatch, and promotions\n\n")
        out.write("---\n\n")
        
        # Section 2: Full Project Directory Tree
        out.write("## 2. Complete Project Directory Tree\n\n")
        out.write("```text\n")
        tree_dict = build_tree(all_files_for_tree)
        tree_lines = render_tree(tree_dict)
        out.write(".\n")
        for tl in tree_lines:
            out.write(f"{tl}\n")
        out.write("```\n\n")
        out.write("---\n\n")

        # Section 3: Categorized Table of Contents
        out.write("## 3. Categorized Source Code Index\n\n")
        for cat in category_order:
            if cat not in categories:
                continue
            cat_files = categories[cat]
            out.write(f"### {cat} ({len(cat_files)} files)\n\n")
            out.write("| Relative Path | Language | Lines | Size |\n")
            out.write("| :--- | :--- | :---: | :---: |\n")
            for item in cat_files:
                anchor = sanitize_anchor(item["path"])
                out.write(f"| [{item['path']}](#{anchor}) | {item['lang_name']} | {item['line_count']:,} | {format_size(item['size'])} |\n")
            out.write("\n")
        out.write("---\n\n")

        # Section 4: Master Alphabetical Index
        out.write("## 4. Master Alphabetical File Index\n\n")
        out.write("| # | Relative Path | Category | Lines | Size |\n")
        out.write("| :---: | :--- | :--- | :---: | :---: |\n")
        for idx, item in enumerate(code_files_to_dump, 1):
            anchor = sanitize_anchor(item["path"])
            out.write(f"| {idx} | [{item['path']}](#{anchor}) | {item['category']} | {item['line_count']:,} | {format_size(item['size'])} |\n")
        out.write("\n---\n\n")

        # Section 5: Verbatim Source Code
        out.write("## 5. Source Code Implementations\n\n")
        out.write("Each file below is presented in full with its complete relative path, metadata, and verbatim contents.\n\n")
        
        for idx, item in enumerate(code_files_to_dump, 1):
            anchor = sanitize_anchor(item["path"])
            out.write(f"---\n\n")
            out.write(f"### File #{idx}: `{item['path']}`\n\n")
            out.write(f"<a id=\"{anchor}\"></a>\n\n")
            out.write(f"- **Relative Path:** `{item['path']}`\n")
            out.write(f"- **Category:** {item['category']}\n")
            out.write(f"- **Language:** {item['lang_name']}\n")
            out.write(f"- **Lines:** {item['line_count']:,}\n")
            out.write(f"- **Size:** {format_size(item['size'])} ({item['size']:,} bytes)\n\n")
            out.write(f"`````{item['fence_lang']}\n")
            out.write(item["content"])
            if not item["content"].endswith("\n"):
                out.write("\n")
            out.write("`````\n\n")
            out.write(f"[↑ Back to Master Index](#4-master-alphabetical-file-index) | [↑ Back to Categorized Index](#3-categorized-source-code-index)\n\n")

        # Section 6: Appendix of Binary Assets
        out.write("---\n\n")
        out.write("## 6. Appendix: Binary Assets & Static Media\n\n")
        out.write("The following non-text static assets, images, and documents are tracked in the repository:\n\n")
        out.write("| Relative Path | Type / Description | Size |\n")
        out.write("| :--- | :--- | :---: |\n")
        for bf, sz in binary_files:
            desc = "Static Image Asset" if bf.endswith(('.webp', '.png', '.jpg')) else "Document / Manual (PDF)" if bf.endswith('.pdf') else "Repository Asset"
            out.write(f"| `{bf}` | {desc} | {format_size(sz)} |\n")
        out.write("\n")

        # Section 7: Appendix of Dependency Lockfiles
        out.write("---\n\n")
        out.write("## 7. Appendix: Dependency Lockfiles\n\n")
        out.write("Dependency lockfiles specify deterministic pinned package versions:\n\n")
        out.write("| File | Role | Size |\n")
        out.write("| :--- | :--- | :---: |\n")
        for lf, sz in lock_files:
            out.write(f"| `{lf}` | Package Resolution Lockfile | {format_size(sz)} ({sz:,} bytes) |\n")
        out.write("\n> Note: Lockfile contents are omitted from text code dumps due to volume (~14,000 JSON lines). Direct package specifications are fully documented in `package.json`.\n\n")

    # Create duplicate copy as FULL_CODEBASE.md for convenience
    try:
        import shutil
        if os.path.islink(SYMLINK_FILE):
            os.remove(SYMLINK_FILE)
        shutil.copyfile(OUTPUT_FILE, SYMLINK_FILE)
    except Exception as e:
        print(f"Copy to FULL_CODEBASE.md skipped: {e}")

    final_size = os.path.getsize(OUTPUT_FILE)
    print(f"Successfully generated {OUTPUT_FILE}")
    print(f"Total file size: {format_size(final_size)} ({final_size:,} bytes)")

if __name__ == "__main__":
    main()
