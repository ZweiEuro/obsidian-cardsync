import { App, Notice, Plugin, PluginSettingTab, Setting } from "obsidian";

import { DAVAccount, fetchAddressBooks, fetchVCards, updateVCard } from "tsdav";

import vCard from "vcard-parser";

import {
  authenticate,
  card_t,
  findFileByFrontmatter,
  FolderSuggestModal,
  getSingleProp,
} from "./util.ts";

interface CardSyncSettings {
  username: string;
  password: string;
  serverUrl: string;
  rootUrl: string;
  homeUrl: string;
  syncFolderLocation: string;
  cardIdKey: string;
}

const DEFAULT_SETTINGS: CardSyncSettings = {
  username: "",
  password: "",
  serverUrl: "",
  rootUrl: "",
  homeUrl: "",
  syncFolderLocation: "",
  cardIdKey: "UID",
};

export default class CardSync extends Plugin {
  settings: CardSyncSettings = DEFAULT_SETTINGS;

  settingsTab: CardsyncSettingsTab | null = null;

  override async onload() {
    await this.loadSettings();

    // This creates an icon in the left ribbon.
    this.addRibbonIcon(
      "arrow-down-to-line",
      "CardSync Read",
      (_: MouseEvent) => {
        this.syncDownClient();
      },
    );
    // This adds an editor command that can perform some operation on the current editor instance
    this.addCommand({
      id: "cardsync-sync-down",
      name: "Sync contacts folder down",
      callback: () => {
        this.syncDownClient();
      },
    });

    this.addRibbonIcon(
      "arrow-up-from-line",
      "CardSync Write",
      (_: MouseEvent) => {
        this.syncUpClient();
      },
    );

    this.addCommand({
      id: "cardsync-sync-up",
      name: "Sync contacts folder up",
      callback: () => {
        this.syncUpClient();
      },
    });

    // This adds a settings tab so the user can configure various aspects of the plugin
    this.settingsTab = new CardsyncSettingsTab(this.app, this);
    this.addSettingTab(this.settingsTab);
  }

  override onunload() {
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.settingsTab?.display();
  }

  settingsValid(): boolean {
    const arr = [
      this.settings.username,
      this.settings.password,
      this.settings.serverUrl,
      this.settings.rootUrl,
      this.settings.homeUrl,
      this.settings.syncFolderLocation,
    ];

    if (arr.some((s) => s.length === 0)) return false;

    return true;
  }

  async validateClient(): Promise<string> {
    const headers = {
      authorization: authenticate(
        this.settings.username,
        this.settings.password,
      ),
    };

    const account: DAVAccount = {
      accountType: "carddav",
      serverUrl: this.settings.serverUrl,
      rootUrl: this.settings.rootUrl,
      homeUrl: this.settings.homeUrl,
    };

    const addressBooks = await fetchAddressBooks({
      account: account,
      headers: headers,
    });

    if (addressBooks.length !== 1) {
      console.warn(
        "Cannot determine adressbook. The credentials and info must return a SINGLE adressbook.",
      );
      return "Credentials and 'fetchAdressBook' must return a single adressbook. Given info returned an array";
    }

    const addressBook = addressBooks[0];

    const cards = await fetchVCards({
      addressBook: addressBook,
      headers: headers,
    });
    // TODO: when done, save the current ctag of the adress book. Then only fetch/sync if the ctag changes

    for (const card of cards) {
      if (
        typeof card.data !== "string" || card.data === null ||
        card.data === undefined
      ) {
        return "A contact in the list did not return its' data a as a 'string'. Cannot parse.";
      }

      const parsed = vCard.parse(card.data);

      if (Array.isArray(parsed)) {
        return "A contact parsed out as an array instead of a single entry. Cannot parse";
      }

      if (!parsed.fn) {
        return "A contact does not have an expected 'FN' (Full name) field. The property is expected to be an array with a single entry that has a non empty string value.";
      }

      const idProp = getSingleProp(parsed, this.settings.cardIdKey);
      if (!idProp) {
        return `Contacts require the ID field set by your settings ${this.settings.cardIdKey}, must have single entry`;
      }
    }
    return "";
  }

  async syncDownClient(): Promise<void> {
    await this.validateClient();

    const headers = {
      authorization: authenticate(
        this.settings.username,
        this.settings.password,
      ),
    };

    const account: DAVAccount = {
      accountType: "carddav",
      serverUrl: this.settings.serverUrl,
      rootUrl: this.settings.rootUrl,
      homeUrl: this.settings.homeUrl,
    };

    const addressBooks = await fetchAddressBooks({
      account: account,
      headers: headers,
    });

    if (addressBooks.length !== 1) {
      console.warn(
        "Cannot determine adressbook. The credentials and info must return a SINGLE adressbook.",
      );
      return;
    }

    const addressBook = addressBooks[0];

    const cards = await fetchVCards({
      addressBook: addressBook,
      headers: headers,
    });

    for (const card of cards) {
      if (
        typeof card.data !== "string" || card.data === null ||
        card.data === undefined
      ) {
        console.warn(
          "A contact in the list did not return its' data a as a 'string'. Cannot parse.",
        );
        return;
      }

      const parsed: card_t = vCard.parse(card.data);

      if (Array.isArray(parsed)) {
        console.warn(
          "A contact parsed out as an array instead of a single entry. Cannot parse",
        );
        return;
      }

      const fn = getSingleProp(parsed, "fn");

      if (!fn) {
        console.warn(
          "A contact does not have an expected 'FN' (Full name) field. The property is expected to be an array with a single entry that has a non empty string value.",
        );
        return;
      }

      // get the unique ID for the current card
      const idPropKey = this.settings.cardIdKey;
      let cardId = getSingleProp(parsed, idPropKey);
      if (!cardId) {
        console.error(
          `Contacts require the ID field set by your settings ${idPropKey}, must have single entry`,
          cardId,
        );
        return;
      }

      if (!cardId) {
        console.error("Contact missing id?", card, parsed);
        return;
      }
      if (cardId) {
        // remove any nesting
        cardId = cardId.replaceAll(/[\"|']/g, "");
      }
      // open existing files if possible

      const fileFolder = this.settings.syncFolderLocation;
      const filePath = `${fileFolder}/${fn}.md`;

      // get a new file or find the existing file
      let file = await findFileByFrontmatter(
        this.app,
        fileFolder,
        idPropKey,
        cardId,
      );

      if (file === null) {
        try {
          file = await this.app.vault.create(filePath, "");
        } catch (e) {
          console.error(
            "Could not create new file at path ",
            filePath,
            "if you manually changed etag values you might have accidentally corrupted a file. Remove the offenting contact.",
            e,
            "id",
            cardId,
          );
          return;
        }
      } else {
        // check if the name changed
        if (file.name !== `${fn}.md`) {
          console.log("moving, name missmatch ", file.name, fn);
          await this.app.vault.rename(file, `${file.parent!.path}/${fn}.md`);
        }
      }

      if (!file) {
        console.warn("could not create or find file? ");
        return;
      }

      const note = getSingleProp(parsed, "note");

      if (note) {
        await this.app.vault.modify(file, `# Note:\n${note}`);
      }

      await this.app.fileManager.processFrontMatter(file, (fm) => {
        fm["obs_sync_url"] = card.url;

        for (const propKey of Object.keys(parsed)) {
          // map the prop into a single value or an array
          const propValue = parsed[propKey];
          if (!propValue || propValue.length === 0) {
            continue;
          }
          delete fm[propKey];

          switch (propKey) {
            case "X-ALIASES":
              fm["aliases"] = getSingleProp(parsed, "X-ALIASES")!.split(",");
              break;
            case "categories":
              const categories = propValue.at(0)!.value;
              if (Array.isArray(categories)) {
                fm["tags"] = propValue[0].value;
              } else {
                fm["tags"] = [propValue[0].value];
              }

              break;
            case "note":
              //skip, parsed beforehand
              break;
            default:
              if (propValue.length === 1) {
                fm[propKey] = propValue[0].value;
              } else if (propValue.length > 1) {
                fm[propKey] = propValue.map((v) => v.value);
              }
          }
        }
      });
    }

    new Notice(`Success downloading ${cards.length} contacts`);
  }

  async syncUpClient(): Promise<void> {
    await this.validateClient();

    const headers = {
      authorization: authenticate(
        this.settings.username,
        this.settings.password,
      ),
    };

    const account: DAVAccount = {
      accountType: "carddav",
      serverUrl: this.settings.serverUrl,
      rootUrl: this.settings.rootUrl,
      homeUrl: this.settings.homeUrl,
    };

    const addressBooks = await fetchAddressBooks({
      account: account,
      headers: headers,
    });

    if (addressBooks.length !== 1) {
      console.warn(
        "Cannot determine adressbook. The credentials and info must return a SINGLE adressbook.",
      );
      return;
    }

    const addressBook = addressBooks[0];

    const cards = await fetchVCards({
      addressBook: addressBook,
      headers: headers,
    });

    let updated = 0;
    for (const card of cards) {
      if (
        typeof card.data !== "string" || card.data === null ||
        card.data === undefined
      ) {
        console.warn(
          "A contact in the list did not return its' data a as a 'string'. Cannot parse.",
        );
        return;
      }

      const parsed: card_t = vCard.parse(card.data);
      const parsedStringRepr = JSON.stringify(parsed);

      if (Array.isArray(parsed)) {
        console.warn(
          "A contact parsed out as an array instead of a single entry. Cannot parse",
        );
        return;
      }

      const fn = getSingleProp(parsed, "fn");

      if (!fn) {
        console.warn(
          "A contact does not have an expected 'FN' (Full name) field. The property is expected to be an array with a single entry that has a non empty string value.",
        );
        return;
      }

      // get the unique ID for the current card
      const idPropKey = this.settings.cardIdKey;
      let cardId = getSingleProp(parsed, idPropKey);
      if (!cardId) {
        console.error(
          `Contacts require the ID field set by your settings ${idPropKey}, must have single entry`,
          cardId,
        );
        return;
      }

      if (!cardId) {
        console.error("Contact missing id?", card, parsed);
        return;
      }
      if (cardId) {
        // remove any nesting
        cardId = cardId.replaceAll(/[\"|']/g, "");
      }
      // open existing files if possible

      const fileFolder = this.settings.syncFolderLocation;

      // get a new file or find the existing file
      const file = await findFileByFrontmatter(
        this.app,
        fileFolder,
        idPropKey,
        cardId,
      );

      if (file === null) {
        console.error("could not find file for ID", idPropKey, cardId);
        continue;
      }

      // extract the "note" section

      const content = await this.app.vault.read(file);
      const split = content.split("# Note:\n");

      if (split.length === 1) {
        // there is no note
      } else if (split.length === 2) {
        parsed["note"] = [{ value: split.at(1) ?? "" }];
      }

      // update aliases, and get the update url

      let cardUrl: string | null = null;
      let aliases: string[] | null = null as null | string[];
      let categories: string[] | null = null as null | string[];

      await this.app.fileManager.processFrontMatter(file, (fm) => {
        aliases = fm["aliases"] ?? null;
        categories = fm["tags"] ?? null;
        cardUrl = fm["obs_sync_url"] ?? null;
      });

      if (aliases) {
        parsed["X-ALIASES"] = [{ value: aliases.join(",") }];
      }
      if (categories) {
        parsed["categories"] = [{ value: categories }];
      }

      if (!cardUrl) {
        console.warn("Could not get update url from file/card id", cardId);
        continue;
      }

      if (parsedStringRepr === JSON.stringify(parsed)) {
        /// nothing changed, skip
        continue;
      }

      await updateVCard({
        vCard: {
          url: cardUrl,
          data: vCard.generate(parsed),
        },

        headers: headers,
      });
      updated += 1;
    }
    new Notice(`Success updating ${updated} contacts`);
  }
}

class CardsyncSettingsTab extends PluginSettingTab {
  plugin: CardSync;

  validationError: string | null = null;

  constructor(app: App, plugin: CardSync) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;

    containerEl.empty();

    new Setting(containerEl).setDesc(
      `This plugin uses https://tsdav.vercel.app/docs/carddav/fetchAddressBooks and https://www.npmjs.com/package/vcard-parser \r
Note that it is NOT a good idea to create a new field by writing it manually, use thunderbird or another editor for that and then edit the value (just to make sure the type fields are formatted as expected.\r
Changing any kind of ID can have unintended side effects with other software!`,
    );

    new Setting(containerEl).setDesc(
      "Fetching remote data will force-overwrite any local changes.",
    );

    new Setting(containerEl).setDesc(
      "I am equating tags-> categories, aliases -> X-ALIASES, note -> file body. ONLY those fields are actually updated. the rest is READ ONLY.",
    );

    new Setting(containerEl).setDesc(
      "This was only tested with /e/os on my phone and thunderbird in combination with a radicale server. If you want to use radicale you will need to add CORS headers to its config.",
    );

    const makeTextSetting = (
      label: string,
      descr: string,
      settingsfield: keyof CardSyncSettings,
    ) => {
      new Setting(containerEl)
        .setName(label)
        .setDesc(descr)
        .addText((text) =>
          text
            .setPlaceholder(`Enter your ${label}`)
            .setValue(this.plugin.settings[settingsfield])
            .onChange(async (value) => {
              this.plugin.settings[settingsfield] = value;
              await this.plugin.saveSettings();
            })
        );
    };

    makeTextSetting("Server Url", "Radicale base server URL", "serverUrl");
    makeTextSetting("Server root url", "Radicale user root URL", "rootUrl");
    makeTextSetting("Resource home url", "Address book URL", "homeUrl");
    makeTextSetting("Username", "Basic authentication username", "username");

    makeTextSetting(
      "Unique identifier",
      "The property key for each card to be uniquely identified (for thunderbids/cardbook its 'UID')",
      "cardIdKey",
    );

    new Setting(containerEl)
      .setName("Password")
      .setDesc(
        "Baisc authentication password. (This is saved as plaintext in obsidians settings!)",
      )
      .addText((text) =>
        text
          .setPlaceholder("Enter your secret")
          .setValue(this.plugin.settings.password)
          .then((t) => t.inputEl.type = "password")
          .onChange(async (value) => {
            this.plugin.settings.password = value;
            await this.plugin.saveSettings();
          })
      );

    // Usage in the settings tab:
    new Setting(containerEl)
      .setName("Folder location")
      .setDesc(
        this.plugin.settings.syncFolderLocation.length === 0
          ? "Choose a folder"
          : `Chosen folder: ${this.plugin.settings.syncFolderLocation}`,
      )
      .addButton((button) =>
        button
          .setButtonText("Browse")
          .onClick(() => {
            new FolderSuggestModal(this.app, (folder) => {
              this.plugin.settings.syncFolderLocation = folder.path;
              this.plugin.saveSettings();
              this.display(); // Refresh the settings display
            }).open();
          })
      );

    new Setting(containerEl)
      .setName("Validate settings")
      .setDesc(
        `Will attempt to connect to the server and fetch the designated adressbook. ${
          this.validationError === null
            ? ("")
            : (this.validationError.length === 0
              ? "Configuration seems valid"
              : `Invalid! Errors: ${this.validationError}`)
        }`,
      )
      .addButton((button) => {
        button
          .setDisabled(!this.plugin.settingsValid())
          .setButtonText("Validate").onClick(async () => {
            this.validationError = await this.plugin.validateClient();
            this.display();
          });
      });

    new Setting(containerEl)
      .setName("Sync now")
      .setDesc(
        "Read remote registry and update local files. Will validate your settings first.",
      )
      .addButton((button) => {
        button
          .setDisabled(
            !this.plugin.settingsValid(),
          )
          .setButtonText("Sync").onClick(async () => {
            this.validationError = await this.plugin.validateClient();

            if (this.validationError !== "") {
              console.warn("validation failed");
              this.display();
              return;
            }

            this.plugin.syncDownClient();
          });
      });
  }
}
