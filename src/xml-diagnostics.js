/**
 * xml-diagnostics.js
 * 
 * This module analyzes raw responses for XML content and generates 
 * detailed debug information to help diagnose extraction issues.
 */

import fs from 'fs/promises';
import path from 'path';
import config from './config.js';
import { ensureDirectoryExists } from './utils.js';

/**
 * Generates a detailed diagnostic report for XML extraction
 * @param {Array} results - Array of extraction results
 */
export async function diagnoseXmlExtraction(results) {
  console.log("Starting XML extraction diagnostics...");
  
  try {
    // Create debug directory
    const debugDir = path.join(config.outputDir, 'debug');
    await ensureDirectoryExists(debugDir);
    
    // Create a diagnostic log file
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logPath = path.join(debugDir, `xml_diagnostic_${timestamp}.txt`);
    const jsonPath = path.join(debugDir, `xml_diagnostic_${timestamp}.json`);
    
    let logContent = "=== XML EXTRACTION DIAGNOSTIC REPORT ===\n";
    logContent += `Generated: ${new Date().toISOString()}\n`;
    logContent += `Total results: ${results.length}\n\n`;
    
    // Diagnostic statistics
    let statsHasRawResponse = 0;
    let statsHasXmlTag = 0;
    let statsHasCompanyTag = 0;
    let statsHasAbstractTag = 0;
    let statsHasCriteriaTag = 0;
    
    // Detailed diagnostics per result
    const diagnostics = [];
    
    for (const result of results) {
      const { companyId, status, rawResponse } = result;
      
      // Skip results without raw response
      if (!rawResponse) {
        logContent += `[${companyId}] NO RAW RESPONSE FOUND\n\n`;
        diagnostics.push({
          companyId,
          status,
          hasRawResponse: false,
          error: "No raw response found"
        });
        continue;
      }
      
      statsHasRawResponse++;
      logContent += `[${companyId}] Raw response length: ${rawResponse.length} characters\n`;
      
      // Check for <sustainability_analysis> tags
      const hasXmlTag = rawResponse.includes('<sustainability_analysis>');
      statsHasXmlTag += hasXmlTag ? 1 : 0;
      logContent += `[${companyId}] Has <sustainability_analysis> tag: ${hasXmlTag}\n`;
      
      // Extract important tags if available
      const extractTag = (tagName) => {
        const regex = new RegExp(`<${tagName}>(.*?)<\\/${tagName}>`, 's');
        const match = rawResponse.match(regex);
        return match ? match[1].trim() : null;
      };
      
      // Check key tags
      const company = extractTag('company');
      const hasCompanyTag = company !== null;
      statsHasCompanyTag += hasCompanyTag ? 1 : 0;
      logContent += `[${companyId}] Has <company> tag: ${hasCompanyTag} ${hasCompanyTag ? `(${company})` : ''}\n`;
      
      const abstract = extractTag('abstract');
      const hasAbstractTag = abstract !== null;
      statsHasAbstractTag += hasAbstractTag ? 1 : 0;
      logContent += `[${companyId}] Has <abstract> tag: ${hasAbstractTag} ${hasAbstractTag ? `(length: ${abstract?.length})` : ''}\n`;
      
      // Check for criteria tags
      let criteriaFound = 0;
      for (let i = 1; i <= 7; i++) {
        const criteriaTag = `criteria${i}_actions_solutions`;
        const criteriaContent = extractTag(criteriaTag);
        if (criteriaContent !== null) {
          criteriaFound++;
          logContent += `[${companyId}] Found ${criteriaTag}: ${criteriaContent.substring(0, 50)}${criteriaContent.length > 50 ? '...' : ''}\n`;
        }
      }
      
      statsHasCriteriaTag += criteriaFound > 0 ? 1 : 0;
      logContent += `[${companyId}] Found ${criteriaFound} criteria tags\n`;
      
      // Check for carbon footprint tags
      let co2TagsFound = 0;
      const co2Tags = [
        'co2_scope1_2022', 'co2_scope2_2022', 'co2_scope3_2022', 'co2_total_2022',
        'co2_scope1_2023', 'co2_scope2_2023', 'co2_scope3_2023', 'co2_total_2023',
        'co2_scope1_2024', 'co2_scope2_2024', 'co2_scope3_2024', 'co2_total_2024'
      ];
      
      for (const tag of co2Tags) {
        if (extractTag(tag) !== null) {
          co2TagsFound++;
        }
      }
      
      logContent += `[${companyId}] Found ${co2TagsFound} carbon footprint tags\n`;
      
      // Check for climate standards
      let standardsFound = 0;
      const standardTags = [
        'climate_standard_iso_14001', 'climate_standard_iso_50001', 
        'climate_standard_emas', 'climate_standard_cdp', 'climate_standard_sbti'
      ];
      
      for (const tag of standardTags) {
        if (extractTag(tag) !== null) {
          standardsFound++;
        }
      }
      
      logContent += `[${companyId}] Found ${standardsFound} climate standard tags\n`;
      
      // Look for <extraction_process> section
      const hasExtractionProcessTag = rawResponse.includes('<extraction_process>');
      logContent += `[${companyId}] Has <extraction_process> tag: ${hasExtractionProcessTag}\n`;
      
      // Look for the example XML
      const hasExampleXml = rawResponse.includes('<sustainability_analysis>\n<file_name>file_name.pdf</file_name>');
      logContent += `[${companyId}] Has example XML: ${hasExampleXml}\n`;
      
      // Save first 500 and last 500 chars of raw response
      logContent += `[${companyId}] First 500 chars of raw response:\n${rawResponse.substring(0, 500)}\n...\n`;
      logContent += `[${companyId}] Last 500 chars of raw response:\n...${rawResponse.substring(rawResponse.length - 500)}\n\n`;
      
      // Save the index positions of key tags for debugging
      const tagPositions = {};
      
      ['sustainability_analysis', 'company', 'abstract', 'criteria1_actions_solutions', 'file_name'].forEach(tag => {
        const openTag = `<${tag}>`;
        const closeTag = `</${tag}>`;
        tagPositions[tag] = {
          openTagPos: rawResponse.indexOf(openTag),
          closeTagPos: rawResponse.indexOf(closeTag)
        };
      });
      
      // Add to diagnostics
      diagnostics.push({
        companyId,
        status,
        hasRawResponse: true,
        responseLength: rawResponse.length,
        hasXmlTag,
        hasCompanyTag,
        company: company || '',
        hasAbstractTag,
        abstractLength: abstract?.length || 0,
        criteriaTagsFound: criteriaFound,
        co2TagsFound,
        standardsFound,
        hasExtractionProcessTag,
        hasExampleXml,
        tagPositions
      });
    }
    
    // Add summary statistics
    logContent += "\n=== SUMMARY STATISTICS ===\n";
    logContent += `Total results: ${results.length}\n`;
    logContent += `Results with raw response: ${statsHasRawResponse}\n`;
    logContent += `Results with <sustainability_analysis> tag: ${statsHasXmlTag}\n`;
    logContent += `Results with <company> tag: ${statsHasCompanyTag}\n`;
    logContent += `Results with <abstract> tag: ${statsHasAbstractTag}\n`;
    logContent += `Results with at least one criteria tag: ${statsHasCriteriaTag}\n`;
    
    // Write the log file
    await fs.writeFile(logPath, logContent);
    console.log(`XML diagnostic log written to: ${logPath}`);
    
    // Write the JSON for easier programmatic analysis
    await fs.writeFile(jsonPath, JSON.stringify(diagnostics, null, 2));
    console.log(`XML diagnostic JSON written to: ${jsonPath}`);
    
    // Check if we're getting any XML content
    if (statsHasXmlTag === 0) {
      console.log("CRITICAL: No results contain <sustainability_analysis> tags. Check if the construction industry prompt is correctly formatting output as XML.");
    } else if (statsHasXmlTag < statsHasRawResponse) {
      console.log(`WARNING: Only ${statsHasXmlTag} out of ${statsHasRawResponse} responses contain proper XML tags. XML extraction may be failing.`);
    }
    
    // Detailed troubleshooting for each type of missing data
    if (statsHasCompanyTag === 0) {
      console.log("CRITICAL: No company tags found. Check XML tag structure.");
    }
    
    if (statsHasAbstractTag === 0) {
      console.log("CRITICAL: No abstract tags found. Check XML tag structure.");
    }
    
    if (statsHasCriteriaTag === 0) {
      console.log("CRITICAL: No criteria tags found. Check XML tag structure.");
    }
    
    return diagnostics;
  } catch (error) {
    console.error(`Error in XML diagnostics: ${error.message}`);
    return null;
  }
}

/**
 * Save raw responses to separate files for debugging
 * @param {Array} results - Array of extraction results
 */
export async function saveRawResponses(results) {
  try {
    // Create raw responses directory
    const debugDir = path.join(config.outputDir, 'debug', 'raw_responses');
    await ensureDirectoryExists(debugDir);
    
    console.log(`Saving raw responses to ${debugDir}...`);
    
    // Save each raw response to a separate file
    for (const result of results) {
      const { companyId, rawResponse } = result;
      
      if (!rawResponse) {
        console.log(`No raw response for ${companyId}, skipping`);
        continue;
      }
      
      const filePath = path.join(debugDir, `${companyId}_raw_response.txt`);
      await fs.writeFile(filePath, rawResponse);
      console.log(`Saved raw response for ${companyId}`);
    }
    
    console.log(`Saved ${results.filter(r => r.rawResponse).length} raw responses`);
  } catch (error) {
    console.error(`Error saving raw responses: ${error.message}`);
  }
}

export default {
  diagnoseXmlExtraction,
  saveRawResponses
};