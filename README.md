# Based on a deno template for obsidian plugins

I wanted to have non-redundant contacts in obsidian, thunderbird, and my phone. It's odd to me that these are essentially "about a person" but in no way synced.

This is a VERY simple plugin that syncs your contacts v4 only.
It:
- Takes basic auth username and password, along with server adress, home and resource position for the data (adressbook)
- Downloads the adressbook
- Creates a file for each field in the contact.
- Exceptions are made for "note" and "X-ALIASES" (a custom field) those are mapped to the note body (beneith a `# Note:`) and the note `aliases` frontmatter respectively
- "categroies" is mapped to obsidians "tags" in much the same way
- uploading will first download the EXACT same contact files, find existing files via UID. Update note, x-aliases or categories respectively
- and then push it to the server again



Notes:
- The file is named after the "fn" (full name) field, if its missing an error is thrown. Renaming should change all links that exist in the vault safely.
- ANY field changes are ignored (other than the few mentioned above)
- Downloading into the vault will OVERWRITE ALL CHANGES that are local only
- There are some assumptions about fields and subfields, note that this was only tested with the software mentioned below


Tested with:
- Radicale CardDav v4. I know for a fact some pictures did not parse correctly because of the encoding field, no idea why. most likly due to how my phone did it but i am not sure, i removed the picture.
	- it is necessary to add CORS headers to the radicale configuration (don't add *, add app://obsidian )
- Thunderbird + Cardbook plugin (because default thunderbird does not support labels/categories)
- android phone running /e/os and Davx^5 for syncing
