import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from zipfile import ZipFile

spec = importlib.util.spec_from_file_location("verify_vsix", Path(__file__).with_name("verify-vsix.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class VerifyVSIXTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.path = self.directory / "copilot-chat-porter-0.1.2.vsix"

    def package(self, publisher="Vizards", version="0.1.2", xml_id="copilot-chat-porter", compiled=True):
        with ZipFile(self.path, "w") as archive:
            archive.writestr("extension/package.json", json.dumps({
                "publisher": publisher, "name": "copilot-chat-porter", "version": version,
            }))
            archive.writestr("extension.vsixmanifest", f'''<PackageManifest xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
              <Metadata><Identity Publisher="Vizards" Id="{xml_id}" Version="0.1.2"/></Metadata>
            </PackageManifest>''')
            if compiled:
                archive.writestr("extension/out/extension.js", "exports.activate = () => {};")

    def test_records_exact_archive_hash(self):
        self.package()
        path, digest = module.verify(self.directory, "0.1.2")
        self.assertEqual(path, self.path)
        self.assertEqual(digest, hashlib.sha256(self.path.read_bytes()).hexdigest())

    def test_rejects_wrong_identity_or_version(self):
        for changes in ({"publisher": "Other"}, {"version": "0.1.1"}, {"xml_id": "deepseek-v4-for-copilot"}):
            with self.subTest(changes=changes):
                self.package(**changes)
                with self.assertRaises(ValueError):
                    module.verify(self.directory, "0.1.2")

    def test_rejects_missing_compiled_entrypoint(self):
        self.package(compiled=False)
        with self.assertRaises(ValueError):
            module.verify(self.directory, "0.1.2")

    def test_rejects_multiple_artifacts(self):
        self.package()
        (self.directory / "unexpected.vsix").write_bytes(self.path.read_bytes())
        with self.assertRaises(ValueError):
            module.verify(self.directory, "0.1.2")

    def test_rejects_ambiguous_package_manifest(self):
        self.package()
        with ZipFile(self.path, "a") as archive:
            archive.writestr("extension/PACKAGE.JSON", "{}")
        with self.assertRaises(ValueError):
            module.verify(self.directory, "0.1.2")


if __name__ == "__main__":
    unittest.main()
