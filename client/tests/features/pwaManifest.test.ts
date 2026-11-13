import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}

interface WebManifest {
  name: string;
  short_name: string;
  icons: ManifestIcon[];
}

describe('PWA Manifest & PNG Icons', () => {
  const publicDir = path.resolve(__dirname, '../../public');
  const manifestPath = path.join(publicDir, 'manifest.webmanifest');
  const indexHtmlPath = path.resolve(__dirname, '../../index.html');

  it('references valid 192px, 512px, and maskable 512px PNG icons in manifest.webmanifest', () => {
    expect(fs.existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as WebManifest;

    expect(manifest.short_name).toBe('OSCAR');
    expect(Array.isArray(manifest.icons)).toBe(true);

    const expectedIcons: Array<{ src: string; sizes: string; purpose: string }> = [
      { src: '/icon-192.png', sizes: '192x192', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', purpose: 'maskable' },
    ];

    for (const expected of expectedIcons) {
      const entry = manifest.icons.find(
        (icon) => icon.src === expected.src && icon.purpose === expected.purpose,
      );
      expect(entry).toBeDefined();
      expect(entry?.type).toBe('image/png');
      expect(entry?.sizes).toBe(expected.sizes);

      const iconFile = path.join(publicDir, expected.src.replace(/^\//, ''));
      expect(fs.existsSync(iconFile)).toBe(true);

      const bytes = fs.readFileSync(iconFile);
      // Verify PNG magic signature: 89 50 4E 47 0D 0A 1A 0A
      expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    }
  });

  it('references icon-192.png as apple-touch-icon and uses clean UTF-8 em-dash in index.html', () => {
    const html = fs.readFileSync(indexHtmlPath, 'utf-8');
    expect(html).toContain('<link rel="apple-touch-icon" href="/icon-192.png" />');
    expect(html).toContain('<title>OSCAR — Confidential AI Voice & Task Agent</title>');
  });
});
