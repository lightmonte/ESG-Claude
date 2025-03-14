/**
 * exporter.js
 * 
 * This module handles the export of extracted ESG data to various formats.
 */

import fs from 'fs/promises';
import path from 'path';
import { createObjectCsvWriter } from 'csv-writer';
import ExcelJS from 'exceljs';
import config from './config.js';
import { ensureDirectoryExists, formatDate } from './utils.js';
import { getIndustryCriteria } from './lib/esg-criteria.js';

/**
 * Generate a formatted date and time string for filenames
 * @param {string} prefix - Prefix for the filename
 * @param {string} extension - File extension
 * @returns {string} - Formatted filename
 */
function generateFormattedFilename(prefix, extension) {
  const now = new Date();
  const dateString = now.toISOString().split('T')[0];
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const hoursFormatted = hours % 12 || 12;
  const minutesFormatted = minutes.toString().padStart(2, '0');
  const timeString = `${hoursFormatted}-${minutesFormatted}${ampm}`;
  return `${prefix}_${dateString} ${timeString}.${extension}`;
}

// Map to help look up criteria names by ID
const criteriaNameMap = {};

// Helper function to get criteria name by ID
function getCriteriaName(criteriaId) {
  // Check if we already have this criteria name cached
  if (criteriaNameMap[criteriaId]) {
    return criteriaNameMap[criteriaId];
  }
  
  // Just use the criteriaId directly
  criteriaNameMap[criteriaId] = criteriaId;
  return criteriaNameMap[criteriaId];
}

/**
 * Export data to JSON format
 * @param {Array} results - Array of extraction results
 * @returns {Promise<object>} - Export result
 */
export async function exportToJson(results) {
  try {
    // Filter out successful extractions
    const successfulResults = results.filter(
      r => r.status === 'extraction_complete' && r.extractedData
    );
    
    if (successfulResults.length === 0) {
      console.log('No successful extractions to export to JSON');
      return { count: 0, success: false, error: 'No data to export' };
    }
    
    // Prepare export directory
    const exportDir = path.join(config.outputDir, 'json');
    await ensureDirectoryExists(exportDir);
    
    // Format the data for export
    const exportData = successfulResults.map(r => ({
      companyId: r.companyId,
      ...r.extractedData
    }));
    
    // Generate filename with date and time
    const filename = generateFormattedFilename('esg_data', 'json');
    const exportPath = path.join(exportDir, filename);
    
    // Write the file
    await fs.writeFile(exportPath, JSON.stringify(exportData, null, 2));
    
    console.log(`Exported ${exportData.length} records to JSON: ${exportPath}`);
    
    return { 
      count: exportData.length, 
      path: exportPath, 
      success: true 
    };
  } catch (error) {
    console.error(`Error exporting to JSON: ${error.message}`);
    return { 
      count: 0, 
      success: false, 
      error: error.message 
    };
  }
}

/**
 * Format initiatives properly to only include lines starting with "# "
 * @param {object} initiative - Initiative data
 * @returns {string} - Formatted initiative text
 */
function formatInitiative(initiative) {
  if (!initiative) return '';
  
  // If it's already a string that starts with "#", return it
  if (typeof initiative === 'string' && initiative.trim().startsWith('#')) {
    return initiative;
  }
  
  // If it's an array, filter for items starting with "#" and join
  if (Array.isArray(initiative)) {
    return initiative
      .filter(item => typeof item === 'string' && item.trim().startsWith('#'))
      .join('\n');
  }
  
  // If it's an object, look for properties that might be the actual content
  if (typeof initiative === 'object') {
    // Look for actions or description properties that might contain our content
    if (Array.isArray(initiative.actions)) {
      return initiative.actions
        .filter(item => typeof item === 'string' && item.trim().startsWith('#'))
        .join('\n');
    }
    
    if (typeof initiative.description === 'string' && initiative.description.trim().startsWith('#')) {
      return initiative.description;
    }
    
    // As a fallback, return any property value that starts with "#"
    for (const key of Object.keys(initiative)) {
      const value = initiative[key];
      if (typeof value === 'string' && value.trim().startsWith('#')) {
        return value;
      }
    }
  }
  
  // If no valid format is found, return empty string
  return '';
}

/**
 * Export data to CSV format
 * @param {Array} results - Array of extraction results
 * @returns {Promise<object>} - Export result
 */
export async function exportToCsv(results) {
  try {
    // Filter out successful extractions
    const successfulResults = results.filter(
      r => r.status === 'extraction_complete' && r.extractedData
    );
    
    if (successfulResults.length === 0) {
      console.log('No successful extractions to export to CSV');
      return { count: 0, success: false, error: 'No data to export' };
    }
    
    // Prepare export directory
    const exportDir = path.join(config.outputDir, 'csv');
    await ensureDirectoryExists(exportDir);
    
    // Generate filename with date and time
    const filename = generateFormattedFilename('esg_data', 'csv');
    const exportPath = path.join(exportDir, filename);
    
    // Define CSV headers for the row-based format
    const headers = [
      { id: 'companyId', title: 'Company ID' },
      { id: 'companyName', title: 'Company Name' },
      { id: 'criteriaId', title: 'Criteria ID' },
      { id: 'criteriaName', title: 'Criteria Name' },
      { id: 'criteriaContent', title: 'Criteria Content' },
      { id: 'excerpt', title: 'Excerpt' }
    ];
    
    const csvWriter = createObjectCsvWriter({
      path: exportPath,
      header: headers
    });
    
    // Transform data to row-based format
    const csvRows = [];
    
    // Helper function to format arrays as a joined string without bullet points
    const formatLines = (arr) => {
      if (!arr || !Array.isArray(arr)) return '';
      return arr
        .filter(item => typeof item === 'string' && item.trim().startsWith('#'))
        .join('\n');
    };
    
    // Create rows for company data
    for (const result of successfulResults) {
      const data = result.extractedData;
      const companyId = result.companyId;
      const companyName = data.basicInformation?.companyName || '';
      
      // Add rows for each ESG criteria
      if (data.esgCriteria) {
        Object.entries(data.esgCriteria).forEach(([criteriaId, criteriaData]) => {
          const criteriaName = getCriteriaName(criteriaId);
          const actions = criteriaData.actions || [];
          // The description field becomes the excerpt
          const excerpt = criteriaData.description || '';
          
          csvRows.push({
            companyId,
            companyName,
            criteriaId,
            criteriaName,
            criteriaContent: formatLines(actions),
            excerpt
          });
        });
      }
      
      // Add rows for climate data if present
      if (data.climateData) {
        // Carbon footprint
        if (data.climateData.carbonFootprint) {
          const footprint = data.climateData.carbonFootprint;
          csvRows.push({
            companyId,
            companyName,
            criteriaId: 'co2_footprint',
            criteriaName: 'CO2 Footprint',
            criteriaContent: Object.entries(footprint)
              .map(([key, value]) => `# ${key}: ${value}`)
              .join('\n'),
            excerpt: ''
          });
        }
        
        // Climate standards
        if (data.climateData.climateStandards) {
          csvRows.push({
            companyId,
            companyName,
            criteriaId: 'climate_standards',
            criteriaName: 'Climate Standards',
            criteriaContent: data.climateData.climateStandards
              .map(standard => `# ${standard}`)
              .join('\n'),
            excerpt: ''
          });
        }
        
        // Emissions reduction targets
        if (data.climateData.emissionsReductionTargets) {
          csvRows.push({
            companyId,
            companyName,
            criteriaId: 'emissions_targets',
            criteriaName: 'Emissions Reduction Targets',
            criteriaContent: data.climateData.emissionsReductionTargets
              .map(target => `# ${target}`)
              .join('\n'),
            excerpt: ''
          });
        }
      }
      
      // Add rows for sustainability strategy
      if (data.sustainabilityStrategy) {
        csvRows.push({
          companyId,
          companyName,
          criteriaId: 'sustainability_strategy',
          criteriaName: 'Sustainability Strategy',
          criteriaContent: `# ${data.sustainabilityStrategy.summary || ''}`,
          excerpt: ''
        });
        
        if (data.sustainabilityStrategy.pillars) {
          csvRows.push({
            companyId,
            companyName,
            criteriaId: 'strategic_pillars',
            criteriaName: 'Strategic Pillars',
            criteriaContent: data.sustainabilityStrategy.pillars
              .map(pillar => `# ${pillar}`)
              .join('\n'),
            excerpt: ''
          });
        }
      }
      
      // Add rows for other initiatives
      if (data.otherInitiatives) {
        Object.entries(data.otherInitiatives).forEach(([initiative, details]) => {
          csvRows.push({
            companyId,
            companyName,
            criteriaId: `initiative_${initiative}`,
            criteriaName: initiative,
            criteriaContent: formatInitiative(details),
            excerpt: ''
          });
        });
      }
      
      // Add rows for controversies
      if (data.controversies) {
        Object.entries(data.controversies).forEach(([controversy, details]) => {
          csvRows.push({
            companyId,
            companyName,
            criteriaId: `controversy_${controversy}`,
            criteriaName: controversy,
            criteriaContent: `# ${details.description || ''}`,
            excerpt: details.response || ''
          });
        });
      }
    }
    
    // Write the CSV file
    await csvWriter.writeRecords(csvRows);
    
    console.log(`Exported ${csvRows.length} rows for ${successfulResults.length} companies to CSV: ${exportPath}`);
    
    return { 
      count: successfulResults.length, 
      path: exportPath, 
      success: true 
    };
  } catch (error) {
    console.error(`Error exporting to CSV: ${error.message}`);
    return { 
      count: 0, 
      success: false, 
      error: error.message 
    };
  }
}

/**
 * Export data to Excel format
 * @param {Array} results - Array of extraction results
 * @returns {Promise<object>} - Export result
 */
export async function exportToExcel(results) {
  try {
    // Filter out successful extractions
    const successfulResults = results.filter(
      r => r.status === 'extraction_complete' && r.extractedData
    );
    
    if (successfulResults.length === 0) {
      console.log('No successful extractions to export to Excel');
      return { count: 0, success: false, error: 'No data to export' };
    }
    
    // Prepare export directory
    const exportDir = path.join(config.outputDir, 'excel');
    await ensureDirectoryExists(exportDir);
    
    // Generate filename with date and time
    const filename = generateFormattedFilename('esg_data', 'xlsx');
    const exportPath = path.join(exportDir, filename);
    
    // Create a new workbook
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'ESG-Claude';
    workbook.lastModifiedBy = 'ESG-Claude';
    workbook.created = new Date();
    workbook.modified = new Date();
    
    // Add the ESG Data sheet
    const worksheet = workbook.addWorksheet('ESG Data');
    
    // Define the exact column headers as requested
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
    
    // Add 7 criteria with the exact formatting requested - using our specific naming pattern
    for (let i = 1; i <= 7; i++) {
      headers.push(`action_key_${i}`);
      headers.push(`action_key_${i}_value_1`);
      headers.push(`action_key_${i}_value_2`);
      headers.push(`action_key_${i}_value_3`);
      headers.push(`action_key_${i}_value_4`);
      headers.push(`action_key_${i}_value_5`);
    }
    
    // Add carbon footprint and climate standards columns
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
    
    // Process each company data
    for (const result of successfulResults) {
      const data = result.extractedData;
      const companyId = result.companyId;
      
      // Log the structure of the data for debugging
      console.log(`Processing company ID: ${companyId}, keys in data:`, Object.keys(data));
      
      // Extract company information with better fallbacks
      const companyName = data.basicInformation?.companyName || data.companyName || '';
      const reportYear = data.basicInformation?.reportYear || data.reportYear || '';
      const reportTitle = data.basicInformation?.reportTitle || data.reportTitle || '';
      
      // Check for industry and URL in multiple possible locations
      const industry = result.industry || data.industry || data.basicInformation?.industry || '';
      const url = result.url || data.url || data.basicInformation?.url || '';
      
      console.log(`Company: ${companyName}, Industry: ${industry}, URL: ${url}`);
      
      // Get company details
      const companyDetails = data.companyDetails || {};
      const address = companyDetails.address || {};
      const contactInfo = companyDetails.contactInfo || {};

      // Base row data with company information
      const rowData = [
        // Company legal entity name
        companyDetails.legalEntityName || companyName || '',
        // User information - these will be empty as they're not in the reports
        '', // user_email_address
        '', // user_first_name
        '', // user_last_name
        // Company name
        companyName || '',
        // Business description
        companyDetails.businessDescription || '',
        // Sector
        companyDetails.sector || '',
        // Industry
        industry || '',
        // Address information
        address.street || '',
        address.zipCode || '',
        address.city || '',
        address.country || '',
        // Contact information
        contactInfo.phoneNumber || '',
        contactInfo.emailAddress || '',
        contactInfo.website || url || '',
        // Company data
        companyDetails.foundingYear || '',
        companyDetails.employeeRange || '',
        companyDetails.revenueRange || '',
        // Contact 1 information - empty as not in reports
        '', // contact_1_salutation
        '', // contact_1_first_name
        '', // contact_1_last_name
        '', // contact_1_role
        '', // contact_1_job_title
        '', // contact_1_email_address
        '', // contact_1_phone
        // Contact 2 information - empty as not in reports
        '', // contact_2_salutation
        '', // contact_2_first_name
        '', // contact_2_last_name
        '', // contact_2_role
        '', // contact_2_job_title
        '', // contact_2_email_address
        '', // contact_2_phone
        // Report information
        url || '',
        reportYear || '',
        '', // scoring_period
        // Abstract
        data.abstract || ''
      ];
      
      // Important: Use the raw industry directly without normalization
      // This matches our new pattern in IndustryCriteriaSimple.csv
      let industryForCriteria = industry || '';
      
      // If we have no industry, use 'general' as a fallback
      if (!industryForCriteria) {
        industryForCriteria = 'general';
      }
      
      console.log(`Using industry for criteria lookup: ${industryForCriteria}`);
      
      // Get industry-specific criteria (exactly 7 criteria in correct order)
      console.log(`Getting criteria for industry: ${industryForCriteria}`);
      
      // Get the actual industry criteria from the shared module
      let relevantCriteria;
      try {
        // Call the function to get industry criteria with the raw industry name
        relevantCriteria = await getIndustryCriteria(industryForCriteria);
        console.log(`Successfully loaded ${relevantCriteria.length} criteria for '${industryForCriteria}'`);
        
        // Debug: Show the loaded criteria to verify they're correct
        if (process.env.DEBUG_EXPORT === 'true') {
          console.log('Criteria loaded:', JSON.stringify(relevantCriteria));
        } else {
          console.log('Criteria IDs:', relevantCriteria.map(c => c.id).join(', '));
        }
      } catch (error) {
        console.error(`Error loading criteria for '${industryForCriteria}': ${error.message}`);
        
        // Default criteria as fallback if loading fails
        relevantCriteria = [
          { id: "carbon_footprint", name_en: "Carbon Footprint" },
          { id: "energy_efficiency", name_en: "Energy Efficiency" },
          { id: "renewable_energies", name_en: "Renewable Energies" },
          { id: "waste_management", name_en: "Waste Management" },
          { id: "water_management", name_en: "Water Management" },
          { id: "diversity_inclusion", name_en: "Diversity and Inclusion" },
          { id: "social_responsibility", name_en: "Social Responsibility" }
        ];
        console.log(`Using default criteria instead of industry-specific ones`);
      }
      
      // Use exactly the 7 criteria from the industry specification in the defined order
      for (let i = 0; i < 7; i++) {
        const criterionNumber = i + 1; // 1-based criterion number for column headers
        const criterion = relevantCriteria[i];
        if (!criterion) continue; // Skip if we somehow have fewer than 7 criteria
        
        const criteriaId = criterion.id;
        const criteriaName = criterion.name_en;
        
        // Get data if it exists, check multiple possible locations in the JSON structure
        let criteriaData = {};
        let actions = [];
        let extracts = '';
        
        // Try to find data in various locations in the JSON structure
        if (data[criteriaId]) {
          // Direct mapping (ideal case)
          criteriaData = data[criteriaId];
        } else if (data.esgCriteria && data.esgCriteria[criteriaId]) {
          // If criteria are under an esgCriteria object
          criteriaData = data.esgCriteria[criteriaId];
        } else if (data.criteria && data.criteria[criteriaId]) {
          // If criteria are under a criteria object
          criteriaData = data.criteria[criteriaId];
        } else {
          // Search for criteria by multiple patterns:
          // 1. New pattern: "industry_position" like "telecommunication_1"
          // 2. Old pattern: "number_position" like "62_1", "1_1", etc.
          // Look for all possible criteria fields in the data
          const possibleCriteriaFields = Object.keys(data).filter(key => {
            // Check if it's an object first
            if (typeof data[key] !== 'object') return false;
            
            // Match our new pattern like "telecommunication_1", "food_processing_2", etc.
            if (industryForCriteria && key.startsWith(`${industryForCriteria.toLowerCase()}_`)) {
              return true;
            }
            
            // Also match the old pattern like "62_1", "1_1", "45_2" etc.
            return /^\d+_\d+$/.test(key);
          });
          
          // If we found criteria, use the one that matches the position
          // Priority order: 
          // 1. Exact match on new format (industryName_position)
          // 2. Any field ending with the position number
          if (possibleCriteriaFields.length > 0) {
            const criterionPosition = i + 1; // 1-based position (1-7)
            
            // First try to find a field with our exact new format pattern
            const industryPattern = `${industryForCriteria.toLowerCase()}_${criterionPosition}`;
            const exactMatchField = possibleCriteriaFields.find(field => 
              field === industryPattern
            );
            
            if (exactMatchField) {
              console.log(`Found exact criteria match: ${exactMatchField}`);
              criteriaData = data[exactMatchField];
            } else {
              // Fall back to position matching (for "62_1", etc.)
              const positionMatchField = possibleCriteriaFields.find(field => 
                field.endsWith(`_${criterionPosition}`)
              );
              
              if (positionMatchField) {
                console.log(`Found criteria data by position matching: ${positionMatchField} for position ${criterionPosition}`);
                criteriaData = data[positionMatchField];
              }
            }
          }
        }
        
        // Log the criteria data structure to understand what we're working with in debug mode only
        if (process.env.DEBUG_EXPORT === 'true') {
          console.log(`Criteria ${criteriaId} data:`, JSON.stringify(criteriaData, null, 2));
        }
        
        // Enhanced extraction of actions with more intelligent fallbacks
        const debugLog = process.env.DEBUG_EXPORT === 'true' ? 
          (msg) => console.log(msg) : () => {};

        if (Array.isArray(criteriaData.actions)) {
          debugLog(`Found actions array for ${criteriaId}`);
          actions = criteriaData.actions;
        } else if (Array.isArray(criteriaData.targets)) {
          debugLog(`Found targets array for ${criteriaId}`);
          actions = criteriaData.targets;
        } else if (Array.isArray(criteriaData.initiatives)) {
          debugLog(`Found initiatives array for ${criteriaId}`);
          actions = criteriaData.initiatives;
        } else if (Array.isArray(criteriaData.solutions)) {
          debugLog(`Found solutions array for ${criteriaId}`);
          actions = criteriaData.solutions;
        } else if (criteriaData.action && Array.isArray(criteriaData.action)) {
          debugLog(`Found action array for ${criteriaId}`);
          actions = criteriaData.action;
        } else if (criteriaData.target && Array.isArray(criteriaData.target)) {
          debugLog(`Found target array for ${criteriaId}`);
          actions = criteriaData.target;
        } else if (typeof criteriaData.actions === 'string') {
          debugLog(`Found actions string for ${criteriaId}`);
          // Handle case where actions might be a string instead of an array
          actions = [criteriaData.actions];
        } else if (typeof criteriaData.action === 'string') {
          debugLog(`Found action string for ${criteriaId}`);
          actions = [criteriaData.action];
        } else if (typeof criteriaData.targets === 'string') {
          debugLog(`Found targets string for ${criteriaId}`);
          actions = [criteriaData.targets];
        } else if (typeof criteriaData.initiatives === 'string') {
          debugLog(`Found initiatives string for ${criteriaId}`);
          actions = [criteriaData.initiatives];
        } else if (typeof criteriaData.solutions === 'string') {
          debugLog(`Found solutions string for ${criteriaId}`);
          actions = [criteriaData.solutions];
        } else if (typeof criteriaData === 'string') {
          debugLog(`Found entire criteriaData as string for ${criteriaId}`);
          // Handle case where the entire criteria data is a string
          actions = [criteriaData];
        } else if (criteriaData.content && (Array.isArray(criteriaData.content) || typeof criteriaData.content === 'string')) {
          debugLog(`Found content for ${criteriaId}`);
          // Handle content field which might be an array or string
          actions = Array.isArray(criteriaData.content) ? criteriaData.content : [criteriaData.content];
        } else {
          // Last resort - try to extract any string values from the criteria data
          debugLog(`No standard actions found for ${criteriaId}, trying to extract string values`);
          actions = [];
          for (const [key, value] of Object.entries(criteriaData)) {
            if (typeof value === 'string' && value.trim() && !['id', 'name', 'type', 'description', 'extracts', 'summary'].includes(key)) {
              actions.push(value);
            } else if (Array.isArray(value) && value.length > 0) {
              actions = [...actions, ...value.filter(item => typeof item === 'string' && item.trim())];
            }
          }
        }
        
        // Clean up actions and ensure we have at least 5 items
        actions = actions.map(action => {
          if (typeof action !== 'string') return '';
          action = action.trim();
          return action.startsWith('# ') ? action : `# ${action}`;
        });
        
        // Make sure we have at least 5 actions (even if empty)
        while (actions.length < 5) {
          actions.push('');
        }
        
        console.log(`Found ${actions.length} actions for ${criteriaId}`);
        
        // Enhanced extract extraction with better fallbacks
        if (criteriaData.extracts) {
          extracts = criteriaData.extracts;
        } else if (criteriaData.description) {
          extracts = criteriaData.description;
        } else if (criteriaData.summary) {
          extracts = criteriaData.summary;
        } else if (criteriaData.details) {
          extracts = criteriaData.details;
        } else if (criteriaData.excerpt) {
          extracts = criteriaData.excerpt;
        } else if (criteriaData.text) {
          extracts = criteriaData.text;
        } else if (criteriaData.content && typeof criteriaData.content === 'string') {
          extracts = criteriaData.content;
        }
        
        // Convert extracts to string if needed
        if (Array.isArray(extracts)) {
          extracts = extracts.join('\n');
        } else if (typeof extracts !== 'string') {
          extracts = '';
        }
        
        // Add the criteria name (using the exact name from the industry definition)
        rowData.push(criteriaName); // This becomes action_key_X
        
        // Add up to 5 solutions
        for (let j = 0; j < 5; j++) {
          // Add the solution if it exists, or an empty string
          let solution = actions[j] || '';
          
          // Make sure to remove the # prefix if it exists for Excel export
          if (solution.startsWith('# ')) {
            solution = solution.substring(2);
          } else if (solution.startsWith('#')) {
            solution = solution.substring(1);
          }
          
          // Add the cleaned solution to the row
          rowData.push(solution);
          
          console.log(`Added solution ${j+1} for ${criteriaId}: ${solution}`);
        }
      }
      
      // Add carbon footprint data (indicator columns)
      rowData.push('Carbon Footprint'); // indicator_key
      
      // Scope 1
      rowData.push('Scope 1'); // indicator_sub_key_1
      const scope1 = data.carbonFootprint?.scope1 || '';
      rowData.push(scope1); // indicator_sub_key_1_value_1
      rowData.push(''); // indicator_sub_key_1_value_2
      rowData.push(''); // indicator_sub_key_1_value_3
      
      // Scope 2
      rowData.push('Scope 2'); // indicator_sub_key_2
      const scope2 = data.carbonFootprint?.scope2 || '';
      rowData.push(scope2); // indicator_sub_key_2_value_1
      rowData.push(''); // indicator_sub_key_2_value_2
      rowData.push(''); // indicator_sub_key_2_value_3
      
      // Scope 3
      rowData.push('Scope 3'); // indicator_sub_key_3
      const scope3 = data.carbonFootprint?.scope3 || '';
      rowData.push(scope3); // indicator_sub_key_3_value_1
      rowData.push(''); // indicator_sub_key_3_value_2
      rowData.push(''); // indicator_sub_key_3_value_3
      
      // Other achievements and highlights
      rowData.push(data.otherInitiatives || ''); // other_achievements
      
      // Highlights
      rowData.push(data.highlights?.courage || ''); // highlights_courage
      rowData.push(data.highlights?.action || ''); // highlights_action
      rowData.push(data.highlights?.solution || ''); // highlights_solution
      
      // Climate standards
      let climateStandards = '';
      if (data.climateStandards) {
        // Convert climate standards object to string
        const standards = [];
        if (data.climateStandards.iso14001 === 'Yes') standards.push('ISO 14001');
        if (data.climateStandards.iso50001 === 'Yes') standards.push('ISO 50001');
        if (data.climateStandards.emas === 'Yes') standards.push('EMAS');
        if (data.climateStandards.cdp === 'Yes') standards.push('CDP');
        if (data.climateStandards.sbti === 'Yes') standards.push('SBTi');
        climateStandards = standards.join(', ');
      }
      rowData.push(climateStandards); // climate_standards
      
      // Add the row to the sheet
      worksheet.addRow(rowData);
    }
    
    // Format cells and set column widths
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
    
    // Set column widths with special width for extracts columns
    worksheet.columns.forEach((column, index) => {
      if (column.header && column.header.includes('extracts')) {
        column.width = 60;
      } else {
        column.width = 20; // Standard width for other columns
      }
      
      // Set text wrapping
      column.alignment = { wrapText: true };
    });
    
    // Apply text wrapping to all cells
    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber > 1) { // Skip header row
        row.eachCell({ includeEmpty: false }, (cell) => {
          cell.alignment = { wrapText: true, vertical: 'top' };
        });
      }
    });
    
    // Create a summary sheet as well
    const summarySheet = workbook.addWorksheet('Summary', {
      properties: { tabColor: { argb: 'FFC0C0C0' } }
    });
    summarySheet.addRow(['Company ID', 'Company Name', 'Industry', 'URL', 'Report Year', 'Report Title', 'Status']);
    
    // Add a row for each company
    for (const result of successfulResults) {
      const data = result.extractedData;
      const companyId = result.companyId;
      const companyName = data.basicInformation?.companyName || '';
      const reportYear = data.basicInformation?.reportYear || '';
      const reportTitle = data.basicInformation?.reportTitle || '';
      
      summarySheet.addRow([companyId, companyName, result.industry || '', result.url || '', reportYear, reportTitle, 'Extraction Complete']);
    }
    
    // Format the summary sheet
    summarySheet.getRow(1).font = { bold: true };
    summarySheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
    
    // Set column widths appropriately
    summarySheet.columns.forEach((column, index) => {
      if (index === 3) { // URL column
        column.width = 40;
      } else {
        column.width = Math.max(15, Math.min(30, column.header?.length || 15));
      }
      column.alignment = { wrapText: true };
    });
    
    // Make the summary sheet active
    workbook.views = [{ activeTab: 0 }];
    
    // Save the workbook
    await workbook.xlsx.writeFile(exportPath);
    
    console.log(`Exported ${successfulResults.length} companies to Excel: ${exportPath}`);
    
    return { 
      count: successfulResults.length, 
      path: exportPath, 
      success: true 
    };
  } catch (error) {
    console.error(`Error exporting to Excel: ${error.message}`);
    return { 
      count: 0, 
      success: false, 
      error: error.message 
    };
  }
}

/**
 * Export data to all supported formats
 * @param {Array} results - Array of extraction results
 * @returns {Promise<object>} - Export results
 */
export async function exportAllFormats(results) {
  console.log(`Starting export of ${results.length} extraction results`);
  
  // Run exports concurrently
  const [jsonResult, csvResult, excelResult] = await Promise.all([
    exportToJson(results),
    exportToCsv(results),
    exportToExcel(results)
  ]);
  
  return {
    json: jsonResult,
    csv: csvResult,
    excel: excelResult
  };
}