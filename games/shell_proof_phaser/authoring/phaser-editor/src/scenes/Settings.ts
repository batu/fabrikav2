
// You can write more code here

/* START OF COMPILED CODE */

import Phaser from "phaser";
import Semantic from "../components/Semantic";
/* START-USER-IMPORTS */
/* END-USER-IMPORTS */

export default class Settings extends Phaser.Scene {

	constructor() {
		super("Settings");

		/* START-USER-CTR-CODE */
		// Write your code here.
		/* END-USER-CTR-CODE */
	}

	preload(): void {

		this.load.pack("asset-pack", "asset-pack.json");
	}

	editorCreate(): void {

		// settings.page
		const settings_page = this.add.container(195, 422);

		// settings.title
		const settings_title = this.add.text(195, 16.88, "", {});
		settings_title.setOrigin(0.5, 0);
		settings_title.text = "Settings";
		settings_title.setStyle({ "color": "#ffffff", "fontFamily": "kenney_future", "fontSize": "28px" });

		// settings.back
		const settings_back = this.add.image(15.6, 21.1, "icon_control_back");
		settings_back.scaleX = 0.546;
		settings_back.scaleY = 0.5908;
		settings_back.setOrigin(0, 0);

		// settings.music
		const settings_music = this.add.text(195, 286.96, "", {});
		settings_music.setOrigin(0.5, 0.5);
		settings_music.text = "Music";
		settings_music.setStyle({ "color": "#ffffff", "fontFamily": "kenney_future", "fontSize": "28px" });

		// settings.sfx
		const settings_sfx = this.add.text(195, 371.36, "", {});
		settings_sfx.setOrigin(0.5, 0.5);
		settings_sfx.text = "SFX";
		settings_sfx.setStyle({ "color": "#ffffff", "fontFamily": "kenney_future", "fontSize": "28px" });

		// settings.haptics
		const settings_haptics = this.add.text(195, 455.76, "", {});
		settings_haptics.setOrigin(0.5, 0.5);
		settings_haptics.text = "Haptics";
		settings_haptics.setStyle({ "color": "#ffffff", "fontFamily": "kenney_future", "fontSize": "28px" });

		// settings_page (components)
		const settings_pageSemantic = new Semantic(settings_page);
		settings_pageSemantic.fabSemanticId = "settings.page";
		settings_pageSemantic.fabRole = "page-surface";
		settings_pageSemantic.fabBinding = "presentation.static";
		settings_pageSemantic.fabVariant = "default";

		// settings_title (components)
		const settings_titleSemantic = new Semantic(settings_title);
		settings_titleSemantic.fabSemanticId = "settings.title";
		settings_titleSemantic.fabRole = "screen-title";
		settings_titleSemantic.fabBinding = "presentation.static";
		settings_titleSemantic.fabSlot = "title-logo";
		settings_titleSemantic.fabVariant = "default";

		// settings_back (components)
		const settings_backSemantic = new Semantic(settings_back);
		settings_backSemantic.fabSemanticId = "settings.back";
		settings_backSemantic.fabRole = "header-back-action";
		settings_backSemantic.fabBinding = "flow.settings-back";
		settings_backSemantic.fabSlot = "icon-control";
		settings_backSemantic.fabVariant = "default";

		// settings_music (components)
		const settings_musicSemantic = new Semantic(settings_music);
		settings_musicSemantic.fabSemanticId = "settings.music";
		settings_musicSemantic.fabRole = "center-toggle-action";
		settings_musicSemantic.fabBinding = "settings.music";
		settings_musicSemantic.fabSlot = "toggle-control";
		settings_musicSemantic.fabVariant = "default";

		// settings_sfx (components)
		const settings_sfxSemantic = new Semantic(settings_sfx);
		settings_sfxSemantic.fabSemanticId = "settings.sfx";
		settings_sfxSemantic.fabRole = "center-toggle-action";
		settings_sfxSemantic.fabBinding = "settings.sfx";
		settings_sfxSemantic.fabSlot = "toggle-control";
		settings_sfxSemantic.fabVariant = "default";

		// settings_haptics (components)
		const settings_hapticsSemantic = new Semantic(settings_haptics);
		settings_hapticsSemantic.fabSemanticId = "settings.haptics";
		settings_hapticsSemantic.fabRole = "center-toggle-action";
		settings_hapticsSemantic.fabBinding = "settings.haptics";
		settings_hapticsSemantic.fabSlot = "toggle-control";
		settings_hapticsSemantic.fabVariant = "default";

		this.events.emit("scene-awake");
	}

	/* START-USER-CODE */

	// Write your code here

	create() {

		this.editorCreate();
	}

	/* END-USER-CODE */
}

/* END OF COMPILED CODE */

// You can write more code here
