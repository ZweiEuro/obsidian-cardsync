import { App, Plugin, PluginSettingTab, Setting } from "obsidian";

import { DAVAccount, fetchAddressBooks, fetchVCards } from "tsdav";

import { parse as parsevcard, VCARD } from "vcard4";
import {
  authenticate,
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

    if (false) {
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
    }

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

      const parsed = parsevcard(card.data);

      if (Array.isArray(parsed)) {
        return "A contact parsed out as an array instead of a single entry. Cannot parse";
      }

      const nameProp = getSingleProp(parsed, "FN");
      if (nameProp) {
        return "A contact does not have an expected 'FN' (Full name) field. The property is expected to be an array with a single entry that has a non empty string value.";
      }

      const idProp = getSingleProp(parsed, this.settings.cardIdKey);
      if (idProp === null) {
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

      const parsed = parsevcard(card.data);

      if (Array.isArray(parsed)) {
        console.warn(
          "A contact parsed out as an array instead of a single entry. Cannot parse",
        );
        return;
      }

      const nameProp = getSingleProp(parsed, "FN");
      if (!nameProp) {
        console.warn(
          "A contact does not have an expected 'FN' (Full name) field. The property is expected to be an array with a single entry that has a non empty string value.",
        );
        return;
      }

      // get the unique ID for the current card
      const idPropKey = this.settings.cardIdKey;
      const idProp = getSingleProp(parsed, idPropKey);
      if (!idProp) {
        console.error(
          `Contacts require the ID field set by your settings ${idPropKey}, must have single entry`,
          idProp,
        );
      }

      let cardId = idProp?.value ?? null;
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
      const filePath = `${fileFolder}/${nameProp.value}.md`;

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
          );
          return;
        }
      }

      if (!file) {
        console.warn("could not create or find file? ");
        return;
      }

      const note = getSingleProp(parsed, "NOTE");

      if (note) {
        await file.vault.modify(file, `# Note:\n${note.value}`);
      }

      await this.app.fileManager.processFrontMatter(file, (fm) => {
        fm["obs_sync_url"] = card.url;

        for (const prop of parsed.properties) {
          // map the prop into a single value or an array
          const propObj = parsed.getProperty(prop);
          if (propObj.length === 0) {
            continue;
          }
          const propName = propObj[0].property;
          delete fm[propName];
          if (propObj.length === 1) {
            switch (propName) {
              case "X-ALIASES":
                fm["aliases"] = propObj[0].value.split(",");
                break;
              case "NOTE":
                //skip
                break;
              default:
                fm[propName] = propObj[0].value;
                break;
            }
          } else if (propObj.length > 1) {
            fm[propName] = propObj.map((v) => v.value);
          }
        }
      });
    }
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

      const parsed = parsevcard(card.data);

      if (Array.isArray(parsed)) {
        console.warn(
          "A contact parsed out as an array instead of a single entry. Cannot parse",
        );
        return;
      }

      // get the unique ID for the current card
      const idPropKey = this.settings.cardIdKey;
      const idProp = getSingleProp(parsed, idPropKey);
      if (!idProp) {
        console.error(
          `Contacts require the ID field set by your settings ${idPropKey}, must have single entry`,
          idProp,
        );
      }

      let cardId = idProp?.value ?? null;
      if (!cardId) {
        console.error("Contact missing id?", card, parsed);
        return;
      }
      if (cardId) {
        // remove any nesting
        cardId = cardId.replaceAll(/[\"|']/g, "");
      }

      const fileFolder = this.settings.syncFolderLocation;

      // get a new file or find the existing file
      const file = await findFileByFrontmatter(
        this.app,
        fileFolder,
        idPropKey,
        cardId,
      );

      if (file === null) {
        console.error("could not find file for ID", idPropKey);
        continue;
      }

      return;

      // await this.app.fileManager.processFrontMatter(file, (fm) => {
      //   fm["obs_sync_url"] = card.url;
      //
      //   for (const prop of parsed.properties) {
      //     // map the prop into a single value or an array
      //     const propObj = parsed.getProperty(prop);
      //     if (propObj.length === 0) {
      //       continue;
      //     }
      //     const propName = propObj[0].property;
      //
      //     if (fm.hasOwn(propName)) {
      //       parsed.getProperty();
      //     }
      //
      //     if (propObj.length === 1) {
      //       switch (propName) {
      //         case "X-ALIASES":
      //           fm["aliases"] = propObj[0].value.split(",");
      //           break;
      //         case "NOTE":
      //           //skip
      //           break;
      //         default:
      //           fm[propName] = propObj[0].value;
      //           break;
      //       }
      //     } else if (propObj.length > 1) {
      //       fm[propName] = propObj.map((v) => v.value);
      //     }
      //   }
      // });
      //
      // console.log(card, fontMatter);
    }
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
      `This plugin uses https://tsdav.vercel.app/docs/carddav/fetchAddressBooks and https://www.npmjs.com/package/vcard4 \r
Note that it is NOT a good idea to create a new field by writing it manually, use thunderbird or another editor for that and then edit the value.\r
Changing any kind of ID can have unintended side effects with other software!`,
    );

    new Setting(containerEl).setDesc(
      "The plugin will copy the 'X-Aliases' prop to 'Aliases' so obsidian can find it. The field is ignored when syncing. The single-string field is split at ',' for multiple aliases.",
    );

    new Setting(containerEl).setDesc(
      "This plugin will always fetch on software start (overwriting ANY local changes). It also WILL NOT sync unknown contacts, create contacts on other devices first so the have a unique UID.",
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
