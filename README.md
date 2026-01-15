# obsidian card sync

A simple vCard DAV compatible sync tool from obsidian to/from a carddav compatible server.

This is my own project, while I didn't once accidentally delete any data, it is theoretically possible to lose something from inside the contact when changes when syncing. Use at your own risk.

## Internals

To serialize and deserialize the actual data from dav I use [tsDav](https://tsdav.vercel.app/) which is a treat to work with.
TsDav gives you the raw data of a contact, to parse it into individual fields I am using my own plugin [davParse](https://codeberg.org/ZweiEuro/davparse). 
There are other plugins but they all had some kind of restriction or specific usage pattern that clashed with what I needed: A simple map-based key-value pair system with some intelligence for property parameters and parsing for lists.


## What is this plugin?

I wanted to have non-redundant contacts in obsidian, thunderbird, and my phone. It's odd to me that these are essentially "about a person" but in no way synced.

This is a plugin that syncs your contacts.
It:
- Takes basic auth username and password, along with server adress, home and resource position for the data (adressbook)
- Downloads the adressbook
- Creates a file for each field in the contact.
- Each contact is identified by fontmatter `UID` and gets the filename `${FN}.md`. If FN changes, then a link-aware-move is performed. (All existing links to the old name should change as expected.)
- Some remapping occures of card props <-> obsidian:
	- NOTE -> obsidian note body
	- X-ALIASES (custom field) -> `aliases` fontmatter
	- CATEGORIES -> `tags` fontmatter
	- The `vcf` url is saved in the fontmatter as `OBS_SYNC_URL` to synchronize any changes
	- PHOTO -> becomes a file named `${FN}_photo.${ending}` and places it in the same folder as the contacts. The contact gets an attribute `photo: [[${photo_filename}]]`.
- In order to avoid accidental data-loss, the plugin _does not_ fetch the adressbook "on startup". But if `modify on write` is enabled it will work as described. 
  This has the consequence that "new" contacts are not in the folder as they don't have a file yet. In such a case you need to manually sync.


## Usage and edge cases:

### Usage
Enter all the data into the settings block, choose a folder location where all your contacts will be placed. 
"Validate" will attempt to fetch the addressbook, this just verifies the entered information. 
"Sync" in the settings has the same functionality as the "sync" button added to the ribbon (left side menu of obsidian), it fetches the _entire_ adressbook and overwrites all local files with their content.
"Upload on modify" makes the plugin listen for any file changes. It then uses the `OBS_SYNC_URL` to update``



### edge cases
- The field "N" is usually an array of strings depicting the different name fields of a contact. The [rfc standard](https://www.rfc-editor.org/rfc/rfc6350) states that "any array may have ';' or ',' as a delimintor".
  While that may be true on paper, Thunderbird seems to expect this field to be ';' seperated, therefore there is a special case for serializing the array value of N with ';'. All other arrays are serialized with ','.
- Syncing manually (down) overwrites ALL local changes.
- The only wayto "sync up" is on-write and _requires_ the SYNC url. Deleting or changing the URL manually will most likly make it fail.
- 


## Potential improvements

Syncing:
The "does not sync on startup" fact can definitely improved, but all the solutions I came up with had some other footgun or caveat or where somewhat opinionated. 
Personally I'd rather not implement something that is a half measure, of you can come up with a good idea of how this may be improved open an issue. Simplest solution is adding a setting to "sync down on startup" but I relented since I, often,
make changes offline. If I restart obsidian online then the sync would overwrite my local changes. 
Theoretically I could always "sync up" first and check for diffs but I am avoiding that chunk of code since there is no "easy" way to look for diffs without checking the entire file and all content (which is possible) using the `davParse` module.

Photos:
I definitely am not 100% happy with my photo solution. Yes it works but only for the cases I implemented. If you can provide a vCard that makes it crash it should be trivial to add more encodings.


## Works with:

Tested with:
- Radicale CardDav v4. 
- It is necessary to add CORS headers to the radicale configuration (don't add `*`, add app://obsidian). Security wise it's not "the best" to allow any obsidian app to fetch this data, but it's better than nothing.
- Thunderbird contact manager. This does NOT show "CATERGORIES"/"TAGS" but they are in the contact.
- Android phone running /e/os and Davx^5 for syncing
