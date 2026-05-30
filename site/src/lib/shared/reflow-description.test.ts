import { describe, it, expect } from 'vitest';
import { reflowDescription } from './reflow-description';

describe('reflowDescription', () => {
  it('turns indented (newline-preserved) bullets into a markdown list', () => {
    // H002-style: YAML kept the newlines + indentation for more-indented items.
    const stored = 'Create two tables:\n   - Code (Code[10])\n   - Name (Text[50])';
    const out = reflowDescription(stored);
    expect(out).toContain('\n- Code (Code[10])');
    expect(out).toContain('\n- Name (Text[50])');
    // A blank line precedes the list so marked parses it as a list.
    expect(out).toMatch(/Create two tables:\n\n- Code/);
  });

  it('turns indented numbered items into a markdown ordered list', () => {
    const stored = 'Demonstrate continue:\n1. SumPositiveNumbers\n2. CountValidCodes';
    const out = reflowDescription(stored);
    expect(out).toMatch(/Demonstrate continue:\n\n1\. SumPositiveNumbers/);
    expect(out).toContain('2. CountValidCodes');
  });

  it('does NOT split single-space prose hyphens (no false lists)', () => {
    // E005-style fully-flat-folded: single-space dashes are ambiguous with
    // prose ("Text - capitalizes"), so they must be left untouched.
    const stored =
      'public procedures: - CapitalizeFirstLetter(InputText: Text): Text - capitalizes the first letter - CountWords(InputText: Text): Integer - counts words';
    const out = reflowDescription(stored);
    // Unchanged: no newline-bullets introduced.
    expect(out).not.toContain('\n- ');
    expect(out).toBe(stored);
  });

  it('preserves a genuine prose hyphen even next to a real list', () => {
    // "(Decimal, FlowField) - sums" is prose (single space) and must survive,
    // while the indented "- Code" becomes a list item.
    const stored =
      'fields:\n   - "Total Qty" (Decimal, FlowField) - sums Quantity\n   - Name (Text[50])';
    const out = reflowDescription(stored);
    expect(out).toContain('"Total Qty" (Decimal, FlowField) - sums Quantity');
    expect(out).toContain('\n- "Total Qty"');
    expect(out).toContain('\n- Name (Text[50])');
  });

  it('returns empty/falsy input unchanged', () => {
    expect(reflowDescription('')).toBe('');
  });

  it('leaves a plain paragraph untouched', () => {
    const stored = 'Create a codeunit that validates input and returns a boolean.';
    expect(reflowDescription(stored)).toBe(stored);
  });
});
