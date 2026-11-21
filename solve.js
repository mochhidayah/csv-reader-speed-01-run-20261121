// solve.js — a fast drop-in for csv-reader 1.0.0 (make.fun).
// Same answers on every input, less CPU: an index-driven scanner with a
// fast path for records without quotes. Dependency-free ES module.
//
// run(input) takes {text, header} and returns {columns, rows, errors}:
// the header (or null), every other record as an array of strings at the
// first record's width, and every broken thing met, in the order met.
//
// Reading policy (csv-reader 1.0.0): a U+FEFF at the very start is dropped;
// a record ends at LF or CRLF, and a line left with no characters is no
// record; outside quotes a CR not followed by LF is dropped (stray_cr); a
// field that opens with a quote runs to the next quote that is not doubled
// ("" inside it is one quote, each CRLF or lone CR inside it reads as LF);
// what follows its closing quote up to the next comma or line break is
// appended as it stands (quote_junk, when the field ends); a quote that
// never closes is a literal character and the text after it is read again
// as unquoted (unterminated_quote); a quote inside an unquoted field is a
// literal character. Fields stay strings, never trimmed or converted.
// columns is the first record when header is true, else null; rows holds
// the records after it, each padded with "" (short_row, with fields: its
// field count) or cut (long_row, with extra: the cut fields) to the first
// record's width. Each error is {code, line, row}: line the 1-based line
// its record starts on (every LF, CRLF and lone CR inside a quoted field
// counted), row its record's index in rows (null for the header).

const COMMA = 0;
const BREAK = 1;
const END = 2;

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const n = text.length;
  let pos = n > 0 && text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let line = 1;

  // The record being read: the line it starts on, and the index in rows
  // it takes (null for the header). Read by unquoted() below.
  let recordLine = 1;
  let recordRow = null;

  // What the last unquoted() call returned, besides its value: how the
  // field ended, and how many characters the scan itself kept (stray CRs
  // dropped along the way do not count).
  let uEnded = END;
  let uKept = 0;

  // Scans one unquoted field starting at `start`, with `prefix` already
  // read as its beginning, and returns its value. The field ends at the
  // nearest comma or LF (indexOf, never a character loop); a CR right
  // before that LF is the CRLF ending, and any other CR inside the
  // field's slice is a stray one: one stray_cr error each, then dropped
  // all at once. Advances pos past the field and its ending, counts the
  // line break, and reports the ending and the kept count in uEnded and
  // uKept.
  function unquoted(start, prefix) {
    const cIdx = text.indexOf(",", start);
    const nIdx = text.indexOf("\n", start);
    let end;
    let kind;
    if (nIdx !== -1 && (cIdx === -1 || nIdx < cIdx)) {
      kind = BREAK;
      end = nIdx;
      if (end > start && text.charCodeAt(end - 1) === 13) end -= 1;
      pos = nIdx + 1;
      line += 1;
    } else if (cIdx !== -1) {
      kind = COMMA;
      end = cIdx;
      pos = cIdx + 1;
    } else {
      kind = END;
      end = n;
      pos = n;
    }
    let value = prefix;
    if (end > start) {
      const seg = text.slice(start, end);
      const r = seg.indexOf("\r");
      if (r === -1) {
        value += seg;
        uKept = end - start;
      } else {
        let cnt = 0;
        let k = -1;
        while ((k = seg.indexOf("\r", k + 1)) !== -1) cnt += 1;
        for (let j = 0; j < cnt; j++) {
          errors.push({ code: "stray_cr", line: recordLine, row: recordRow });
        }
        value += seg.replaceAll("\r", "");
        uKept = end - start - cnt;
      }
    } else uKept = 0;
    uEnded = kind;
    return value;
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else break;
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    // Fast path: this line's segment (up to its LF) holds no quote, so
    // the whole record is unquoted fields and ends at that LF. A quote
    // anywhere before the LF sends the record to the slow path instead.
    // The segment is sliced once and every check runs on that slice, so
    // no search ever runs past the line's end.
    const nl = text.indexOf("\n", pos);
    const segEnd = nl === -1 ? n : nl;
    let end = segEnd;
    if (nl !== -1 && end > pos && text.charCodeAt(end - 1) === 13) end -= 1;
    const seg = text.slice(pos, end);
    if (seg.indexOf('"') === -1) {
      const r = seg.indexOf("\r");
      let fields;
      if (r === -1) {
        fields = seg.split(",");
      } else {
        // Stray CRs only here (the CRLF one, if any, was stripped
        // above): one error each, then drop them all at once.
        let s = seg;
        let k = -1;
        let cnt = 0;
        while ((k = s.indexOf("\r", k + 1)) !== -1) cnt += 1;
        for (let j = 0; j < cnt; j++) {
          errors.push({ code: "stray_cr", line: recordLine, row: recordRow });
        }
        if (cnt > 0) s = s.replaceAll("\r", "");
        fields = s.split(",");
      }
      if (nl !== -1) {
        pos = nl + 1;
        line += 1;
      } else pos = n;
      // A line that held only stray CRs is left with no characters.
      if (fields.length === 1 && fields[0] === "") continue;
      if (width < 0) width = fields.length;
      if (header && columns === null) {
        columns = fields;
        continue;
      }
      if (fields.length < width) {
        errors.push({ code: "short_row", line: recordLine, row: recordRow, fields: fields.length });
        while (fields.length < width) fields.push("");
      } else if (fields.length > width) {
        errors.push({ code: "long_row", line: recordLine, row: recordRow, extra: fields.splice(width) });
      }
      rows.push(fields);
      continue;
    }

    // Slow path: the record holds a quote somewhere, so read it field
    // by field. A quoted field is found with indexOf, its content taken
    // with one slice (transformed only when it holds "" or a CR); an
    // unquoted field is scanned for its ending, then sliced once.
    const fields = [];
    let ended = END;
    let quoted = false;
    for (;;) {
      if (pos >= n) {
        fields.push("");
        ended = END;
        quoted = false;
        break;
      }
      if (text.charCodeAt(pos) === 34) {
        quoted = true;
        const open = pos;
        const openLine = line;
        let qq = text.indexOf('"', pos + 1);
        let doubled = false;
        while (qq !== -1 && text.charCodeAt(qq + 1) === 34) {
          doubled = true;
          qq = text.indexOf('"', qq + 2);
        }
        if (qq === -1) {
          // The quote never closes: it is a literal character, and the
          // text after it is read again as unquoted.
          errors.push({ code: "unterminated_quote", line: recordLine, row: recordRow });
          pos = open + 1;
          line = openLine;
          const f = unquoted(pos, '"');
          fields.push(f);
          ended = uEnded;
          if (ended !== COMMA) break;
          continue;
        }
        const content = text.slice(open + 1, qq);
        // Count the line breaks inside the quotes: every LF, plus every
        // CR not followed by LF (a CRLF counts once, through its LF).
        // Both searches are native indexOf on the short slice, never a
        // character loop.
        let breaks = 0;
        let hasCR = false;
        let ni = content.indexOf("\n");
        while (ni !== -1) {
          breaks += 1;
          ni = content.indexOf("\n", ni + 1);
        }
        let ri = content.indexOf("\r");
        if (ri !== -1) {
          hasCR = true;
          do {
            if (content.charCodeAt(ri + 1) !== 10) breaks += 1;
            ri = content.indexOf("\r", ri + 1);
          } while (ri !== -1);
        }
        line += breaks;
        let value = content;
        if (hasCR) value = value.replace(/\r\n?/g, "\n");
        if (doubled) value = value.replaceAll('""', '"');
        pos = qq + 1;
        if (pos >= n) {
          fields.push(value);
          ended = END;
          break;
        }
        const c = text.charCodeAt(pos);
        if (c === 44) {
          pos += 1;
          fields.push(value);
          ended = COMMA;
        } else if (c === 10) {
          pos += 1;
          line += 1;
          fields.push(value);
          ended = BREAK;
        } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
          pos += 2;
          line += 1;
          fields.push(value);
          ended = BREAK;
        } else {
          // What follows the closing quote is appended as it stands,
          // up to the next comma or line break.
          const f = unquoted(pos, value);
          if (uKept > 0) errors.push({ code: "quote_junk", line: recordLine, row: recordRow });
          fields.push(f);
          ended = uEnded;
        }
        if (ended !== COMMA) break;
      } else {
        quoted = false;
        const f = unquoted(pos, "");
        fields.push(f);
        ended = uEnded;
        if (ended !== COMMA) break;
      }
    }

    // A line that held only stray CRs is left with no characters.
    if (fields.length === 1 && fields[0] === "" && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: "short_row", line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push("");
    } else if (fields.length > width) {
      errors.push({ code: "long_row", line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  return { columns: header ? (columns ?? []) : null, rows, errors };
}
