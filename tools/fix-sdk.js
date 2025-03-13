/**
 * fix-sdk.js
 * 
 * This script attempts to completely fix SDK installation issues
 * by forcing a clean reinstall of the Anthropic SDK.
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function fixSDK() {
  console.log('===== Anthropic SDK Fix Tool =====');
  console.log('This tool will attempt to fix SDK installation issues by performing a complete reinstall.');
  console.log('⚠️  This process will take a few minutes ⚠️\n');
  
  try {
    // Step 1: Uninstall current SDK
    console.log('📦 Step 1: Uninstalling current Anthropic SDK...');
    execSync('npm uninstall @anthropic-ai/sdk', { stdio: 'inherit' });
    console.log('✅ Uninstallation complete\n');
    
    // Step 2: Clear npm cache
    console.log('🧹 Step 2: Clearing npm cache...');
    execSync('npm cache clean --force', { stdio: 'inherit' });
    console.log('✅ Cache cleared\n');
    
    // Step 3: Update package.json to latest version
    console.log('📝 Step 3: Updating package.json reference...');
    const packageJsonPath = path.resolve(__dirname, '../package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    packageJson.dependencies['@anthropic-ai/sdk'] = 'latest';
    fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
    console.log('✅ Package.json updated\n');
    
    // Step 4: Install latest version
    console.log('🔄 Step 4: Installing latest Anthropic SDK...');
    execSync('npm install @anthropic-ai/sdk@latest --no-save', { stdio: 'inherit' });
    console.log('✅ Installation complete\n');
    
    // Step 5: Verify installation
    console.log('🔍 Step 5: Verifying installation...');
    const npmOutput = execSync('npm list @anthropic-ai/sdk', { encoding: 'utf8' });
    console.log(npmOutput);
    
    // Step 6: Run the diagnostic tool
    console.log('🧪 Step 6: Running diagnostic tool...');
    execSync('node tools/diagnose-sdk.js', { stdio: 'inherit' });
    
    console.log('\n✨ Fix process completed!');
    console.log('If the diagnostic tool shows that the batch API is still not available,');
    console.log('please try restarting your application or setting USE_BATCH_PROCESSING=false in your .env file.');
    
  } catch (error) {
    console.error(`❌ Error during fix process: ${error.message}`);
    console.log('\nPlease try the following manual steps:');
    console.log('1. Delete node_modules folder');
    console.log('2. Delete package-lock.json');
    console.log('3. Run: npm install');
    console.log('4. Run: npm install @anthropic-ai/sdk@latest');
  }
}

// Run the fix
fixSDK().catch(console.error);