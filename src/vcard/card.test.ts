import { assertEquals } from "jsr:@std/assert";
import { countVCardEntries, parseVCards, rawToVCardLines } from "./card.ts";
import { reprList } from "./vcard.ts";

const decoder = new TextDecoder("utf-8");

const addr_book = decoder.decode(
  await Deno.readFile("src/vcard/testbook.vcf"),
);
const single_contact = decoder.decode(
  await Deno.readFile("src/vcard/single_contact.vcf"),
);

Deno.test("Check amount of cards in strings", () => {
  assertEquals(countVCardEntries(addr_book), 2);
  assertEquals(countVCardEntries(single_contact), 1);
});

Deno.test("Check number of lines are correct per entry", () => {
  const book = rawToVCardLines(addr_book);
  assertEquals(book.at(0)?.length, 7);
  assertEquals(book.at(1)?.length, 13);

  const single = rawToVCardLines(single_contact);
  assertEquals(single.at(0)?.length, 11);
});

Deno.test("Parse single contact and check contents", () => {
  const cards = parseVCards(single_contact);

  assertEquals(cards.length, 1);
  const card = cards.at(0)!;

  assertEquals(card.repr(), single_contact);
});

Deno.test("Check that everything has 'expected' values", () => {
  const cards = parseVCards(addr_book);

  assertEquals(cards.length, 2);
  const card = cards.at(0)!;
  const noteval =
    "special value test:\n< > : @ ? ~ { } + _ ) ( * & ^ % $ £ \" !\n[ ] \\; ' # , . / = - ` ¬ |\nLeading space:\n here\nmanual backslash n: \\n";

  assertEquals(card.get("note")!.value as string, noteval);
});

Deno.test("Adress book round trip", () => {
  const cards = parseVCards(addr_book);
  const actualRawLines = rawToVCardLines(addr_book);

  const ourRawLines = rawToVCardLines(reprList(cards));

  assertEquals(cards.length, 2);

  // compare the entire addrbook line for line
  for (let cardIndex = 0; cardIndex < cards.length; cardIndex++) {
    assertEquals(
      actualRawLines[cardIndex].length,
      ourRawLines[cardIndex].length,
    );

    for (
      let lineIndex = 0;
      lineIndex < actualRawLines[cardIndex].length;
      lineIndex++
    ) {
      assertEquals(ourRawLines[lineIndex], actualRawLines[lineIndex]);
    }
  }
});
