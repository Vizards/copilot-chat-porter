"""Check the exact Porter release artifact before either upload destination."""

import hashlib
import json
import os
from pathlib import Path
import re
import sys
import xml.etree.ElementTree as ET
from zipfile import ZipFile


def verify(directory, version):
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise ValueError("Expected a stable release version")
    directory = Path(directory)
    packages = list(directory.glob("*.vsix"))
    expected_path = directory / f"copilot-chat-porter-{version}.vsix"
    if len(packages) != 1 or packages[0] != expected_path or expected_path.is_symlink():
        raise ValueError("Expected exactly one VSIX at the release's expected path")

    with ZipFile(expected_path) as archive:
        names = archive.namelist()
        if len(names) != len(set(name.lower() for name in names)):
            raise ValueError("VSIX contains duplicate or ambiguous entries")
        manifest = json.loads(archive.read("extension/package.json"))
        expected = {"publisher": "Vizards", "name": "copilot-chat-porter", "version": version}
        if any(manifest.get(key) != value for key, value in expected.items()):
            raise ValueError("VSIX package.json publisher/name/version does not match the release")
        identity = ET.fromstring(archive.read("extension.vsixmanifest")).find("{*}Metadata/{*}Identity")
        if identity is None or any(identity.get(key) != value for key, value in {
            "Publisher": "Vizards", "Id": "copilot-chat-porter", "Version": version,
        }.items()) or identity.get("TargetPlatform") not in (None, "universal"):
            raise ValueError("VSIX XML identity does not match the universal Porter release")
        if "extension/out/extension.js" not in names:
            raise ValueError("Compiled extension entry point is missing")

    digest = hashlib.sha256(expected_path.read_bytes()).hexdigest()
    return expected_path, digest


def main():
    path, digest = verify("dist", sys.argv[1])
    (path.parent / "SHA256SUMS").write_text(f"{digest}  {path.name}\n", encoding="utf-8")
    print(f"Verified VSIX: {path}; SHA-256: {digest}")
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
            output.write(f"vsix_path={path.as_posix()}\nsha256={digest}\n")
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as summary:
            summary.write(f"Verified VSIX: `{path}`\n\nSHA-256: `{digest}`\n\n")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        sys.exit(f"VSIX verification failed: {error}")
