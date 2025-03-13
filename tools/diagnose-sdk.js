/**
 * diagnose-sdk.js
 * 
 * This script diagnoses issues with the Anthropic SDK installation
 * and tests the availability of the batch API.
 */

import Anthropic from '@anthropic-ai/sdk';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function diagnoseSDK() {
  console.log('===== Anthropic SDK Diagnostic Tool =====');
  
  // 1. Check the installed SDK version
  console.log('\n📦 Checking installed SDK version...');
  try {
    const packageJson = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../node_modules/@anthropic-ai/sdk/package.json'), 'utf8')
    );
    console.log(`Installed version: ${packageJson.version}`);
    
    if (packageJson.version < '0.19.0') {
      console.log('❌ The installed version does not support batch API (requires ≥ 0.19.0)');
    } else {
      console.log('✅ Version should support batch API');
    }
  } catch (error) {
    console.log(`❌ Error reading package.json: ${error.message}`);
  }
  
  // 2. Check if SDK has been properly initialized
  console.log('\n🔍 Testing SDK initialization...');
  try {
    const anthropic = new Anthropic({ apiKey: 'dummy_key_for_testing' });
    console.log('✅ SDK initialized successfully');
    
    // Check for batch API
    console.log('\n🧪 Testing batch API availability...');
    if (anthropic.messages && anthropic.messages.batches) {
      console.log('✅ Batch API is available!');
    } else {
      console.log('❌ Batch API is NOT available in the current SDK instance');
      console.log('  - anthropic.messages exists:', !!anthropic.messages);
      console.log('  - anthropic.messages.batches exists:', !!(anthropic.messages && anthropic.messages.batches));
    }
  } catch (error) {
    console.log(`❌ Error initializing SDK: ${error.message}`);
  }
  
  // 3. Show installed packages
  console.log('\n📋 Checking npm installation...');
  try {
    const npmOutput = execSync('npm list @anthropic-ai/sdk', { encoding: 'utf8' });
    console.log(npmOutput);
  } catch (error) {
    console.log('Could not run npm list command');
  }
  
  // 4. Provide fix commands
  console.log('\n🔧 Recommended fixes:');
  console.log('1. Force reinstall the latest SDK:');
  console.log('   npm uninstall @anthropic-ai/sdk && npm install @anthropic-ai/sdk@latest');
  console.log('2. Clear npm cache if needed:');
  console.log('   npm cache clean --force');
  console.log('3. Check for conflicting versions in package-lock.json:');
  console.log('   npm ls @anthropic-ai/sdk');
  console.log('4. As a last resort, remove node_modules and reinstall all dependencies:');
  console.log('   rm -rf node_modules && npm install');
  console.log('\nAlternatively, disable batch processing in your .env file:');
  console.log('USE_BATCH_PROCESSING=false');
}

// Run the diagnostic
diagnoseSDK().catch(console.error);