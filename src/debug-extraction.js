/**
 * debug-extraction.js
 * 
 * This file helps debug extraction issues by examining the output structure
 * and printing detailed diagnostics about the extracted data.
 */

import fs from 'fs/promises';
import path from 'path';
import config from './config.js';
import { ensureDirectoryExists } from './utils.js';

/**
 * Debug function to examine extraction results before export
 * @param {Array} results - Array of extraction results
 * @returns {Promise<void>}
 */
export async function debugExtractionResults(results) {
  try {
    // Create debug directory
    const debugDir = path.join(config.outputDir, 'debug');
    await ensureDirectoryExists(debugDir);
    
    // Save the full results structure for examination
    await fs.writeFile(
      path.join(debugDir, 'extraction_results_debug.json'),
      JSON.stringify(results, null, 2)
    );
    
    console.log('=== EXTRACTION DEBUG INFO ===');
    console.log(`Total results: ${results.length}`);
    
    const complete = results.filter(r => r.status === 'extraction_complete');
    const failed = results.filter(r => r.status === 'extraction_failed');
    const skipped = results.filter(r => r.status !== 'extraction_complete' && r.status !== 'extraction_failed');
    
    console.log(`Completed: ${complete.length}, Failed: ${failed.length}, Skipped: ${skipped.length}`);
    
    // Analyze the structure of successful extractions
    if (complete.length > 0) {
      console.log('\n=== SUCCESSFUL EXTRACTIONS ANALYSIS ===');
      
      for (let i = 0; i < complete.length; i++) {
        const result = complete[i];
        console.log(`\n[${i+1}/${complete.length}] Company ID: ${result.companyId}`);
        
        if (!result.extractedData) {
          console.log(`  NO EXTRACTED DATA FOUND - THIS IS A BUG!`);
          continue;
        }
        
        // Log the top-level keys
        const topLevelKeys = Object.keys(result.extractedData);
        console.log(`  Top-level keys: ${topLevelKeys.join(', ')}`);
        
        // Check for required fields
        const hasBasicInfo = result.extractedData.basicInformation !== undefined;
        const hasAbstract = result.extractedData.abstract !== undefined;
        const hasHighlights = result.extractedData.highlights !== undefined;
        const hasCarbonFootprint = result.extractedData.carbonFootprint !== undefined;
        const hasClimateStandards = result.extractedData.climateStandards !== undefined;
        
        console.log(`  Has basicInformation: ${hasBasicInfo}`);
        console.log(`  Has abstract: ${hasAbstract}`);
        console.log(`  Has highlights: ${hasHighlights}`);
        console.log(`  Has carbonFootprint: ${hasCarbonFootprint}`);
        console.log(`  Has climateStandards: ${hasClimateStandards}`);
        
        // Check for criteria
        const potentialCriteriaFields = topLevelKeys.filter(key => 
          !['basicInformation', 'abstract', 'highlights', 'carbonFootprint', 
            'climateStandards', 'companyDetails', 'industry', 'sourceType',
            'otherInitiatives', 'controversies'].includes(key)
        );
        
        console.log(`  Potential criteria fields: ${potentialCriteriaFields.join(', ')}`);
        
        // For detailed inspection of a specific extraction, uncomment:
        await fs.writeFile(
          path.join(debugDir, `${result.companyId}_extraction_debug.json`),
          JSON.stringify(result.extractedData, null, 2)
        );
      }
    }
    
    // Analyze the structure of failed extractions
    if (failed.length > 0) {
      console.log('\n=== FAILED EXTRACTIONS ANALYSIS ===');
      
      for (let i = 0; i < failed.length; i++) {
        const result = failed[i];
        console.log(`\n[${i+1}/${failed.length}] Company ID: ${result.companyId}`);
        console.log(`  Error: ${result.error || 'No error message'}`);
        
        if (result.fallbackData) {
          console.log(`  Fallback data keys: ${Object.keys(result.fallbackData).join(', ')}`);
        } else {
          console.log(`  No fallback data available`);
        }
      }
    }
    
    console.log('\n=== END OF DEBUG INFO ===');
  } catch (error) {
    console.error(`Error in debug function: ${error.message}`);
  }
}

export default {
  debugExtractionResults
};