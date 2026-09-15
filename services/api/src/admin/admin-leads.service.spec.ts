import { describe, it, expect } from 'vitest';
import { csvCell } from './admin-leads.service';

describe('csvCell', () => {
  it('passes ordinary values through unquoted', () => {
    expect(csvCell('someone@example.com')).toBe('someone@example.com');
    expect(csvCell('')).toBe('');
  });

  it('quotes and doubles embedded quotes', () => {
    expect(csvCell('a "quoted" value')).toBe('"a ""quoted"" value"');
  });

  it('quotes values containing a comma or newline', () => {
    expect(csvCell('Sahu, Krishn')).toBe('"Sahu, Krishn"');
    expect(csvCell('line1\r\nline2')).toBe('"line1\r\nline2"');
  });

  /**
   * CSV injection. A cell beginning =, +, - or @ is executed as a FORMULA when
   * the file is opened in Excel or Sheets. Every value in this export is
   * attacker-supplied by definition — anyone can type anything into the signup
   * form — so the guard is not theoretical.
   */
  describe('neutralises formula injection', () => {
    for (const payload of [
      '=cmd|\'/c calc\'!A1',
      '+1+1',
      '-2+3',
      '@SUM(A1:A9)',
      '\tSUM(1)',
    ]) {
      it(JSON.stringify(payload), () => {
        const out = csvCell(payload);
        expect(out.startsWith('"')).toBe(true);
        // A leading apostrophe makes the spreadsheet treat it as text.
        expect(out.slice(1, 2)).toBe("'");
        expect(out).toContain(payload.replace(/"/g, '""'));
      });
    }
  });

  it('does not mangle an address that merely CONTAINS an @', () => {
    expect(csvCell('a@b.com')).toBe('a@b.com');
  });

  it('handles null and undefined without throwing', () => {
    expect(csvCell(null as unknown as string)).toBe('');
    expect(csvCell(undefined as unknown as string)).toBe('');
  });
});
