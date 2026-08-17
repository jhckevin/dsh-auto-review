import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { getGuardianPolicySections, guardianPolicyOutline, searchGuardianPolicy } from './policy-corpus.ts'

const OUTPUT = {
  schema: { type: 'string' as const },
  render: (_args: unknown, value: string) => [{ type: 'text' as const, text: value }],
}

export function installReviewerPolicyTools(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'guardian_policy_outline',
    description: 'List ids and headings from the immutable canonical Guardian security policy. Use this to discover which exact policy sections may govern the planned action.',
    parameters: {},
    output: OUTPUT,
    execute: () => Promise.resolve(JSON.stringify({ sections: guardianPolicyOutline() })),
    presentCall: () => ({ card: 'generic', title: 'Inspect security policy outline', kind: 'read' }),
  }))
  ctx.tools.register(defineTool({
    name: 'guardian_policy_search',
    description: 'Search the immutable canonical Guardian security policy. Returns bounded ranked snippets and section ids; retrieve decisive sections with guardian_policy_get.',
    parameters: {
      query: { type: 'string', required: true, description: 'Concrete risk concept, side effect, data flow, or action category.' },
      limit: { type: 'number', description: 'Number of matches, 1 through 8. Default 6.' },
    },
    output: OUTPUT,
    execute: args => Promise.resolve(JSON.stringify({ hits: searchGuardianPolicy(args.query, args.limit ?? 6) })),
    presentCall: args => ({ card: 'generic', title: 'Search security policy', kind: 'read', rawInput: args.query }),
  }))
  ctx.tools.register(defineTool({
    name: 'guardian_policy_get',
    description: 'Retrieve the exact immutable text of 1 to 8 canonical Guardian policy sections by ids returned from outline or search. Total response is capped at 24 KiB.',
    parameters: {
      section_ids: { type: 'array', required: true, items: { type: 'string' }, description: 'Exact canonical policy section ids.' },
    },
    output: OUTPUT,
    execute: args => Promise.resolve(JSON.stringify({ sections: getGuardianPolicySections(args.section_ids) })),
    presentCall: args => ({ card: 'generic', title: 'Read security policy sections', kind: 'read', rawInput: args.section_ids }),
  }))
}
