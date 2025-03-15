/**
 * simple-csv-exporter.js
 * 
 * A simplified CSV exporter for troubleshooting extraction issues
 */

import fs from 'fs/promises';
import path from 'path';
import config from './config.js';
import { ensureDirectoryExists } from './utils.js';

/**
 * Export extraction results to a simple CSV file for debugging
 * @param {Array} results - Array of extraction results
 * @returns {Promise<string>} - Path to saved CSV file
 */
export async function exportSimpleCsv(results) {
  try {
    // Create the output directory
    const outputDir = path.join(config.outputDir, 'debug');
    await ensureDirectoryExists(outputDir);
    
    // Generate a filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filePath = path.join(outputDir, `extraction_debug_${timestamp}.csv`);
    
    // CSV header
    let csvContent = "company_id,status,extracted_data_available,company_name,abstract_length,highlights_available,criteria_count\n";
    
    // Process each result
    for (const result of results) {
      const { companyId, status, extractedData } = result;
      
      // Check if extractedData exists
      const hasExtractedData = !!extractedData;
      
      // Get company name if available
      const companyName = extractedData?.basicInformation?.companyName || 
                         extractedData?.companyName || 
                         "unknown";
      
      // Get abstract length if available
      const abstractLength = extractedData?.abstract ? extractedData.abstract.length : 0;
      
      // Check if highlights are available
      const hasHighlights = !!extractedData?.highlights;
      
      // Count criteria fields (excluding standard metadata fields)
      const standardFields = ['basicInformation', 'abstract', 'highlights', 
                             'carbonFootprint', 'climateStandards', 'companyDetails', 
                             'industry', 'sourceType', 'otherInitiatives', 'controversies'];
      
      const criteriaCount = extractedData ? 
        Object.keys(extractedData).filter(key => !standardFields.includes(key)).length : 0;
      
      // Add a row to the CSV
      csvContent += `${companyId},${status},${hasExtractedData},${companyName},${abstractLength},${hasHighlights},${criteriaCount}\n`;
    }
    
    // Write the CSV file
    await fs.writeFile(filePath, csvContent);
    console.log(`Simple CSV export saved to: ${filePath}`);
    
    return filePath;
  } catch (error) {
    console.error(`Error in simple CSV export: ${error.message}`);
    return null;
  }
}

export default {
  exportSimpleCsv
};