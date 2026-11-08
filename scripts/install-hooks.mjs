import { writeFileSync, chmodSync } from 'node:fs';
writeFileSync('.git/hooks/pre-commit', '#!/bin/sh\nnode scripts/check-secrets.mjs || exit 1\n');
try { chmodSync('.git/hooks/pre-commit', 0o755); } catch {}
console.log('pre-commit secret check installed');
