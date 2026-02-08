#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const libDir = path.join(__dirname, '../lib');
const binFile = path.join(__dirname, '../bin/omp');

// Check lib/ contains required files
const srcDir = path.join(__dirname, '../../../src/omp');
const requiredFiles = fs.readdirSync(srcDir).filter(f => f.endsWith('.js'));

console.log('Verifying build...');

const missing = requiredFiles.filter(f => !fs.existsSync(path.join(libDir, f)));
if (missing.length > 0) {
  console.error('❌ Missing required files in lib/:', missing);
  process.exit(1);
}

// Check bin/omp is executable
try {
  fs.accessSync(binFile, fs.constants.X_OK);
} catch {
  console.error('❌ bin/omp is not executable');
  process.exit(1);
}

// Check package.json version
const pkg = require('../package.json');
if (!pkg.version || pkg.version === '0.0.0') {
  console.error('❌ Invalid version in package.json');
  process.exit(1);
}

console.log('✓ Build verification passed');
console.log(`  Version: ${pkg.version}`);
console.log(`  Files: ${fs.readdirSync(libDir).length}`);
