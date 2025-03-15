# ESG-Claude Industry-Specific Prompts

This feature allows you to use specialized prompts tailored for specific industries when extracting ESG data from sustainability reports.

## How Industry-Specific Prompts Work

1. Custom prompts are defined in files at the root of the project directory.
2. Each industry has its own specialized prompt file.
3. During extraction, the system will automatically use the industry-specific prompt if available.

## Available Industry-Specific Prompts

- **Construction Industry**: `construction-industry-prompt.txt`
  - Specialized for construction companies with focus on sustainable building practices, materials, and construction operations.

## How to Use Industry-Specific Prompts

1. In your `company_urls.csv` file, make sure to set the `industry` column to the appropriate industry name:

```
name,url,industry,shouldUpdate
acme_construction,https://example.com/sustainability-report.pdf,construction,true
```

The industry identifier must match exactly one of the keys in the `industryPromptPaths` object in `src/lib/data/industry-prompts.js`. For example, `construction` (all lowercase) is the correct identifier for construction companies.

2. When running the extraction, the system will automatically detect that the company belongs to the construction industry and will use the specialized prompt.

3. The output will be automatically mapped from the industry-specific format to the standard JSON format expected by the rest of the application.

## Creating New Industry-Specific Prompts

To create a prompt for a new industry:

1. Create a new text file at the root of the project with a descriptive name (e.g., `automotive-industry-prompt.txt`).

2. Follow the template provided in existing industry prompts, customizing the criteria and key words to match the industry's specific sustainability aspects.

3. Register the new industry prompt in `src/lib/data/industry-prompts.js` by adding it to the `industryPromptPaths` object:

```javascript
const industryPromptPaths = {
  'construction': 'construction-industry-prompt.txt',
  'automotive': 'automotive-industry-prompt.txt',
  // Add other industry-specific prompts here
};
```

4. Make sure the companies in your `company_urls.csv` file have the correct industry identifier in the `industry` column.

## Important Notes

- The industry-specific prompts use XML output format instead of JSON, but this is automatically converted to the expected JSON structure.
- The PDF URL is automatically injected into the prompt, replacing the "The PDF is attached" line.
- Always test new industry prompts thoroughly before using them in production.