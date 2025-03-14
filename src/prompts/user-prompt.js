/**
 * user-prompt.js
 *
 * This module provides user prompts for Claude API interactions.
 */

import { getCriterionDescription } from '../lib/data/criteria-descriptions.js';

/**
 * Create a user prompt for ESG extraction
 * @param {string} documentUrl - URL of the document (PDF or website) to analyze
 * @param {Array} relevantCriteria - Array of relevant criteria for the industry
 * @param {Object} options - Additional options
 * @returns {string} - User prompt
 */
export function createUserPrompt(documentUrl, relevantCriteria, options = {}) {
  const { 
    includeCriteriaDescriptions = true,
    maxActions = 5,
    isBatch = false,
    contentType = 'pdf',
    websiteContent = null
  } = options;
  
  // Format criteria list for the prompt with descriptions and keywords
  const criteriaList = formatCriteriaList(relevantCriteria, includeCriteriaDescriptions);
  
  // Create the criteria structure for the JSON
  const criteriaStructure = createCriteriaStructure(relevantCriteria, maxActions);
  
  // Different intro based on content type
  let promptIntro;
  if (contentType === 'pdf') {
    promptIntro = `Extract ESG information from the sustainability report at URL: ${documentUrl}

IMPORTANT: First read the entire document to understand the company's overall sustainability approach before attempting extraction.`;
  } else {
    promptIntro = `Extract ESG information from the website at URL: ${documentUrl}

The website content has been extracted and is provided below.

IMPORTANT: First read the entire content to understand the company's overall sustainability approach before attempting extraction.`;
    
    // If we have website content, append it to the prompt
    if (websiteContent) {
      promptIntro += `\n\n${websiteContent}`;
    }
  }
  
  return `${promptIntro}
EXTRACTION PROCESS:
  1. First, analyze the entire document comprehensively before extracting data
  2. For each extraction point:
     - Quote the relevant text from the document
     - Explain your reasoning for this extraction
     - Note any ambiguities or missing information
     - Rate your confidence (High/Medium/Low)
  3. Then produce a final JSON output with the exact structure shown below
  
Extract information for EXACTLY the following ${relevantCriteria.length} ESG criteria (no more, no less):
${criteriaList}

Your goal is to extract the following information:
01. Detailed company information:
   - Legal entity name (full legal name of the company)
   - Business description (what the company does)
   - Sector and detailed industry classification
   - Address (street, zip/postal code, city, country)
   - Contact information (phone number, email address, website)
   - Founding year (when the company was established)
   - Employee range (number of employees or range)
   - Revenue range (annual revenue or range)
02. Company name, report year/period, and title
03. Overall sustainability abstract (max 500 characters)
04. Three highlights:
   - Highest entrepreneurial courage (max 400 characters)
   - Most important internal sustainability action (max 400 characters)
   - Most important customer sustainability solution (max 400 characters)
05. Actions and solutions for each criterion - both INTERNAL actions within the company and SOLUTIONS offered to customers that improve sustainability
06. Carbon footprint data (scope 1, 2, 3 and totals) 
07. Climate standards compliance (ISO 14001, EMAS, ISO 50001, CDP, SBTi)
08. Other important sustainability initiatives
09. Any sustainability-related controversies and company responses

EXTRACTION RULES:
1. For company information:
   - Extract EXACTLY as stated in the document
   - Use "Not found" when information is not explicitly provided
   - DO NOT create information not present in the document
   - For addresses, extract separate fields (street, zip, city, country) as found

2. For each criterion, extract:
   - Maximum ${maxActions} concrete actions/solutions
   - List solutions for customers FIRST, followed by internal actions
   - Focus on IMPLEMENTED actions with SPECIFIC DETAILS rather than future plans or general statements
   - Include NUMERICAL VALUES whenever available (e.g., percentages, quantities, timeframes)
   - Include technical specifications when present (e.g., equipment types, material details)
   - Format each action/solution with "# " prefix and keep under 150 characters
   - Maintain original language, terminology, and numerical values from the document

3. For carbon footprint data:
   - Extract scope 1, 2, 3 and total emissions for each year mentioned (2022-2024)
   - Use consistent format: "x.xxx t CO2e" for all values
   - If emissions are reported in other units, convert them if conversion factor is provided
   - If emissions are not reported for certain scopes or years, use empty strings
   - If no emissions data is found at all, set all values to empty strings

4. For standards compliance:
   - Mark as "Yes" ONLY if the document explicitly states current certification
   - Mark as "In progress" if working toward certification
   - Mark as "No" or leave empty if not mentioned
   - Include certification date/year when available

5. For highlights:
   - Choose initiatives with SPECIFIC IMPACTS over general commitments
   - Select initiatives with NUMERICAL RESULTS when available
   - For courage: select most innovative or challenging initiative
   - For action: select initiative with largest reported internal impact
   - For solution: select customer-facing solution with most substantial impact

HALLUCINATION PREVENTION:
1. ONLY include information EXPLICITLY stated in the document
2. DO NOT infer, assume, or create information not directly present
3. Use phrases directly from the document whenever possible
4. When information is absent, use "Not found" or "Not stated" rather than creating placeholder content
5. If data seems contradictory within the document, note the discrepancy rather than resolving it
6. For actions, prioritize SPECIFICITY over quantity - it's better to have fewer detailed actions than many vague ones
7. Distinguish between IMPLEMENTED actions and PLANNED initiatives
8. If the source doesn't provide sufficient information for a criterion, include an action stating: "# No specific actions found for [CRITERION NAME]"
9. If the source mentions a program name without details, state: "# [Program Name] mentioned but no specific details provided"

Format your response as a JSON object with this structure:
{
  "companyDetails": {
    "legalEntityName": "Full legal name of the company",
    "businessDescription": "Description of the company's business",
    "sector": "Main sector",
    "address": {
      "street": "Street address",
      "zipCode": "Postal/zip code",
      "city": "City",
      "country": "Country"
    },
    "contactInfo": {
      "phoneNumber": "Company phone number",
      "emailAddress": "Company email",
      "website": "Company website"
    },
    "foundingYear": "Year the company was founded",
    "employeeRange": "Number of employees or range",
    "revenueRange": "Annual revenue or range"
  },
  "basicInformation": {
    "companyName": "Name",
    "reportYear": "Year",
    "reportTitle": "Title"
  },
  "abstract": "Summary of business and sustainability strategy (max 500 characters)",
  "highlights": {
    "courage": "Most courageous sustainability initiative showing entrepreneurial courage (max 400 characters)",
    "action": "Most important internal sustainability action with biggest progress (max 400 characters)",
    "solution": "Most important customer sustainability solution with biggest impact (max 400 characters)"
  },
${criteriaStructure},
  "carbonFootprint": {
    "scope1_2022": "x.xxx t CO2e",
    "scope2_2022": "x.xxx t CO2e",
    "scope3_2022": "x.xxx t CO2e",
    "total_2022": "x.xxx t CO2e",
    "scope1_2023": "x.xxx t CO2e",
    "scope2_2023": "x.xxx t CO2e",
    "scope3_2023": "x.xxx t CO2e",
    "total_2023": "x.xxx t CO2e",
    "scope1_2024": "x.xxx t CO2e",
    "scope2_2024": "x.xxx t CO2e",
    "scope3_2024": "x.xxx t CO2e",
    "total_2024": "x.xxx t CO2e"
  },
  "climateStandards": {
    "iso14001": "Yes/No",
    "iso50001": "Yes/No",
    "emas": "Yes/No",
    "cdp": "Yes/No",
    "sbti": "Yes/No"
  },
  "otherInitiatives": "Other important sustainability initiatives not covered by criteria (max 1000 chars)",
  "controversies": "Any sustainability-related controversies in the last five years and company responses (max 1000 chars)"
}

FINAL VERIFICATION:
Before submitting, verify that:
1. You've included ONLY information explicitly stated in the document
2. Your output contains NO hallucinated or inferred information
3. All actions/solutions are formatted correctly with "#" prefix
4. You've addressed all ${relevantCriteria.length} required criteria
5. Your output is valid, parseable JSON without any text before or after
6. You've preserved the original language of the document (German or English)
7. You've used exactly the same field structure as shown above

Your response MUST be valid JSON that can be parsed with JSON.parse() - no additional text, no markdown formatting, no code blocks.`;
}

/**
 * Format a list of criteria for the prompt
 * @param {Array} criteria - Array of criteria objects
 * @param {boolean} includeDescriptions - Whether to include descriptions
 * @returns {string} - Formatted criteria list
 */
function formatCriteriaList(criteria, includeDescriptions = false) {
  return criteria.map(criterion => {
    const description = getCriterionDescription(criterion.id);
    let item = `- ${criterion.id}: ${criterion.name_en}`;
    
    if (includeDescriptions && description) {
      item += `\n  Description: ${description.description}`;
      item += `\n  Typical keywords: ${description.keywords.join(', ')}`;
    }
    
    return item;
  }).join('\n\n');
}

/**
 * Create criteria structure for JSON example
 * @param {Array} criteria - Array of criteria objects
 * @param {number} maxActions - Maximum number of actions per criterion
 * @returns {string} - Formatted criteria structure
 */
function createCriteriaStructure(criteria, maxActions = 5) {
  return criteria.map(criterion => {
    // Example actions based on the Baufritz examples
    const exampleActions = [
      '"# Zentraler Baustoff der Voll-Werte-Häuser ist Holz: 100 % nachwachsender Rohstoff aus nachhaltig bewirtschafteten Wäldern"',
      '"# Bezug zu 100 % von kleinen/mittelständischen Betrieben aus Bayern, Baden Württemberg, Österreich, 80 % mit PEFC-/FSC-Zertifikaten"',
      '"# Bauelemente (Fenster/Türen/Treppen) ausschließlich von regionalen, mittelständischen Betrieben im Umkreis von 5 - 50 km"',
      '"# Reduktion der Temperatur in allen Fertigungshallen von 18–20°C um 4°C"',
      '"# Umstellung auf LED-Leuchtmittel im Betriebsurlaub Sommer 2023"',
      '"# Eigenstromproduktion von über 500.000 Kilowattstunden jährlich"',
      '"# 100% Ökostrom und Ökogas von Polarstern, Umstieg auf CO2-neutrales Propangas"',
      '"# 750 Tonnen CO2-Einsparung/Senke pro Jahr"'
    ];
    
    // Take the first maxActions example actions or all if less than maxActions
    const actionList = exampleActions.slice(0, maxActions).join(', ');
    
    // Format criterion structure with actions as direct array
    return `  "${criterion.id}": {
    "actions": [
      ${actionList}
    ]
  }`;
  }).join(',\n');
}

export default {
  createUserPrompt
};