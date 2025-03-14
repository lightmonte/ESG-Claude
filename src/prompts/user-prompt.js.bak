/**
 * user-prompt.js
 *
 * This module provides user prompts for Claude API interactions.
 */

import { getCriterionDescription } from '../lib/data/criteria-descriptions.js';

/**
 * Create a user prompt for ESG extraction
 * @param {string} pdfUrl - URL of the PDF to analyze
 * @param {Array} relevantCriteria - Array of relevant criteria for the industry
 * @param {Object} options - Additional options
 * @returns {string} - User prompt
 */
export function createUserPrompt(pdfUrl, relevantCriteria, options = {}) {
  const { 
    includeCriteriaDescriptions = true,
    maxActions = 5,
    isBatch = false
  } = options;
  
  // Format criteria list for the prompt
  const criteriaList = formatCriteriaList(relevantCriteria, includeCriteriaDescriptions);
  
  // Create the criteria structure for the JSON example
  const criteriaStructure = createCriteriaStructure(relevantCriteria, maxActions);
  
  return `Extract ESG information from the sustainability report at URL: ${pdfUrl}

Extract information for EXACTLY the following ${relevantCriteria.length} ESG criteria (no more, no less):
${criteriaList}

Also extract the following basic information:
- Company name
- Report year/period 
- Report title

For each criterion above, extract:
-Maximum ${maxActions} concrete actions/solutions the company is taking, including any supporting numbers 
-For each action/solution, identify relevant direct text excerpts from the document that support it
 
Format your response as a JSON object with this structure:
{
  "basicInformation": {
    "companyName": "Name",
    "reportYear": "Year",
    "reportTitle": "Title"
  },
${criteriaStructure}
}

FORMATTING REQUIREMENTS (CRITICAL):
1. Include EXACTLY the ${relevantCriteria.length} criteria listed above with their exact IDs as shown - do not add or remove any criteria
2. Include a MAXIMUM of ${maxActions} actions/solutions per criterion (less if fewer are mentioned in the document). These should be the TOP actions of the company in this criterion.
3. Keep each action under 150 characters
4. Rank actions by importance
5. For the "extracts" field, include direct quotes from the document that supports the actions

CONTENT REQUIREMENTS:
1. YOUR RESPONSE MUST INCLUDE ALL ${relevantCriteria.length} CRITERIA LISTED ABOVE WITH THEIR EXACT IDs, even if there's limited or no information for some criteria
2. For criteria with no information, include an action with "# No specific actions found for [CRITERION NAME]" and note "No relevant information found in the report for [CRITERION NAME]" in extracts
3. Include ONLY information explicitly stated in the document
4. Generate the results in the PDF's original language (German or English) - don't translate.
5. List actions/solutions by importance (customer solutions first, then internal actions)
6. Use original wording from the report where possible
7. For carbon emissions, use #.### t CO2e format (calculate if needed)
8. When a data point does not exist in the report, say "Not stated" in the extracts field

Your response MUST be valid JSON that can be parsed with JSON.parse().`;
}

/**
 * Format a list of criteria for the prompt
 * @param {Array} criteria - Array of criteria objects
 * @param {boolean} includeDescriptions - Whether to include descriptions
 * @returns {string} - Formatted criteria list
 */
function formatCriteriaList(criteria, includeDescriptions = false) {
  return criteria.map(criterion => {
    let item = `- ${criterion.id}: ${criterion.name_en}`;
    
    if (includeDescriptions) {
      const description = getCriterionDescription(criterion.id);
      if (description) {
        item += `\n  Description: ${description.description}`;
      }
    }
    
    return item;
  }).join('\n');
}

/**
 * Create criteria structure for JSON example
 * @param {Array} criteria - Array of criteria objects
 * @param {number} maxActions - Maximum number of actions per criterion
 * @returns {string} - Formatted criteria structure
 */
function createCriteriaStructure(criteria, maxActions = 5) {
  return criteria.map(criterion => {
    // Create example actions
    const exampleActions = Array.from({ length: maxActions }, (_, i) => `"# Action ${i + 1}"`).join(', ');
    
    return `  "${criterion.id}": {
    "actions": [
      ${exampleActions}
    ],
    "extracts": "Key supporting evidence from the document for the actions listed above."
  }`;
  }).join(',\n');
}

export default {
  createUserPrompt
};