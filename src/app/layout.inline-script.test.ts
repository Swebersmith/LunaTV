import fs from 'node:fs';
import path from 'node:path';

describe('RootLayout Cloudflare inline-script compatibility', () => {
  it('defines the esbuild name helper before rendering the theme provider', () => {
    const layoutSource = fs.readFileSync(
      path.join(__dirname, 'layout.tsx'),
      'utf8'
    );
    const helper = 'globalThis.__name ??= (target) => target;';

    expect(layoutSource.indexOf(helper)).toBeGreaterThanOrEqual(0);
    expect(layoutSource.indexOf(helper)).toBeLessThan(
      layoutSource.indexOf('<ThemeProvider')
    );
  });
});
