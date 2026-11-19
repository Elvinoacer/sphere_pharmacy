#!/usr/bin/env python3
"""
Sphere Pharmacy - Single-File Codebase Consolidator
Generates SPHERE_PHARMACY_FULL_CODEBASE.md containing:
1. Architectural Overview & Summary Statistics
2. Complete ASCII / Unicode Directory Tree
3. Categorized Table of Contents with Anchor Links
4. Verbatim Source Code for Every Source File (indexed against relative paths)
5. Appendix of Binary Assets, Media, and Dependency Lockfiles

Usage:
  python3 scripts/generate_codebase_file.py            # Export / update snapshot
  python3 scripts/generate_codebase_file.py --update   # Explicit alias to update snapshot
  python3 scripts/generate_codebase_file.py --check    # Verify snapshot is up to date (exit 0/1)
"""

import argparse
import os
import re
import subprocess
import sys
from datetime import datetime

ROOT_DIR = os.path.abspath(os.path.dirname(os.path.dirname(__file__)))
OUTPUT_FILENAME = "SPHERE_PHARMACY_FULL_CODEBASE.md"
COPY_FILENAME = "FULL_CODEBASE.md"
OUTPUT_FILE = os.path.join(ROOT_DIR, OUTPUT_FILENAME)

SELF_OUTPUT_FILES = {OUTPUT_FILENAME, COPY_FILENAME}
EXCLUDED_DIR_PARTS = {
    ".git",
    ".next",
    "node_modules",
    ".qodo",
    ".vercel",
    ".claude",
    "coverage",
}
EXCLUDED_ARTIFACT_SUFFIXES = (".log", ".tsbuildinfo", ".pem", ".key")
BINARY_EXTENSIONS = {
    ".webp",
    ".png",
    ".jpg",
    ".jpeg",
    ".pdf",
    ".ico",
    ".woff",
    ".woff2",
    ".ttf",
    ".eot",
}
LOCKFILE_NAMES = {"package-lock.json", "bun.lock"}
BINARY_SPECIAL_PATHS = {".zscripts/dev.pid", "mini-services/.gitkeep"}

LANG_MAP = {
    ".ts": ("TypeScript", "typescript"),
    ".tsx": ("TypeScript React", "tsx"),
    ".js": ("JavaScript", "javascript"),
    ".mjs": ("JavaScript (ESM)", "javascript"),
    ".cjs": ("JavaScript (CommonJS)", "javascript"),
    ".py": ("Python", "python"),
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

CATEGORY_ORDER = [
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
    "Documentation & Blueprints",
]


def is_excluded_path(rel_path: str) -> bool:
    """Prevent self-recursion, secret leakage (.env), build artifacts, and scratch dirs."""
    norm = rel_path.replace("\\", "/").lstrip("./")
    if not norm:
        return True
    base = os.path.basename(norm)
    if norm in SELF_OUTPUT_FILES or base in SELF_OUTPUT_FILES:
        return True
    if base == ".env" or (base.startswith(".env.") and base != ".env.example"):
        return True
    if any(part in EXCLUDED_DIR_PARTS for part in norm.split("/")):
        return True
    if norm.endswith(EXCLUDED_ARTIFACT_SUFFIXES):
        return True
    return False


def get_tracked_and_workspace_files() -> list[str]:
    """List git-tracked files plus non-ignored untracked workspace files."""
    output = subprocess.check_output(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard"],
        cwd=ROOT_DIR,
    ).decode("utf-8")
    return sorted(f for f in output.splitlines() if f and not is_excluded_path(f))


def count_migrations() -> int:
    migrations_dir = os.path.join(ROOT_DIR, "prisma", "migrations")
    if not os.path.isdir(migrations_dir):
        return 0
    return sum(
        1
        for entry in os.listdir(migrations_dir)
        if os.path.isdir(os.path.join(migrations_dir, entry))
    )


def sanitize_anchor(path: str) -> str:
    clean = re.sub(r"[^a-zA-Z0-9_\-]", "-", path).lower()
    return f"file-{clean}"


def format_size(bytes_num: int) -> str:
    if bytes_num < 1024:
        return f"{bytes_num} B"
    if bytes_num < 1024 * 1024:
        return f"{bytes_num / 1024:.1f} KB"
    return f"{bytes_num / (1024 * 1024):.2f} MB"


def safe_fence(content: str) -> str:
    """Return a backtick fence strictly longer than any backtick run in content."""
    runs = re.findall(r"`+", content)
    max_run = max((len(r) for r in runs), default=0)
    return "`" * max(5, max_run + 1)


def build_tree(paths: list[str]) -> dict:
    tree: dict = {}
    for p in paths:
        curr = tree
        for part in p.split("/"):
            curr = curr.setdefault(part, {})
    return tree


def render_tree(node: dict, prefix: str = "") -> list[str]:
    lines = []
    items = sorted(node.keys())
    for i, item in enumerate(items):
        is_last = i == len(items) - 1
        connector = "└── " if is_last else "├── "
        lines.append(f"{prefix}{connector}{item}")
        child_prefix = prefix + ("    " if is_last else "│   ")
        if node[item]:
            lines.extend(render_tree(node[item], child_prefix))
    return lines


def categorize_file(rel_path: str) -> str:
    if rel_path.startswith("src/app/api/"):
        return "Backend API Routes (Next.js App Router)"
    if rel_path.startswith("src/app/"):
        return "Frontend Pages & Global Styles (Next.js App Router)"
    if rel_path.startswith("src/components/views/admin/"):
        return "Admin Workspace & Staff Control Room"
    if rel_path.startswith("src/components/views/"):
        return "Storefront Views & Customer Flows"
    if rel_path.startswith("src/components/ui/"):
        return "UI Primitives (shadcn/ui & Radix UI)"
    if rel_path.startswith("src/components/"):
        return "Shared Layout & Domain Components"
    if rel_path.startswith("src/lib/mpesa") or rel_path.startswith("src/lib/intasend"):
        return "Payment Gateways (M-Pesa Daraja & IntaSend)"
    if rel_path.startswith("src/lib/security"):
        return "Security, Rate Limiting & Validation Guards"
    if (
        rel_path.startswith("src/lib/crm")
        or rel_path.startswith("src/lib/bandago")
        or rel_path.startswith("src/lib/pos-reconciliation")
    ):
        return "Bandago POS & CRM Integration"
    if (
        rel_path.startswith("src/lib/notifications")
        or rel_path.startswith("src/lib/email")
        or rel_path.startswith("src/lib/firebase")
        or rel_path.startswith("src/lib/sms")
    ):
        return "Notifications, Push Messaging & Communications"
    if rel_path.startswith("src/lib/assistant"):
        return "AI Medication Assistant"
    if rel_path.startswith("src/lib/"):
        return "Core Business Logic & Database Clients"
    if rel_path.startswith("src/store/"):
        return "Client State Stores (Zustand)"
    if rel_path.startswith("src/hooks/"):
        return "Custom React Hooks"
    if rel_path.startswith("prisma/"):
        return "Database Schema, Migrations & Seeds (Prisma ORM)"
    if rel_path.startswith("tests/"):
        return "Automated Test Suites & Verification"
    if rel_path.startswith(".zscripts/") or rel_path.startswith("scripts/"):
        return "Dev, Build & Service Scripts"
    if (
        rel_path.startswith("docs/")
        or rel_path.startswith("openapi/")
        or rel_path.startswith("reference/")
        or rel_path.endswith(".md")
    ):
        return "Documentation & Blueprints"
    if rel_path.startswith(".github/"):
        return "CI/CD Workflows"
    if rel_path.startswith("public/"):
        return "Public Web Assets & Service Workers"
    return "Project Configuration & Root Tooling"


def build_markdown() -> tuple[str, dict]:
    """Collect project files and render the full consolidated Markdown snapshot."""
    workspace_files = get_tracked_and_workspace_files()

    extra_files = [
        "scripts/generate_codebase_file.py",
        "next-env.d.ts",
        "gitignoresfiles/SPHERE_PHARMACY_OWNER_OPERATIONS_MANUAL.md",
    ]
    all_files_for_tree = sorted(
        {
            f
            for f in workspace_files
            + [ef for ef in extra_files if os.path.exists(os.path.join(ROOT_DIR, ef))]
            if not is_excluded_path(f)
        }
    )

    code_files_to_dump = []
    binary_files = []
    lock_files = []

    for f in all_files_for_tree:
        if is_excluded_path(f):
            continue
        full_path = os.path.join(ROOT_DIR, f)
        if not os.path.isfile(full_path):
            continue
        ext = os.path.splitext(f)[1]
        base = os.path.basename(f)

        if f in LOCKFILE_NAMES:
            lock_files.append((f, os.path.getsize(full_path)))
            continue

        if ext in BINARY_EXTENSIONS or f in BINARY_SPECIAL_PATHS:
            binary_files.append((f, os.path.getsize(full_path)))
            continue

        lang_name, fence_lang = LANG_MAP.get(
            base, LANG_MAP.get(ext, ("Plain Text", "text"))
        )

        with open(full_path, "r", encoding="utf-8", errors="replace") as fh:
            lines = fh.readlines()
            line_count = len(lines)
            content = "".join(lines)

        size = os.path.getsize(full_path)
        category = categorize_file(f)
        code_files_to_dump.append(
            {
                "path": f,
                "category": category,
                "lang_name": lang_name,
                "fence_lang": fence_lang,
                "line_count": line_count,
                "size": size,
                "content": content,
            }
        )

    code_files_to_dump.sort(key=lambda x: x["path"])

    total_code_files = len(code_files_to_dump)
    total_code_lines = sum(cf["line_count"] for cf in code_files_to_dump)
    total_code_size = sum(cf["size"] for cf in code_files_to_dump)
    migration_count = count_migrations()

    categories: dict[str, list] = {}
    for cf in code_files_to_dump:
        categories.setdefault(cf["category"], []).append(cf)

    chunks = []
    chunks.append("# Sphere Pharmacy — Complete Platform Codebase & Architecture\n\n")
    chunks.append("> **Comprehensive Single-File Source Code Repository**  \n")
    chunks.append(
        "> **Platform:** Sphere Pharmacy (Lumumba Drive, Roysambu, Nairobi, Kenya)  \n"
    )
    chunks.append(f"> **Generated:** {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}  \n")
    chunks.append(f"> **Total Source Code Files:** {total_code_files} files  \n")
    chunks.append(f"> **Total Lines of Source Code:** {total_code_lines:,} lines  \n")
    chunks.append(f"> **Total Uncompressed Size:** {format_size(total_code_size)}  \n\n")
    chunks.append("---\n\n")

    # Section 1: Executive Summary & Stack
    chunks.append("## 1. Executive Summary & Technology Stack\n\n")
    chunks.append(
        "This single file encapsulates the complete source code, architectural structure, and integration logic for **Sphere Pharmacy**, a high-compliance retail pharmacy web platform.\n\n"
    )
    chunks.append("### Tech Stack Highlights\n")
    chunks.append("- **Framework:** Next.js 16 (App Router) + React 19\n")
    chunks.append("- **Language:** TypeScript 5 (Strict Mode)\n")
    chunks.append(
        "- **Styling & UI:** Tailwind CSS 4 + shadcn/ui (New York style), Lucide React, Radix UI\n"
    )
    chunks.append(
        f"- **Database & ORM:** PostgreSQL + Prisma ORM (with {migration_count} incremental database migrations and full seed dataset)\n"
    )
    chunks.append(
        "- **State Management:** Zustand (reactive view router + localStorage persistent cart)\n"
    )
    chunks.append(
        "- **Payment Integrations:** Safaricom M-Pesa Daraja (STK Push with PIN simulator), IntaSend Card Processing\n"
    )
    chunks.append(
        "- **External Integrations:** Bi-directional BandaGo POS/CRM synchronization (FEFO, drift protection, daily sales export, and outbound writeback), Resend Email API, Firebase Cloud Messaging (Web Push), Cloudflare R2 Presigned Storage\n"
    )
    chunks.append(
        "- **Verification:** Automated unit, integration, assistant, and security tests covering checkout, RBAC, dispatch, POS sync, and promotions\n\n"
    )
    chunks.append("---\n\n")

    # Section 2: Full Project Directory Tree
    chunks.append("## 2. Complete Project Directory Tree\n\n")
    chunks.append("```text\n")
    tree_dict = build_tree(all_files_for_tree)
    tree_lines = render_tree(tree_dict)
    chunks.append(".\n")
    for tl in tree_lines:
        chunks.append(f"{tl}\n")
    chunks.append("```\n\n")
    chunks.append("---\n\n")

    # Section 3: Categorized Table of Contents
    chunks.append("## 3. Categorized Source Code Index\n\n")
    for cat in CATEGORY_ORDER:
        if cat not in categories:
            continue
        cat_files = categories[cat]
        chunks.append(f"### {cat} ({len(cat_files)} files)\n\n")
        chunks.append("| Relative Path | Language | Lines | Size |\n")
        chunks.append("| :--- | :--- | :---: | :---: |\n")
        for item in cat_files:
            anchor = sanitize_anchor(item["path"])
            chunks.append(
                f"| [{item['path']}](#{anchor}) | {item['lang_name']} | {item['line_count']:,} | {format_size(item['size'])} |\n"
            )
        chunks.append("\n")
    chunks.append("---\n\n")

    # Section 4: Master Alphabetical Index
    chunks.append("## 4. Master Alphabetical File Index\n\n")
    chunks.append("| # | Relative Path | Category | Lines | Size |\n")
    chunks.append("| :---: | :--- | :--- | :---: | :---: |\n")
    for idx, item in enumerate(code_files_to_dump, 1):
        anchor = sanitize_anchor(item["path"])
        chunks.append(
            f"| {idx} | [{item['path']}](#{anchor}) | {item['category']} | {item['line_count']:,} | {format_size(item['size'])} |\n"
        )
    chunks.append("\n---\n\n")

    # Section 5: Verbatim Source Code
    chunks.append("## 5. Source Code Implementations\n\n")
    chunks.append(
        "Each file below is presented in full with its complete relative path, metadata, and verbatim contents.\n\n"
    )

    for idx, item in enumerate(code_files_to_dump, 1):
        anchor = sanitize_anchor(item["path"])
        fence = safe_fence(item["content"])
        chunks.append("---\n\n")
        chunks.append(f"### File #{idx}: `{item['path']}`\n\n")
        chunks.append(f'<a id="{anchor}"></a>\n\n')
        chunks.append(f"- **Relative Path:** `{item['path']}`\n")
        chunks.append(f"- **Category:** {item['category']}\n")
        chunks.append(f"- **Language:** {item['lang_name']}\n")
        chunks.append(f"- **Lines:** {item['line_count']:,}\n")
        chunks.append(
            f"- **Size:** {format_size(item['size'])} ({item['size']:,} bytes)\n\n"
        )
        chunks.append(f"{fence}{item['fence_lang']}\n")
        chunks.append(item["content"])
        if not item["content"].endswith("\n"):
            chunks.append("\n")
        chunks.append(f"{fence}\n\n")
        chunks.append(
            "[↑ Back to Master Index](#4-master-alphabetical-file-index) | [↑ Back to Categorized Index](#3-categorized-source-code-index)\n\n"
        )

    # Section 6: Appendix of Binary Assets
    chunks.append("---\n\n")
    chunks.append("## 6. Appendix: Binary Assets & Static Media\n\n")
    chunks.append(
        "The following non-text static assets, images, and documents are tracked in the repository:\n\n"
    )
    chunks.append("| Relative Path | Type / Description | Size |\n")
    chunks.append("| :--- | :--- | :---: |\n")
    for bf, sz in binary_files:
        desc = (
            "Static Image Asset"
            if bf.endswith((".webp", ".png", ".jpg"))
            else "Document / Manual (PDF)"
            if bf.endswith(".pdf")
            else "Repository Asset"
        )
        chunks.append(f"| `{bf}` | {desc} | {format_size(sz)} |\n")
    chunks.append("\n")

    # Section 7: Appendix of Dependency Lockfiles
    chunks.append("---\n\n")
    chunks.append("## 7. Appendix: Dependency Lockfiles\n\n")
    chunks.append(
        "Dependency lockfiles specify deterministic pinned package versions:\n\n"
    )
    chunks.append("| File | Role | Size |\n")
    chunks.append("| :--- | :--- | :---: |\n")
    for lf, sz in lock_files:
        chunks.append(
            f"| `{lf}` | Package Resolution Lockfile | {format_size(sz)} ({sz:,} bytes) |\n"
        )
    chunks.append(
        "\n> Note: Lockfile contents are omitted from text code dumps due to volume (~14,000 JSON lines). Direct package specifications are fully documented in `package.json`.\n\n"
    )

    stats = {
        "files": total_code_files,
        "lines": total_code_lines,
        "size": total_code_size,
        "migrations": migration_count,
    }
    return "".join(chunks), stats


def strip_generated_timestamp(markdown_text: str) -> str:
    return re.sub(
        r"^> \*\*Generated:\*\* .*$",
        "> **Generated:** <TIMESTAMP>",
        markdown_text,
        flags=re.MULTILINE,
    )


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Export or validate Sphere Pharmacy single-file codebase snapshot."
    )
    parser.add_argument(
        "--update",
        action="store_true",
        help="Regenerate SPHERE_PHARMACY_FULL_CODEBASE.md (default behavior).",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Verify SPHERE_PHARMACY_FULL_CODEBASE.md is up to date without modifying files.",
    )
    args = parser.parse_args()

    rendered, stats = build_markdown()

    if args.check:
        if not os.path.isfile(OUTPUT_FILE):
            print(
                f"Codebase snapshot missing ({OUTPUT_FILENAME}). Run `npm run update:codebase`."
            )
            return 1

        with open(OUTPUT_FILE, "r", encoding="utf-8") as fh:
            existing_primary = fh.read()

        if strip_generated_timestamp(existing_primary) != strip_generated_timestamp(rendered):
            print(
                f"{OUTPUT_FILENAME} is out of date (expected {stats['files']} files, {stats['lines']:,} lines). Run `npm run update:codebase`."
            )
            return 1

        print(
            f"Codebase snapshot is in sync ({stats['files']} files, {stats['lines']:,} lines, {format_size(os.path.getsize(OUTPUT_FILE))})."
        )
        return 0

    print(
        f"Aggregating {stats['files']} files, {stats['lines']:,} lines, {format_size(stats['size'])}..."
    )
    with open(OUTPUT_FILE, "w", encoding="utf-8") as out:
        out.write(rendered)

    final_size = os.path.getsize(OUTPUT_FILE)
    print(f"Successfully generated {OUTPUT_FILE}")
    print(f"Total file size: {format_size(final_size)} ({final_size:,} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
