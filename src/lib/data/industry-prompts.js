/**
 * industry-prompts.js
 *
 * This module provides industry-specific prompts for Claude extraction.
 */

import fs from 'fs/promises';
import path from 'path';
import config from '../../config.js';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
// No need for replacePlaceholders import as we're doing direct string replacement

// Get the project root directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = path.resolve(__dirname, '../../../');

// Map of industries to specialized prompt file paths
const industryPromptPaths = {
  'construction': 'construction-industry-prompt.txt',
  // Add other industry-specific prompts here
};

/**
 * Get an industry-specific prompt if available
 * @param {string} industry - Industry identifier
 * @returns {Promise<string|null>} - The industry-specific prompt or null if not available
 */
export async function getIndustryPrompt(industry, url) {
  if (!industry) return null;
  
  // Normalize industry identifier to lowercase
  const normalizedIndustry = industry.toLowerCase();
  
  // Check if we have a specialized prompt for this industry
  const promptFile = industryPromptPaths[normalizedIndustry];
  if (!promptFile) return null;
  
  try {
    // Read the specialized prompt file from the root directory
    // Use config.rootDir if available, otherwise use determined project root
    const rootDir = config.rootDir || projectRoot;
    console.log(`Looking for industry prompt in: ${rootDir}`);
    
    const promptPath = path.join(rootDir, promptFile);
    console.log(`Loading prompt from: ${promptPath}`);
    const promptContent = await fs.readFile(promptPath, 'utf8');
    
    // Replace any placeholders in the prompt
    let modifiedPrompt = promptContent;
    
    // Replace PDF URL placeholder if it exists
    if (url) {
      modifiedPrompt = modifiedPrompt.replace('The PDF is attached.', `The PDF URL is: ${url}`);
    }
    
    // Make some adjustments to help Claude generate valid XML
    modifiedPrompt = modifiedPrompt.replace('</sustainability_analysis>\n<highlight_courage>', '</sustainability_analysis>\n\n<highlight_courage>');
    
    // Add extra instruction to ensure proper XML formatting
    modifiedPrompt += '\n\nIMPORTANT: Make sure to properly nest all tags within <sustainability_analysis></sustainability_analysis> tags. The final output should be properly formatted XML with all data between these main tags.';
    
    return modifiedPrompt;
  } catch (error) {
    console.error(`Error loading industry-specific prompt for ${industry}: ${error.message}`);
    return null;
  }
}

export default {
  getIndustryPrompt
};