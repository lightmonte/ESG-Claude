/**
 * direct-excel-exporter.js
 * 
 * This module directly exports XML data from Claude responses to Excel format,
 * bypassing intermediate JSON format to avoid mapping issues.
 */

import fs from 'fs/promises';
import path from 'path';
import ExcelJS from 'exceljs';
import config from './config.js';
import { ensureDirectoryExists } from './utils.js';

/**
 * Generate a formatted date and time string for filenames
 * @returns {string} - Formatted date-time string
 */
function generateTimestamp() {
  const now = new Date();
  const dateString = now.toISOString().split('T')[0];
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const hoursFormatted = hours % 12 || 12;
  const minutesFormatted = minutes.toString().padStart(2, '0');
  return `${dateString} ${hoursFormatted}-${minutesFormatted}${ampm}`;
}

/**
 * Extract the content of an XML tag from a response text
 * @param {string} responseText - The full response text from Claude
 * @param {string} tagName - The XML tag name to extract content from
 * @returns {string} - The content of the tag, or empty string if not found
 */
function extractXmlTag(responseText, tagName) {
  const regex = new RegExp(`<${tagName}>(.*?)<\\/${tagName}>`, 's');
  const match = responseText.match(regex);
  return match ? match[1].trim() : '';
}

/**
 * Process action text from XML format
 * @param {string} actionsText - Raw actions text from XML
 * @returns {string[]} - Array of cleaned action strings
 */
function processActions(actionsText) {
  if (!actionsText || actionsText.trim() === '') {
    return [''];
  }
  
  return actionsText
    .split('#')
    .filter(item => item.trim())
    .map(item => item.trim())
    .slice(0, 5); // Limit to 5 items
}

/**
 * Directly export extraction results to Excel without JSON intermediary
 * @param {Array} results - Array of extraction results
 * @returns {Promise<object>} - Export result
 */
export async function exportDirectlyToExcel(results) {
  try {
    console.log('Starting direct XML-to-Excel export...');
    
    // Prepare export directory
    const exportDir = path.join(config.outputDir, 'excel');
    await ensureDirectoryExists(exportDir);
    
    // Generate filename with date and time
    const timestamp = generateTimestamp();
    const filename = `esg_data_${timestamp}.xlsx`;
    const exportPath = path.join(exportDir, filename);
    
    // Create a new workbook
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'ESG-Claude';
    workbook.lastModifiedBy = 'ESG-Claude';
    workbook.created = new Date();
    workbook.modified = new Date();
    
    // Add the ESG Data sheet
    const worksheet = workbook.addWorksheet('ESG Data');
    
    // Define the exact column headers from the output columns document
    const headers = [
      'company_legal_entity_name',
      'user_email_address',
      'user_first_name',
      'user_last_name',
      'company_name',
      'business_description',
      'sector',
      'industry',
      'street',
      'zip_code',
      'city',
      'country',
      'phone_number',
      'email_address',
      'website',
      'founding_year',
      'employee_range',
      'revenue_range',
      'contact_1_salutation',
      'contact_1_first_name',
      'contact_1_last_name',
      'contact_1_role',
      'contact_1_job_title',
      'contact_1_email_address',
      'contact_1_phone',
      'contact_2_salutation',
      'contact_2_first_name',
      'contact_2_last_name',
      'contact_2_role',
      'contact_2_job_title',
      'contact_2_email_address',
      'contact_2_phone',
      'report_url',
      'reporting_period',
      'scoring_period',
      'abstract'
    ];
    
    // Add 7 criteria with the exact formatting requested
    for (let i = 1; i <= 7; i++) {
      headers.push(`action_key_${i}`);
      headers.push(`action_key_${i}_value_1`);
      headers.push(`action_key_${i}_value_2`);
      headers.push(`action_key_${i}_value_3`);
      headers.push(`action_key_${i}_value_4`);
      headers.push(`action_key_${i}_value_5`);
    }
    
    // Add indicator columns
    headers.push('indicator_key');
    headers.push('indicator_sub_key_1');
    headers.push('indicator_sub_key_1_value_1');
    headers.push('indicator_sub_key_1_value_2');
    headers.push('indicator_sub_key_1_value_3');
    headers.push('indicator_sub_key_2');
    headers.push('indicator_sub_key_2_value_1');
    headers.push('indicator_sub_key_2_value_2');
    headers.push('indicator_sub_key_2_value_3');
    headers.push('indicator_sub_key_3');
    headers.push('indicator_sub_key_3_value_1');
    headers.push('indicator_sub_key_3_value_2');
    headers.push('indicator_sub_key_3_value_3');
    headers.push('other_achievements');
    headers.push('highlights_courage');
    headers.push('highlights_action');
    headers.push('highlights_solution');
    headers.push('climate_standards');
    
    // Add headers to the sheet
    worksheet.addRow(headers);
    
    // Count of successful exports
    let successCount = 0;
    
    // Map construction criteria to the standard criteria we need
    const criteriaMapping = {
      'criteria1_actions_solutions': 'Sustainable Construction',
      'criteria2_actions_solutions': 'Energy Efficiency',
      'criteria3_actions_solutions': 'Renewable Energies',
      'criteria4_actions_solutions': 'Climate-neutral Operation',
      'criteria5_actions_solutions': 'Sustainable Materials',
      'criteria6_actions_solutions': 'Occupational Safety and Health',
      'criteria7_actions_solutions': 'Carbon Footprint'
    };
    
    // Process results that have raw response text (construction industry XML)
    for (const result of results) {
      const { companyId, name, url, industry, rawResponse } = result;
      
      // Skip if no raw response
      if (!rawResponse) {
        console.log(`Skipping ${companyId}: No raw response data`);
        continue;
      }
      
      try {
        console.log(`Processing ${companyId} for direct Excel export...`);
        
        // Extract directly from XML structure in the raw response
        const company = extractXmlTag(rawResponse, 'company') || name || companyId;
        const abstract = extractXmlTag(rawResponse, 'abstract') || '';
        
        // Extract highlights
        const highlightCourage = extractXmlTag(rawResponse, 'highlight_courage') || '';
        const highlightAction = extractXmlTag(rawResponse, 'highlight_action') || '';
        const highlightSolution = extractXmlTag(rawResponse, 'highlight_solution') || '';
        
        // Extract criteria actions/solutions
        const criteriaActions = {};
        for (let i = 1; i <= 7; i++) {
          const tag = `criteria${i}_actions_solutions`;
          criteriaActions[tag] = extractXmlTag(rawResponse, tag);
        }
        
        // Extract carbon footprint data
        const co2Scope1_2022 = extractXmlTag(rawResponse, 'co2_scope1_2022') || '';
        const co2Scope2_2022 = extractXmlTag(rawResponse, 'co2_scope2_2022') || '';
        const co2Scope3_2022 = extractXmlTag(rawResponse, 'co2_scope3_2022') || '';
        const co2Total_2022 = extractXmlTag(rawResponse, 'co2_total_2022') || '';
        
        const co2Scope1_2023 = extractXmlTag(rawResponse, 'co2_scope1_2023') || '';
        const co2Scope2_2023 = extractXmlTag(rawResponse, 'co2_scope2_2023') || '';
        const co2Scope3_2023 = extractXmlTag(rawResponse, 'co2_scope3_2023') || '';
        const co2Total_2023 = extractXmlTag(rawResponse, 'co2_total_2023') || '';
        
        const co2Scope1_2024 = extractXmlTag(rawResponse, 'co2_scope1_2024') || '';
        const co2Scope2_2024 = extractXmlTag(rawResponse, 'co2_scope2_2024') || '';
        const co2Scope3_2024 = extractXmlTag(rawResponse, 'co2_scope3_2024') || '';
        const co2Total_2024 = extractXmlTag(rawResponse, 'co2_total_2024') || '';
        
        // Extract climate standards
        const climateStandardIso14001 = extractXmlTag(rawResponse, 'climate_standard_iso_14001') || 'No';
        const climateStandardIso50001 = extractXmlTag(rawResponse, 'climate_standard_iso_50001') || 'No';
        const climateStandardEmas = extractXmlTag(rawResponse, 'climate_standard_emas') || 'No';
        const climateStandardCdp = extractXmlTag(rawResponse, 'climate_standard_cdp') || 'No';
        const climateStandardSbti = extractXmlTag(rawResponse, 'climate_standard_sbti') || 'No';
        
        // Extract other information
        const otherAchievements = extractXmlTag(rawResponse, 'other') || '';
        const controversies = extractXmlTag(rawResponse, 'controversies') || '';
        
        // Base row data
        const row = [
          company, // company_legal_entity_name
          '', // user_email_address
          '', // user_first_name
          '', // user_last_name
          company, // company_name
          '', // business_description
          industry || 'Construction', // sector
          industry || 'Construction', // industry
          '', // street
          '', // zip_code
          '', // city
          '', // country
          '', // phone_number
          '', // email_address
          url || '', // website
          '', // founding_year
          '', // employee_range
          '', // revenue_range
          '', // contact_1_salutation
          '', // contact_1_first_name
          '', // contact_1_last_name
          '', // contact_1_role
          '', // contact_1_job_title
          '', // contact_1_email_address
          '', // contact_1_phone
          '', // contact_2_salutation
          '', // contact_2_first_name
          '', // contact_2_last_name
          '', // contact_2_role
          '', // contact_2_job_title
          '', // contact_2_email_address
          '', // contact_2_phone
          url || '', // report_url
          new Date().getFullYear().toString(), // reporting_period
          new Date().getFullYear().toString(), // scoring_period
          abstract // abstract
        ];
        
        // Add criteria data
        for (let i = 1; i <= 7; i++) {
          const criteriaTag = `criteria${i}_actions_solutions`;
          const criteriaName = criteriaMapping[criteriaTag];
          const actionsText = criteriaActions[criteriaTag] || '';
          
          // Process the actions into individual items (max 5)
          const actions = processActions(actionsText);
          
          // Add criteria name
          row.push(criteriaName);
          
          // Add up to 5 actions, padding with empty strings if needed
          for (let j = 0; j < 5; j++) {
            row.push(j < actions.length ? actions[j] : '');
          }
        }
        
        // Add carbon footprint indicators
        row.push('Carbon Footprint'); // indicator_key
        
        // Scope 1
        row.push('Scope 1'); // indicator_sub_key_1
        row.push(co2Scope1_2023 || co2Scope1_2024 || co2Scope1_2022 || ''); // indicator_sub_key_1_value_1
        row.push(co2Scope1_2022 !== co2Scope1_2023 ? co2Scope1_2022 : ''); // indicator_sub_key_1_value_2
        row.push(co2Scope1_2024 !== co2Scope1_2023 ? co2Scope1_2024 : ''); // indicator_sub_key_1_value_3
        
        // Scope 2
        row.push('Scope 2'); // indicator_sub_key_2
        row.push(co2Scope2_2023 || co2Scope2_2024 || co2Scope2_2022 || ''); // indicator_sub_key_2_value_1
        row.push(co2Scope2_2022 !== co2Scope2_2023 ? co2Scope2_2022 : ''); // indicator_sub_key_2_value_2
        row.push(co2Scope2_2024 !== co2Scope2_2023 ? co2Scope2_2024 : ''); // indicator_sub_key_2_value_3
        
        // Scope 3
        row.push('Scope 3'); // indicator_sub_key_3
        row.push(co2Scope3_2023 || co2Scope3_2024 || co2Scope3_2022 || ''); // indicator_sub_key_3_value_1
        row.push(co2Scope3_2022 !== co2Scope3_2023 ? co2Scope3_2022 : ''); // indicator_sub_key_3_value_2
        row.push(co2Scope3_2024 !== co2Scope3_2023 ? co2Scope3_2024 : ''); // indicator_sub_key_3_value_3
        
        // Other achievements and controversies
        if (controversies) {
          row.push(`${otherAchievements}\n\nControversies: ${controversies}`);
        } else {
          row.push(otherAchievements);
        }
        
        // Highlights
        row.push(highlightCourage);
        row.push(highlightAction);
        row.push(highlightSolution);
        
        // Climate standards (combined into one field)
        const standards = [];
        if (climateStandardIso14001 === 'Yes') standards.push('ISO 14001');
        if (climateStandardIso50001 === 'Yes') standards.push('ISO 50001');
        if (climateStandardEmas === 'Yes') standards.push('EMAS');
        if (climateStandardCdp === 'Yes') standards.push('CDP');
        if (climateStandardSbti === 'Yes') standards.push('SBTi');
        
        row.push(standards.join(', '));
        
        // Add the row to the worksheet
        worksheet.addRow(row);
        successCount++;
        
      } catch (error) {
        console.error(`Error processing ${companyId} for Excel export: ${error.message}`);
      }
    }
    
    // Add a summary sheet
    const summarySheet = workbook.addWorksheet('Summary');
    summarySheet.addRow(['Company ID', 'Company Name', 'Status', 'URL']);
    
    for (const result of results) {
      const companyName = extractXmlTag(result.rawResponse || '', 'company') || result.name || result.companyId;
      summarySheet.addRow([result.companyId, companyName, result.status, result.url || '']);
    }
    
    // Format the worksheet
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
    
    // Set column widths
    worksheet.columns.forEach(column => {
      column.width = 25;
      column.alignment = { wrapText: true };
    });
    
    // Save the workbook
    await workbook.xlsx.writeFile(exportPath);
    
    console.log(`Successfully exported ${successCount} companies directly to Excel: ${exportPath}`);
    
    return {
      count: successCount,
      path: exportPath,
      success: true
    };
    
  } catch (error) {
    console.error(`Error in direct Excel export: ${error.message}`);
    return {
      count: 0,
      path: null,
      success: false,
      error: error.message
    };
  }
}

export default {
  exportDirectlyToExcel
};