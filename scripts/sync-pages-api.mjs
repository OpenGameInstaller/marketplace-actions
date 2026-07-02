#!/usr/bin/env node
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const marketplace = readFileSync('marketplace.json', 'utf8');
const body = marketplace.endsWith('\n') ? marketplace : `${marketplace}\n`;

mkdirSync('api', { recursive: true });
writeFileSync('api/marketplace.json', body);

rmSync('_site', { recursive: true, force: true });
mkdirSync('_site/api', { recursive: true });
writeFileSync('_site/api/marketplace.json', body);
writeFileSync('_site/marketplace.json', body);
writeFileSync('_site/index.html', '<!doctype html><meta charset="utf-8"><title>OGI Marketplace</title><a href="/api/marketplace.json">marketplace.json</a>\n');

console.log('Synced marketplace.json to api/marketplace.json and _site');
