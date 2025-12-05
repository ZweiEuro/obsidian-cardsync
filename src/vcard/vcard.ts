export const PREFIX = "BEGIN:VCARD";
export const POSTFIX = "END:VCARD";

export const LINE_DELIM = "\r\n"; // https://www.rfc-editor.org/rfc/rfc6350#section-3.2

// continued line delim (space at end)
export const CONT_LINE_DELIM = "\r\n "; // https://www.rfc-editor.org/rfc/rfc6350#section-3.2

export type cardProp_t = {
  propName: string;
  groupName: string | null;
  params: {
    name: string;
    valStr: string;
  }[] | null;
  value: string | {
    listVals: string[];
    valueListDelim: null | string; // either ; or ,
  };
};

export function repr(cardProp: cardProp_t) {
  let ret = "";

  if (cardProp.groupName) {
    ret += `${cardProp.groupName}.`;
  }

  ret += cardProp.propName;

  if (cardProp.params && cardProp.params.length > 0) {
    ret += cardProp.params.map((p) => `;${p.name}=${p.valStr}`).join("");
  }
  ret += ":";

  const escapeValue = (val: string) => {
    return val
      .replace(/\\/g, "\\\\") // Escape backslashes first: \ → \\
      .replace(/\n/g, "\\n") // Escape newlines: newline → \n (lowercase by convention)
      .replace(/([,;])/g, "\\$1"); // Escape delimiters: , and ; → \, and \;
  };

  let escapedString = "";

  if (typeof cardProp.value === "string") {
    escapedString += escapeValue(cardProp.value);
  } else {
    if (!cardProp.value.valueListDelim) {
      console.warn("Missing delimiter for list value, choosing ','");
      cardProp.value.valueListDelim = ",";
    }

    escapedString += cardProp.value.listVals
      .map((v) => escapeValue(v))
      .join(cardProp.value.valueListDelim);
  }

  ret += escapedString.replace(/([\w\W]{75})/g, `$1${CONT_LINE_DELIM}`);

  return ret + LINE_DELIM;
}

export class vCard {
  private data: Map<string, cardProp_t> = new Map();

  public set(prop: cardProp_t) {
    prop.propName = prop.propName.toUpperCase();
    this.data.set(prop.propName, prop);
  }

  public get(key: string) {
    return this.data.get(key.toUpperCase()) ?? null;
  }

  public repr() {
    if (!this.get("fn") || !this.get("version")) {
      throw new Error("vCard must have version and fn field");
    }

    let ret = PREFIX + LINE_DELIM;

    ret += repr(this.get("version")!);

    for (const [key, val] of this.data) {
      if (key === "VERSION") continue;

      ret += repr(val);
    }

    return ret + POSTFIX + LINE_DELIM;
  }
}

export function reprList(cards: vCard[]) {
  return cards.map((c) => c.repr()).join("");
}
