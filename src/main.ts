import {
  App,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
} from "obsidian";

import { DAVAccount, fetchAddressBooks, fetchVCards, updateVCard } from "tsdav";
import {
  authenticate,
  findFileByFrontmatter,
  FolderSuggestModal,
} from "./util.ts";
import { cardParse } from "@zweieuro/davparse";
import { createPhotoFile } from "./image.ts";
import { getRelevantCardInfoFromFile } from "./cardUtil.ts";

interface CardSyncSettings {
  username: string;
  password: string;
  serverUrl: string;
  rootUrl: string;
  homeUrl: string;
  syncFolderLocation: string;
  cardIdKey: string;
  writeOnModify: boolean;
}

const DEFAULT_SETTINGS: CardSyncSettings = {
  username: "",
  password: "",
  serverUrl: "",
  rootUrl: "",
  homeUrl: "",
  syncFolderLocation: "",
  cardIdKey: "UID",
  writeOnModify: false,
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

    // This adds a settings tab so the user can configure various aspects of the plugin
    this.settingsTab = new CardsyncSettingsTab(this.app, this);
    this.addSettingTab(this.settingsTab);

    this.app.vault.on("modify", (afile) => {
      const file = this.app.vault.getFileByPath(afile.path);
      if (!file) {
        console.error("DavSync could not get file from abstract file path ?");
        return;
      }
      this.handleFileModified(file);
    });
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

  getDavData() {
    if (!this.settingsValid()) {
      console.warn("DavSync Settings Invalid");
      new Notice("Dav settings invalid");
      throw new Error("DavSync Settings invalid");
    }

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

    return {
      headers,
      account,
    };
  }

  async getAddressBook() {
    const addressBooks = await fetchAddressBooks(this.getDavData());

    if (addressBooks.length !== 1) {
      console.warn(
        "Cannot determine adressbook. The credentials and info must return a SINGLE adressbook.",
      );
      new Notice("Error: DavSync URL returned multiple address books");
      return null;
    }

    return addressBooks[0];
  }

  async validateClient(): Promise<string> {
    const { headers } = this.getDavData();

    const addressBook = await this.getAddressBook();
    if (!addressBook) {
      return "Credentials and 'fetchAdressBook' must return a single adressbook. Given info returned an array";
    }

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

      const parsed_list = cardParse.parseVCards(card.data);

      if (parsed_list.length !== 1) {
        return "Only a single contact may exist in any dataset of a dav entry";
      }

      const parsed = parsed_list.at(0)!;

      if (!parsed.get("fn")) {
        return "A contact does not have an expected 'FN' (Full name) field. The property is expected to be an array with a single entry that has a non empty string value.";
      }

      const idProp = parsed.get(this.settings.cardIdKey);
      if (!idProp || typeof idProp.value !== "string") {
        return `Contacts require the ID field set by your settings ${this.settings.cardIdKey}, must have single entry`;
      }
    }
    return "";
  }

  async handleFileModified(file: TFile) {
    if (!this.settingsValid() || !this.settings.writeOnModify) {
      return;
    }

    if (file.parent?.path !== this.settings.syncFolderLocation) {
      console.debug("Not in sync folder");
      return;
    }

    const { cardUrl, aliases, categories, note } =
      await getRelevantCardInfoFromFile(
        this.app,
        file,
      );

    if (!cardUrl) {
      console.warn("No card url prop for file", file.basename);
      new Notice("Could not extract card url for updating");
      return;
    }

    const { headers } = this.getDavData();

    const addressBooks = await this.getAddressBook();

    if (!addressBooks) {
      return;
    }

    const contact = (await fetchVCards({
      addressBook: addressBooks,
      headers,
      objectUrls: [cardUrl],
    })).at(0);
    if (!contact) {
      console.warn("Could not fetch vCard from Url");
      new Notice("Could not fetch vCard from Url");
      return;
    }

    const parsed = cardParse.parseVCards(contact.data).at(0);

    if (!parsed) {
      console.warn("Could not parse contact from response");
      new Notice("Failed to parse contact from url response");
      return;
    }

    const parsedStringRepr = parsed.repr();

    if (aliases) {
      parsed.update_value("X-CUSTOM1", aliases.join(","));
    }
    if (categories) {
      // WE always make it to an array, but if it is a single value then it is expected to stay a single value
      if (typeof categories === "string") {
        parsed.update_value("categories", categories);
      } else if (categories.length === 1) {
        parsed.update_value("categories", categories.at(0)!);
      } else {
        parsed.update_value("categories", {
          valueListDelim: ",",
          listVals: categories,
        });
      }
    }

    if (note) {
      parsed.update_value("note", note);
    }

    if (parsedStringRepr === parsed.repr()) {
      return;
    }

    await updateVCard({
      vCard: {
        url: cardUrl,
        data: parsed.repr(),
      },

      headers: headers,
    });

    new Notice("Updated vCard");
  }

  async syncDownClient(): Promise<void> {
    const { headers } = this.getDavData();

    const addressBook = await this.getAddressBook();
    if (!addressBook) {
      return;
    }

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

      const parsed_list = cardParse.parseVCards(card.data);

      if (parsed_list.length !== 1) {
        console.error(
          "Only a single contact may exist in any dataset of a dav entry",
        );
        return;
      }

      const parsed = parsed_list.at(0)!;

      if (!parsed.getSingleVal("fn")) {
        console.error(
          "A contact does not have an expected 'FN' (Full name) field. The property is expected to be an array with a single entry that has a non empty string value.",
        );
        return;
      }
      console.debug(parsed);

      const idPropKey = this.settings.cardIdKey;
      let cardId = parsed.getSingleVal(idPropKey);
      if (!cardId) {
        console.error(
          `Contacts require the ID field set by your settings ${this.settings.cardIdKey}, must have single entry`,
        );
        return;
      }

      // get the unique ID for the current card
      if (!cardId) {
        console.error(
          `Contacts require the ID field set by your settings ${idPropKey}, must have single entry`,
          cardId,
        );
        return;
      } else {
        // remove any nesting
        cardId = cardId.replaceAll(/[\"|']/g, "");
      }
      // open existing files if possible

      const fn = parsed.getSingleVal("fn");
      if (!fn) {
        console.error("expected fn to be single string value");
        return;
      }

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
      }

      if (!file) {
        console.warn("could not create or find file? ");
        return;
      }

      // NOTE: Anything that may be "async" must be done beforehand
      // cant modify while editing fontmatter, race condition

      const contactPhoto = await createPhotoFile(this.app, parsed, file);

      const note = parsed.getSingleVal("NOTE");
      if (note) {
        await this.app.vault.modify(
          file,
          `# Note:\n${parsed.getSingleVal("note")}`,
        );
      }

      //NOTE: DO NOT make this async, for some reason some thing break.
      // Seems that obsidian is partially updating the fontmatter, making this object invalid during the process. which is not exactly good
      await this.app.fileManager.processFrontMatter(file, (fm) => {
        fm["obs_sync_url"] = card.url;

        for (const propKey of parsed.get_data().keys()) {
          // map the prop into a single value or an array
          const propValue = parsed.get(propKey);
          if (
            !propValue ||
            (typeof propValue.value !== "string" &&
              propValue.value.listVals.length === 0)
          ) {
            continue;
          }
          delete fm[propKey];

          switch (propKey) {
            case "X-CUSTOM1":
              fm["aliases"] = parsed.getSingleVal("X-CUSTOM1")!.split(",");

              break;
            case "CATEGORIES": {
              const categories = propValue.value;
              if (typeof categories === "string") {
                fm["tags"] = categories;
              } else {
                fm["tags"] = categories.listVals;
              }

              break;
            }
            case "NOTE": {
              //skip, parsed beforehand
              break;
            }
            case "PHOTO": {
              if (contactPhoto) {
                fm[propKey] = contactPhoto.frontmatter;
              }
              break;
            }
            default:
              if (typeof propValue.value === "string") {
                fm[propKey] = propValue.value;
              } else {
                fm[propKey] = propValue.value.listVals;
              }
          }
        }
      });

      // check if the name changed
      if (file.name !== `${fn}.md`) {
        console.log("moving, name missmatch ", file.name, fn);
        await this.app.fileManager.renameFile(
          file,
          `${file.parent!.path}/${fn}.md`,
        );

        if (contactPhoto) {
          await this.app.vault.delete(
            contactPhoto.file,
          );
        }
      }
    }

    new Notice(`Success downloading ${cards.length} contacts`);
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
      settingsfield: Exclude<keyof CardSyncSettings, "writeOnModify">,
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

    new Setting(containerEl)
      .setName("Upload on Modify")
      .setDesc(
        "When a contact is modified, attempt to sync that contact upwards",
      ).addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.writeOnModify)
          .onChange((newVal) => {
            this.plugin.settings.writeOnModify = newVal;
            this.plugin.saveSettings();
          });
      });
  }
}
