import argparse
import hashlib
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SKIP_DIRS = {"scripts", "dist", "node_modules"}
BUILT_IN = {"plain", "dark", "light", "iridium-dark", "iridium-light"}
ID_PATTERN = re.compile(r"^[a-z0-9-][a-z0-9._-]{0,63}$")

ALLOWED = {".json", ".js", ".png", ".jpg", ".jpeg", ".ttf", ".otf", ".ttc", ".glsl", ".txt", ".wav"}
TEXT = {".json", ".js", ".glsl", ".txt"}
MAX_FILES = 512
MAX_TOTAL = 64 << 20
MAX_TEXT = 1 << 20
MAX_SOUND = 1 << 20

ICON_SIZE = 64
PREVIEW_SIZE = (960, 600)
ZIP_TIME = (1980, 1, 1, 0, 0, 0)

warnings = []


def fail(message):
    print("error: " + message, file=sys.stderr)
    sys.exit(1)


def warn(message):
    warnings.append(message)
    print("warning: " + message, file=sys.stderr)


def strip_comments(text):
    out = []
    i = 0
    quoted = False
    while i < len(text):
        c = text[i]
        if quoted:
            out.append(c)
            if c == "\\" and i + 1 < len(text):
                out.append(text[i + 1])
                i += 2
                continue
            if c == '"':
                quoted = False
            i += 1
            continue
        if c == '"':
            quoted = True
            out.append(c)
            i += 1
        elif text.startswith("//", i):
            end = text.find("\n", i)
            i = len(text) if end < 0 else end
        elif text.startswith("/*", i):
            end = text.find("*/", i + 2)
            i = len(text) if end < 0 else end + 2
        else:
            out.append(c)
            i += 1
    return "".join(out)


def read_theme(path):
    try:
        doc = json.loads(strip_comments(path.read_text(encoding="utf-8-sig")))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        fail(f"{path.relative_to(ROOT).as_posix()} 不是有效的 JSON：{error}")
    if not isinstance(doc, dict):
        fail(f"{path.relative_to(ROOT).as_posix()} 顶层应该是对象")
    return doc


def text_field(doc, key, default=""):
    value = doc.get(key, default)
    return value if isinstance(value, str) else default


def tool(name):
    return shutil.which(name)


def optimize_png(path, lossy):
    if lossy and tool("pngquant"):
        subprocess.run(["pngquant", "--quality=70-92", "--speed", "1", "--strip", "--skip-if-larger", "--force",
                        "--output", str(path), str(path)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if tool("optipng"):
        args = ["optipng", "-quiet", "-o2"] + (["-strip", "all"] if lossy else []) + [str(path)]
        subprocess.run(args, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def optimize_jpeg(path, lossy):
    if tool("jpegoptim"):
        args = ["jpegoptim", "--quiet"] + (["--strip-all"] if lossy else []) + [str(path)]
        subprocess.run(args, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def catalog_preview(source, work):
    with Image.open(source) as image:
        image.load()
        image = image.convert("RGBA")
        if image.width > PREVIEW_SIZE[0] or image.height > PREVIEW_SIZE[1]:
            image.thumbnail(PREVIEW_SIZE, Image.LANCZOS)
        png = work / "preview.png"
        if image.getchannel("A").getextrema()[0] < 255:
            image.save(png, "PNG", optimize=True)
            optimize_png(png, True)
            return png.read_bytes(), png.suffix
        flat = image.convert("RGB")
        flat.save(png, "PNG", optimize=True)
        optimize_png(png, True)
        jpg = work / "preview.jpg"
        flat.save(jpg, "JPEG", quality=80, optimize=True, progressive=True, subsampling="4:2:0")
        optimize_jpeg(jpg, True)
        best = min((png, jpg), key=lambda path: path.stat().st_size)
        return best.read_bytes(), best.suffix


def catalog_icon(source, work):
    with Image.open(source) as image:
        image.load()
        image = image.convert("RGBA")
        scale = min(ICON_SIZE / image.width, ICON_SIZE / image.height)
        size = (max(1, round(image.width * scale)), max(1, round(image.height * scale)))
        image = image.resize(size, Image.LANCZOS)
        canvas = Image.new("RGBA", (ICON_SIZE, ICON_SIZE), (0, 0, 0, 0))
        canvas.paste(image, ((ICON_SIZE - size[0]) // 2, (ICON_SIZE - size[1]) // 2))
        target = work / "icon.png"
        canvas.save(target, "PNG", optimize=True)
        optimize_png(target, True)
    return target.read_bytes(), target.suffix


def git_updated(folder):
    try:
        result = subprocess.run(["git", "-C", str(ROOT), "log", "-1", "--format=%cI", "--", folder.name],
                                capture_output=True, text=True, check=True)
    except (OSError, subprocess.CalledProcessError):
        return None
    return result.stdout.strip() or None


def package_files(folder):
    files = []
    total = 0
    for path in sorted(folder.rglob("*"), key=lambda p: p.relative_to(folder).as_posix()):
        if not path.is_file():
            continue
        relative = path.relative_to(folder).as_posix()
        if relative == "icon.png" or relative.startswith("preview/"):
            continue
        if any(part.startswith(".") for part in relative.split("/")):
            continue
        extension = path.suffix.lower()
        if extension not in ALLOWED:
            warn(f"{folder.name}/{relative} 的扩展名不在启动器允许的范围内，已跳过")
            continue
        size = path.stat().st_size
        if extension in TEXT and size > MAX_TEXT:
            fail(f"{folder.name}/{relative} 超过 1 MB")
        if extension == ".wav" and size > MAX_SOUND:
            fail(f"{folder.name}/{relative} 超过 1 MB")
        total += size
        files.append((relative, path))
    if len(files) > MAX_FILES:
        fail(f"{folder.name} 的文件超过 {MAX_FILES} 个")
    if total > MAX_TOTAL:
        fail(f"{folder.name} 的文件合计超过 64 MB")
    return files


def build_package(theme_id, files, work):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for relative, path in files:
            data = path.read_bytes()
            extension = path.suffix.lower()
            if extension in (".png", ".jpg", ".jpeg"):
                copy = work / ("asset" + extension)
                copy.write_bytes(data)
                if extension == ".png":
                    optimize_png(copy, False)
                else:
                    optimize_jpeg(copy, False)
                data = copy.read_bytes()
            info = zipfile.ZipInfo(f"{theme_id}/{relative}", date_time=ZIP_TIME)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = 3
            info.external_attr = 0o644 << 16
            archive.writestr(info, data, compresslevel=9)
    return buffer.getvalue()


def publish(out, theme_id, data, suffix):
    digest = hashlib.sha256(data).hexdigest()
    relative = f"themes/{theme_id}/{digest[:16]}{suffix}"
    target = out / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
    return relative, digest


def build_theme(folder, out, catalog_ids):
    theme_id = folder.name
    doc = read_theme(folder / "theme.json")
    parent = text_field(doc, "extends")
    requires = []
    if parent and parent not in BUILT_IN:
        if parent not in catalog_ids:
            fail(f"{theme_id} 继承的主题 {parent} 不在目录里")
        requires.append(parent)
    with tempfile.TemporaryDirectory() as temp:
        work = Path(temp)
        package = build_package(theme_id, package_files(folder), work)
        package_url, package_hash = publish(out, theme_id, package, ".zip")
        icon = None
        if (folder / "icon.png").is_file():
            data, suffix = catalog_icon(folder / "icon.png", work)
            icon, _ = publish(out, theme_id, data, suffix)
        previews = []
        preview_dir = folder / "preview"
        if preview_dir.is_dir():
            for path in sorted(preview_dir.iterdir(), key=lambda p: p.name):
                if path.suffix.lower() not in (".png", ".jpg", ".jpeg"):
                    continue
                data, suffix = catalog_preview(path, work)
                url, _ = publish(out, theme_id, data, suffix)
                previews.append(url)
    entry = {
        "id": theme_id,
        "name": text_field(doc, "name", theme_id) or theme_id,
        "author": text_field(doc, "author"),
        "version": text_field(doc, "version"),
        "description": text_field(doc, "description"),
        "base": text_field(doc, "base", "dark") or "dark",
        "requires": requires,
        "updated": git_updated(folder),
        "package": {"url": package_url, "size": len(package), "sha256": package_hash},
        "icon": icon,
        "previews": previews,
    }
    if not entry["version"]:
        warn(f"{theme_id} 没有写 version")
    return entry


def find_themes():
    folders = []
    for folder in sorted(ROOT.iterdir(), key=lambda p: p.name):
        if not folder.is_dir() or folder.name.startswith(".") or folder.name in SKIP_DIRS:
            continue
        if not (folder / "theme.json").is_file():
            continue
        if not ID_PATTERN.match(folder.name):
            fail(f"文件夹名 {folder.name} 不能作为主题 id：只能用小写字母、数字、.、_、-，不能以 . 或 _ 开头")
        if folder.name in BUILT_IN:
            fail(f"{folder.name} 和内置主题重名")
        folders.append(folder)
    return folders


def load_previous(path):
    if path is None or not path.is_file():
        return []
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return []
    themes = doc.get("themes") if isinstance(doc, dict) else None
    return themes if isinstance(themes, list) else []


def report(previous, themes):
    before = {item.get("id"): item for item in previous if isinstance(item, dict)}
    after = {item["id"]: item for item in themes}
    lines = []
    for theme_id, item in after.items():
        if theme_id not in before:
            lines.append(f"- 新增 {item['name']}（{theme_id}）")
        elif json.dumps(before[theme_id], sort_keys=True) != json.dumps(item, sort_keys=True):
            lines.append(f"- 更新 {item['name']}（{theme_id}）")
    for theme_id in before:
        if theme_id not in after:
            lines.append(f"- 移除 {theme_id}")
    return lines


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="dist")
    parser.add_argument("--previous")
    args = parser.parse_args()
    out = Path(args.out)
    if not out.is_absolute():
        out = ROOT / out
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    missing = [name for name in ("pngquant", "optipng", "jpegoptim") if not tool(name)]
    if missing:
        warn("没有找到 " + "、".join(missing) + "，对应的图片压缩已跳过")
    folders = find_themes()
    ids = {folder.name for folder in folders}
    themes = [build_theme(folder, out, ids) for folder in folders]
    (out / "index.json").write_text(json.dumps({"schema": 1, "themes": themes}, ensure_ascii=False, indent=1),
                                    encoding="utf-8")
    changes = report(load_previous(Path(args.previous) if args.previous else None), themes)
    print(f"{len(themes)} 个主题")
    for line in changes or ["- 没有变化"]:
        print(line)
    output = os.environ.get("GITHUB_OUTPUT")
    if output:
        with open(output, "a", encoding="utf-8") as f:
            f.write(f"changed={'true' if changes else 'false'}\n")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as f:
            f.write("### 主题目录\n\n" + "\n".join(changes or ["没有变化，跳过部署"]) + "\n")
            if warnings:
                f.write("\n#### 警告\n\n" + "\n".join("- " + item for item in warnings) + "\n")


if __name__ == "__main__":
    main()
