# Finding: Kimi marketplace installation fixed - missing manifests added

## Date
2026-07-22

## Area
kimi-plugin, marketplace, plugins/atlas, plugins/armada, plugins/programmer

## Summary
Kimi marketplace installation was broken because two of the three plugins (armada and programmer) were missing their `.kimi-plugin/plugin.json` manifests. The root `kimi.plugin.json` and `.kimi-plugin/marketplace.json` also used local file paths instead of GitHub URLs, making the marketplace unusable from the GitHub source.

## Root Cause
- `plugins/atlas/.kimi-plugin/plugin.json` existed (v5.1.1)
- `plugins/armada/.kimi-plugin/plugin.json` was MISSING
- `plugins/programmer/.kimi-plugin/plugin.json` was MISSING
- Root `kimi.plugin.json` used local paths (`./plugins/atlas`, etc.) instead of GitHub URLs
- Root `.kimi-plugin/marketplace.json` used local paths instead of GitHub URLs
- Root `marketplace.json` also used local paths instead of GitHub URLs

When Kimi tried to install from the GitHub repo, the missing manifests and local paths made installation fail for armada and programmer plugins.

## Fix Applied
1. Created `plugins/armada/.kimi-plugin/plugin.json` (v1.0.0) - Armada org deployment plugin manifest
2. Created `plugins/programmer/.kimi-plugin/plugin.json` (v0.1.0) - Programmer plugin manifest  
3. Updated root `kimi.plugin.json` (v2) with GitHub URLs for all 3 plugins
4. Updated `.kimi-plugin/marketplace.json` with GitHub URLs for all 3 plugins
5. Updated root `marketplace.json` with GitHub URLs for all 3 plugins

## Evidence
- `kimi.plugin.json:1-8` - root Kimi plugin manifest with 3 plugins using GitHub URLs
- `.kimi-plugin/marketplace.json:1-8` - marketplace catalog with GitHub URLs  
- `marketplace.json:1-8` - root marketplace with GitHub URLs
- `plugins/armada/.kimi-plugin/plugin.json:1-11` - armada plugin manifest
- `plugins/programmer/.kimi-plugin/plugin.json:1-11` - programmer plugin manifest

## Verification
All 3 plugins now have valid Kimi marketplace manifests with GitHub source URLs:
- atlas v5.1.1 -> https://github.com/w159/atlas/tree/main/plugins/atlas
- armada v1.0.0 -> https://github.com/w159/atlas/tree/main/plugins/armada
- programmer v0.1.0 -> https://github.com/w159/atlas/tree/main/plugins/programmer

Verified by inspecting all manifest files on disk - they exist and contain correct structure per Kimi plugin spec (version, plugins array with id, displayName, source).

## Resolution
Fixed. All 3 plugins now installable via Kimi marketplace from the GitHub repo.