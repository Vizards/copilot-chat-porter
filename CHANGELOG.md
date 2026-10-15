# Changelog

## 0.1.2

- **Release maintenance**: Switch Marketplace publishing to Microsoft Entra workload identity federation, retain production approval, and publish the same verified VSIX attached to GitHub Releases. Extension functionality is unchanged.

## 0.1.1

- **Codespaces support**: Fix LM Tool calls hanging in GitHub Codespaces by setting `extensionKind` to `workspace`, ensuring the extension runs in the same host as Copilot Chat
- **Remote URI handling**: Fix `resolvePathToUri` to preserve `vscode-remote://` URI scheme instead of creating `file:///` URIs in remote environments
- **Robustness**: Add timeouts to export command (15s) and file verification (5s) to prevent indefinite hangs
- **Packaging**: Exclude `tmp/` and `docs/` from VSIX to reduce package size

## 0.1.0

- **URI Handler**: External scripts can trigger export/import via `code --open-url "vscode://Vizards.copilot-chat-porter/export?..."`, enabling integration with Copilot Hooks and shell scripts
- **Attachment saving**: Optionally copy externally-referenced files (outside workspace) into a local directory alongside the exported JSON, with automatic path rewriting for portability
- **Command Palette**: Export and import directly via `Cmd+Shift+P` without AI involvement
- **Callback support**: URI Handler export accepts an optional `callback` parameter (Named Pipe / file path) for synchronous result feedback
- **Absolute path support**: `outputPath` and `inputPath` now accept both absolute and relative paths
- **File deduplication**: Same-name attachments with identical content are skipped; different content gets a numeric suffix
- **Code restructure**: Split single-file extension into modular architecture (core, attachments, uriHandler, lmTools, commands, utils)

## 0.0.2

- Add CI/CD workflows (GitHub Actions)

## 0.0.1

- Initial release
- Export current Copilot Chat session to JSON via natural language
- Import and restore chat sessions from JSON files
- Support custom output paths
- Auto-generated timestamped filenames when no path specified
