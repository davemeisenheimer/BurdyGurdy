import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sitemapPath = resolve(__dirname, '../public/sitemap.xml');

const today = new Date().toISOString().split('T')[0];
let xml = readFileSync(sitemapPath, 'utf8');
xml = xml.replace(/<lastmod>[\d-]+<\/lastmod>/g, `<lastmod>${today}</lastmod>`);
writeFileSync(sitemapPath, xml, 'utf8');
console.log(`sitemap.xml lastmod → ${today}`);
