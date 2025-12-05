// based (distantly) on of:
// https://github.com/Heymdall/vcard/blob/master/lib/vcard.js
//  giving it some type annotations

import {
  cardProp_t,
  CONT_LINE_DELIM,
  LINE_DELIM,
  POSTFIX,
  PREFIX,
  vCard,
} from "./vcard.ts";

/*
NOTE:
https://www.rfc-editor.org/rfc/rfc6350#section-3.3
Property names and parameter names are case-insensitive (e.g., the
property name "fn" is the same as "FN" and "Fn").  Parameter values
MAY be case-sensitive or case-insensitive, depending on their
definition
-> RECOMMENDED: Upper case on output

*/

// Get all indices of every occurnace of the substr
function findAllIndices<T>(arr: T[], elem: T): number[] {
  const ret = [];
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] === elem) {
      ret.push(i);
    }
  }

  return ret;
}

// cleanup any "continued lines"
// https://www.rfc-editor.org/rfc/rfc6350#section-3.2
function mergeContinuedLines(raw: string) {
  /*
A logical line MAY be continued on the next physical line anywhere
between two characters by inserting a CRLF immediately followed by a
single white space character (space (U+0020) or horizontal tab
(U+0009)).  The folded line MUST contain at least one character.  Any
sequence of CRLF followed immediately by a single white space
character is ignored (removed) when processing the content type.
  */
  return raw.replaceAll(CONT_LINE_DELIM, "");
}

/**
 * Count how many entires of VCARDS are inside the raw string
 */
export function countVCardEntries(vCardString: string) {
  if (vCardString.length === 0) {
    return 0;
  }
  const lines = mergeContinuedLines(vCardString).split(LINE_DELIM);
  return lines.filter((line) => line === PREFIX).length;
}

export function rawToVCardLines(vCardString: string): string[][] {
  if (vCardString.length === 0) {
    return [];
  }
  // cleanup any "continued lines"
  // https://www.rfc-editor.org/rfc/rfc6350#section-3.2
  /*
A logical line MAY be continued on the next physical line anywhere
between two characters by inserting a CRLF immediately followed by a
single white space character (space (U+0020) or horizontal tab
(U+0009)).  The folded line MUST contain at least one character.  Any
sequence of CRLF followed immediately by a single white space
character is ignored (removed) when processing the content type.
  */
  const noContinuedLines = vCardString.replaceAll(CONT_LINE_DELIM, "");

  // split all lines, find all starts and stops and put them into subarrays
  const lines = noContinuedLines.split(LINE_DELIM);

  const start_indices = findAllIndices(lines, PREFIX);
  const end_indices = findAllIndices(lines, POSTFIX);

  if (start_indices.length !== end_indices.length) {
    throw new Error("Unequal number of start and end entries in string");
  }

  return start_indices.map((start, index) => {
    return lines.slice(start, end_indices[index] + 1);
  });
}

function parseLine(line: string): cardProp_t {
  const index = line.indexOf(":");

  if (index === -1) {
    throw new Error("Could not parse prop line, no ':' character");
  }
  /*
   * https://www.rfc-editor.org/rfc/rfc6350#section-3.3
   * contentline = [group "."] name *(";" param) ":" value CRLF
   * group = 1*(ALPHA / DIGIT / "-")
   * name = ALPHA / "-"       // There are essentially fixed strings. Upper/Lowercase is not clear so any case and "-". Digits are not listed but there is no harm in allowing them
   * param = language-param / value-param / pref-param / pid-param
   *   / type-param / geo-parameter / tz-parameter / sort-as-param
   *   / calscale-param / any-param
   *
   param-value = *SAFE-CHAR / DQUOTE *QSAFE-CHAR DQUOTE
   */

  const propStr = line.substring(0, index);
  const valStr = line.substring(index + 1);

  // https://regex101.com/r/hmY5rg/1
  const regex = /^([\w]+\.)?([\w\-]+)((;[\w]+=[\w]+)*)$/m;
  const reg = regex.exec(propStr);

  if (!reg) {
    throw new Error("Regex could not parse property string");
  }

  const groupName = reg.at(1)?.slice(0, -1) ?? null;
  const propName = reg.at(2) ?? null; // < -- REQUIRED
  const paramString = reg.at(3) ?? null;

  if (!propName) {
    throw new Error("Propname not found in property part");
  }

  const params =
    paramString?.split(";").filter((part) => part.length > 0).map((part) => {
      const s = part.split("=");
      return { name: s[0], valStr: s[1] };
    }) ?? null;

  parseValueStr(valStr);

  return {
    propName: propName,
    groupName: groupName,
    params: params,
    value: parseValueStr(valStr),
  };
}

// un-escape value commas
// https://www.rfc-editor.org/rfc/rfc6350#section-3.4
function parseValueStr(valueStr: string): cardProp_t["value"] {
  // Match the delimiter when preceded by even number of backslashes (including 0)

  //arravalue
  const regex = /(?<!\\)[,;]/gm;

  const unescapeValue = (str: string) => {
    return str
      .replace(/\\\\/g, "\u0000") // Temporarily store \\
      .replace(/\\[nN]/g, "\n") // Unescape newlines: \n or \N -> actual newline
      .replace(/\\([,;])/g, "$1") // Unescape delimiters: \, and \; -> , and ;
      // deno-lint-ignore no-control-regex
      .replace(/\u0000/g, "\\"); // Restore escaped backslashes: \\ -> \
  };

  const match = regex.exec(valueStr);
  if (match) {
    return {
      listVals: valueStr.split(regex).map(unescapeValue),
      valueListDelim: match.at(0)!,
    };
  }
  return unescapeValue(valueStr);
}

/**
 * Return json representation of vCard
 * @param {string} vCardString raw vCard
 * @returns {vCard[]} All vCards found in file
 */
export function parseVCards(vCardString: string): vCard[] {
  const result = [];
  const allCardLines = rawToVCardLines(vCardString);

  for (const cardLines of allCardLines) {
    // for each card

    // https://www.rfc-editor.org/rfc/rfc6350#section-3.3
    // expected value enforcement
    if (
      cardLines.at(0) !== PREFIX ||
      cardLines.at(1)!.startsWith("VERSION:") === false ||
      cardLines.at(-1) !== POSTFIX
    ) {
      throw new Error(
        "Unexpected lines for fixed properties rfc6350#section-3.3 (BEGIN,VERSION,END)",
      );
    }

    const card = new vCard();

    for (const lineStr of cardLines) {
      // go through all lines
      if (lineStr === PREFIX || lineStr === POSTFIX) {
        continue;
      }

      const property = parseLine(lineStr);

      if (property.propName === "VERSION" && property.value !== "4.0") {
        throw new Error("VERSION did not equal 4.0");
      }

      card.set(property);
    }

    if (!card.get("fn")) {
      throw new Error("fn prop missing in contact");
    }

    result.push(card);
  }
  return result;
}
