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
  it('publica dominio personalizado y fallback seguro para rutas SPA', () => {
    expect(readFileSync(resolve(process.cwd(), 'public/CNAME'), 'utf8').trim()).toBe('cartera.rtdev.uk');
    const fallback=readFileSync(resolve(process.cwd(), 'public/404.html'), 'utf8');
    const index=readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
    expect(fallback).toContain('__spa_route');
    expect(index).toContain('history.replaceState');
    expect(index).toContain("!route.startsWith('//')");
  });
});

describe('publicación coordinada de Pages',()=>{
 const workflow=readFileSync(resolve(process.cwd(),'../../.github/workflows/deploy-pages.yml'),'utf8');
 it('fusionar solo compila y publicar exige ejecución manual',()=>{
  const deploy=workflow.slice(workflow.indexOf('\n  deploy:'));
  expect(deploy).toContain("if: github.event_name == 'workflow_dispatch'");
  expect(workflow).toContain('api_revision:');
  expect(workflow).toContain('frontend_revision:');
  expect(workflow).toContain('working-directory: ${{ github.workspace }}');
  expect(workflow).toContain('ref: ${{ inputs.frontend_revision || github.sha }}');
 });
 it('la comprobación de publicación rechaza revisión API distinta y referencias no válidas',async()=>{
  const {spawnSync}=await import('node:child_process');
  const section=workflow.slice(workflow.indexOf('      - name: Validate coordinated release'),workflow.indexOf('      - name: Checkout repository'));
  const script=section.split('        run: |\n')[1].split('\n').map(line=>line.replace(/^ {10}/u,'')).join('\n');
  const sha='a'.repeat(40);
  const check=(api:string,frontend:string)=>spawnSync('bash',['-e','-c',script],{env:{...process.env,GITHUB_SHA:sha,API_REVISION:api,FRONTEND_REVISION:frontend}}).status;
  expect(check(sha,'')).toBe(0);
  expect(check(sha,'b'.repeat(40))).toBe(0);
  expect(check('b'.repeat(40),'b'.repeat(40))).toBe(0);
  expect(check('c'.repeat(40),'')).not.toBe(0);
  expect(check('', '')).not.toBe(0);
  expect(check(sha,'main')).not.toBe(0);
  expect(check(sha,'$(exit 0)')).not.toBe(0);
 });
});
