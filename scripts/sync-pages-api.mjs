#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const marketplace = readFileSync('marketplace.json', 'utf8');
mkdirSync('api', { recursive: true });

writeFileSync('api/marketplace.json', marketplace.endsWith('\n') ? marketplace : `${marketplace}\n`);

console.log('Synced marketplace.json to api/marketplace.json');
