import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('configuración PWA', () => {
  it('incluye manifest, shell offline y excluye API autenticada del caché', () => {
    const config = readFileSync(resolve(process.cwd(), 'vite.config.ts'), 'utf8');
    expect(config).toContain("display: 'standalone'");
    expect(config).toContain("handler: 'NetworkOnly'");
    expect(config).toContain("navigateFallback: '/index.html'");
  });
  it('incluye icono local instalable', () => {
    expect(readFileSync(resolve(process.cwd(), 'public/icon.svg'), 'utf8')).toContain('<svg');
  });
});
