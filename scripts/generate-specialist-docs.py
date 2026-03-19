#!/usr/bin/env python3
"""
Specialist Docs Generator - Auto-scan bundled specialist YAML and render docs.

Scans:
1. resources/specialists/**/*.yaml - bundled base specialist definitions
2. resources/specialists/locales/<locale>/**/*.yaml - locale overlays

Outputs:
1. docs/specialists/README.md - group overview page
2. docs/specialists/**/<specialist>.md - one page per specialist

Usage:
    python scripts/generate-specialist-docs.py
    python scripts/generate-specialist-docs.py --save
    python scripts/generate-specialist-docs.py --json
"""

import sys
import json
import argparse
from pathlib import Path
from collections import defaultdict

try:
    import yaml
    HAS_YAML = True
except ImportError:
    HAS_YAML = False

ROOT_DIR = Path(__file__).parent.parent
SPECIALISTS_DIR = ROOT_DIR / "resources" / "specialists"
OUTPUT_DIR = ROOT_DIR / "docs" / "specialists"

GROUP_DESCRIPTIONS = {
    "core": "系统基础角色，定义 Routa 多 agent 协作的底座角色模型。",
    "team": "面向团队协作的通用职能角色，回答“这类工作通常该派谁做”。",
    "review": "分析、审查、判断类 specialist，重点是把关而不是主导实现。",
    "issue": "问题整理与工单加工 specialist，把模糊反馈加工成可执行输入。",
    "tools": "绑定具体 provider、adapter、SDK 或执行环境的 specialist。",
    "workflows/kanban": "绑定 Kanban 流程阶段的 specialist，强调列职责与卡片流转。",
}


def parse_yaml_file(filepath):
    """Parse YAML file into dict."""
    content = filepath.read_text(encoding="utf-8")
    data = yaml.safe_load(content)
    return data if isinstance(data, dict) else {}


def relative_posix(path):
    return path.relative_to(ROOT_DIR).as_posix()


def path_to_group(path):
    rel = path.relative_to(SPECIALISTS_DIR)
    parts = rel.parts
    if parts[0] == "locales":
        return "/".join(parts[2:-1])
    return "/".join(parts[:-1])


def path_to_locale(path):
    rel = path.relative_to(SPECIALISTS_DIR)
    parts = rel.parts
    if len(parts) > 2 and parts[0] == "locales":
        return parts[1]
    return None


def normalize_field(data, snake, camel=None):
    if camel and camel in data and data[camel] is not None:
        return data[camel]
    return data.get(snake)


def extract_execution(data):
    execution = data.get("execution")
    if not isinstance(execution, dict):
        execution = {}
    model_tier = normalize_field(execution, "model_tier", "modelTier")
    return {
        "role": execution.get("role"),
        "provider": execution.get("provider"),
        "adapter": execution.get("adapter"),
        "model_tier": model_tier,
        "model": execution.get("model"),
    }


def scan_specialists():
    """Return grouped specialist definitions with locale overlays."""
    base_defs = {}
    locale_overlays = defaultdict(list)

    for yaml_path in sorted(SPECIALISTS_DIR.rglob("*.yaml")):
        rel = yaml_path.relative_to(SPECIALISTS_DIR)
        if rel.parts[0] == "locales":
            data = parse_yaml_file(yaml_path)
            locale = path_to_locale(yaml_path)
            specialist_id = data.get("id") or yaml_path.stem
            locale_overlays[specialist_id].append({
                "locale": locale,
                "path": relative_posix(yaml_path),
                "name": data.get("name"),
                "description": data.get("description"),
            })
            continue

        data = parse_yaml_file(yaml_path)
        specialist_id = data.get("id") or yaml_path.stem
        base_defs[specialist_id] = {
            "id": specialist_id,
            "name": data.get("name", ""),
            "description": data.get("description", ""),
            "role": data.get("role", ""),
            "model_tier": normalize_field(data, "model_tier", "modelTier") or "",
            "role_reminder": normalize_field(data, "role_reminder", "roleReminder") or "",
            "default_provider": normalize_field(data, "default_provider", "defaultProvider"),
            "default_adapter": normalize_field(data, "default_adapter", "defaultAdapter"),
            "model": data.get("model"),
            "execution": extract_execution(data),
            "system_prompt": data.get("system_prompt", "") or "",
            "group": path_to_group(yaml_path),
            "path": relative_posix(yaml_path),
        }

    grouped = defaultdict(list)
    for specialist in base_defs.values():
        specialist["locales"] = sorted(
            locale_overlays.get(specialist["id"], []),
            key=lambda item: ((item["locale"] or ""), item["path"]),
        )
        grouped[specialist["group"]].append(specialist)

    return {
        "groups": dict(sorted(
            ((group, sorted(items, key=lambda item: item["id"])) for group, items in grouped.items()),
            key=lambda item: item[0],
        )),
        "total_specialists": len(base_defs),
        "total_locales": len({overlay["locale"] for overlays in locale_overlays.values() for overlay in overlays if overlay["locale"]}),
    }


def first_prompt_paragraph(prompt):
    lines = [line.rstrip() for line in prompt.splitlines()]
    paragraphs = []
    current = []
    for line in lines:
        stripped = line.strip()
        if not stripped:
            if current:
                paragraphs.append(" ".join(current))
                current = []
            continue
        if stripped.startswith("## "):
            continue
        current.append(stripped)
    if current:
        paragraphs.append(" ".join(current))
    return paragraphs[0] if paragraphs else ""


def render_execution_summary(spec):
    execution = spec["execution"]
    parts = []
    if execution.get("role"):
        parts.append(f"role={execution['role']}")
    if execution.get("provider"):
        parts.append(f"provider={execution['provider']}")
    if execution.get("adapter"):
        parts.append(f"adapter={execution['adapter']}")
    if execution.get("model_tier"):
        parts.append(f"model_tier={execution['model_tier']}")
    if execution.get("model"):
        parts.append(f"model={execution['model']}")

    if not parts:
        return "-"
    return ", ".join(parts)


def doc_path_for_specialist(spec):
    return OUTPUT_DIR / spec["group"] / f"{spec['id']}.md"


def relative_doc_link(from_path, to_path):
    return to_path.relative_to(from_path.parent).as_posix() if to_path.is_relative_to(from_path.parent) else None


def prompt_excerpt(prompt, limit=600):
    excerpt = prompt.strip()
    if len(excerpt) <= limit:
        return excerpt
    return excerpt[:limit].rstrip() + "\n..."


def render_overview_markdown(catalog):
    lines = []
    lines.append("# Specialists")
    lines.append("")
    lines.append("本文由脚本自动生成，来源如下：")
    lines.append("- `resources/specialists/**/*.yaml`")
    lines.append("- `resources/specialists/locales/<locale>/**/*.yaml`")
    lines.append("")
    lines.append("用途：帮助用户按 group 理解内置 specialist，并跳转到每个 specialist 的独立说明页。")
    lines.append("")
    lines.append(f"- 基础 specialist 数量：`{catalog['total_specialists']}`")
    lines.append(f"- locale 覆盖语言数量：`{catalog['total_locales']}`")
    lines.append("")
    lines.append("## Group Index")
    lines.append("")

    for group, specialists in catalog["groups"].items():
        lines.append(f"- `{group}`: {len(specialists)} 个 specialist")

    lines.append("")

    for group, specialists in catalog["groups"].items():
        lines.append(f"## `{group}`")
        lines.append("")
        description = GROUP_DESCRIPTIONS.get(group, "该分组来自 specialist 目录结构。")
        lines.append(description)
        lines.append("")
        lines.append("| ID | Name | Role | Model Tier | Locales | Doc | Source |")
        lines.append("|---|---|---|---|---:|---|---|")
        for spec in specialists:
            doc_path = doc_path_for_specialist(spec)
            doc_link = doc_path.relative_to(OUTPUT_DIR).as_posix()
            lines.append(
                f"| `{spec['id']}` | {spec['name']} | `{spec['role'] or '-'}` | `{spec['model_tier'] or '-'}` | {len(spec['locales'])} | [{spec['name']}]({doc_link}) | `{spec['path']}` |"
            )
        lines.append("")

    return "\n".join(lines) + "\n"


def render_specialist_markdown(spec):
    lines = []
    lines.append(f"# {spec['name']}")
    lines.append("")
    if spec["description"]:
        lines.append(spec["description"])
        lines.append("")

    lines.append("## Summary")
    lines.append("")
    lines.append(f"- ID: `{spec['id']}`")
    lines.append(f"- Group: `{spec['group']}`")
    lines.append(f"- Role: `{spec['role'] or '-'}`")
    lines.append(f"- Model Tier: `{spec['model_tier'] or '-'}`")
    lines.append(f"- Source YAML: `{spec['path']}`")
    lines.append(f"- Default Provider: `{spec['default_provider'] or '-'}`")
    lines.append(f"- Default Adapter: `{spec['default_adapter'] or '-'}`")
    lines.append(f"- Model Override: `{spec['model'] or '-'}`")
    lines.append(f"- Execution Defaults: `{render_execution_summary(spec)}`")
    lines.append("")

    prompt_summary = first_prompt_paragraph(spec["system_prompt"])
    if prompt_summary:
        lines.append("## Prompt Summary")
        lines.append("")
        lines.append(f"> {prompt_summary}")
        lines.append("")

    if spec["role_reminder"]:
        lines.append("## Role Reminder")
        lines.append("")
        lines.append(f"> {spec['role_reminder']}")
        lines.append("")

    lines.append("## Prompt Excerpt")
    lines.append("")
    lines.append("```text")
    lines.append(prompt_excerpt(spec["system_prompt"]))
    lines.append("```")
    lines.append("")

    if spec["locales"]:
        lines.append("## Locale Overlays")
        lines.append("")
        lines.append("| Locale | Name | Description | File |")
        lines.append("|---|---|---|---|")
        for overlay in spec["locales"]:
            lines.append(
                f"| `{overlay['locale']}` | {overlay['name'] or '-'} | {overlay['description'] or '-'} | `{overlay['path']}` |"
            )
        lines.append("")

    return "\n".join(lines) + "\n"


def ensure_clean_markdown_tree(root_dir):
    if not root_dir.exists():
        return

    for markdown_file in root_dir.rglob("*.md"):
        markdown_file.unlink()

    for category_file in root_dir.rglob("_category_.json"):
        category_file.unlink()

    for path in sorted((p for p in root_dir.rglob("*") if p.is_dir()), reverse=True):
        try:
            path.rmdir()
        except OSError:
            pass


def write_category_file(directory, label, position=None):
    payload = {"label": label}
    if position is not None:
        payload["position"] = position
    content = json.dumps(payload, indent=2, ensure_ascii=False) + "\n"
    (directory / "_category_.json").write_text(content, encoding="utf-8")


def save_docs(catalog):
    ensure_clean_markdown_tree(OUTPUT_DIR)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    write_category_file(OUTPUT_DIR, "Specialists", 4)

    overview_path = OUTPUT_DIR / "README.md"
    overview_path.write_text(render_overview_markdown(catalog), encoding="utf-8")

    written_groups = set()
    for group, specialists in catalog["groups"].items():
        group_dir = OUTPUT_DIR / group
        group_dir.mkdir(parents=True, exist_ok=True)
        if group not in written_groups:
            write_category_hierarchy(group)
            written_groups.add(group)

        for spec in specialists:
            doc_path = doc_path_for_specialist(spec)
            doc_path.parent.mkdir(parents=True, exist_ok=True)
            doc_path.write_text(render_specialist_markdown(spec), encoding="utf-8")


def write_category_hierarchy(group):
    current = OUTPUT_DIR
    for index, part in enumerate(group.split("/"), start=1):
        current = current / part
        current.mkdir(parents=True, exist_ok=True)
        category_path = current / "_category_.json"
        if category_path.exists():
            continue
        label = part.replace("-", " ").title()
        write_category_file(current, label, index)


def main():
    parser = argparse.ArgumentParser(description="Generate specialist YAML docs")
    parser.add_argument("--json", action="store_true", help="Output catalog as JSON")
    parser.add_argument("--save", action="store_true", help="Save docs/specialists/**")
    args = parser.parse_args()

    if not HAS_YAML:
        print("⚠️  PyYAML not installed. Run: pip install pyyaml", file=sys.stderr)
        sys.exit(1)

    catalog = scan_specialists()

    if args.json:
        print(json.dumps(catalog, indent=2, ensure_ascii=False))
        return

    if args.save:
        save_docs(catalog)
        print(f"✅ Saved to {OUTPUT_DIR}")
        return

    print(render_overview_markdown(catalog))


if __name__ == "__main__":
    main()
